# 担当者の Google ログイン

2026-09-12。`/operations` に Google ログインとログアウトを実装しました。未設定時はログインを無効にし、実注文の参照を拒否します。[ADR 0006](../architecture/adr/0006-google-operator-login.md) の構成です。実 Google の接続情報・担当者権限はまだ登録していません。

## 接続設定

1. Google Cloud で OAuth 同意画面と「ウェブアプリケーション」の OAuth クライアントを準備します。必要なスコープは `openid email` です。一般 Gmail を使う場合は外部向けのアプリ設定が必要で、テスト公開中は対象アカウントをテストユーザーに登録します。[Google の設定手順](https://developers.google.com/identity/openid-connect/openid-connect#settingup) を確認してください。
2. 環境ごとの正規オリジンを決め、承認済みリダイレクト URI に **`AUTH_URL` のオリジン + `/api/operator-auth/callback/google`** を登録します。ローカルなら `http://localhost:3000/api/operator-auth/callback/google`。本番は HTTPS とし、ローカル用クライアント・秘密情報を分けます。アプリ配下のパスを AUTH_URL に含めません。
3. 下表の値をサーバーの秘密管理に保存します。ユーザー指定のメールアドレス、実 subject、接続文字列や秘密情報を公開 Git・PR・チャットへ書き込まないでください。既存の環境ファイルを上書きせず、必要なキーだけ追加します。
4. 最初は `AUTH_OPERATOR_BINDINGS=[]` としてログインを確認します。許可アカウントで本人がログインした際の「担当者登録用の情報」に Google subject が表示されます。サーバーの検証を経たこの値を、内部担当者 UUID と明示的に対応付けます。未登録の状態では DB に接続しません。
5. [承認権限の運用](SHOPIFY_FULFILLMENT_APPROVAL.md) に従い、DB 管理者が店舗別権限を別途設定します。既存の NOLOGIN ロール `bloombox_fulfillment_approver` を専用ログイン接続へ限定付与し、`DATABASE_OPERATOR_URL` に指定します。一般アプリ・worker・DB 所有者の接続を使わず、この資格情報で実際の権限制限を確認します。DB 権限の変更は現在 SYSTEM 監査であり、人ごとの権限管理画面は今後の実装対象です。
6. ログイン後の「注文一覧」から `/operations/fulfillments` を開き、権限のある店舗ドメインを指定して対象注文を選びます（[一覧の仕様](OPERATOR_FULFILLMENT_INBOX.md)）。内部発送 UUID が分かる場合は従来どおり、`/operations/fulfillments/<shop.myshopify.com>/<fulfillment UUID>` を開きます。Google subject の一致に加えて店舗権限・期限・test/live 区分を確認します。非認証・非認可・他店舗・存在しない対象はいずれも Not Found 画面になり、存在有無を区別しません。Next.js のストリーミング開始後は HTTP 200 の場合もあるため、HTTP ステータスだけで認可成功を判断しません。承認・発送ボタンはまだ追加していません。

| 環境変数 | 内容 |
| --- | --- |
| `AUTH_OPERATOR_ENABLED` | 既定は無効。有効化する環境のみ `true` |
| `AUTH_URL` | HTTPS の正規オリジン。ローカルの localhost/127.0.0.1 のみ HTTP 可 |
| `AUTH_SECRET` | 暗号学的に安全な乱数から生成した 32 文字以上の秘密値 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 環境専用の Google OAuth クライアント ID / シークレット |
| `AUTH_OPERATOR_EMAILS` | ログインを許可する確認済みメールのカンマ区切りリスト（最大20件） |
| `AUTH_OPERATOR_BINDINGS` | `[{"subject":"<verified Google sub>","operatorId":"<internal UUID>"}]`。両識別子を一意にする。既定 `[]` |
| `OPERATOR_SHOPIFY_MODE` | `test`（既定）または `live`。表示対象の決済区分で、発送を有効にする設定ではない |
| `DATABASE_OPERATOR_URL` | 専用の PostgreSQL 接続。未設定時に他の接続へフォールバックしない |
| `DATABASE_SSL_MODE` / `DATABASE_MAX_CONNECTIONS` | 既存 DB 設定と共通。既定 verify-full / 5 |

`NEXTAUTH_URL` と `AUTH_REDIRECT_PROXY_URL` は設定禁止です。正規オリジンの検証を迂回する自動上書きを拒否します。認証設定の変更を実プロセスへ反映するには、ホスティングの秘密管理更新と再起動／再デプロイが必要です。

## 保護と失効

Auth.js の OIDC 検証（PKCE、state、nonce、issuer、audience、有効期限）に加え、jose で Google 固定公開鍵エンドポイントによる RS256 署名を検証します。プロバイダー通信は Google の限定ホスト、5秒の期限、256KiB の受信上限、リダイレクト禁止を適用します。認証 POST は同一オリジンと CSRF、または Next.js Server Action の検証を通し、本文を8KiBに制限します。Server Action は Next.js 自身の本文制限を使用します。

セッションは暗号化した HttpOnly / SameSite=Lax / host-only Cookie で、HTTPS では Secure と `__Host-` を使います。ログインから15分の絶対期限を持ち、閲覧で期限を延長しません。Google access/refresh token、氏名、画像を保存せず、ブラウザーに返すセッションは subject と期限だけです。エラーの生ログやプロフィールは出力しません。管理画面・認証応答は private/no-store、no-referrer、検索除外です。

許可メールの削除は次の要求でログイン状態を無効化し、subject 対応付けの削除は次の参照で担当者権限を失わせます。DB の店舗権限失効も各参照で再確認します。秘密値の更新は全 Cookie を無効にします。ログアウトは現在のブラウザー Cookie を削除しますが、盗まれた Cookie の個別失効にはサーバー側セッション台帳が未実装です。緊急時は許可リスト・対応付け・DB 権限の削除、または秘密値の更新を使います。Google 側のアカウント変更通知も未接続のため、本番利用前にこの制約を評価します。

## 検証と残件

実ライブラリを通した合成 Google OIDC 応答で、署名付きログイン、CSRF、PKCE/state/nonce、署名改ざん、別 audience、期限切れ、不許可メール、暗号 Cookie 改ざん、絶対期限、許可取り消し、ログアウトを検証します。認証未設定／未登録の DB 接続拒否、Google 通信の上限、専用 DB 接続の必須化も回帰テストに含めます。

NextAuth 5.0.0-beta.32 を固定採用しています。依存監査と合成プロバイダーテストは、実 Google の同意画面・本番コールバックを通した成功証跡の代用にはなりません。実接続、デプロイ先での Cookie/Origin、専用ロール設定、実店舗権限の失効を確認してから公開運用してください。[承認フォーム](OPERATOR_APPROVAL_FORM.md)は実装済みですが、事業条件 PENDING により操作は無効です。事業条件、操作頻度制限、Inbox 完了、本番 Gate、発送実行は引き続き別の確認・実装が必要です。

戻す場合は `AUTH_OPERATOR_ENABLED=false` を反映して入口を閉じ、対応付け削除または秘密値更新で既存セッションを無効化します。注文・承認・監査履歴の削除や DB の後退移行は不要です。

## 今回の検証記録

- `pnpm check:ci`：通常623件、静的チェック・型・Lint・本番ビルドが成功。
- 専用の隔離 PostgreSQL：既存14移行を含む86件が成功。DB の移行追加はありません。
- `pnpm audit --prod --audit-level high`：既知の脆弱性なし。新規依存は7日の公開待機期間を適用して解決しました。
- Chrome の本番ビルド（別ポート）で320/1440pxの横はみ出し・実行エラーなし。未接続画面、非認証の Not Found、認証 API の503、private/no-store・no-referrer・noindex を確認しました。開発サーバーは Next.js により Cache-Control が no-cache に上書きされるため、本番ビルドで検証しています。
- 画像：[モバイル](evidence/operator-login-mobile.png)／[デスクトップ](evidence/operator-login-desktop.png)。いずれも接続情報未設定の画面で、実アカウント情報を含みません。
