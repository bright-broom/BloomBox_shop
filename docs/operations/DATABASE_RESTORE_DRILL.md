# ローカルDBのバックアップ・復元演習

Issue #130。バックアップファイルの作成成功だけでは、復元可能とは判定しません。本コマンドは既存ローカルDBの `bloombox` schemaを読み取り、新規の隔離DBへ復元して全テーブルの内容を照合します。本番への切替や既存DBの上書きを行うツールではありません。

## 保護する境界

- 接続先はloopbackのみ。管理接続のDB名は `postgres` に固定し、URLのquery/hashを拒否します。環境の `PGSERVICE`、`PGOPTIONS`、`PGHOSTADDR` 等は子プロセスへ引き継ぎません。
- 元DBのトランザクションは `REPEATABLE READ READ ONLY`。`pg_export_snapshot()` の同じsnapshotを比較元と `pg_dump` が共有するため、演習中に別接続が更新しても時点がずれません。
- 復元先は毎回 `test_bloombox_restore_…` を新規作成します。既存DBを指定するオプション、`DROP`、`--clean`、失敗時の自動削除はありません。一般ロールのCONNECT/TEMP権限を外します。
- `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges` で復元します。復元先ではアプリ・Worker・通知・外部決済を起動しません。
- PostgreSQLが生成する全行のJSON表現（暗号化バイト列も含む）を一定順序でSHA-256へ流し込み、テーブル名・件数・内容を比較します。migration履歴も対象です。件数一致だけで成功とはしません。
- subprocessのstderr、接続文字列、SQL行、暗号文、テーブルごとのdigestを結果へ出しません。保存するreportは結果・件数・対象の生成DB名・時刻・対象外の検証範囲のみです。
- schemaは200テーブル、1テーブル100,000行まで。DB接続は5秒、各SQL/外部コマンドは180秒で打ち切ります。ローカルの小規模演習用であり、大規模DBの所要時間保証ではありません。

## 実行前の準備

Node.js 24、依存関係のインストール、対象サーバーと互換性のある信頼済み `pg_dump` / `pg_restore` が必要です。新規パッケージは追加していません。元DBにはschema全体をバックアップできる接続、隔離先クラスタにはDB作成権限のある管理接続を使います。資格情報をチャット・Issue・共有ログへ貼らず、現在の非公開保管先から環境へ渡してください。

| 環境変数 | 用途 |
| --- | --- |
| `RESTORE_DRILL_SOURCE_URL` | 元のローカルPostgreSQL URL |
| `RESTORE_DRILL_ADMIN_URL` | 隔離先クラスタの `/postgres` への管理URL |
| `RESTORE_DRILL_OUTPUT_DIRECTORY` | リポジトリ外の非公開出力ディレクトリ |
| `RESTORE_DRILL_PG_DUMP` | pg_dumpの絶対パス |
| `RESTORE_DRILL_PG_RESTORE` | pg_restoreの絶対パス |

同じローカルクラスタでも実行できます。新規DBだけに復元し、元DBは読み取り専用で保持します。資格情報や設定ファイルをWebアプリの公開環境へ転記しないでください。

```bash
node scripts/database-restore-drill.mjs
```

環境はシェルから明示的に渡します。CLIがNext.jsの `.env.local` を自動ロードすることはありません。終了コード0かつ `status=verified` の場合のみ検証成功です。失敗は終了コード1と機密情報を含まない理由コードを返します。

## 成果物と停止・復旧

指定先の `restore-…` フォルダーは0700、`database.dump` と `report.json` は0600です。**dumpは暗号化されていません。** ファイル権限で保護したローカル演習用のため、クラウド共有・Git・CI artifactへの公開は禁止します。本番の暗号化バックアップ・鍵の分離保管・保持期限の代替にはなりません。

成功/失敗とも生成したDB・ファイルを残し、調査前に証跡を消しません。失敗時はreportの理由を確認し、バイナリ版・権限・schemaを修正して新しい演習として再実行します。中断やディスク障害等でreportが残らない場合は成功とみなしません。再実行も元DBや以前の復元先を上書きしません。

後片付けはreportに記録された隔離DB名・対応する演習フォルダーを管理者が照合したうえで行います。元DB・通常アプリの資格情報・バックアップをまとめて削除するワイルドカード処理は用意していません。

## 2026-09-17の検証

- 新規の合成DBで、バックアップ→復元→全内容一致、外部キーの復元、PUBLICアクセスの無効化、秘密値の非出力、元DBの保持を確認。
- 比較元のsnapshot取得後に別接続から書き込み、更新前の一貫したsnapshotが復元されることを確認。
- 復元コマンドの失敗と、実際のCOPY中の制約エラーを注入。後者はschema作成も含めて全体がrollbackされ、元DBを保持して理由だけを返すことを確認。
- 設定不正・リモート接続・管理DB取り違え・URLによる接続上書き・同件数の内容不一致を含め、関連12テスト成功。
- 既存のGoogle検証用ローカルDBでも実行し、**59テーブル・88行が全内容一致**。確認時の所要時間は約0.5秒。小規模ローカルの観測値であり、本番RTOではない。
- 既存の顧客/注文を変更せず、復元先でWorker・決済・メールを起動していない。
- CIに、既存の使い捨てPostgreSQLサービスで行う合成復元テストを追加。実行結果は対象PRのChecksで確認する。

個人情報を含むarchive、実DB名、接続情報、復元時のrow内容は公開リポジトリへ保存していません。

## 本番復旧へ進む前の残件

本演習の合格は、Issue #130全体の完了や本番復旧可能性の証明ではありません。次は本番バックアップ/鍵の復元、roles/GRANT・各環境設定の再構築、RPO/RTO測定、切替/切戻し、遅延・重複イベントの再処理、Stripeと取引の照合、障害連絡/担当者確認が必要です。暗号化済み列のバイト一致は鍵による復号の確認とは区別します。

復元直後にWorkerを再開すると、外部サービスの最新状態と復元時点の状態の差から再送が発生し得ます。[Inbox復旧](COMMERCE_INBOX_RECOVERY.md)・[財務照合](FINANCE_RECONCILIATION.md)を併用し、対象アカウント・時点・冪等性を確認するまで外部処理を有効化しません。

参考仕様：[PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[GitHub Ubuntu runnerの搭載ツール](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)。CIの実行時にもサーバーとpg_dump/pg_restoreの互換性を確認する。
