# アクセス解析（GA4）

2026-09-18。コードは実装済み。GA4プロパティ作成と本番設定は未実施で、初期状態は無効。設計判断は [ADR 0018](../architecture/adr/0018-consented-web-analytics.md)。

## 分かること

| 知りたいこと | GA4での見方 | 使うイベント・項目 |
|---|---|---|
| ページのどの区画で離脱したか | 探索 → 自由形式またはファネル。`section_name` 別の `section_view` 件数を、ページの `page_view` 件数で割る | `section_view`（`section_name`、`page_path`） |
| 商品から購入までの離脱 | 探索 → ファネル: `view_item` → `gift_start` → `view_cart` → `begin_checkout` → `purchase` | 推奨イベント |
| 新規かリピートか | レポートまたは探索で `customer_type` 別に比較（first_purchase / repeat_purchase / guest） | `purchase` のパラメータとユーザープロパティ |

区画名はトップページが hero, intro, announcements, shortcuts, collection, occasions, gallery, delivery, assurance, journey, reviews, faq, membership。商品ページは product-detail, product-facts, related-products。そのほか cart, order-confirmation がある。区画の追加は、対象要素に `data-analytics-section="英小文字とハイフン"` を付けるだけ。

`customer_type` は購入時の区分で、購入前の閲覧者には付かない。「ログインしていない購入」はguestで、初回かどうかは判定しない（メールアドレスで名寄せしない）。同じ人が別の端末・ブラウザを使うと、GA4上は別ユーザーとして数えられる。

## 計測しない画面

ギフト入力（贈る言葉・受取人）、受取人向け画面、ログイン、マイページ、運営画面、注文照会、テスト決済、プレビュー、紹介。一覧は `src/shared/domain/analytics-policy.ts` の `ANALYTICS_EXCLUDED_PATH_PREFIXES`。

## GA4プロパティの推奨設定

Googleアカウントでの作業は、事業の管理者が行う。GA4の標準版は無料。GA4 360（有料）や BigQuery の有料利用は不要。

1. [Google アナリティクス](https://analytics.google.com/) で「管理」→「作成」→「プロパティ」。
   - プロパティ名: `BloomBox`
   - レポートのタイムゾーン: 日本
   - 通貨: 日本円（JPY）
   - 業種: ショッピング、ビジネスの規模は実態に合わせる
2. 「データストリーム」→「ウェブ」。URLには本番の `BLOOMBOX_PUBLIC_ORIGIN`（https）を入れる。ストリーム名は `BloomBox Web`。
3. 同じ画面の「拡張計測機能」を次のようにする。自動送信がURLのクエリや入力内容を拾わないようにするため。
   - ページビュー → 詳細設定 → 「ブラウザの履歴イベントに基づくページの変更」: **オフ**（アプリが送るため。二重計測を防ぐ）
   - サイト内検索: **オフ**
   - フォームの操作: **オフ**
   - スクロール数、離脱クリック、動画エンゲージメント、ファイルのダウンロード: オンのままでよい
4. 「測定ID」（`G-` で始まる）を控える。
5. 「管理」→「データの収集と修正」→「データの収集」。**Google シグナルのデータ収集はオフ**のまま。「広告のパーソナライズ」を許可する設定も有効にしない。
6. 「データの保持」→ イベントデータの保持: **14か月**。「新しいアクティビティのユーザーデータのリセット」: オン。
7. 「カスタム定義」→「カスタムディメンションを作成」:
   - ディメンション名 `区画`、範囲 **イベント**、イベントパラメータ `section_name`
   - ディメンション名 `購入区分`、範囲 **イベント**、イベントパラメータ `customer_type`
   - ディメンション名 `顧客区分`、範囲 **ユーザー**、ユーザープロパティ `customer_type`
8. 「データフィルタ」の「内部トラフィック」に運営者のIPを登録し、フィルタを「有効」にする。テスト中は「テスト中」のままでよい。
9. Google 広告とのリンクは作らない（広告送信は [広告連携](ADVERTISING.md) の同意・経路で別管理）。

## アプリの設定

| 変数 | 内容 |
|---|---|
| `BLOOMBOX_GA4_MEASUREMENT_ID` | GA4の測定ID（例 `G-XXXXXXXXXX`）。未設定または空で無効。形式が不正なときは無効になり、`analytics_configuration` のエラーを記録する |

公開してよい値だが、`NEXT_PUBLIC_` は使わずサーバー環境変数として設定する。CSPを同じ値から決めるため。設定の反映には再配備が必要。preview環境には設定しない。本番と分けたい場合は、GA4側で別のプロパティを作る。

## 有効化の確認

1. 本番URLを開き、同意バナーで「同意しない」を選ぶ。ネットワークに `googletagmanager.com` / `google-analytics.com` への通信がないこと。
2. 「アクセス解析の設定」→「同意する」。GA4の「リアルタイム」または「DebugView」に `page_view` が出ること。
3. トップページをスクロールし、`section_view` の `section_name` が順に出ること。
4. `/gift/…` や `/account` に移動したとき、そこではイベントが出ないこと。
5. テスト決済で購入し、完了画面で `purchase` が1回だけ出ること。`transaction_id` が受付番号で、`customer_type` が付いていること。ページのURLに `session_id` が含まれていないこと。
6. 「同意しない」に変更すると、`_ga` で始まるCookieが消え、以降の送信が止まること。

カスタムディメンションはレポートへの反映に最大24〜48時間かかる。

## 停止・切り戻し

`BLOOMBOX_GA4_MEASUREMENT_ID` を削除して再配備する。タグ、同意UI、CSPの追加送信先がすべて消える。送信済みデータの削除はGA4の「データ削除リクエスト」で行う。個人を特定するデータは送っていないので、利用者単位の削除依頼には「ユーザーエクスプローラ」でのクライアントID削除で対応する。

## 未完了

- GA4プロパティの作成、測定IDの本番設定、上記の確認（事業者のGoogleアカウントが必要）。
- プライバシーポリシーの外部送信の記載は法務確認（P0-16）後に公開。
- 同意UIの文言確認。
