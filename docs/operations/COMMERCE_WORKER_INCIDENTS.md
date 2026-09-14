# コマースワーカーの障害対応

対象は、GitHub Issue「[Production] Stripe commerce worker is failing」です。5分ごとの Commerce Worker（`.github/workflows/commerce-reconciliation.yml`）が失敗すると、このIssueが作成または再オープンされます。成功すると閉じます。

2026-09-14から、ワーカーは実行のたびに未解決の件数を数えます。失敗した通知や、要確認の未記録決済が1件でも残っていれば、その回に新しく発生していなくても実行を失敗させます。そのため、解決するまでIssueは閉じません。

## 最初に確認すること

1. Issue本文の未解決件数を見ます。「failed Inbox event(s)」は失敗した通知、「unrecorded checkout(s) awaiting review」は要確認の未記録決済です。
2. 件数が書かれていない場合は、認証・通信・想定外エラーによる失敗です。ワークフロー実行ログのHTTPステータスを確認します。
   - 401：`COMMERCE_WORKER_SECRET` の不一致
   - 500で件数あり：未解決データが残っている（下記B・C）
   - 500で件数なし：想定外エラー（下記A）
3. 本番の新規購入が停止中でも、ワーカーは既存取引の処理のために動きます。ワークフローを無効化して障害を隠さないでください。

Issueやチャットには、表示ID・購入準備ID・イベントIDだけを書きます。顧客の氏名・住所・電話番号・メッセージ・決済URLは貼りません。

## A. 想定外エラー（件数なし）

- アプリの構造化ログで、`event=unexpected_error`、`operation=reconcile_stripe_events` の `errorType` と `errorId` を確認します。Stripe障害、DB接続、Stripeの件数上限（`StripeReconciliationLimitError`、`StripeCheckoutLookupLimitError`）などが原因です。
- 原因が解消すれば、次の実行で自動的に回復し、Issueは閉じます。DBを手で変更する必要はありません。
- 件数上限の変更や不具合の修正は、PRで行います。

## B. 失敗した通知（failed Inbox events）

**意味**：Stripeの署名検証済みイベントが12回処理に失敗し、`webhook_inbox.status = 'FAILED'` のまま残っています。注文・入金・返金・在庫の解放が反映されていない可能性があります。

読み取り専用ロール（`bloombox_readonly`）で確認します。

```sql
SELECT id, external_event_id, event_type, external_object_id, attempts, last_error_code, received_at
FROM bloombox.webhook_inbox
WHERE commerce_provider = 'STRIPE' AND status = 'FAILED'
ORDER BY received_at;
```

- Stripe管理画面で `external_event_id` のイベントと、対象オブジェクト（Checkout Session、PaymentIntent、Refund、Dispute）の現在の状態を確認します。
- `last_error_code` から原因を切り分けます。
  - `InvalidStripeCommerceEventError`：保存済みの状態とイベントが矛盾しています。
  - `StripeCommerceEventDependencyError`：先に処理されるべきイベントが未処理です。
  - 在庫関連のエラー：予約と購入準備の状態が整合していません。
- コードに原因がある場合は、修正PRを配備します。
- 失敗した通知を再処理する運用ツールは未実装です（残課題台帳 P1-03）。行を手でUPDATE・DELETEして状態を戻さないでください。解決手段が整うまで、Issueは開いたままになります。
- イベントの本文は暗号化されて保存され、保持期限を過ぎると削除されます。期限内に調査してください。

## C. 要確認の未記録決済（unrecorded checkouts awaiting review）

**意味**：決済先にStripeを選んだものの、Checkout SessionのIDを保存できなかった購入準備です。期限後の照合で、Stripe上に「期限切れ・未払い」以外のSession（完了・支払処理中・有効など）が見つかりました。顧客が支払っている可能性があります。予約は保持したままで、自動では解放しません（[ADR 0010](../architecture/adr/0010-native-inventory-reservations.md)）。

読み取り専用ロールで確認します。

```sql
SELECT intent.id, intent.display_id, intent.created_at, intent.expires_at,
  review.occurred_at AS reviewed_at, review.safe_metadata
FROM bloombox.purchase_intents AS intent
JOIN bloombox.audit_logs AS review
  ON review.resource_type = 'PurchaseIntent'
  AND review.resource_id = intent.id
  AND review.action = 'checkout.unrecorded_session.review_required'
WHERE intent.status = 'READY_FOR_CHECKOUT'
  AND intent.commerce_provider = 'STRIPE'
  AND intent.external_checkout_id IS NULL;
```

- Stripe管理画面で、`created_at` から `expires_at` までに作られたCheckout Sessionのうち、`client_reference_id` が購入準備IDと一致するものを探し、支払状況を確認します。
- 支払済みの場合は、注文が作られていない入金として扱います。顧客への連絡、発送するか返金するかの判断は担当者が行います。
- 未記録のSessionを購入準備に取り込み、注文を作る運用ツールは未実装です。予約を手で解放したり、購入準備の状態を手で変えたりしないでください。

## やってはいけないこと

- `purchase_intents`・在庫・`webhook_inbox` の状態を手でUPDATEして障害を閉じる。
- 監査ログを削除する。
- ワークフローを無効化して障害を隠す。販売停止の判断は [Stripe](STRIPE.md) の緊急停止手順に従う。
- 決済結果が不明な予約を、Stripe側の証拠なしに解放する。

## 記録

Issueに、確認日時、対象のイベントIDまたは購入準備ID、原因、対応したPR、残っている件数を残します。
