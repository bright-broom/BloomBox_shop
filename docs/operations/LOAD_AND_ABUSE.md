# 負荷・濫用・上限（Issue #139 / P1-05）

2026-09-17。基準 main `2c564d9`。実装・隔離DBの合成負荷検証を追加した。**販売量の見積もり、実Stripeテスト環境と公開接続での負荷検証は未完了**。本記録だけで #139 の販売量に関する完了条件や販売開始ゲートを満たさない。

## 修正した未制限経路

Stripe Webhook と郵便番号 API は、`Content-Length` を省略・偽装すると、本文を全量読み込んでからサイズを判定していた。ストリームの各チャンクで実バイト数を判定し、上限を超えた時点で読取を中止する共通処理へ変更した。Shopify も同じ処理を使用する。

| 入り口 | 実施する制限 | 失敗時 |
| --- | --- | --- |
| Stripe / 旧Shopify Webhook | 1,000,000 bytes、読取全体2秒、未進行の空チャンクを拒否 | 超過413・期限408・壊れた本文400。保存前に拒否し、成功受理としない |
| 郵便番号 POST | 256 bytes、読取全体2秒、形式検証 | 外部呼出しをせず拒否。通常のサービス障害では住所の手入力が可能 |
| 購入開始 | 既存のサーバー側価格・数量・配送日・本人検証、同一request IDの照合、DB唯一制約 | 不一致は拒否。同一購入の再送でIntent/Outboxを増やさない |
| 注文参照 | 既存の参照形式検証、checkout参照による限定検索・LIMIT 1、ブラウザーの4秒×10回ポーリング | 不正参照でDBを呼ばない。表示情報は従来の限定情報を維持 |

本文の保持は固定長バッファで上限を設け、細切れチャンクごとのタイマーを解放する。全体期限は単調増加時計でも判定するため、即時完了するチャンク列がタイマーの実行を妨げても読取を続けない。中止処理自体が停止した場合に期限を失わないよう、cancel完了を待たない。

## DB接続と導入条件

既存の接続数上限（既定5、設定可能1〜20）、接続10秒、idle20秒、寿命30分を維持。これは**1プロセス・1接続用途ごとの上限**であり、Vercel全体の接続数やレートを保証しない。

追加設定は明示的なオプトインとする。

| 設定名 | 既定 | 許容範囲 |
| --- | --- | --- |
| `DATABASE_CONNECTION_TIMEOUTS_ENABLED` | `false` | `true` / `false` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `10000` | 100〜60000 ms |
| `DATABASE_LOCK_TIMEOUT_MS` | `2000` | 50〜30000 ms、statement未満 |

有効時はPostgreSQL接続に `statement_timeout`、`lock_timeout`、`idle_in_transaction_session_timeout`（statementと同値）を渡す。無効時はこれらの起動パラメータを**送らない**。既存の公開Google認証・Neon接続を、未確認の起動パラメータで壊さないためである。無効時にアプリ側SQL期限が有効であるとは報告しない。

有効化前に、対象の**同じ接続URL・ログインロール・pooler**を使った隔離環境で次を確認する。

1. 接続が成功し、`current_setting('statement_timeout')` / `current_setting('lock_timeout')` が期待値である。
2. 新しい接続と同時接続でも設定が有効。長いクエリ・ロック競合が期限で失敗する。
3. トランザクション全体が戻り、接続の再利用が成功する。Workerの通常バッチが期限内である。
4. 非対応poolerでは有効化せず、DB運用者が専用ログインロールの既定値や対象トランザクションの設定方法を検討する。`Promise.race`だけでDB処理を放置する代替にはしない。

