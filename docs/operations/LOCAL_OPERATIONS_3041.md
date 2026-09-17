# 3041番の管理画面・業務DB接続

2026-09-17（JST）。[Google認証の復旧](LOCAL_GOOGLE_3041.md)に続き、ローカルの管理画面を既存の隔離顧客DBへ接続した。対象コードはmain `7629ccd`。アプリコードや新規migrationは不要で、欠けていた環境設定と専用DB権限を既存実装へ接続する変更。

## 完了した範囲

- `/operations`：ダッシュボード・最近の注文・日別集計。
- `/operations/orders`：注文閲覧の既存サービスへ専用接続を提供。
- `/operations/customers`：顧客一覧と購入者ごとの履歴。
- `/operations/reports`：期間別集計。
- `/operations/requests`：問い合わせ・退会削除依頼の一覧。

このDBの注文2件は以前から存在する接続確認用データ。今回、顧客・注文・問い合わせを作成していない。集計14,000円は確認用注文の合計であり、実売上ではない。

## 接続・権限

起動元は `/Users/toshikisakuta/dev/BloomBox`、URLは `http://localhost:3041`。既存の隔離PostgreSQL（127.0.0.1:55448）の `bloombox_customer_local` を使用。更新前に非公開のcustom形式DBバックアップと環境設定バックアップを取得した。

- 専用login `bloombox_local_support` を作成。継承先は `bloombox_customer_support` だけ。
- superuser / CREATEDB / CREATEROLE / REPLICATION / BYPASSRLSを付与しない。
- `database/roles.sql` の顧客サポート用11件のGRANTだけを適用。顧客用・worker・商品・発送のロールは継承させない。
- `DATABASE_CUSTOMER_SUPPORT_URL` をGit対象外の `.env.local` に設定。DBオーナー資格情報をruntimeへ設定しない。
- 以前に実Googleで本人確認・内部operator紐付け済みの管理者1名に、期限付き顧客サポート権限を設定。メールの一致による権限付与や他の担当者の自動登録はしていない。
- 有効期限：**2026-09-24 21:35:28 JST**（12:35:28 UTC）。期限切れ後は閲覧を拒否する。継続利用時は担当者と期限を確認して、既存のDB管理手順に従って更新・監査する。
- 権限付与は `audit_logs`、閲覧は `customer_support_accesses` に記録。

非公開接続情報は既存の `/private/tmp/bloombox-customer-local/connection.json` の `support` に保持。ファイル0600。秘密値・Google subject・operator UUIDをこの文書へ記載しない。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| Chromeの実Google管理者ログイン | ダッシュボードへ戻り、2件・14,000円・発送前2件を表示 |
| 注文一覧・完全一致検索 | 2件の一覧から既存の注文番号で1件へ絞り込み |
| 顧客一覧→購入履歴 | 既存2顧客、対象顧客の注文と独立した支払・発送状態を表示 |
| レポート | 30日集計がDBの確認用注文と一致 |
| 問い合わせ・退会削除依頼 | 取得失敗ではなく正常な空一覧を表示 |
| 実接続のDB権限 | Google識別情報・住所帳のSELECT、注文UPDATE、権限の自己付与、監査DELETEを全て拒否 |
| runtimeのロール | supportだけを継承、昇格権限なし |
| 実画面の参照監査 | DIRECTORY/HISTORYの記録をDBで確認 |
| データ保持 | 顧客2件・注文2件・合計14,000円を維持 |
| 専用テストDB | 顧客管理・運営集計12テスト成功。期限切れ・取消・監査失敗時の拒否、集計・ページ送り等を検証 |
| 通常テスト | 関連3ファイル20テスト成功 |
| health | 200、releaseが対象コードSHAと一致 |

DBテストの破棄・再作成対象は専用の `test_local_support_20260917`。実Google接続用のDBへテストスイートやseedを実行していない。アプリコードの変更がないため、直前の同一コード・Node.js 24のbuild成功結果を使用し、runtime設定変更後の再起動と実ブラウザー疎通を検証した。

## 再開・停止

起動手順は [3041番の再開手順](LOCAL_GOOGLE_3041.md)。DBと `.env.local` の専用接続を維持し、固定ポート3041で起動する。別作業ツリーへコードだけコピーしても秘密値は移らない。

停止時は、DB管理者が対象operatorの `customer_support_operators.enabled` をfalseにする。監査へ変更理由を残し、進行中トランザクションの完了を待つ。アプリロール自身にはこの更新を許可しない。接続自体を停止する場合は環境変数を外してサーバーを再起動する。ロール・顧客・注文・閲覧監査の削除は不要。

## 残る範囲

商品・在庫、発送、返金、メール送信、実決済の接続・操作は今回の検証対象外。問い合わせ本文の閲覧・返信は合成データを使う別のテストが必要であり、空一覧の疎通成功だけで完了扱いにしない。Vercelの設定・デプロイ、Google対象ユーザー・公開範囲、販売停止設定は変更していない。
