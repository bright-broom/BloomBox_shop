# ADR 0022: main の自動配備と、追加だけの DB 変更の自動適用

- 状態：**採用（2026-09-26）。** ユーザーの「DBの自動適用とmainの自動配備を用意して」という依頼による。実際に動かすには、リポジトリ変数 `AUTO_DEPLOY_ENABLED=true` と、`production` Environment の秘密値（`PRODUCTION_DEPLOY_HOOK_URL`・`DATABASE_MIGRATION_URL`）の設定が必要（既定は無効）。
- 範囲：公開先 Vercel project `bloom-box`（2026-09-26に `bloom-box-shop-ybb9` から改名、ID不変）への配備と、公開用 DB への migration 適用。販売の開始（ADR 0020）は扱わない。
- 関連
  - [RELEASE.md](../../operations/RELEASE.md)：手動の配備・リリース手順
  - [ADR 0020](0020-governed-checkout-activation.md)：新規購入の受付はコードと承認で別に止める
  - [DATABASE_PREFLIGHT.md](../../operations/DATABASE_PREFLIGHT.md)：適用履歴の読み取り確認

## 背景

2026-09-17 に `vercel.json` の `git.deploymentEnabled: false` で自動配備を止めた。push・PR のたびに配備が走って 1 日の上限を使い切っていたことと、マージを公開の承認とみなさないためである。その結果、公開サイトは 9 月 17 日の版のまま止まり、main の変更（トップ・全ページ・運営画面の刷新、通知と発送の警報など）が反映されなくなった。一方で、main は migration 0028〜0030 を前提にしており、DB を先に更新しないまま新しい版を出すと画面が壊れる。

## 決定

- **配備の起点**：main への push で CI が成功したときだけ、GitHub Actions の `Auto Deploy` が動く。Vercel 側の Git 自動配備は止めたまま（`vercel.json` は変更しない）。これで main の 1 版につき配備は 1 回になり、PR では配備しない。
- **順序**：DB migration の適用 → Deploy Hook による配備 → `/api/health` の版が CI で検証した SHA と一致するまで待つ（最大 10 分）。途中で失敗したら障害 Issue（`[Production] Automatic deployment failed`）を開き、次の成功で閉じる。
- **追加だけの変更に限る**：新しいコードが公開される前に migration を適用するので、その間も古い版が動いている。古い版を壊しうる文（テーブル・列などの DROP、RENAME、列の型変更、SET NOT NULL、TRUNCATE、DELETE、既存オブジェクトの REVOKE）を含む未適用の migration が 1 つでもあれば、**何も適用せずに止まる**（`MIGRATION_EXPAND_ONLY=true`）。同じ migration で作るテーブル・関数から PUBLIC 権限を外す定型文は例外とする。止まった変更は、従来どおり手動の `Production Release` で段階的に扱う（例：まず列を追加して新旧両対応の版を出し、後の migration で古い列を消す）。
- **古い版の取り扱い**：CI 完了時点で main がさらに進んでいたら、その版は配備せずに終了する。Deploy Hook は常に main の最新を作るため、最新版の実行に任せる。
- **直列化**：手動リリースと同じ concurrency グループ（`production-release`）を使い、両者が重ならないようにする。
- **販売とは切り離す**：自動配備は本番の新規購入を開かない。受付は ADR 0020 のとおり、受付スイッチ・承認済みの証跡・承認済みの案内がそろうまでコードで拒否される。`pnpm check:release`（販売開始の判定）は自動配備では実行しない。

## 検討した代替案

- **`vercel.json` で main だけ自動配備に戻す**：Vercel のビルド中に migration を走らせる必要があり、DB 所有者の秘密値をビルド環境（プレビューを含む）へ渡すことになる。DB と配備の順序も保証しにくい。
- **Vercel の Ignored Build Step**：取り消したビルドも配備回数に数えられるため、上限の問題が戻る。
- **手動のまま**：安全だが、公開サイトが古い版のまま止まる状況が繰り返される。

## 影響と切り戻し

- 自動で止める条件：CI の失敗、追加だけでない migration、Deploy Hook・DB の設定不足、10 分以内に新しい版にならないこと。いずれも障害 Issue になり、公開中の版は変わらないか、Vercel の直前の配備に戻せる。
- 無効化：リポジトリ変数 `AUTO_DEPLOY_ENABLED` を `true` 以外にする（コード変更不要）。
- この ADR のコミットを revert すれば、手動配備だけの運用に戻る。適用済みの migration は forward-only のため戻さない（追加だけなので古い版でも動く）。
