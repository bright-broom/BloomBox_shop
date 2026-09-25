# コマースワーカーの障害対応

対象は、GitHub Issue「[Production] Stripe commerce worker is failing」です。5分ごとの Commerce Worker（`.github/workflows/commerce-reconciliation.yml`）が失敗すると、このIssueが作成または再オープンされます。成功すると閉じます。

2026-09-14から、ワーカーは実行のたびに未解決の件数を数えます。失敗した通知や、要確認の未記録決済が1件でも残っていれば、その回に新しく発生していなくても実行を失敗させます。そのため、解決するまでIssueは閉じません。

## 最初に確認すること

1. Issue本文の未解決件数を見ます。「failed Inbox event(s)」は失敗した通知、「unrecorded checkout(s) awaiting review」は要確認の未記録決済、「Buyer notifications: N undelivered」「delivery cannot run」は購入者へのメールが届かない状態（下記D）、「Orders not yet shipped …」はお届け日が近い未発送の注文（下記E）です。
2. 件数が書かれていない場合は、認証・通信・想定外エラーによる失敗です。ワークフロー実行ログのHTTPステータスを確認します。
   - 401：`COMMERCE_WORKER_SECRET` の不一致
   - 500で件数あり：未解決データが残っている（下記B〜E）
   - 500で件数なし：想定外エラー（下記A）
3. 本番の新規購入が停止中でも、ワーカーは既存取引の処理のために動きます。ワークフローを無効化して障害を隠さないでください。

Issueやチャットには、表示ID・購入準備ID・イベントIDだけを書きます。顧客の氏名・住所・電話番号・メッセージ・決済URLは貼りません。

## A. 想定外エラー（件数なし）

- アプリの構造化ログで、`event=unexpected_error`、`operation=reconcile_stripe_events` の `errorType` と `errorId` を確認します。Stripe障害、DB接続、Stripeの件数上限（`StripeReconciliationLimitError`、`StripeCheckoutLookupLimitError`）などが原因です。
- 原因が解消すれば、次の実行で自動的に回復し、Issueは閉じます。DBを手で変更する必要はありません。
- 件数上限の変更や不具合の修正は、PRで行います。
- `StripeCheckoutLookupAccountError`：未記録決済の照合前にCheckoutキー自身のアカウントを確認できませんでした。`STRIPE_ACCOUNT_ID` とキーの所属、`GET /v1/account` の読取権限、Stripeへの接続を確認します。未確認の一覧から在庫を解放せず、設定を修正して次のWorkerで再試行します。全権限キーへの切替や在庫の手動解放で回避しません。キー・API応答・個人情報を公開Issueへ貼らないでください。

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
- イベントの本文は暗号化されて保存され、受信から30日の保持期限を過ぎると削除されます。期限内に調査し、再処理してください。

### 失敗した通知を再処理する

原因を解消し、修正が本番に配備されてから行います。原因が残ったまま戻すと、同じ失敗を12回繰り返します。

1. GitHub Actionsの「Commerce Inbox Requeue」（`.github/workflows/commerce-inbox-requeue.yml`）を、`main` から手動実行します。`main` 以外からの実行と、確認欄が未チェックの実行は何もしません。
2. 入力します。
   - `event_ids`：上のSQLで確認した `external_event_id`（`evt_` で始まるID）。カンマ区切りで最大20件です。
   - `incident_issue`：このIssueの番号です。調査内容はIssueに書き、実行時の入力には書きません。
   - `confirm`：原因の解消と配備を確認したらチェックします。
3. 実行ログの応答で、イベントごとの結果を確認します。

| 結果 | 意味と次の対応 |
| --- | --- |
| `REQUEUED` | 処理待ちに戻しました。試行回数は0に戻り、次のCommerce Worker実行（最大5分後）で、通常の再試行と同じ処理が行われます。 |
| `NOT_FAILED` | 失敗状態ではありません。すでに処理済みか、処理待ちです。何もしていません。 |
| `NOT_FOUND` | 設定中のStripeアカウントに、そのイベントIDの通知がありません。IDの誤りを確認します。 |
| `PAYLOAD_PURGED` | 本文が保持期限で削除済みのため、戻せません。下記「本文が削除済みの通知」を参照します。 |

4. 次のワーカー実行の後、上のSQLで失敗状態の件数が減ったことを確認します。再び12回失敗すると失敗状態に戻り、Issueは開いたままです。原因を再調査します。

戻した操作は監査ログに残ります。記録されるのは、実行したGitHubアカウント、イベントID、イベント種別、それまでの試行回数とエラー種別、Issue番号だけです。

```sql
SELECT occurred_at, actor_reference, safe_metadata
FROM bloombox.audit_logs
WHERE action = 'provider.inbox.requeued'
ORDER BY occurred_at DESC;
```

- 行を手でUPDATE・DELETEして状態を戻さないでください。上記の手順は、行ロックの下で失敗状態の行だけを戻し、監査ログを同じトランザクションで記録します。
- 本文が削除済みの通知：2026-09-17に[滞留調査・Stripeからの限定的な本文復元](COMMERCE_INBOX_RECOVERY.md)を実装。実Stripe/公開配備は未検証。取得可能な原イベントの識別情報が一致する場合だけ暗号化復元して通常処理へ戻します。取得期限外などはFAILEDとIssueを保持し、手動で解決済みにしません。

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

