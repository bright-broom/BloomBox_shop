# Shopify注文確定後の決済反映・購入状態更新

2026-09-11時点。内部の`ReconcileShopifyPayment`へ任意注入の完了処理を追加しました。新規注文はこれまでの販売条件・入金・金額・配送検証とOrder保存を通り、その後にPaymentの反映、CheckoutのCONVERTED遷移を実行します。公開購入経路・本番決済Gateは無効のままです。2026-09-12に[テスト注文限定のInbox worker](SHOPIFY_INBOX_WORKER.md)を初期停止で接続しました。

## 確定済み注文の再開

Order所有の`ShopifyAcceptedOrderQuery`が、認証済みProvider応答の店舗と注文IDから、不変の受け入れ証跡・注文・購入試行の組合せを解決します。別店舗や証跡のない注文は再開対象になりません。ブラウザーの注文IDから直接呼ぶ公開APIではありません。

確定済みなら、現在のカート内容・配送先・配送日・購入準備のPII保持期限を新規受け入れ条件として再利用しません。正式な決済照会を継続し、最新の保存済み決済根拠からPaymentを反映した後、購入状態を更新します。したがってカート情報の欠落、商品variantの削除、購入準備の個人情報削除、配送日経過後も、確定済み注文の復旧と返金反映ができます。未確定の注文については元の関連付け・受け入れ条件を緩めません。

確定済み経路の`deliveryTiming`は`ORDER_ALREADY_ACCEPTED`、`destination`は未評価、`acceptance`はDUPLICATEです。新たな発送承認を表しません。API全体の不正・通信失敗、決済観測自体の矛盾は従来どおり失敗させます。

## Payment所有の反映

`PostgresShopifyOrderPaymentProjector`は決済根拠をロックし、注文受け入れ証跡・試行・店舗・JPY総額・test/live区分・根拠の版を照合します。元の受け入れ版以降の全額入金記録を必須とし、部分/全額返金を含む最新根拠を使います。古いイベントの結果をそのままPaymentへ上書きしません。

PaymentはShopify注文全体の決済集計です。`external_payment_id`には店舗とShopify注文IDの組を保存し、個々のチャージIDとして扱いません。個々のSALE/CAPTURE/REFUNDは元の取引ID・親関係を根拠スナップショットに残します。`amount_authorized_minor`は既存Paymentモデルに合わせ、引落済み額＋残存与信額です。新しい決済手段や加盟店アカウントは作成しません。

1トランザクションでPayment、根拠の投影版/スナップショット、状態遷移、取引記録、貸借の釣り合う台帳行、監査、Outboxを保存します。成功した新規のSALE/CAPTURE/REFUNDだけを一度記録します。待機・失敗した取引は入出金として記録しません。0円の取引は根拠に保持し、金額0の台帳行を作りません。保存失敗は全体をロールバックします。

`SHOPIFY_CLEARING`と`ORDER_PAYMENTS`は購入代金の照合用コードです。売上認識、税務仕訳、手数料、実際の入金消込を完了した会計帳簿ではありません。取引記録の時刻はローカルで反映した観測時刻で、Providerが返していない実際の取引発生時刻を捏造しません。個別のShopify RefundリソースIDや返金理由は取得契約にないため、Refund行・返金要求を作りません。

初回反映までに全額返金されていれば、最初からREFUNDEDと関連する入金/返金記録を保存します。購入契約・Order状態は書き換えません。Fulfillmentの未着手受付の取消・保留は[発送受付](SHOPIFY_FULFILLMENT_INTAKE.md)で実装しました。Order自体の取消、外部の作業停止、個別返金詳細、Disputeへの対応は別途必要です。

## Checkout所有の状態更新と障害復旧

`PostgresShopifyPurchaseConverter`は購入準備をロックし、Orderの不変証跡とPaymentの投影記録の一致を確認してから、既存状態遷移規則でCHECKOUT_CREATED→CONVERTEDへ進めます。購入準備、監査、Outboxだけを更新し、他モジュールのテーブルを書き換えません。再実行はDUPLICATEとなり、版・監査・イベントを増やしません。

Order保存、Payment反映、Checkout更新は別々のトランザクションです。前段が確定して後段だけ失敗しても、前段を取り消しません。呼出元へ固定の安全な例外を返し、同じ通知の再実行でOrderの不変証跡から再開します。これにより住所を再取得せず、配送期限を過ぎていても残りの更新ができます。

返却値は決済観測の`outcome`、注文受け入れの`acceptance`、今回の`completion`を分けます。`completion: COMPLETED`はPayment反映とCheckout更新の完了で、発送・通知・Inbox全体の完了ではありません。追加の任意依存を注入した場合、`completion.fulfillment`に[発送受付・保留・取消](SHOPIFY_FULFILLMENT_INTAKE.md)の結果を返します。HELDを発送許可として扱いません。依存を未注入ならNOT_CONFIGURED、未受け入れならORDER_NOT_ACCEPTEDで保留します。テストInbox workerは注文・決済・購入状態・発送受付の記録が揃った場合のみ処理済みにします。顧客通知や実発送を完了した意味ではありません。

CONVERTEDになった購入準備は既存の保持期限処理の対象になります。確定注文側の暗号化スナップショットは別途保持し、その削除運用・本人確認・閲覧権限は未完了です。

## 移行・検証・ロールバック

既存移行の後に`0009_shopify_payment_projections.sql`を適用し、`database/roles.sql`を再反映します。Payment所有の投影表は注文/購入準備ごとに一意で、IDの付け替え・版の巻き戻し・削除を拒否します。workerにSELECT/INSERT/UPDATEだけを追加し、一般アプリの書込やDELETE権限を追加しません。既存Stripeの索引・書込は変更しません。依存・環境変数の追加はありません。

隔離PostgreSQLで全9移行の再実行、6並列の確定/購入状態更新、返金の反映、逆順の通知、変換失敗からの再開、個人情報削除後の処理、Outbox障害時のPayment/台帳/版のロールバック、worker権限、別店舗/注文/試行の拒否を検証します。実店舗の決済・返金・通知や会計処理の承認証跡ではありません。

公開前に戻す場合は完了処理の依存注入を外します。適用済み移行、注文、Payment、投影、台帳、監査は削除しません。修復は監査付きの所有モジュールのコマンドまたは前進移行で行います。発送受付・保留・未着手受付の取消を内部接続しました。正式な発送活動の取得・後退しない記録も任意注入で接続しました。[分割配送の数量照合](SHOPIFY_FULFILLMENT_QUANTITIES.md)も内部接続済みです。次は在庫/出荷承認、個別返金詳細、安全な注文参照、Inbox/再照合、実店舗E2Eを進めます。
