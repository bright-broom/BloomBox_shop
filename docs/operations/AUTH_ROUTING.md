# 顧客・管理者のログイン導線

確認日：2026-09-14。変更基準：main `1ff4bd28987ffa29dc141179c9fb7830c48135a3`。この文書と同じPRのコード・検証画像が対象。本番公開・実Google接続の完了記録ではない。

## 経路

```mermaid
flowchart TD
  Home[トップページ] -->|マイページ| Account[/account]
  Home -->|フッター・スマホメニューの管理者入口| Ops[/operations]
  Account -->|未認証| CustomerLogin[/account/login]
  CustomerLogin -->|顧客Google認証・既存セッション| Personal[本人の購入履歴・会員ランク]
  Account -->|認証済み| Personal
  Ops -->|未認証・担当者未登録| OperatorLogin[/operations/login]
  OperatorLogin -->|運営者Google認証・担当者確認| Hub[管理画面]
  Ops -->|認証済み・担当者確認| Hub
  Hub -->|各機能で権限を再確認| Management[商品・在庫 / 顧客 / 注文 / 権限]
  CustomerLogin -. Preview環境の見本リンク .-> Preview[/preview/account：架空データ]
```

トップの「マイページ」は `/account` を維持する。サーバーで認証状態を確認し、認証済みなら既存の購入履歴・会員ランク画面を表示する。見本に飛ばして本人の注文が見えるように装う処理は入れない。

未認証で管理機能へ直接アクセスした場合も専用ログインへ案内する。ログイン済みでも未登録の運営者には登録案内とログアウトを表示し、管理画面とのリダイレクトループを防ぐ。管理入口の通過だけでは権限を付与せず、各機能の既存のDB権限・有効期限検査を維持する。

## 安全性・失敗時の動作

- 顧客と管理者は既存の別Googleクライアント、秘密値、Cookie、セッション検証を使用する。顧客ログインで管理機能は開かない。
- 戻り先 `next` は純粋なドメイン関数で許可したローカルパスに限定。外部URL、別の認証領域、任意クエリー、ログイン画面へのループを拒否する。フォーム値とAuth.js callbackの両方で検証する。
- OAuth開始とログアウトは既存の同一オリジン検査を維持する。ログアウトはそれぞれのログイン画面へ戻り、もう一方のCookieを削除しない。
- 設定未接続、DB等の一時障害、未認証、担当者未登録を分ける。設定未接続時には動作しないGoogleボタンを表示しない。取得失敗を空の注文履歴に変換しない。
- `/account/*` と `/operations/*` の既存のprivate/no-store・same-originヘッダーを継承し、ログインページも検索対象外にする。

## ローカル接続時の注意

報告があった3025は、認証設定を渡していないデザイン確認用サーバーだった。`/preview/account` は開けても、本人の `/account` が開く証拠にはならない。

既存の実Google検証設定は `http://localhost:3000` 向けだったが、今回の確認時には3000を別プロジェクトが使用していた。3025へ移す場合は、顧客の `CUSTOMER_ACCOUNT_ORIGIN` と管理者の `AUTH_URL`、それぞれのGoogle OAuthクライアントに登録された戻り先を同じオリジンにそろえる。ポートの衝突を解消するか、3025用の登録を行うかは運用上の選択として残る。秘密値を文書やブラウザーへ埋め込まない。

Googleに登録するcallbackパスは今回変更していない。

| 用途 | callbackパス | 顧客・管理者の入口 |
| --- | --- | --- |
| 顧客Google | `/api/customer-auth/callback/google` | `/account/login` |
| 運営者Google | `/api/operator-auth/callback/google` | `/operations/login` |

専用ログインページのURLをOAuth callbackに登録しない。実接続は [顧客の接続記録](CUSTOMER_GOOGLE_CONNECTION_VERIFICATION.md) と既存の運営者設定に従い、DB、担当者対応、機能別DB権限も確認する。

## 今回の検証

- `pnpm check:ci` 成功：型、lint、構造・設計ルール、1001テスト、production build。DBを必要とする209テストはこの実行ではskip。追加の戻り先フォーム検証2テストも個別実行。
- ChromiumとWebKit、幅390/1280pxの4条件で、トップ→顧客ログイン、管理者ログイン、認証済み入口のスキップ、管理各ページの直接アクセス制御、顧客/管理者分離、権限付き商品管理・顧客管理への遷移、独立ログアウト、privateキャッシュと横幅を確認。
- ブラウザー検証は隔離PostgreSQL、架空顧客・担当者、暗号化された合成セッションを使用。実Google認証、実Stripe決済、実機Safariは今回の証跡に含まない。合成セッションは試験プロセス内だけで生成し、アプリへの認証回避機能は追加していない。
- 画像：[顧客390px](../design/verification/auth-routing/customer-390.png)、[顧客1280px](../design/verification/auth-routing/customer-1280.png)、[管理390px](../design/verification/auth-routing/operator-390.png)、[管理1280px](../design/verification/auth-routing/operator-1280.png)。

## 配備・切り戻し

DB migration・新しい環境変数・依存パッケージの追加はない。認証済みCookieの形式も変更しない。問題があれば、このPRのページ・Server Action・Auth.jsの遷移設定をまとめて戻す。Google設定のオリジン変更を別途行った場合は、その環境のURLと登録callbackを一緒に戻す。本番の販売停止設定は維持する。
