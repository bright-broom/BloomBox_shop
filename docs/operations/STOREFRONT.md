# Storefront operations

## Scope and ownership

BloomBox は、商品発見、商品説明、ギフト設定、購入後の安全な状況確認、案内ページを所有します。Shopify は商品、価格、在庫、顧客、注文、返金の正本です。Stripe を有効化する場合は ADR 0002 の独立した決済境界を使用し、在庫確保方式が承認されるまで本番決済を開始しません。

通常のショップで必要になる機能は、次のように分担します。

| 機能 | 所有者 | BloomBox での実装 |
| --- | --- | --- |
| 商品検索・贈る場面での絞り込み・並び替え | BloomBox | サーバー側で正規化し、商品名、花材、つくり手、贈る場面を検索 |
| 商品、価格、販売可否 | Shopify | Storefront Adapter で取得し、購入直前に再確認 |
| 数量、届け先、希望日、ギフトメッセージ | BloomBox | サーバー側ポリシーで検証し、価格を再計算 |
| カート | BloomBox | 1 商品・1 お届け先のギフト設定をタブ単位で保持し、決済開始時にサーバー側で商品・価格・販売可否を再検証 |
| 割引、税、送料、支払方法、最終確認 | Commerce Provider | Hosted Checkout に委譲し、ブラウザーから価格を受け取らない |
| 顧客アカウント、住所帳、注文履歴 | Shopify | 必要性と本人確認方式を承認後、Shopify Customer Account へ接続 |
| 注文・決済・配送状況 | Shopify または Stripe の検証済み事実 | 高エントロピーな Checkout Reference を capability として、個人情報を含まない投影だけを表示 |
| 注文・発送通知 | Commerce Provider | Provider 側通知を本番 E2E で検証。BloomBox Outbox から独自通知する場合は別の承認済み Adapter を追加 |
| 法務、配送、返品、プライバシー、問い合わせ | Product / Legal / Support | 検証済みコンテンツから表示し、草案の間は本番ゲートを失敗させる |

BloomBox は 1 回の注文につき 1 つのお届け先を扱います。これはギフト情報と受取人の境界を曖昧にしないための明示的な制約です。複数配送先は、Provider の注文分割、送料、キャンセル、返金、サポート手順を設計する ADR が承認されるまで、注文を分けて扱います。

## Cart and Preview Test Mode

購入導線は、ギフト設定、カート、お届け先入力、注文確認、決済、完了の順に統一します。Production では、カートの「購入手続きへ」からサーバー側で Purchase Intent を作成し、Stripe Checkout へ遷移します。Stripe Checkout を取り消した場合はカートへ戻し、タブ内のギフト設定を保持して再試行できるようにします。

Preview では、同じカート入口から明示的な Test Mode に進みます。Test Mode は外部 API やカード会社を呼び出さず、固定のダミーカードで成功と失敗を再現します。実カード番号を入力する欄は設けません。テスト送料は Preview 専用ポリシーとして表示し、実際の送料とはみなしません。

カート、ギフト情報、ご注文者、配送先はブラウザーの `sessionStorage` にだけ保存し、すべての読み出し時に Schema 検証します。この情報はタブを閉じると失われます。テスト完了時にはカート、ご注文者、配送先、同意状態を削除し、個人情報を含まない最小限のテスト控えだけをタブ内に残します。ブラウザー内の価格は表示用であり、Production の決済金額には使用しません。

### Postal code address lookup

配送先フォームは、郵便番号を NFKC 正規化し、ハイフンと空白を除いた 7 桁の数字として検証します。7 桁が揃うと自動検索し、都道府県、市区町村、町域を入力します。同一郵便番号に複数の町域がある場合は、先頭候補だけで確定せず、利用者が候補を選択できるようにします。検索で存在しないことを確認した郵便番号は続行を止めます。

住所検索は、`fulfillment` Module の Port を介して zipcloud Adapter に接続します。zipcloud は日本郵便の公開データを検索 API として提供しており、API キーは不要です。Provider へのリクエストは 2.5 秒で打ち切り、成功結果を 24 時間 Cache します。Provider 障害、Timeout、不正レスポンスは購入の停止理由にせず、住所の手入力へフォールバックします。Provider の URL、レスポンス、郵便番号は Log に残しません。

