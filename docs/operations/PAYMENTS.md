# BloomBox 決済導入：Shopify Payments + KOMOJU

更新日：2026-09-11。選定は [ADR 0003](../architecture/adr/0003-shopify-payments-and-komoju.md)。本番の接続・審査・決済は未確認で、現時点では利用開始していません。

## 採用構成

BloomBox → Shopify Checkout → Shopify Payments / KOMOJUの決済アプリ。

カードとウォレットはShopify Payments、国内の追加手段はKOMOJUを採用します。PayPalもShopify経由の追加候補です。Stripeは比較しましたが、この構成で別の決済を同時作成しません。決済方法の選択画面はShopifyの有効な設定に従い、BloomBox側で未契約の方法を利用可能と表示しません。

## 導入する決済手段

日本の事業者・JPY・国内配送を前提とした候補です。以下は対応範囲の調査結果であり、この店舗で有効化済みという意味ではありません。

| 方法 | 接続先 | 導入条件・順序 |
| --- | --- | --- |
| Visa / Mastercard / American Express / JCB / Diners / Discover | Shopify Payments | 優先。JCB等の審査状況とJPY条件を確認 |
| Apple Pay / Google Pay / Shop Pay | Shopify Payments | 優先。対応端末・ブラウザで表示と決済を確認 |
| PayPay / メルペイ / 楽天ペイ / au PAY / d払い | KOMOJU | 優先。方法ごとの加盟店審査とShopifyアプリ接続 |
| コンビニ（ローソン、ファミリーマート、ミニストップ、デイリーヤマザキ、セイコーマート） | KOMOJU | 入金期限・配送締切・期限切れ時の在庫解放を確定後 |
| セブンイレブン | KOMOJU | 法人のみ申請可能。上記の入金・配送条件も必要 |
| 銀行振込 / ペイジー | KOMOJU | 入金期限、照合、返金の手動運用を整備後 |
| Paidy | KOMOJU | 加盟店・商品審査、請求/返金/確定条件をテスト後 |
| PayPal | ShopifyのPayPal連携 | 追加候補。アカウントと返金運用を確認 |
| BitCash / NET CASH | KOMOJU | 日本のShopify対応候補。物販への適用、手数料、需要を確認して追加 |
| Alipay / Alipay HK / WeChat Pay | KOMOJU | 海外の購入者から日本へのギフト需要がある場合に優先。通貨・購入者条件を実店舗で確認 |
| 韓国・欧州・東南アジア・ブラジル向け決済 | KOMOJU等 | 将来の市場拡大候補。国/通貨/加盟店条件が合う方法だけ追加。現行JPY固定に無条件で追加しない |

