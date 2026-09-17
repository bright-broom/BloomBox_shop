# 公開準備の実確認（2026-09-18 JST）

基準mainは`fae73df5200b400a5c68d58cb8d8f4edfe0ed6c9`。PR #211/#212/#213はすべてMERGED、同SHAのmain CI成功を確認。リポジトリは48件の未完Issueを維持し、外部設定待ちをコードの未実装と混同しない。

## 実際に確認したこと

- 公開origin `https://bloom-box-shop-ybb9.vercel.app` のhealthは旧SHA `259356edf51def7030729822df32e07ff82a3b54`。main反映とは別である。
- 隔離作業ディレクトリを既存Vercel project `bloom-box-shop-ybb9`にリンクし、project ID `prj_uguMJ5XHO9Vx6qvij8mELEKAtHyp`を照合。元作業ディレクトリの別project設定を使っていない。
- Productionの設定を必要な範囲だけ読取確認：runtimeは`preview`、新規受付は`false`、顧客認証・運営者認証は`true`。設定値の変更・公開配備は行っていない。
- 同環境の項目名一覧にStripe関連項目はない。別環境やアカウントの存在までは否定しない。
- DB接続先1件をメモリ内で読み取り、秘密値を表示・保存せず照合に使用。URL・ユーザー名・パスワード・ホスト・DB名をこの記録へ転記しない。

## DB確認で判明した障害

接続URLには`sslmode`と`channel_binding`がある。従来のNode検査はqueryを拒否する。対応する標準psqlを使っても、接続プールはstartup optionsの`statement_timeout`を拒否した。タイムアウトを読取専用transaction内の`SET LOCAL`へ移し、証明書/ホスト名検証とchannel binding必須を保った接続で再確認した。

最終的に修正後の `db:status` は **`INSPECTION_FORBIDDEN`・終了1**。現在のアプリ用接続には`schema_migrations`のSELECT権限がないため、適用履歴は確認できていない。旧記録の0027を現在の実測値とせず、0028未適用とも断定しない。DBへのDDL・DML・権限変更・データ投入は行っていない。

## 実装・検証

- `DATABASE_STATUS_PSQL`で絶対パスの標準クライアントを明示可能にした。channel bindingのrequireを維持し、TLSはverify-fullを強制。未知/重複/保護を弱めるURLオプションを拒否。
- 既存Node方式とpsql方式の両方で、タイムアウトをtransaction内で設定。権限不足を固定エラーへ分類し、接続先や生エラーを出力しない。
- 隔離PostgreSQLでNode/psql、台帳なし、未適用、差異、読取専用ロール、権限取消を検証。通常16件＋実DB2件成功。型/Lint/構造/buildと通常1,497件成功。通常suiteの288件skipはDB等の別環境向けであり、今回の実DB試験は別途実施。
- 公開への正常配備、実Google経由の購入、実Stripe、監視 #33の復旧を証明したものではない。

## 次の一手

1. #121：配備担当が、対象DBのCONNECT・bloomboxスキーマUSAGE・schema_migrationsのSELECTだけを持つ承認済み確認用接続先を用意する。アプリ用ロールを広げたり所有者権限で代用しない。
2. 同じ対象SHAで事前検査を実施し、履歴に基づいて必要なmigration・専用roleの適用計画を確定する。`db:migrate`を確認目的で実行しない。
3. #122/#131：販売停止を保つ配備と戻し方を確定し、対象SHAで公開後のhealth・CSP・顧客/運営者経路を確認する。#33は実復旧まで保持する。
4. #120：専用Stripeテスト設定と実購入E2Eをそろえる。live課金や販売有効化は別の承認・証跡を要する。

設定・業務判断待ちを完了として閉じる根拠は今回もない。Issue本文では#211〜#213の「未マージ」を履歴として整理し、この実測と必要権限を最新状態として追加する。

API仕様は[Vercelの個別環境変数読取](https://vercel.com/docs/rest-api/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id)、TLS/信頼ストアは[PostgreSQLの接続仕様](https://www.postgresql.org/docs/16/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT)を確認した。APIの利用権限と配備承認は同じ意味ではない。
