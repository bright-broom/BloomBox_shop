# Inboxの調査・削除済み本文の復元

2026-09-17、Issue #137。実装と隔離DBでの検証。公開Vercelへの配備・実Stripeへの接続・実イベントの復旧は未実施。既存の[障害対応](COMMERCE_WORKER_INCIDENTS.md)から継続する。

## 調査

GitHub Actionsの **Commerce Inbox Recovery** をmainから実行し、`operation=inspect`を選ぶ。Production環境の承認とworker秘密値が必要。通常の顧客・管理画面のCookieでは操作できない。認証用秘密値を使える運用者は特権主体であり、`requestedBy`はGitHub workflowが設定する監査参照値。任意の利用者が自己申告するGoogle認証の代替ではない。

- Inbox：設定されたStripeアカウントだけの未完了件数・最古受信日時・削除済み件数。未完了行はUUID順で1ページ50件、`nextCursor`を次の`after`へ渡す。
- Outbox：アカウント列を持たないため、**全プロバイダー合計**のPENDING/FAILED件数と最古日時。配信済みという扱いにはしない。
- 各ページ内の件数と行は同一の読取専用スナップショット。ページ間にはワーカーの更新が入り得るため、調査後に先頭を再確認する。件数はサンプルではなく全件集計、実行が10秒を超える場合は失敗し、部分集計を全体件数に見せない。
- 本文・暗号文・顧客/受取人情報・自由記入エラーは読まない。公開Actionsへの出力は全応答を型・列挙値・件数上限・識別子形式で検証してから実行する。API応答は`Cache-Control: no-store`。

## 本文が削除済みのFAILEDイベント

1. 調査対象の原因修正を配備し、機密情報を含めずIssueに記録する。
2. `operation=restore`、`event_id`（1件）、`incident_issue`、`confirm=true`を指定。main以外、確認なしの復元は実行しない。
3. 復元処理はStripeの読取専用照合キーでアカウント所有を確認し、Events APIからそのイベントだけを取得する。account・mode・イベントID・種別・オブジェクトID・API版・発生日時が既存Inboxと一致する場合のみ、必要項目を既存方式で暗号化する。ブラウザーから本文を受け取るAPIはない。
4. 外部通信が完了してから行ロックを取得し、FAILED・削除済み状態を再確認。本文復元・PENDING化・試行回数リセット・操作者/Issue/保持期限の監査を1取引で確定する。
5. `RESTORED`は「通常ワーカーが処理できる状態へ戻った」の意味。入金・返金・注文の反映完了を意味しない。次のワーカー処理と財務照合を確認する。

| 結果 | 対応 |
| --- | --- |
| RESTORED | 次のワーカーと対象取引の整合性を確認 |
| NOT_FOUND | 対象IDまたは設定アカウントを再確認 |
| NOT_FAILED | 状態が進んでいるため再調査。変更なし |
| PAYLOAD_RETAINED | 既存Commerce Inbox Requeueを使う。復元なし |
| PROVIDER_UNAVAILABLE | 未提供・取得期限外・権限不足・不整合応答・外部障害。FAILEDを保持して調査 |
| EVENT_MISMATCH | 保存済み識別情報と一致しない。FAILEDを保持して調査 |
| ALREADY_RESTORED | 同じイベントの復元済み監査が存在。保持延長を繰り返さず、個別調査を継続 |

Stripeの[イベント取得](https://docs.stripe.com/api/events/retrieve)は作成後30日以内が対象。BloomBoxの通常本文保持も30日のため、自然な期限切れ後には取得できない可能性が高い。このツールは早期消去やStripeが取得可能な場合の限定的な復旧手段であり、消失した全取引の復元を保証しない。取得できない場合は手動でPROCESSED/RESOLVEDに変更せず、Stripe管理画面・財務照合に基づき修正方法を別途レビューする。IssueとFAILED警告は残す。

## 保持・権限・安全性

復元本文の`payload_expires_at`は復元時刻+24時間。同一イベントの復元は監査キーで一度に制限し、繰り返しによる期限延長を防ぐ。既存保持ジョブはPROCESSED/FAILEDのみを消去するため、PENDING/PROCESSINGが長期化すると24時間を超えて保持される。これは処理途中の入力を失わないための既存方針であり、**絶対24時間以内の消去保証ではない**。監視で滞留を調査する。

既存`bloombox_worker`のInbox SELECT/UPDATE、Outbox SELECT、監査SELECT/INSERTを使う。追加DB migration・ロール・依存ライブラリは不要。Stripe照合キーには現在のアカウントとEventsの読取権限が必要であり、鍵をチャットや公開Issueへ貼らない。Web側のruntime=production/checkoutProvider=stripe設定が有効な場合のみ接続される。販売開始承認とは別。

ネットワークは1回10秒、自動再試行なし。復元は1リクエスト1件、入力実バイト1024・読取5秒に制限。固定長バッファと単調時計の期限を使い、空チャンクの連続入力を拒否し、分割UTF-8は全体を揃えてから厳密に復号する。同時復元・ワーカー・保持処理を行ロックで直列化し、監査失敗時は復元もロールバック。通信不明時は再実行で状態を確認し、財務状態そのものはここで変更しない。

## 検証・残件・戻し方

確認結果：通常52件、専用隔離DB16件、`pnpm check:static`、`pnpm build`が成功。

通常試験：実SDKのGET/固定API版/キー選択/別account・mode拒否/404・外部障害、認証前の拒否・入力制限・機密応答非表示、公開Actionsの不正応答拒否。隔離PostgreSQL：暗号化復元・既存ワーカーで復号、同時要求、監査失敗の原子性、別account/識別子/時刻不一致、行変更競合、期限後消去・再復元禁止、50件ページング、既存workerロールの実行を確認。

Issue #137全体は未完。Outboxの通知consumer・送信先/送信主体・再送/重複防止の実配信、Outbox保持期限と削除条件は#125の通知設計と実接続に依存する。未送信Outboxを空にする目的で削除/PUBLISHED化しない。

戻す場合は新workflowの利用を止めてコードを戻す。既に復元済みのPENDINGイベントは既存ワーカーで処理可能なままであり、本文・監査・状態を直接巻き戻さない。新しいマイグレーションはない。配備後も販売停止・既存公開先設定を維持する。
