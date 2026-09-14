# 公開プレビューのGoogleログイン接続

2026-09-14（JST）。公開URLの「マイページは準備中」を解消するため、既存の顧客認証・本人画面をVercelへ接続した記録。アプリケーションコードは変更せず、CI成功済みmain `decdb45fb05a24fc3066e1b5fab8c13924b74022` を使用した。

## 原因と接続先

公開先は **https://bloom-box-shop-ybb9.vercel.app**、Vercel projectは `bloom-box-shop-ybb9`（`prj_uguMJ5XHO9Vx6qvij8mELEKAtHyp`）。確認開始時の稼働SHAは `38b93bb46f98dcd930a3927c358f2da21ed404e8` で、専用ログイン画面の変更前だった。環境変数も未設定だった。`vercel.json` は自動デプロイを止めているため、PR #108/#109のマージと3025番での確認だけでは公開先は更新されない。

元のローカル作業ツリーの `.vercel/project.json` は別project `bloom-box-shop` を指していた。名前の似たprojectへデプロイしない。操作前に実際の公開URL、project ID、稼働SHAを照合する。

```mermaid
flowchart LR
  Header[トップのマイページ] --> Account[/account]
  Account -->|未認証| Login[/account/login]
  Login --> Google[顧客専用Google OAuth]
  Google --> Callback[固定HTTPS callback]
  Callback --> Identity[Neonの本人ID・状態を検証]
  Identity --> Dashboard[本人の履歴・ランク・プロフィール]
  Account -->|認証済み| Identity
```

## 環境とデータ

- Vercelの既存公開aliasはtargetが `production` だが、アプリの `BLOOMBOX_RUNTIME_MODE=preview` と `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false` を維持した。今回のユーザー指示は既存公開プレビューの認証修正であり、販売開始や本番commerce activationではない。
- 既存Neon連携のFreeプランに、専用DB `bloombox-customer-account` を作成。regionはVercelと同じiad1。Neon Authは無効で、既存のGoogle認証を使用する。
- 空DBへ既存migration 0001〜0025を適用。再実行は追加0件。ローカルDB、架空注文、商品、運営者権限は移していない。
- `database/roles.sql` を適用し、専用login `bloombox_account_web` に既存 `bloombox_application` のみを付与。superuser・CREATEDB・CREATEROLE・BYPASSRLSはすべてfalse。アプリ権限でschemaへのCREATE TABLEが拒否されることを確認した（成功してもrollbackする検証）。
- 初期化用owner資格情報を取得するためのDevelopment接続は解除済み。公開runtimeにはowner接続・worker接続・運営者接続を渡していない。DB自体は保持し、制限したアプリ接続をVercelへ設定した。
- `CUSTOMER_ACCOUNT_ENABLED=true`、`CUSTOMER_ACCOUNT_ORIGIN` と `AUTH_URL` は上記HTTPS origin。顧客専用Google client/secretと、新規の公開環境専用session secretを接続。Googleに同originの `/api/customer-auth/callback/google` を追加し、既存localhost callbackは維持した。
- `DATABASE_SSL_MODE=verify-full`、`DATABASE_MAX_CONNECTIONS=2`。`AUTH_OPERATOR_ENABLED=false`。顧客認証を管理者権限へ流用しない。
- 秘密値、実顧客のメール・ID、OAuth URL、Cookie、プロフィール画像を含むキャプチャはGit/PRへ保存しない。
- 公開前のhealth確認時にVercel CLIが生成したautomation bypass tokenは、検証後に当該tokenだけを失効させた。Deployment Protection自体は無効化していない。

## デプロイと検証

公開deploymentは `dpl_6twZmCZWafY8Puvr8MVd4MZYWr2k`。先にdomain切り替えを保留してbuildし、ReadyとhealthのSHA一致を確認してから既存公開aliasへpromoteした。公開 `/api/health` でも同SHAと `status=ok` を確認した。

