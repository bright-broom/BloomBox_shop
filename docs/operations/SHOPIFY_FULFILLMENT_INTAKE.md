# Shopify注文の発送受付・保留・取消

2026-09-12時点。注文受け入れ→Payment反映→CheckoutのCONVERTED更新の後、任意注入の`ShopifyFulfillmentIntake`でBloomBox内の発送受付を保存します。公開経路・Inbox worker・本番Gateは無効のままです。ShopifyのFulfillment情報は任意注入Readerで取得・記録します。在庫連携・出荷指示・ローカル配送状態の更新は未実装なので、今回の処理からSCHEDULED/PROCESSING/READY/SHIPPEDへ進めません。

## 受付の判定

初回はOrderの不変証跡・店舗・注文・購入試行を照合し、購入状態がCONVERTEDであることを確認します。最新の決済根拠とPayment投影の版、JPY総額、入金/返金額、test/live区分も一致が必要です。根拠だけが先に更新されて投影が古い場合は例外で再試行させ、古い入金状態で受付を更新しません。

通常はFulfillmentをUNFULFILLEDで一度だけ作成し、HELDと具体的な理由を記録します。部分返金、処理中の決済/返金取引、必要な配送情報の欠落/保持期限超過、配送受付期間外、未承認方針を保留します。方針はFulfillment所有の`FULFILLMENT_INTAKE_POLICY`へ集約し、初期値はPENDINGです。合成テストでAPPROVEDにしても、在庫証跡が未接続なのでINVENTORY_UNVERIFIEDで保留します。承認フラグだけで在庫の存在を推測しません。

住所は取得・復号せず、確定注文の暗号化スナップショットが存在し保持期限内であることだけを参照します。受付期間は既存の東京時間・3日リードタイム・60日上限を再使用します。この判定は初期受付の安全な保留であり、配送業者の集荷締切や実際の配送能力の保証ではありません。

## 取消と作業開始後の扱い

最新の検証済みShopify照会が発送記録0件で、保存済みの外部活動証跡もなく、検証済みの注文取消または全額返金がある場合、まだ存在しない受付、またはUNFULFILLEDの受付だけをCANCELLEDにします。取消の記録は配送情報の保持期限や受付方針の承認を待ちません。部分返金は自動取消にせず、確認が必要な保留として残します。取消済み受付を再開しません。

これはBloomBox内の未着手受付の取消です。Shopify・倉庫・配送業者への取消要求や、外部で出荷されていないことの証明ではありません。Shopifyの照会結果に記録があれば自動取消を保留しますが、APIの反映遅延や照会後の外部更新は残ります。発送前の在庫・作業承認や継続的な再照合は別途必要です。

SCHEDULED/PROCESSING/READYはACTIVE_FULFILLMENT_REVIEW_REQUIRED、SHIPPED/DELIVERED/RETURNEDはPOST_SHIPMENT_REVIEW_REQUIREDとして記録し、既存状態を保持します。返金通知だけから物理的な作業停止・配送取消・返品完了を捏造しません。確認用記録を担当者へ届ける運用/画面/通知は別途接続が必要です。

## Shopifyの発送活動を照合

`ShopifyAdminOrderReader.readFulfillments`を受付AdapterのReaderとして任意注入します。API 2026-07の認証済み読取境界を再利用し、店舗・注文ID・各Fulfillmentの所属注文・test/live・API版を照合します。5秒上限、256KB上限、redirect禁止、no-storeを維持します。`fulfillments(first: 11)`は配列で、最大10件を受け入れます。数量照合のネストした照会の負荷を抑えるため、上限を絞っています。`fulfillmentsCount`のprecisionがEXACTで配列件数と一致し、ID重複がない場合だけ完全な応答として扱います。不明・過大・件数不一致・GraphQL部分エラー・通信失敗は固定の安全な例外で再試行します。EXACTも即時反映を保証するものではありません。

保存するのは注文の一部で確認した活動と、その根拠となるFulfillment 1件（ID、status、updatedAt、inTransitAt、deliveredAt）です。住所・追跡番号・追跡URLは要求・保存・返却しません。`providerActivity`は以下を区別します。

| 値 | 意味 |
| --- | --- |
| UNVERIFIED | 発送情報の照会が未設定・未確認 |
| NONE | 今回の照会は0件で、保存済みの活動証跡もない |
| RECORDED | 発送記録あり。SUCCESSでも物理的な配送中・配達済みとは推測しない |
| IN_TRANSIT | 少なくとも1件のinTransitAtを確認 |
| DELIVERED | 少なくとも1件のdeliveredAtを確認。注文全体の配達完了ではない |