## D. 届かない購入者通知（2026-09-25）

**意味**：`Buyer notifications: N undelivered` は、注文確認・発送・回答のお知らせのうち、発生から7日以内で購入者に届かないことが確定した件数です。`delivery cannot run` は、送信が有効なのに配信を実行できない状態です。注文・決済・在庫の処理はすでに終わっており、止まっていません（[ADR 0019追記](../architecture/adr/0019-transactional-notifications.md)）。

1. `delivery cannot run` の場合は、配信の設定（`RESEND_API_KEY`、`NOTIFICATION_EMAIL_FROM`、`BLOOMBOX_PUBLIC_ORIGIN`）と配信事業者の状態を確認し、`pnpm notifications:verify` で送信を確かめます。直ると次の実行で `delivery cannot run` は消えます。止まっていた間の通知は48時間を過ぎると送られないため、復旧後に下の手順で対象を確認します。
2. 対象の通知を読み取り専用ロールで確認します。メールアドレスや本文は含まれません。

   ```sql
   SELECT id, event_type, aggregate_id, status, last_error_code, attempts, occurred_at
   FROM bloombox.outbox_events
   WHERE event_type IN ('order.confirmed', 'fulfillment.shipped', 'customer.request.replied')
     AND occurred_at > now() - interval '7 days'
     AND ((status = 'FAILED' AND last_error_code IS DISTINCT FROM 'ORDER_NOT_ACTIVE'
           AND last_error_code IS DISTINCT FROM 'REQUEST_NOT_ANSWERED')
       OR (status = 'PENDING' AND attempts > 0
           AND (occurred_at <= now() - interval '48 hours' OR attempts >= 6)))
   ORDER BY occurred_at;
   ```

3. `last_error_code` で原因を分けます。`REJECTED`（宛先や内容を配信事業者が拒否）、`RETRY_EXHAUSTED`・`SEND_FAILED`（一時的な障害が続いた）、`NO_BUYER_EMAIL`・`ORDER_NOT_FOUND`・`INVALID_EVENT`（データの不整合。開発者に連絡）。
4. 購入者へは、お問い合わせ窓口から個別に連絡します。宛先は運営管理画面の権限で確認し、Issueやチャットに書きません。
5. Issueに、確認日時、対象のイベントID、原因、連絡した日（宛先は書かない）を記録します。7日を過ぎた通知は件数から外れ、他に未解決がなければIssueは自動で閉じます。

- Outboxの行を手でUPDATE・DELETEして件数を減らさないでください。送信の記録と監査が食い違います。
- 48時間を過ぎた通知を再送する仕組みはありません。自動で送り直すことはしません。

## E. お届け日が近い未発送の注文（2026-09-25）

**意味**：`Orders not yet shipped with a delivery date within 2 days or past: N` は、確定済みの自作注文のうち、お届け予定日が東京時間で今日から2日後以前（過ぎたものを含む）なのに、まだ発送も取消もされていない件数です（[ADR 0015追記](../architecture/adr/0015-native-fulfillment-operations.md)）。ギフトが指定日に届かないおそれがあります。

1. `/operations/native-fulfillments` で、未発送の状態（未対応・準備中・準備完了・保留）の注文を開き、お届け予定日の近い順に確認します。
2. 発送できる注文は、[発送管理](NATIVE_FULFILLMENT.md)の手順で準備→発送を登録します。発送を登録すると、次のワーカー実行で件数から外れます。
3. 間に合わない注文は、購入者へ「顧客からのご相談」またはお問い合わせ窓口から連絡し、合意に応じてお届け希望日の変更、または[取消・返金](REFUNDS_AND_CANCELLATIONS.md)を行います。全額返金した注文も、発送管理で取消を登録するまで件数に残ります。
4. Issueには注文の表示IDと対応内容だけを書き、宛先・贈る言葉は書きません。

- 件数を減らすために、発送していない注文を発送済みにしないでください。
- 2日という基準は暫定値です。地域別の所要日数・締切（P0-07）が決まったら見直します。

## やってはいけないこと

- `purchase_intents`・在庫・`webhook_inbox` の状態を手でUPDATEして障害を閉じる。
- 監査ログを削除する。
- ワークフローを無効化して障害を隠す。販売停止の判断は [Stripe](STRIPE.md) の緊急停止手順に従う。
- 決済結果が不明な予約を、Stripe側の証拠なしに解放する。

## 記録

Issueに、確認日時、対象のイベントIDまたは購入準備ID、原因、対応したPR、残っている件数を残します。

## 再処理APIの入力上限（2026-09-18）

認証後のリクエスト本文は16 KiB・全体5秒以内で読み取り、UTF-8を厳密に検証する。Content-Lengthが省略・偽装されていても実読取量を制限する。最大20件の最大長イベントIDと監査項目は上限内に収まる。超過・読取停滞・不正な本文は従来と同じ400 / invalid_requestで拒否し、再処理Use Caseを呼ばない。未認証は本文を読む前に401。全応答にno-storeを付ける。

既存の再処理条件・行ロック・冪等性・監査は変更しない。標準の本文読取とルートの関連25ケースを検証。公開APIや実Stripeに対する試験、再処理の実行、公開配備は未実施。変更を戻す場合はこのルート差分をrevertでき、DB変更はない。#137 / #139の実環境・負荷・運用条件は残る。