KOMOJU公式のShopify一覧では、LINE Payは終了済み、日本加盟店のWebMoneyは対象外、キャリア決済は非対応です。au PAYウォレットとauかんたん決済などを同一視しません。[Shopify向け対応一覧](https://help.komoju.com/hc/ja/articles/4747456302366--Shopify-KOMOJU%E3%81%A7%E5%B0%8E%E5%85%A5%E5%8F%AF%E8%83%BD%E3%81%AA%E6%B1%BA%E6%B8%88%E6%89%8B%E6%AE%B5%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6)、[Shopify Payments日本](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/japan/payment-methods)。

## 費用比較

KOMOJU公開料金の目安は、コンビニ2.75%、PayPay・メルペイ・au PAY・d払い3.5%〜、楽天ペイ4.4%〜、銀行振込1.4%。初期・月額費用は無料と案内されています。個別契約が優先し、課税、最低手数料、購入者負担、返金・振込費用も実契約で確認します。[KOMOJU料金](https://ja.komoju.com/pricing/)。

Shopifyの外部サービス取引手数料が別途かかる場合があります。Shopify Paymentsを併用しているだけでKOMOJU分が免除されるとは考えません。カードはShopify Paymentsとの総費用で比較します。取引量・契約プランが未確認のため、月次費用や「必ず最安」という断定はしません。[Shopify外部決済手数料](https://help.shopify.com/ja/manual/payments/third-party-providers)。

## 管理画面での接続

1. Shopify店舗・法人/個人区分・日本住所・JPY・販売商品・法務表示を確認し、KOMOJUの利用申請と必要な方法ごとの審査を行う。秘密鍵はチャットやリポジトリへ記載しない。
2. KOMOJUの設定 → 外部サービス連携 → Shopifyから、承認された各方法を対象店舗へ接続する。KOMOJUとShopifyのアカウント/店舗名を確認する。
3. Shopifyの設定 → 決済で各アプリを有効化する。隔離したテスト店舗では、各方法のテストモードを明示的にONにしてから検証する。テストモードは方法ごとで、初期状態でONとは限らない。
4. 下記の証跡を残す。本番では審査・証跡が揃った方法だけを有効にし、テスト用設定を混ぜない。

この方式ではKOMOJUの決済APIをBloomBoxから直接呼びません。決済方法追加はShopify/KOMOJUの公式連携で行います。[公式接続手順](https://doc.komoju.com/docs/getting-started-with-shopify)。

## 実装済みの接続境界

- `ShopifyCartClient` はStorefront API `2026-07`のカート作成と再取得を実装。サーバーで選んだvariantと数量のみ送信し、ShopifyのJPY価格を照合します。最終税・送料・割引・決済額はShopifyで確定します。
- カートに送る属性は購入準備IDだけ。ギフト本文・受取人の氏名・住所は送信しません。注文のギフト情報引き継ぎは別途、保護された保存内容と検証済み注文の関連付けで完成させる必要があります。
- 意図しない価格/数量変更、追加明細、APIの警告・エラー、許可外のチェックアウトURLは拒否します。作成結果が不明な場合は自動再送しません。
- `SHOPIFY_CHECKOUT_HOSTNAMES`で確認済みのチェックアウトドメインをカンマ区切りで指定。省略時は設定済みの`SHOPIFY_STORE_DOMAIN`のみ許可します。APIホストは引き続き`*.myshopify.com`の当該店舗に固定します。
- 外部要求前の永続的な試行確保、事業者固定、暗号化保存、再取得、結果不明時の停止を内部ワークフローに実装。[仕様と運用](SHOPIFY_CHECKOUT_ATTEMPTS.md)。
- 接続境界は購入画面へまだ組み込んでいません。設定だけで有効になるものではありません。現在の`BLOOMBOX_CHECKOUT_PROVIDER`は`preview`/`stripe`のみです。

## 本番に組み込む前の残作業

| 課題 | 完了条件 |
| --- | --- |
| カート作成の重複防止・回復 | 永続化/排他・暗号化・再取得・DB障害テストは実装。残件は結果不明の正式な照合・通知・終了/削除手順、所有権確認、購入画面への組込み。[詳細](SHOPIFY_CHECKOUT_ATTEMPTS.md) |
| Shopify通知と注文状態 | 署名検証、対象店舗/API版/イベントの検証、重複排除、順序逆転、未着通知の再照合、支払待ち/入金済み/取消/返金の投影。KOMOJUからの戻り画面だけで入金済みにしない |
| 配送・在庫・ギフト | 購入者と受取人の分離、ギフト情報の関連付け、購入途中の内容変更、在庫の予約/解放、未入金で発送しない制御 |
| 遅延決済の締切 | 入金後に必要な準備日数、希望日までに入金されなかった場合の変更/返金、期限切れ後の入金、決済アプリの期限設定を確認。PurchaseIntentの24時間期限をShopifyの決済期限と同一視しない |
| 公開判定 | `config/production-commerce-activation.json`と実行可能な公開判定をShopify経路に更新。証跡不足やpreviewのままで通過させない |
| 実店舗設定 | 審査・各アプリ接続・テスト・本番/テスト環境分離。現在はいずれも未確認 |

コンビニ・銀行振込・ペイジーは返金が手動対応となるため、担当者・返金先確認・重複防止・返金記録を定めます。管理画面上の取消と実際の返金完了を区別します。KOMOJU公式の[コンビニ・銀行振込・ペイジーの返金手順](https://help.komoju.com/hc/ja/articles/5355123862686)を参照します。

## 決済方法ごとの証跡

秘密情報・個人情報を除いた次の記録を、対象コミットと隔離店舗に紐づけて残します。単体テスト成功を実決済の接続証跡の代わりにしません。

| 記録 | 必要な検証 |
| --- | --- |
| 加盟店設定 | 方法名、審査状態、対象通貨/国、アプリ有効化、テストモード、担当者 |
| 正常購入 | BloomBox → Shopify → 対象決済 → Shopify注文への反映。同一商品/金額/数量 |
| 購入失敗 | ユーザー取消、残高不足/認証失敗、通信切断、二重クリック、価格/在庫変更 |
| 非同期決済 | pendingで発送されない、入金・期限切れ・遅延入金、希望配送日を過ぎた場合 |
| 返金・取消 | 全額/部分返金の対応可否、二重操作、Shopify/KOMOJUの状態と手数料差異 |
| 復旧 | 通知の重複/順序逆転/欠落、再処理、照合、新規受付停止後も既存取引を処理 |

全方式の承認前に「全決済対応」と公表しないこと。追加方法はこの同じ証跡で段階的に有効化します。