CLI uploadの最初の候補 `dpl_K6XPMbHkNUwVxCUsb5E2hCzQiDUM` はhealthのreleaseが空だったため公開aliasへpromoteしていない。`BLOOMBOX_RELEASE_SHA` を明示した候補に置き換えた。今後CLIでデプロイする際も対象SHAをbuild/runtimeへ明示し、healthとの一致を確認する。

SHAはdeploymentに保存済みで、project共通の `BLOOMBOX_RELEASE_SHA` は後続リリースで古いSHAを誤表示しないよう解除した。CLI更新では `--build-env BLOOMBOX_RELEASE_SHA=<対象SHA> --env BLOOMBOX_RELEASE_SHA=<対象SHA>` のように、そのdeploymentに指定する。

| 確認 | 結果 |
| --- | --- |
| 対象SHAのGitHub CI・Semgrep | 成功を確認 |
| ローカルのrepository検査・認証/DB設定テスト | repository検査成功、2ファイル23テスト成功 |
| Vercel build | Ready |
| 未認証でトップのマイページをクリック | 専用ログイン画面へ移動し、Googleボタンを表示 |
| Chromeで顧客Aの実Google認証 | 公開HTTPS `/account` へ戻り、本人プロフィール・SEED・購入実績0円・注文なしを表示 |
| 認証済みの顧客Aがトップから再訪 | Google認証を再要求せず本人画面を表示 |
| 別ブラウザーで顧客Bの実Google認証 | 同じ公開URLで顧客B本人のプロフィール・SEED・購入実績0円・注文なしを表示 |
| 顧客Aがログアウトしてマイページへ再訪 | 本人情報を表示せず専用ログイン画面へ案内 |
| 顧客Aの再ログイン・顧客Bの再読み込み | 各本人の画面を再表示。DBは顧客2件・Google identity2件・異なる顧客ID2件・注文0件を維持し、重複アカウントを作らない |
| 顧客Bの認証で管理画面を開く | 管理者ログインの未接続案内へ遷移し、管理データは表示しない |
| 未認証HTTPのaccount/loginとaccount | `private, no-cache, no-store`、旧「準備中」表示なし |

公開DBには検証用注文を追加していないため、実注文付きの二者間非表示は[隔離DBの記録](CUSTOMER_ORDER_ISOLATION_VERIFICATION.md)を参照。ローカルの合成注文を公開購入実績として見せない。

## 残る範囲

Googleは「テスト中」、登録テストユーザー2名の設定を維持。Google画面ではBranding設定未完了により公開ボタンが無効だった。一般顧客向けの公開範囲・正式ブランド/ドメイン/窓口・個人情報条件の確定は別途必要。ID/パスワード認証は追加していない。

実Stripe購入・割引・返金・発送、公開DBの復旧演習、自然なsession期限切れ、公開先でのGoogle/DB障害訓練、運営者認証・業務権限の接続は未完。料金/ランク条件は先行案の表示を維持する。今回の認証接続を商用販売の完了証拠にしない。

## 更新・切り戻し

1. 次回も公開URLとproject IDを確認し、環境変数の値は表示せず設定先・有効化状態を検証する。Git pushだけではVercelは更新されない。
2. 固定origin/callbackを保つ。Preview deployment用のランダムURLへ顧客の秘密値を複製しない。CLIでは対象SHAを明示し、Ready・health一致を確認してから許可された公開先へ反映する。
3. 認証の緊急停止は同projectで `CUSTOMER_ACCOUNT_ENABLED=false` を反映した再デプロイ。画面を戻す場合の旧deploymentは `dpl_G2LEF3yu7hhgSg7xJTCT7CzKy2km`（旧準備中画面に戻る）。immutable deploymentには作成時の環境設定が含まれるため、現在の環境変数変更だけで過去deploymentが更新されるとは考えない。
4. 顧客・監査・migrationを削除して戻さない。DBとGoogle clientは保持する。callbackを取り消す必要がある場合は今回のHTTPS URIだけを対象にする。
5. 商用販売の開始は引き続き [RELEASE.md](RELEASE.md) と本番activation gateに従う。
