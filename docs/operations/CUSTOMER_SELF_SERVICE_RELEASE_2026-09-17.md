# マイページの公開反映記録

2026-09-17（JST）。ユーザーの「全部最新にして」に基づき、既存の公開プレビューを更新した。コードの最新化と実販売開始を区別する。

## 公開先とバージョン

- URL: https://bloom-box-shop-ybb9.vercel.app
- Project: `bloom-box-shop-ybb9` / `prj_uguMJ5XHO9Vx6qvij8mELEKAtHyp`
- Code SHA: `259356edf51def7030729822df32e07ff82a3b54`（PR #175 のmain）。main CI・Semgrep成功を確認。
- Deployment: `dpl_FUGUCxxTjkX5cDPaNq2eVW4LWFSE`
- Immutable URL: https://bloom-box-shop-ybb9-8n4pefmq7-koenigwolfs-projects.vercel.app
- Previous deployment: `dpl_Dak5zsEpDtgToShk8CExegogXFM8` / `https://bloom-box-shop-ybb9-cc8bguan4-koenigwolfs-projects.vercel.app`
- Vercel targetはproduction、アプリはpreview。checkout intake=false、広告送信=falseを維持。

`--skip-domain`で候補を作り、Readyと新画面を確認後にpromote。切り替え後の公開 `/api/health` で `status=ok` と上記SHAの一致を確認した。immutable候補のhealthは未認証アクセスがVercel認証へ転送され、ブラウザーのJSON直表示もブロックされたため、候補のhealth成功とは記録しない。保護を解除せず、候補のUIと最終公開healthで検証した。

初期候補 `dpl_5NZJVCkcFeuTzn1mjjA3QxehKXo5` は管理者紐付けを含まないため、公開URLへpromoteしていない。最終候補は上記のとおり。

## DBと秘密値

既存Neon `bloombox-customer-account` の同一DBを使用。事前にPostgreSQL 18のpg_dumpでbloombox schemaをcustom形式へ保存し、pg_restoreの一覧でアーカイブ346項目を検証した。保存先は作業端末の非公開 `~/.codex/secure-backups/bloombox/release-20260917/`。バックアップはAES-256-GCMで暗号化、フォルダー0700・ファイル0600。keyringと復旧手順を同じ非公開保管先に保持する。Git・PRへ含めない。別DBへの復元演習は今回未実施。

- 既存0001〜0025のチェックサムを検証し、0026（広告用テーブル）と0027（顧客セルフサービス）を前進適用。広告処理自体は有効化していない。
- `customer_portals`、`customer_requests`、`customer_request_changes` の追加GRANTを適用。顧客用loginは既存の `bloombox_application` 継承を維持。
- `BLOOMBOX_PII_KEYRING` をproduction限定のSecretで新規設定。元は未設定。鍵を追加・更新するときは既存の復号鍵を必ず保持する。
- `bloombox_customer_support` のみを継承する専用loginを作成し、`DATABASE_CUSTOMER_SUPPORT_URL` をproduction限定のSecretへ設定。superuser/CREATEDB/CREATEROLE/BYPASSRLSは付与しない。
- アプリ用実接続で設定CRUDと問い合わせINSERTを一つのトランザクション内で試し、全件rollbackを確認。架空顧客を残していない。サポート接続から住所帳・Google識別テーブルのSELECTが拒否されることを確認。
- owner資格情報はmigrationだけに使い、Vercel runtimeには設定していない。接続文字列、Google subject、operator UUID、秘密値、実顧客情報は本記録へ掲載しない。

## 管理者の接続

ユーザーが指定済みの管理者1名について、公開Google認証で本人確認を行い、画面に表示された検証済みsubjectを内部operatorへ紐付けた。メールの文字列だけで紐付けていない。既存の許可メール一覧・OAuth client・secretを変更していない。

以前の設定スクリプトが設定した空の `AUTH_OPERATOR_BINDINGS` と、公開画面の未登録状態を確認し、本人確認済みの1件へ更新。Vercel Secretは保存後に読めないため、今後の追加時に他の紐付けを消さないよう、現行リストを非公開の復旧保管先へ残した。

顧客サポート権限は2026-12-15 17:08:32 UTCまで。実行者の権限期限を運用担当が確認し、必要時に見直す。付与操作を監査へ記録。更新後は旧セッションを継続利用せず、再ログインして担当者として入場することを確認した。

別の指定管理者は、実Google本人確認と個別紐付けが未完。商品・在庫の専用管理接続、発送登録接続など他業務の権限を自動付与していない。

## 公開URLでの確認

| 確認 | 結果 |
| --- | --- |
| health / ホーム / 商品一覧 / 商品M | 正常、healthのSHAが最新mainと一致 |
| 顧客の実Googleログイン | 本人の履歴・ランク・プロフィールを表示 |
| プロフィール / 住所帳 / お気に入り / 設定 / 問い合わせ | 本人セッションで各画面が読み込めることを確認 |
| お気に入りの実保存 | 登録→ページ再読込→表示→解除を確認。確認前と同じ空の一覧へ戻した |
| 未認証export | 401。本人データを返さない |
| 非公開ページのキャッシュ | private/no-store |
| 管理者の実Google再ログイン | 登録済み担当者として概要に入り、DB上の注文0件を表示 |
| 管理者の問い合わせ一覧 | 空の問い合わせ・削除依頼を正常に読み込み、エラーやダミー件数に置換しない |
| 見本ページ | 最新UIを表示し、保存・送信は無効 |

実顧客の氏名・電話・住所、配信希望、注文、問い合わせ本文は変更していない。実顧客の退会・全端末失効は試していない。公開保存の検証はお気に入りの追加・解除のみで、隔離DBでの既存1,435件のテストと区別する。全端末・全管理者・実機Safari・実決済・返金・配送・メール送達の完了証拠ではない。

## 復旧と残件

コードの不具合は前のimmutable deploymentへpromoteして戻す。顧客設定・問い合わせ・監査・schema_migrationsを消さない。暗号鍵を消さず、保持したkeyringを使用する。権限を緊急停止する場合は対象support grantをdisabledにし、必要に応じて担当者sessionVersionを上げる。全体の暗号鍵やGoogle clientを根拠なく取り替えない。

実販売開始、全管理者の紐付け、商品管理・発送の専用接続、実メール、正式な領収書、Google OAuthの一般公開条件は残件。今回の公開更新でこれらを完了扱いにしない。自動デプロイは既存どおり無効。