ブラウザーからの検索は、郵便番号を URL やアクセスログへ載せないよう、同一 Origin の `POST /api/postal-code` を使います。Route は Content Type、実 Body Size、Schema、Cross-site Request を検証し、Provider の詳細を Client へ返しません。日本郵便公式 API へ移行する場合は、Application と UI を変えずに Adapter と認証付き Server Configuration を差し替えます。

- [zipcloud 郵便番号検索 API](https://zipcloud.ibsnet.co.jp/doc/api)
- [zipcloud 郵便番号検索 API 利用規約](https://zipcloud.ibsnet.co.jp/rule/api)
- [日本郵便 郵便番号・デジタルアドレス API](https://guide-biz.da.pf.japanpost.jp/api/)

## Customer-facing information

`content/storefront.json` が、About、ご利用ガイド、FAQ、配送・返品、Privacy Policy、利用規約、特定商取引法に基づく表記、問い合わせ案内の正本です。編集後は `pnpm check:content` を実行します。

`publicationStatus` を `approved` に変更できるのは、販売事業者と担当者の実在情報、送料、支払時期、引渡時期、キャンセル、返品の可否・期限・条件・費用負担、個人情報取扱事業者、委託先、越境移転、保存期間、問い合わせ窓口が承認された後だけです。未確定表現が残る場合、`pnpm check:production` は失敗します。

消費者庁の通信販売ガイドでは、販売価格と送料、支払時期・方法、引渡時期、返品条件、事業者名、住所、電話番号、責任者などの表示が必要とされています。返品特約は可否だけでなく、期間、条件、送料負担を明確にし、最終確認画面でも確認できる必要があります。

- [通信販売に対する規制](https://www.no-trouble.caa.go.jp/what/mailorder/index.html)
- [通信販売広告について](https://www.no-trouble.caa.go.jp/what/mailorder/advertising.html)
- [通信販売の申込み段階における表示](https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice02/index.html)
- [個人情報保護法の法令・ガイドライン](https://www.ppc.go.jp/personalinfo/legal/)

法令適合性の最終判断は、販売事業者と法務担当者が行います。

## Search, SEO, and indexing

- Preview は `robots.txt` で全面的に Index を拒否します。
- Production は Cart、Checkout、Gift、Order、API を Crawl 対象外にします。
- Sitemap は公開情報ページと、Provider から取得した販売可能商品だけを含みます。
- 商品ページは Canonical、Open Graph、Product JSON-LD を出力します。
- `BLOOMBOX_PUBLIC_ORIGIN` は Production で HTTPS Origin が必須です。

## Order-status privacy boundary

注文状況ページは、Stripe Checkout Session ID を推測困難な capability として利用します。画面と Query は、受付番号、商品名、数量、希望日、合計、状態、配送番号だけを返します。氏名、住所、メール、電話、ギフトメッセージ、Provider Customer ID は返しません。

注文番号だけを使う公開検索は実装しません。注文番号は短く、人による問い合わせには適していますが、認可 Token にはなりません。将来の注文履歴は、Shopify Customer Account の本人確認済み Session を使います。

## Release evidence

本番前に、最低限次を証跡として残します。

- Mobile、Desktop、200% Zoom、Keyboard、Screen Reader の主要導線
- 検索 0 件、在庫なし、Provider 障害、決済キャンセル、決済処理中、注文確定、発送、返金
- Shopify Test Store または Stripe Test Mode の最終確認画面に、商品、数量、税、送料、支払総額、返品条件が正しく表示されること
- 注文・発送・返金メールが正しい宛先へ 1 回だけ送られ、Recipient が Marketing 対象にならないこと
- 特定商取引法、配送・返品、Privacy、利用規約、問い合わせ窓口の承認
- Order Status が PII を返さず、無効な Reference を拒否すること
- Provider 障害、DB 障害、Frontend Rollback 後も、受理済み注文が失われないこと

## Rollback

表示や検索の問題は、直前の Frontend Revision へ戻します。Provider が受理した注文、決済、返金、在庫を削除または書き換えません。法務表示に誤りが見つかった場合は、新規 Checkout を停止し、修正と再承認が完了するまで Preview Mode に戻します。