CANCELLED/ERROR/FAILUREや非推奨OPEN/PENDINGも活動記録として確認対象にします。RECORDED以上は常に`EXTERNAL_FULFILLMENT_REVIEW_REQUIRED`で保留し、全額返金・注文取消より優先します。ローカルCANCELLEDの後に発送記録が届いても状態を再開せず、矛盾としてHELDを残します。既存`status`はローカル作業状態、`providerActivity`は外部観測です。利用側はstatusだけで未発送と判定せず、decisionも確認します。

保存済み活動はUNVERIFIED→NONE→RECORDED→IN_TRANSIT→DELIVEREDの順でのみ進め、空・古い・取消済みの応答で巻き戻しません。同じ段階の最初の根拠を保持します。[分割配送の数量照合](SHOPIFY_FULFILLMENT_QUANTITIES.md)は別のquantityAssessmentとして実装しました。発送ごとの全履歴、返品・訂正を解決する管理コマンドは別途必要です。Reader未注入では`PROVIDER_FULFILLMENT_UNVERIFIED`で新規取消を止めます。過去のNONEを使い回して取消を許可しません。保存済みRECORDED以上の保留は維持します。

仕様参照：[Order.fulfillments](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)、[Fulfillment](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Fulfillment)、[FulfillmentStatus](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/FulfillmentStatus)、[CountPrecision](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CountPrecision)。実店舗での成功証跡は未取得です。

## 原子性と再試行

DBトランザクション開始前に外部照会を完了します。DB内では決済根拠の親行を最初にロックし、Payment投影/Paymentを共有ロック、Fulfillmentと受付記録を更新ロックします。Fulfillmentだけが自分のテーブルを更新し、Order/Checkout/Paymentは参照だけです。外部サービスをトランザクション内で呼びません。

Fulfillment、状態遷移、受付判断・外部活動の根拠、監査、`fulfillment.shopify_intake.updated` Outboxを1トランザクションで保存します。障害で途中まで保存しません。同じ決済版・判断・理由・状態・活動段階・数量根拠・数量判定ならDUPLICATEとなり、監査/イベント/版を増やしません。決済版が同じでも日付や保持期限によって判断が変わるか、外部活動段階や数量根拠・判定が変われば、受付独自の版を増やして記録します。

最後の受付保存だけが失敗しても、前段の注文・決済・購入状態は維持します。内部フローの再試行で確定済み注文の識別子から再開し、住所を再取得せず残りを保存できます。トップレベルの`completion: COMPLETED`は前段処理の完了を示し、`completion.fulfillment.decision`がHELDなら発送許可ではありません。依存未注入ではNOT_CONFIGUREDです。Inbox全体の完了にはまだ接続しません。

## 移行・検証・復旧

`0010_shopify_fulfillment_intakes.sql`、`0011_shopify_fulfillment_observations.sql`、`0012_shopify_fulfillment_quantities.sql`を前進適用し、`database/roles.sql`を再適用します。Fulfillment所有の受付は注文/購入準備ごとに一意です。紐付けの変更、削除、決済版の巻き戻し、受付版の不正な更新をDBで拒否します。workerへ新表のSELECT/INSERT/UPDATEと、既存Fulfillmentのstatus/version/updated_atだけのUPDATEを付与します。注文IDの付け替え権限、一般アプリからの受付書込、DELETE権限は追加しません。0011は既存受付へUNVERIFIEDを設定し、活動の後退・同段階の根拠の差替えをDBで拒否します。追加権限や環境変数は不要です。既存Stripeの書込方式は変更しません。

Domainテストで全状態からの取消、各保留条件、取消済みの維持、日付境界、在庫未確認時の停止を検証します。隔離PostgreSQLでは全12移行の再実行、6並列の重複防止、同じ決済版での期限変化、全額返金/古い通知、作業中・発送後の状態保持、Outbox障害の巻き戻し、古い投影の拒否、処理中返金、権限を確認します。外部照会の不正応答・部分応答・秘密情報除去、6並列での活動保存、配達観測後の空応答・取消、取消後の遅延発送記録、照会障害後の再試行、観測更新時のOutbox失敗の原子的巻き戻しも検証します。これらは実店舗・倉庫・配送のE2E証跡ではありません。

戻す場合は任意注入の受付処理を外し、適用済み移行・受付・取消記録・監査を保持します。保存済みCANCELLEDをUNFULFILLEDへ戻したり、既存取引を削除したりしません。復旧は監査付きの所有モジュールのコマンドまたは前進移行で行います。新列・活動証跡は残します。旧コードへ戻して取消を再開する運用は行いません。次は在庫方針、準備/出荷承認、担当者の確認経路を接続します。
