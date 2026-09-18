# ADR 0018: 同意に基づくGA4アクセス解析

- 状態: 実装方式として採用、2026-09-18。「ページのどの部分で離脱したか」「新規かリピートか」を知りたいという依頼に対応。GA4プロパティとの接続は未実施（初期無効）。
- 範囲: ブラウザーでのGoogle アナリティクス 4（gtag.js）読み込み、計測対象画面、送信する情報。
- 関連: [ADR 0014](0014-advertising-conversions.md)（広告コンバージョン）。本ADRはADR 0014の「ブラウザに第三者SDKを読み込まない」を**アクセス解析に限って**例外とする。広告Pixel・リターゲティングは引き続き導入しない。

## 背景

区画単位の離脱や閲覧の流れは、サーバーログや購入確定イベントだけでは分からない。ブラウザーでの計測が必要になる。GA4は無料枠で必要な探索レポート（到達率・経路・ファネル）を持ち、別の分析基盤の構築より小さく始められる。

## 決定

- 同意前はgtag.jsを読み込まず、Cookieも作らない。同意状態は第一者Cookie `bloombox_analytics_consent`（granted/denied、180日、SameSite=Lax、HTTPSではSecure）で保持する。サーバーには保存しない。
- 読み込みはレイアウトのクライアント部品が同意後に行う。CSPはnonce＋`'strict-dynamic'`のまま。`BLOOMBOX_GA4_MEASUREMENT_ID` 設定時だけ、`connect-src`/`img-src` にGoogle アナリティクスの送信先を追加する。運営画面では追加しない。
- 計測しない画面: `/gift`・`/gift-next`（贈る言葉・受取人）、`/account`（ログイン・マイページ）、`/operations`、`/order`、`/checkout/test`、`/preview`、`/referrals`、`/api`。ここではタグを読み込まない。読み込み済みなら `ga-disable-<ID>` で送信を止める。規則は `src/shared/domain/analytics-policy.ts` が唯一の定義。
- ページビューは自動送信を止め、アプリが送る。`page_location` はoriginとパスだけ。クエリ（Stripeの `session_id` など）とフラグメントを送らない。外部の参照元はoriginだけ、同一サイトはパスだけ。
- 区画の到達は `data-analytics-section` を付けた要素がビューポート中央帯に入ったとき、ページビューごとに一度 `section_view` を送る（IntersectionObserver）。
- 商取引イベントはGA4推奨名を使う: `view_item`、`view_cart`、`begin_checkout`、`purchase`。ギフト入力画面は計測しないため、商品ページのボタンで `gift_start` を送る。
- `purchase` は検証済みWebhookで注文が確定した後の完了画面でだけ送る。`transaction_id` は受付番号。同じタブの再表示では送らない（sessionStorage）。GA4側でも重複排除される。
- 新規/リピートはサーバーが注文から判定する。同じ顧客アカウントに、それより前のCONFIRMED/CLOSEDのStripe注文があればリピート、なければ初回。アカウントに紐付かない注文はguest。この区分 `customer_type` をイベントパラメータとユーザープロパティとして送る。顧客ID・メール・氏名は送らない。GA4のUser-IDは使わない。
- Googleシグナルと広告パーソナライズは無効。Consent Modeは `ad_storage`/`ad_user_data`/`ad_personalization` を常にdenied。
- 解析の失敗・未読込・拒否は購入を止めない。送信はベストエフォートで、判断の根拠となる正本は注文データとする。

## 検討した代替案

- サーバー側のMeasurement Protocolだけ: 区画の表示やスクロールを取れない。
- 自前の解析基盤: 保存・集計・閲覧UIの運用が増える。現段階では過剰。
- Google タグ マネージャー: 管理画面から任意のスクリプトを追加でき、CSP/監視と承認の境界を弱める。採用しない。

## 影響と切り戻し

- 環境変数を未設定にすれば、タグ・同意UI・CSP拡張がすべて無効になる。コード変更のrevertでも戻せる。DBスキーマ変更はない。
- 公開監視（`scripts/verify-browser-policy.mjs`）は、上記の送信先を正確な組でだけ許可する。HTMLに外部スクリプトが直接あれば引き続き検出する。
- プライバシーポリシーに外部送信の内容を追記した。公開は法務確認（P0-16）後。

運用手順: [アクセス解析（GA4）](../../operations/ANALYTICS.md)。
