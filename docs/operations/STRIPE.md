# Stripe connection and operations

ADR 0009に基づき、BloomBoxの自作CommerceをStripeへ接続するための手順です。本番注文受付はコード上で停止しています。接続確認の成功と、実支払・注文保存・配送を含む公開条件を区別します。M/Lの1箱送料は税込固定料金を検証対象とします。

## Fixed integration contract

- API version: `2026-07-29.dahlia`, pinned by checked-in configuration and explicit per-request options, independently of the installed SDK default.
- Checkout model: hosted Stripe Checkout Session in `payment` mode.
- Currency: JPY.
- Tax model: `automatic_tax` and the price/shipping `tax_behavior` are configured as one invariant. `inclusive` or `exclusive` requires automatic tax; `unspecified` requires it to be disabled.
- Customer consent: the Checkout terms checkbox is controlled explicitly. `required` is rejected by Stripe unless the account business profile has a valid terms URL.
- Checkout metadata: BloomBox purchase-intent and catalog product identifiers only. Recipient, address, phone, email, and gift message are excluded.
- Customer model: guest-first. A Stripe Customer is not automatically treated as a BloomBox customer account.
- Payment authority: verified Stripe webhook or authenticated Stripe Events API response, never the browser success URL.
- Provider assignment: one PurchaseIntent uses one provider after Checkout creation and cannot switch in flight.
- Redirect authority: Checkout URLs must be HTTPS and use `checkout.stripe.com` or one explicitly configured custom Checkout hostname. Mode and Session ID prefixes must agree.

SDK updates do not upgrade the wire API or the webhook endpoint automatically. Checkout create/retrieve and every Events pagination request set the configured API version using supported per-request options. Session retrieval passes options as the third argument, after an empty parameter object. Offline webhook signature verification performs no API call and still rejects a signed event with a different version. This preserves the existing contract without an unsafe cast to the SDK's latest-only constructor type. Real-SDK transport tests verify the outgoing version header, checkout idempotency and event pagination. A deliberate API upgrade remains a separate change with webhook/account validation. See [Stripe API versioning](https://docs.stripe.com/api/versioning?lang=node).

## Account-side setup

Create and record the owner for each resource in the private credential inventory:

