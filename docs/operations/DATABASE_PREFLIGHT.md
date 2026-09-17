# 配備前のDB履歴確認（2026-09-18、#121/#122）

`pnpm db:status` は対象DBを変更せず、チェックアウトしたコードのmigrationと適用履歴を照合する。`db:migrate` は未適用SQLを実行するため、確認目的で代用しない。

## 実行

承認された接続先の秘密管理から `DATABASE_STATUS_URL` を環境変数として渡し、対象コミットの作業ディレクトリで `pnpm db:status` を実行する。URL・パスワードをIssue、文書、コマンド履歴に貼らない。通常の `DATABASE_URL` を自動流用しない。証跡には接続先の非機密な環境名と `git rev-parse HEAD` のSHAを別途記録し、URLは記録しない。

- 既定は証明書検証付きTLS。URL query/hashは拒否し、接続オプションの曖昧な上書きを防ぐ。
- `DATABASE_STATUS_SSL_MODE=disable` は明示したloopbackテスト接続だけに許可。遠隔DBでは使えない。
- 接続ロールは対象DBへのCONNECT、`bloombox`へのUSAGE、`bloombox.schema_migrations`へのSELECTがあればよい。migration所有者や顧客テーブルの読取権限は不要。ロールの作成・付与は本コマンドで行わない。
- 接続時にread-onlyを指定し、repeatable-read/read-only transaction内で履歴だけを取得。SQLは実行せず、スキーマ・台帳の初期化もしない。接続10秒・各問い合わせ10秒の上限を設ける。

| 結果 | 終了コード | 対応 |
| --- | --- | --- |
| `current` | 0 | 同コミットのmigration履歴に一致。次の配備条件を確認する |
| `pending` | 1 | JSONの`pending`に未適用ファイルを表示。適用担当が影響・戻し方を確認して別工程で適用する |
| `MIGRATION_HISTORY_MISMATCH` | 1 | 適用履歴の欠番・重複・未知版・名前/checksum差異。配備を止め、対象環境/コミット/履歴を調査する |
| `INVALID_CONFIGURATION` / `INVALID_LOCAL_SEQUENCE` / `INSPECTION_FAILED` | 1 | 設定、コード側連番、接続/権限等を調査。成功扱いにしない |

台帳が存在しない場合は`ledgerPresent: false`で全件未適用として返し、何も作成しない。任意のDBエラー文は接続先や秘密値を含む可能性があるため出力せず固定コードにする。JSONは件数とローカルの未適用ファイル名のみで、顧客情報・DBの任意文字列・接続先を含まない。

## 判定の限界

これは履歴照合であり、テーブルを手動変更した後の物理スキーマ差分、実効権限の網羅検査、暗号鍵、データの正当性、バックアップ、Stripe、販売開始の承認を証明しない。取得後に別作業でDBが変わる可能性があるため、適用直前/直後に同じSHAで再確認する。適用SQL自体のチェックサム検査は既存migration処理が引き続き行う。

現在mainのファイルは0028まで。公開DBの0027適用は過去の記録であり、今回再確認した状態ではない。公開DBには接続していない。

## 検証・戻し方

通常15件と、使い捨てDBでの実PostgreSQL試験1件が成功。未初期化DB、正常な履歴、未適用の追加SQL、SELECT-onlyロール、不一致、CLI終了コードを確認。検査前後の台帳・サンプル行を比較し、追加SQLが適用されないことを確認した。CIの隔離DB/復元演習ステップでもこの検査を実行する。

通常suiteはDB試験を環境変数なしではskipする。実行する場合は専用loopback PostgreSQLの`postgres`管理DBを `TEST_RESTORE_DRILL_ADMIN_URL` に指定する。試験用DB/ロールはランダム名で作成し終了時に削除する。公開DBで試験しない。

コード・package script・CI対象をrevertできる。業務DBの変更やmigration追加はない。

## Issue再整理

残存48件のうち、#121の「0026まで」を対象SHAの全migration（現時点0028）へ修正する。#137は権限付き調査・再処理・本文復元が実装済みのため、旧「実装待ち」表記を削除し、実Stripe/公開配備・取得期限外復旧・通知consumerの判断と保持条件を残す。これらを未完のまま閉じず、再実装を防ぐ。
