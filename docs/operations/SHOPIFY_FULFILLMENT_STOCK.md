# 割当先拠点の在庫確認

2026-09-12時点。内部の発送受付へ任意の`ShopifyFulfillmentStockReader`を注入し、確定注文に割り当てられた拠点の在庫を確認します。`ShopifyAdminOrderReader.readFulfillmentStock`が実装です。Shopifyの在庫・割当は変更しません。公開経路・Inbox・本番Gate・自動出荷は無効のままです。

## 読取と権限

認証済みAdmin API 2026-07で注文のFulfillmentOrder、状態、要求状態、supportedActions、割当先LocationのID/稼働状態、明細のvariant/inventoryItem IDと全数/残数を読みます。variant.inventoryItemと明細のinventoryItemIdを照合し、同じ在庫品を共有するvariantを数量合計で扱います。非推奨のInventoryItem.variantは使用しません。

割当は最大5件、割当明細は各10件、在庫品・拠点の組は最大10組です。接続のhasNextPageがtrueなら不完全として拒否します。対象の組だけを最大10並列で照会し、InventoryLevelのitem/location、稼働状態、available/committed/on_handを確認します。欠落・重複した数量、別店舗/注文/在庫品/拠点、test/live不一致、API版不一致、GraphQLエラーは固定の安全な例外で再試行します。

在庫読取後に割当を再取得し、注文更新日時・割当内容が途中で変わっていれば拒否します。各要求は既存の5秒/256KB上限、固定の店舗URL、redirect禁止、no-storeを再利用します。外部照会中はDBトランザクションを開きません。単一注文・在庫明細照会ではなく、最大12要求の読取です。これらは外部の原子的な在庫予約ではありません。

既存read_ordersに加え、対象のFulfillmentOrderを閲覧できるスコープ、read_inventory、variant/Location読取に必要な権限を実店舗で確認してください。OAuthや権限を自動追加しません。FulfillmentOrderはアプリ権限によって見える割当が制限されるため、明細合計の一致だけで本番用スコープ設定の確認を代替しません。配送先・倉庫住所・電話・SKU・原価・追跡情報は要求しません。

仕様参照：[FulfillmentOrder](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/FulfillmentOrder)、[FulfillmentOrderLineItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/FulfillmentOrderLineItem)、[InventoryItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryItem)、[InventoryLevel](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryLevel)。実店舗の権限・応答・照会コストは未検証です。

## 判定

stockAssessmentは確定したorder_itemsの商品・数量を参照して計算します。全割当がOPEN、UNSUBMITTED、CREATE_FULFILLMENT対応、稼働拠点で、全数が未発送かつ要配送であることが必要です。保留・依頼済み・作業開始済み・割当不足・商品違いはHELDです。

各在庫品・拠点で必要数を合計します。tracked/activeで必要な数量が取得でき、availableが非負、on_handがcommittedと必要数を下回らず、committedが必要数以上である場合にCOVEREDとします。available + committedがon_handを超えるなどの矛盾も保留します。販売可能在庫availableが0でも、on_hand=1、committed=1で1点分が賄われればCOVEREDです。反対に、売越しや他注文を含む引当総数を賄えない拠点では出荷を進めません。

| status | 主なreason | 意味 |
| --- | --- | --- |
| UNVERIFIED | NOT_CONFIGURED / STALE_SNAPSHOT | 読取未設定、期限切れ、未来/古い応答、照会間で注文版が不一致 |
| HELD | ALLOCATION_BLOCKED / ORDER_ITEMS_CHANGED | 割当条件または確定商品の数量が不一致 |
| HELD | STOCK_UNAVAILABLE / STOCK_UNTRACKED | 拠点・在庫明細がない、または在庫追跡が無効 |
| HELD | STOCK_SHORTAGE / STOCK_INCONSISTENT / COMMITMENT_UNVERIFIED | 在庫不足、数量矛盾、必要な引当数を確認できない |
| COVERED | COMMITMENTS_COVERED | 観測した商品在庫が割当の引当数を賄っている |

初回割当照会後・在庫読取前の時刻をcheckedAtとし、書込時点で30秒を超えた結果は使いません。保存済みのCOVEREDは再利用せず、毎回新規読取が必要です。同一時刻で内容が変わった応答や、保存済みより古い応答はUNVERIFIEDにし、新しい保存済み根拠を維持します。

受付方針がAPPROVEDでも、在庫未確認ならINVENTORY_UNVERIFIED、問題があればINVENTORY_REVIEW_REQUIREDです。COVEREDでも数量照合がNONE/MATCHEDでなければFULFILLMENT_QUANTITIES_UNVERIFIED、すべて揃ってもHELD/DISPATCH_APPROVAL_REQUIREDです。支払、取消、配送期限、住所保持期限、発送活動など既存の保留条件も維持します。COVEREDはこの注文専用の予約保証や、花材の品質・鮮度・ロット確認、梱包資材の確保、担当者承認ではありません。

## 保存・検証・復旧

前進移行0013でFulfillment所有の受付へ在庫根拠・判定のnullable列を追加します。割当と在庫のスナップショットは内部DBにだけ保存し、返却値・監査・Outboxには判定と理由を渡します。新しい読取時刻/根拠/判定なら受付版を進め、完全に同一ならDUPLICATEです。新規読取ごとの時刻は監査対象なので、同じ在庫数でも新たな確認として記録します。

DBトリガーは保存済み根拠の削除、確認時刻の後退、同一時刻の内容差替えを拒否します。受付・根拠・判定・監査・Outboxは原子的に保存し、最後の保存が失敗しても前段のOrder/Payment/Checkoutを維持します。取得失敗も以前の根拠を消しません。エラー後の保存済みCOVEREDを使って承認する経路はありません。

Domainテストで引当済み在庫、共有在庫の数量合算、売越し、拠点違い、追跡無効、割当保留、期限切れ、承認待ちを検証します。Providerテストはスコープ/関連付け/ページ不完全/数量欠落/割当変更/安全なエラーを確認します。隔離PostgreSQLは全13移行の再実行、6並列の重複防止、期限切れ、在庫不足への更新、古い応答の保持、未接続時の停止、Outbox失敗・再試行を確認します。テストのAPPROVEDは合成条件であり、事業条件の承認ではありません。

追加環境変数・依存パッケージ・DB権限はありません。戻す場合は在庫/発送受付の任意注入を外し、移行・根拠・監査を保持します。旧コードで確認結果を承認に流用しません。訂正は所有モジュールの前進変更で行います。次は担当者の認証・拠点/操作権限、確認画面と承認記録、出荷直前の再確認、Shopify/倉庫での実行と結果不明時の照合が必要です。
