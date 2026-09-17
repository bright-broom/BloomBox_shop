# 3041番のGoogleログイン復旧記録

2026-09-17。対象はローカル `http://localhost:3041`。アプリコードはmain `7629ccd4f44ab5e6f8f74246533b354ba130f9c9`。

> 後続作業で、管理ダッシュボードの業務DB接続も完了。[管理画面の接続記録・権限期限](LOCAL_OPERATIONS_3041.md)を参照。以下の未設定という記載はGoogle認証復旧時点の履歴です。

## 原因と復旧

旧3041サーバーは顧客認証の設定を持たない作業ツリーの古いbuildを実行しており、`CUSTOMER_ACCOUNT_ENABLED` が未設定のためGoogleボタンが非表示だった。マイページ・管理者ページの実装の削除ではない。

- 既存の顧客・運営者Google OAuthクライアントへ、それぞれ `http://localhost:3041/api/customer-auth/callback/google` と `http://localhost:3041/api/operator-auth/callback/google` を追加し、Google Cloudで保存完了を確認。既存3000/3025/公開サイトの戻り先は維持。
- 既存の非公開設定を引き継ぎ、`CUSTOMER_ACCOUNT_ORIGIN` と `AUTH_URL` を `http://localhost:3041` に統一。顧客用と運営者用のクライアント・秘密値・Cookie・権限の分離は維持。
- 既存の隔離顧客DBを非公開バックアップし、既存migration 0026〜0028を適用。customer_portals/customer_requestsへのアプリロールの権限は `database/roles.sql` の定義に合わせた。顧客2件・確認用注文2件を維持。顧客・注文の再作成やseedは行っていない。
- 既存ローカル暗号鍵を接続し、プロフィール等のセルフサービス画面が読み込める状態にした。
- プロジェクト本体 `/Users/toshikisakuta/dev/BloomBox` を上記main基準へ更新し、Node.js 24で再build・3041番で再起動。設定はGit対象外の `.env.local`、権限0600。アプリコードの変更は不要だった。

## 検証

- ログイン画面に「Googleでログイン」が表示される。
- Chromeの既存本人アカウントで実Google認証が成功し、3041の `/account` に戻る。本人の確認用注文・購入実績・会員ランク・プロフィールが表示される。
- トップのヘッダー「マイページ」から、再ログインなしで本人の画面へ戻れる。
- `/account/profile` が表示される。プロフィールの書き換えはしていない。
- 顧客としてログインしていても `/operations` は専用ログインを要求する。別途実Google認証を行うと運営ダッシュボードへ戻る。
- **管理ダッシュボードの業務DB接続は未設定。認証成功は業務データ取得・各操作の検証完了を意味しない。**
- Node.js 24でproduction build成功。既存の認証設定・認証ルート・入口状態の47テストが成功。

## 再開方法・再発防止

現在の起動元は `/Users/toshikisakuta/dev/BloomBox`。秘密値を共有文書へ転記しない。DB管理メモ・バックアップは既存の非公開 `/private/tmp/bloombox-customer-local` にある。DBは同ディレクトリのREADMEに従って再開し、初回setup/seedは再実行しない。

```bash
cd /Users/toshikisakuta/dev/BloomBox
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3041
```

3041が使用中なら、既存サーバーの作業ディレクトリを確認してから再起動する。ポートを自動でずらさない。新しい作業ツリーには `.env.local` が移らないので、コードだけでGoogle認証が有効になると考えない。`/api/health` のreleaseと実際のログイン画面の両方を確認する。コード更新時は `BLOOMBOX_RELEASE_SHA` をそのコードに合わせ、buildと実行元をそろえる。

## 範囲と切り戻し

Preview・新規注文受付停止を維持。Vercelの設定・デプロイ、Googleの対象ユーザー・公開範囲・スコープ、管理者の追加権限は変更していない。注文は以前の確認用データであり、実決済・発送の証拠ではない。今回は既存1アカウントで復旧確認し、2人の注文分離試験全体は再実施していない。

停止する場合はローカルサーバーを終了するか、顧客認証を無効にして再起動する。必要なら既存の非公開バックアップから環境設定を戻す。Googleの戻り先を撤回する場合は3041番の追加分だけを対象とする。適用済みmigration・顧客・注文を削除して切り戻さない。