直結PostgreSQLの結果はNeon/PgBouncerとの互換性を証明しない。[PostgreSQLの期限仕様](https://www.postgresql.org/docs/18/runtime-config-client.html)、[Postgres.jsの接続設定](https://github.com/porsager/postgres#connection-details)、[Neonの接続プール](https://neon.com/docs/connect/connection-pooling)を参照。

## 合成負荷の再実行

実サービス・実顧客・Stripe API・ZipCloudへアクセスしない。ループバックホストかつDB名に `test` を含む専用DBを使用する。通常テスト用DBを使用し、業務DBの名前を変更して検査を回避しない。試験はmigrationを適用して合成データを残すため、使い捨てDBに限定する。

```sh
TEST_DATABASE_URL=postgres://localhost:55462/test_big139 pnpm exec vitest run \
  --config vitest.database.config.ts \
  src/shared/infrastructure/database/commerce-load.database.test.ts \
  src/shared/infrastructure/database/postgres-client.database.test.ts \
  --disableConsoleIntercept
```

**工学上の小規模ベースライン**：各シナリオ12並列、DBプール2、合計540操作。想定販売量をユーザーの承認なしで決めたものではない。実CreatePurchaseIntent・暗号化PostgreSQL保存・注文参照・Stripe SDKの署名検証・Inbox保存を使う。商品はプレビューフィクスチャであり、実在庫・Google・Stripe Checkout・Webhook後続処理を含むE2Eではない。郵便番号の応答は固定JSONで、Nextの実キャッシュ命中率・上流の遅延は測定対象外。

2026-09-17、Darwin arm64、Node24、PostgreSQL18.6、ローカル実測：

| シナリオ | 操作数 | p50 ms | p95 ms | p99 ms | 全体 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 購入開始（60購入×同時再送2） | 120 | 8.61 | 40.67 | 45.00 | 125 |
| checkout参照 | 120 | 0.36 | 5.04 | 5.58 | 9 |
| 署名付きWebhook（60イベント×2） | 120 | 4.15 | 11.69 | 12.31 | 54 |
| 郵便番号（固定上流応答） | 120 | 0.55 | 1.95 | 1.98 | 7 |
| プール飽和（2msのDB待機） | 60 | 13.61 | 14.00 | 14.44 | 69 |

正しさの条件：Intent60件、購入開始Outbox60件、Inbox60件、重複受理60件、参照120件が期待状態、観測DB backend数2以下。すべて成功。性能値は機材・実行順に依存するので、CIで厳しい遅延閾値を固定しない。スループット表示もローカル合成処理の値であり、Vercelの販売処理能力ではない。

追加の隔離DB試験3件で、実セッションの期限値、重いクエリの中断・書込ロールバック・プール復旧、ロック待機の中断と再取得を確認。HTTP/設定の試験では、長さ偽装、細切れUTF-8、上限ちょうど、空チャンク、停止ストリーム、停止cancel、切断、郵便番号への100件同時の超過本文（外部呼出し0件）を確認。

## 残る公開前確認

- #115の隔離Stripe環境で、事業者が見込む通常/ピークの購入数・同時利用・Webhook再送量を数値化して再実測。対象SHA・環境・DB容量・cold start・認証・外部遅延を記録する。
- 実際の429/5xx、DB待ち、接続数、郵便番号のcache hitを観測し、閾値と共有ストア/WAFの必要性を判断する。既存の郵便番号24時間Nextキャッシュを維持するが、この試験で公開先のキャッシュ動作を証明したものではない。
- 分散レート制限は未追加。プロセスメモリのカウンターをVercel全体の濫用対策とは扱わない。必要時は信頼できる利用者識別と共有カウンターを設計し、購入済み操作の再送を通せる形にする。
- Webhookは署名・保存・冪等処理で保護し、送信元IPの一律制限で正当な決済イベントを捨てない。保存失敗を2xxに変えない。

## ロールバック

DB schema / migration の追加はない。DB期限設定は未有効化が既定。有効化後の互換性問題は `DATABASE_CONNECTION_TIMEOUTS_ENABLED=false` と再配備で戻す。HTTP変更はこのPRをrevertできるが、本文の後判定という弱点が戻るため、可能ならサイズ・期限を保った修正を優先する。適用前のDB/外部設定と公開SHAを記録し、main更新と公開配備を分ける。
