# 購入画面のスクリプト防御と検査

2026-09-18。対象は駿河屋のような購入画面の改ざんに対する追加防御。侵入の完全防止や公開環境の安全性を保証するものではない。

## 判断と変更

`src/proxy.ts` がリクエストごとに暗号学的乱数24バイトのnonceを発行する。ブラウザーが指定したnonce/CSPは上書きし、Next.jsのサーバーレンダリングと応答に同じCSPを渡す。スクリプトはnonceとstrict-dynamic、通信は同一originに制限する。HTMLをキャッシュさせず、root layoutの `connection()` でリクエスト時レンダリングにする。prefetchを装うヘッダーでも処理を省略しない。

Googleへのフォーム遷移は顧客・運営者の認証経路だけで許可する。画像はNextの同一origin最適化経由、フォントは自己配信。既存のReact style属性を維持するためstyle-srcのみunsafe-inlineを許可し、JavaScriptには許可しない。unsafe-evalは開発サーバーだけ。Stripe SDK、認証・認可、販売停止条件は変更しない。

Next.js 16.3.4同梱のCSP/Proxy/connectionガイドを確認。実験的SRIや新たな解析用外部スクリプトは導入していない。nonceによって静的HTML/CDNキャッシュが利用できなくなるため、クラウドの応答時間・費用への影響は配備前後に確認する。ローカルの正常表示だけで本番性能を保証しない。

## 監視の検知範囲

既存の公開監視に `scripts/verify-browser-policy.mjs` を追加。parse5でHTMLを実行せず解析し、CSP欠落・弱体化・重複指定、nonce不一致、未承認の外部スクリプト、イベント属性、予期しないscript種別、HTMLキャッシュ許可を検出する。script要素を削除した後の文字列だけで判定しない。エラーにページ本文や改ざんされたヘッダー値を出力しない。

これは**既存JavaScriptファイルの内容のハッシュ照合ではない**。nonce付きの改ざん済みインラインコードや、許可されたパスのJS内容の差し替えを、それだけでは検知できない。CSPとHTMLの両方を変更できる攻撃者にも単独では対抗できない。承認済み配備物のハッシュを独立管理した監視、実配備権限の分離は次の運用課題。監視のコード自体は同じGitHubリポジトリにあるため、main保護を代替しない。

## 検証と依存関係

- 関連テストに未承認script、nonce偽装、重複CSP、送信先の拡大、キャッシュ許可、Report-Onlyのみの設定を拒否するケースを追加。
- PlaywrightのChromiumで実際のproduction buildを起動し、購入・ログイン画面、hydration、nonceの毎回更新、不正スクリプト・外部送信の遮断を確認。
- ローカルの架空データで、ギフト設定→カート→Server Action→注文者入力→確認→ダミー決済完了を確認。実Stripe・実Googleログインの検証とは区別する。
- 通常テスト1,474件成功、DB等287件はローカル未設定によりskip。静的検査・型検査・lint・production build成功。DB変更はない。
- `parse5@8.0.1`（MIT）：HTMLの文字参照・テンプレート等を正しく検査するため、監視・検証用のdevDependencyとして採用。
- `@playwright/test@1.62.0`（Apache-2.0）：実ブラウザーでCSPの遮断と正常操作を確認するため採用。npm registryの公開版を固定。リリース直後の1.63.0は採用しない。
- 初回の全依存監査で既存ESLint配下のjs-yaml 4.3.1にGHSA-2883-xcg3-v3hhを検出。並行してmainへ入ったESLint 10更新（#207）で当該依存が除去されたため、追加overrideは残さない。統合後の全依存監査は検出0件。

再現手順：`pnpm install --frozen-lockfile`、`pnpm check:ci`、`pnpm exec playwright install chromium`、`pnpm test:browser-security`。ブラウザー試験のサーバーは127.0.0.1:3187、preview/in-memory/dummy checkout専用。実アカウントや秘密値を持ち込まない。CIの既存品質jobにもブラウザー試験を追加。

## GitHub実設定の確認と適用

2026-09-18にAPIで確認。リポジトリはprivate、mainはprotected=false。rulesets取得はプラン制約の403。Productionの保護はmain限定のみで、required reviewerなし。既存の承認者bright-broom（User ID 170618233）を再設定するAPIは、プランがrequired reviewersをサポートしないという422で拒否された。課金・公開化は行っていない。

適用できた補完対策：Actionsの `sha_pinning_required` をfalseからtrueへ変更し、読み返して確認。enabled=true / allowed_actions=allは維持。既存workflowは固定SHAなので実行方法の変更はない。default workflow permissions=read、PRレビュー自動承認=falseも確認。権限を狭めるこの設定はmain保護の代わりにはならない。

P0-01/P0-02、Issue #6は未完。過去の「設定済み」は当日の履歴であり、現在の実効性を示さない。privateのまま保護を利用できるプランと独立レビュー担当の判断が必要。Environmentを経由しないVercel配備経路・MFA・鍵の権限は未確認。

## 配備・切り戻し

本変更は本番販売の許可ではない。公開稼働SHAは監査時259356eであり、コードと監視の更新が配備済みという意味ではない。nonce対応アプリの配備前に新監視をmainへ取り込むと、旧アプリをCSP不足として検出する。旧サイトに合わせて検査を緩めず、リリース担当者がアプリ配備と監視切替を調整する。

配備時に7経路のヘッダー・画面動作、実Google認証、Stripeテスト接続、レスポンス時間を確認する。アプリと監視の切替を一組として扱い、問題時はこのPRのコードをrevertして直前の確認済み配備物へ戻す。スクリプト制限をunsafe-inlineへ緩めて回避しない。ActionsのSHA固定は維持する。必要な場合のみ管理者が記録を残して元の設定へ戻す。
