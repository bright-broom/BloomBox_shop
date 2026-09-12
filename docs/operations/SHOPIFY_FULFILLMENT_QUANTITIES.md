# Shopify分割配送の数量照合

2026-09-12時点。内部の発送受付に`quantityAssessment`を追加し、注文確定時の商品・数量と、Shopifyが返す注文明細・各発送明細を照合します。これは観測結果です。ローカルFulfillmentの作業状態、Order状態、出荷承認、通知を自動更新しません。公開経路・Inbox・本番Gateは無効のままです。

## 取得と照合

同じ認証済みAdmin API照会で、注文のupdatedAt、LineItemのID/variant/quantity/currentQuantity、Fulfillmentの状態/日時/totalQuantity、FulfillmentLineItemのID/quantity/元LineItem IDを取得します。宛名・住所・追跡番号・追跡URLは取得しません。発送活動の根拠と、数量の根拠を独立に検証します。

ネストした照会の負荷を抑えるため、外部発送は最大10件（first: 11で超過検出）、注文明細は最大100件、各発送明細は最大20件に限定します。注文・発送明細のhasNextPageがtrue、明細数量がnull/0/不正、重複ID、発送明細の合計とtotalQuantityの不一致は数量根拠をUNVERIFIEDにします。店舗・注文・test/live・API版・発送件数自体が不正、またはGraphQLエラーなら従来どおり例外で再試行します。5秒/256KBの上限も維持します。上限を超える大口注文のページ取得は別途必要です。

Fulfillment所有のトランザクション内で、確定済み`order_items`からvariant IDと数量だけを参照します。商品別の合計がShopifyの注文内容と一致し、quantityとcurrentQuantityが等しいことが必要です。注文編集・削除済みvariant・商品別数量の不一致はORDER_ITEMS_CHANGEDです。同じ商品が複数明細に分かれていても、商品別照合後の発送数は元LineItemごとに検証します。

SUCCESSの有効な発送を明細別に加算し、割当数が注文数を超えればQUANTITY_EXCEEDED、注文にない明細ならUNKNOWN_ORDER_LINEです。SUCCESSだけでは発送済みとせず、inTransitAtまたはdeliveredAtがある数量をshippedに、deliveredAtがある数量をdeliveredに加算します。CANCELLEDかつ物理的な進行日時がない割当は除外します。物理的な進行を示すCANCELLED、ERROR/FAILURE/OPEN/PENDINGはAMBIGUOUS_FULFILLMENTで確認待ちです。

仕様参照：[FulfillmentLineItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/FulfillmentLineItem)、[Fulfillment](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Fulfillment)。実店舗での応答・照会コスト・倉庫E2Eは未検証です。

## 返却値

`providerActivity`は「どれか1件の進行」、`quantityAssessment`は「注文全体に対する数量の照合結果」、既存`status`は「ローカル作業状態」です。

| quantityAssessment.status | 意味 |
| --- | --- |
| UNVERIFIED | 完全な数量根拠がない |
| NONE | 商品数量は一致するが、配送中・配達済みを示す数量は0 |
| PARTIALLY_SHIPPED | 注文数の一部が発送済み。配達済みは0 |
| SHIPPED | 注文数のすべてが発送済み。配達済みは0 |
| PARTIALLY_DELIVERED | 一部が配達済み。残りの発送状況はshippedで確認 |
| DELIVERED | 注文数のすべてが配達済み |
| REVIEW_REQUIRED | 商品・数量・状態・版に不整合がある |

orderedは確定注文の数量合計です。UNVERIFIED/REVIEW_REQUIREDではshipped/deliveredをnullにし、不明を0件と誤読させません。例：3点のうち1点だけ配達されればPARTIALLY_DELIVEREDです。合計3点でも商品の内訳が違えば完了にはしません。数量がすべて一致しても、発送受付のHELDを解除しません。

## 保存・競合・復旧

移行`0012_shopify_fulfillment_quantities.sql`で既存受付へnullableの数量根拠・判定列を追加します。旧レコードを配達済みと推測して埋めません。追加の権限・環境変数・依存パッケージは不要です。

検証済みの根拠をID順に正規化して保存します。注文updatedAtの後退、既知Fulfillmentの消失/updatedAt後退はSOURCE_REGRESSION、同じ版での内容変更や配送日時の消失はSOURCE_CONFLICTです。確認待ちにし、以前の根拠を保持します。DBトリガーも保存済み根拠の削除・後退を拒否します。不完全な数量応答でも、保存済み根拠と発送活動を消しません。後続の整合する応答で判定を再計算できます。削除や返品などの正式な訂正は、今後の権限付き解決処理が必要です。

根拠・判定・受付版・監査・Outboxを同じトランザクションで保存します。内容がすべて同一ならDUPLICATEです。決済版やproviderActivityが同じでも数量根拠・判定が変われば受付版を進めます。Outbox失敗で数量だけ進むことはありません。外部照会はトランザクションの外で実施します。

Domainテストは複数商品・分割配送の各進行段階、過剰割当、注文編集、取消、古い/矛盾する版を検証します。隔離PostgreSQLでは確定注文との照合、6並列の重複防止、古い応答後の根拠保持、DBの後退拒否、Outbox障害と再試行を検証します。現在の購入経路の1商品・1点制限を緩和する変更は含みません。

戻す場合は任意注入の発送受付処理を無効にし、移行・数量根拠・判定・監査・Outboxを保持します。旧コードで判定を更新し続ける運用は避け、修復は前進変更で行います。次は在庫確認、権限付きの確認・出荷承認、実店舗/倉庫照合を接続します。