1. A Stripe test account and a separate live account or mode-specific access policy.
2. Separate restricted server keys. The application key has Checkout Session write/read access. The worker key has Event read access. They must not be the same key. Restricted keys beginning with `rk_test_` or `rk_live_` are supported; publishable keys are not.
3. 共通送料 `STRIPE_SHIPPING_RATE_ID` は旧経路の互換性確認用です。M/Lの検証Sessionには個別の固定送料を渡します。実商品DBの送料登録・購入時固定は送料実装PR #99の対象で、この接続確認は商品DBを書き換えません。
4. 1箱送料の接続確認は `STRIPE_TAX_BEHAVIOR=inclusive` と `STRIPE_AUTOMATIC_TAX_ENABLED=true` が必要です。旧共通送料の税区分も一致させます。実際の住所入力後の税額・最終総額は別途E2Eで確認します。
5. A business-profile terms URL before setting `STRIPE_TERMS_ACCEPTANCE=required`. Configure payment receipts and branding in the Dashboard; these Dashboard-only settings remain a manual review item.
6. A webhook endpoint at `/api/webhooks/stripe`, pinned to the API version above and subscribed only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.dispute.created`
   - `charge.dispute.closed`
7. The webhook signing secret and expected `acct_` account ID.

自作在庫の予約・確定・解放はADR 0010で内部実装済みです。実Stripeの支払・取消・失効・返金・通信断と在庫の照合、および発送運用の検証が完了するまで本番受付を解除しません。

## Runtime configuration

Application runtime:

```text
BLOOMBOX_RUNTIME_MODE=production
BLOOMBOX_CHECKOUT_PROVIDER=stripe
BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false
BLOOMBOX_PUBLIC_ORIGIN=https://<production-origin>
DATABASE_URL=<least-privilege-application-url>
DATABASE_SSL_MODE=verify-full
DATABASE_MAX_CONNECTIONS=5
BLOOMBOX_PII_KEYRING=<versioned-keyring-json>
STRIPE_MODE=test
STRIPE_CHECKOUT_SECRET_KEY=<restricted-test-checkout-key>
STRIPE_RECONCILIATION_SECRET_KEY=<restricted-test-events-key>
STRIPE_WEBHOOK_SECRET=<test-webhook-secret>
STRIPE_ACCOUNT_ID=<expected-account-id>
STRIPE_SHIPPING_RATE_ID=<shipping-rate-id>
STRIPE_TAX_BEHAVIOR=inclusive
STRIPE_AUTOMATIC_TAX_ENABLED=true
STRIPE_TERMS_ACCEPTANCE=<required|none>
# STRIPE_CHECKOUT_CUSTOM_DOMAIN=<exact-hostname-without-scheme>
COMMERCE_WORKER_SECRET=<random-32-plus-character-secret>
```

Worker and GitHub configuration:

```text
DATABASE_WORKER_URL=<least-privilege-worker-url>
GitHub variable: PRODUCTION_BASE_URL
GitHub variable: STRIPE_RECONCILIATION_ENABLED=true
GitHub secret: COMMERCE_WORKER_SECRET
```

The application, worker, migration, test, and live Stripe credentials are separate. Never expose any of them through `NEXT_PUBLIC_*` or Preview Environment inheritance.

## Automated Test Mode account verification

The `Stripe Test Mode Readiness` workflow is a manual, account-backed gate using the protected `stripe-test` GitHub Environment. In addition to the runtime keys above, configure a third, test-only `STRIPE_READINESS_SECRET_KEY`. It needs read access to the current Account, Shipping Rates, Webhook Endpoints, and Tax Settings. It is not deployed with the application.

Configure these Environment values:

```text
Secret: STRIPE_CHECKOUT_SECRET_KEY
Secret: STRIPE_RECONCILIATION_SECRET_KEY
Secret: STRIPE_READINESS_SECRET_KEY
Secret: STRIPE_WEBHOOK_SECRET
Variable: STRIPE_TEST_PUBLIC_ORIGIN
Variable: STRIPE_ACCOUNT_ID
Variable: STRIPE_SHIPPING_RATE_ID
Variable: STRIPE_TAX_BEHAVIOR
Variable: STRIPE_AUTOMATIC_TAX_ENABLED
Variable: STRIPE_TERMS_ACCEPTANCE
Optional variable: STRIPE_CHECKOUT_CUSTOM_DOMAIN
```

ワークフローは本番キー、同一キーの兼用、税別・税未指定を拒否します。アカウント・旧共通送料・Stripe Tax・規約URL・Webhook URL/版/購読イベント・Events読取権限を確認後、M/LのSessionを作成します。金額は検証用 `content/catalog.json` から検証付きで読み、現在はM＝4,000＋1,000円、L＝8,000＋0円です。これは実商品カタログの検証ではありません。

作成したSessionを再取得し、保存された商品の単価・数量・通貨・税区分と、個別の固定送料を照合します。住所入力前は自動税計算が未完了になり得るため、最終総額を検証済みとは扱いません。顧客情報・カード情報は送信せず、支払操作は行いません。

全Sessionの期限切れを再取得で確認した後にだけ `status=connection_verified` を記録します。作成・金額照合・後片付けに失敗した場合は `failed` と終了コード1です。途中で失敗しても判明済みのSessionはすべて後片付けを試みます。expireの応答が不明でも、再取得で未払い・PaymentIntentなし・期限切れを確認できれば成功とします。SDKの生エラーやCheckout URLはログに残しません。

作成結果が不明なSessionは `cleanup=unknown` と識別子・同一要求キーを記録します。別キーで新規作成せず、専用テストアカウントで識別子により調査します。Sessionの有効期限は作成要求から31分です。`unconfirmed` は期限切れ未確認であり、成功として扱いません。生成されたShipping Rate等のテストオブジェクトを削除する処理はありません。

**実行順:** この変更のWebhook処理をテスト接続先へ配備し、`/api/health` のrevisionと対象コードを確認してからワークフローを手動実行します。専用接続確認の `readiness_` 識別子・固定マーカー・未払い・PaymentIntentなし・期限切れを持つテスト通知だけは、署名/アカウント/API版の検証後に受理してInboxへ保存しません。通常の購入UUID、支払い済み、本番モード、署名不正はこの除外に入りません。これにより実在しない購入を探す再試行が発生しません。旧版へのロールバック前は新たなprobe実行を止め、発行済みprobeの期限切れ通知を処理します。

記録には実行コードのSHA（GitHub上のみ）、ケース別の金額、Session ID、期限切れ結果を残します。`paymentVerification` と `finalTaxAndTotalVerification` は常に `not_performed` です。署名付き通知の実配信・DB保存・ブラウザーでの支払いは、下記E2Eで別に確認します。

2026-09-13時点の確認: ローカルのプロジェクト設定にStripeキーなし。GitHub Environment一覧はPreviewとProductionで、stripe-testは未作成です。キーの発行・環境登録・権限拡張・実Stripeへの接続は行っていません。公開チャットに秘密鍵を貼らず、権限を持つ担当者が上記の専用Environmentへ登録してください。

実装の検証: Node 24.21.0 / pnpm 10.23.0で `pnpm check:ci`（通常テスト924件・build）を実行。関連33件ではSDKモックでM/Lの再取得照合、設定不備で外部接続ゼロ、後片付けの失敗・不明応答・途中失敗・本番オブジェクト拒否を確認しました。検証プログラムが生成する識別子を使った署名付き期限切れ通知の除外、通常購入UUID・本番モード・支払い済み通知を除外しないことも確認しました。DBスキーマや注文・在庫の書込処理は変更していません。これらはStripeアカウントへの実接続証拠ではありません。

仕様参照: [Checkout Sessionの再取得](https://docs.stripe.com/api/checkout/sessions/retrieve)、[Sessionの期限切れ](https://docs.stripe.com/api/checkout/sessions/expire)。

## Automated flow

1. The server recalculates product price and creates an encrypted PurchaseIntent plus Outbox Event in one PostgreSQL transaction.
2. The Stripe Checkout Session is created outside the database transaction with a deterministic idempotency key.
3. BloomBox records the provider Session ID and API version with an optimistic status predicate.
4. Stripe returns the customer to `/checkout/success`. The page treats the Session ID as a high-entropy capability, reads only BloomBox's PII-free order-status projection, and never treats the browser return as payment confirmation. While the verified event is pending, the page reports processing and refreshes for a bounded period.
5. The signed webhook is verified from the unmodified raw body, minimized, encrypted, and deduplicated in the Inbox before the endpoint acknowledges receipt. No Order or Payment work runs on the request path.
6. The protected worker claims Inbox rows with `SKIP LOCKED`, reclaims stale locks, and uses bounded exponential retry. A paid Checkout event creates exactly one Order, Payment, Attempt, Fulfillment, immutable gift snapshot, balanced ledger transaction, audit record, and Outbox Event in one database transaction. An event moves to `FAILED` after 12 unsuccessful attempts and causes the workflow incident to remain open.
7. Refund and dispute events update their independent entities and payment projection idempotently.
8. GitHub Actions invokes the protected commerce worker every five minutes. It drains the Inbox, reads authenticated Stripe Events with a ten-minute overlap, stores newly discovered events, drains the Inbox again, purges expired transient encrypted payloads, and opens one deduplicated incident issue on failure.

An expired Checkout or an asynchronous payment failure leaves no Order and moves the PurchaseIntent to a terminal state. The return page displays the specific non-charge state and links to a fresh purchase flow for the same catalog product instead of remaining indefinitely in “processing.”

When a customer removes a production cart, the server first cancels that customer's PurchaseIntent. An issued Checkout Session is closed through Stripe's expire operation for the stored Session ID; the application key's Checkout Session write access covers this call. Success requires Stripe to report the Session as `expired`, directly or on retrieval. A completed Session is never cancelled: only the stale browser cart is cleared, and the customer is told that the order was not cancelled. If Stripe refuses to expire a Session it still reports as open, the original error is reported. An unconfirmed result is also reported and keeps the cart for a retry. Inventory is still released only by the verified `checkout.session.expired` event.

Webhook payloads and terminal PurchaseIntent personal data are cryptographically protected at rest and purged after 30 days. Unstarted PurchaseIntents are automatically expired after 24 hours with an Outbox Event and audit record. Confirmed Order gift and delivery snapshots follow the separately approved order-retention policy and are not deleted by this transient-data job.

## Test-mode activation evidence

Before changing `STRIPE_MODE` to `live`, record all of the following in the activation PR:

- a successful `Stripe Test Mode Readiness` workflow run for the exact test deployment revision;
- successful, failed, canceled, expired, and asynchronous Checkout Sessions;
- customer cart removal after returning from Checkout: expiry request, verified expiry event, released reservation, and the cart no longer reappearing;
- duplicate form submission, provider timeout after Session creation, duplicate Webhook, invalid signature, delayed delivery, and reversed event order;
- full and partial refund, failed refund, dispute opened and dispute closed;
- changed price, unavailable catalog item, shipping-rate failure, and tax configuration mismatch;
- concurrent buyers, the approved inventory reservation policy, reservation release, and native inventory reconciliation;
- encrypted address and gift data, log inspection, retention expiry, access controls, and data-subject workflow;
- database backup restoration, frontend rollback, Inbox retry, Event reconciliation, and incident alert recovery;
- Stripe Dashboard totals reconciled to BloomBox Payment, Refund, and Ledger records.

Use Stripe test payment methods only in a Stripe Sandbox/Test Mode. Never test with real payment details in live mode. A browser E2E is considered complete only after the verified webhook has created the BloomBox Order and the customer return page shows the same display ID and total.

## Emergency controls

- Stop new purchase intake by setting `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false` and deploying this setting to every application instance. Keep `BLOOMBOX_CHECKOUT_PROVIDER=stripe`, the production runtime, provider credentials, and reconciliation schedule unchanged. Never change the provider of an in-flight PurchaseIntent.
- The intake flag defaults to `true` for backward compatibility and accepts only the strings `true` or `false`. Invalid values reject purchase intake but do not disable settlement services. Purchase-intent creation and Checkout initiation check the flag on each invocation; Checkout checks again before creating an external Session. Paused submissions return a customer-facing message without a draft or Checkout URL, preserving the cart for retry.
- This is a deployment-scoped control, not a distributed instantaneous cancellation. Requests already sent to Stripe and previously issued Checkout URLs may still complete. Persist their returned Session references and continue receiving verified events. If existing Sessions must be expired, handle that separately through the provider under an approved incident procedure; do not abandon accepted payment facts.
- Keep the Webhook endpoint and reconciliation worker available while checkout creation is disabled so accepted payments continue to settle into Order and support records.
- Before reopening, verify a paused submission creates no new intent or Session, verify delayed/duplicate events still settle, and confirm reconciliation is healthy. Set `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true` on all instances to resume. A customer may retry the same request; existing idempotency rules remain in force. Do not roll back to a revision without this control while relying on the flag to stop intake.
- For uncertain payment state, query Stripe by the stored Session or PaymentIntent ID and reconcile; never create a replacement charge speculatively.
- Rotate an exposed Stripe or worker secret immediately, update the protected environment, and replay only verified provider events.
- Roll application code back independently of the database. Correct applied schemas with a new forward migration and never delete accepted commerce facts.
