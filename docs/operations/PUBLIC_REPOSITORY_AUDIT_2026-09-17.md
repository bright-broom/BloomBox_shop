# 公開リポジトリの Actions・情報管理監査

確認日：2026-09-17（JST）。対象：`bright-broom/BloomBox_shop`、コード基準 main `a4ba714` と本変更のワークフロー。#114 / P0-03 の証跡。設定は確認時点のスナップショットであり、次の公開判定では再確認する。

## 確認方法と境界

`.github/workflows/`、呼び出し先スクリプト、[SECURITY.md](../../SECURITY.md)、GitHub REST API のリポジトリ・Actions 設定・Artifact **メタデータだけ**を確認した。Secret 値、実顧客情報、Artifact 本体、既存ジョブのログ本文、秘密情報検知アラートの中身は取得していない。外部サービスを呼ぶ手動処理や決済は実行していない。

今回の結果は「全履歴に秘密情報がない」「本番接続を検証した」という証明ではない。公開前に残る判断は末尾に記載する。

## GitHub の確認結果

| 項目 | 確認時点の設定・証跡 |
| --- | --- |
| 公開範囲 / 既定ブランチ | public / main |
| Actions の既定トークン | `default_workflow_permissions: read` |
| Actions による PR 承認 | `can_approve_pull_request_reviews: false` |
| 外部 fork PR の承認 | `approval_policy: first_time_contributors`。全外部実行に承認を求める設定ではない |
| 使用できる Actions | `allowed_actions: all`、組織側 SHA 固定強制 `sha_pinning_required: false`。現リポジトリは全 action を SHA 固定し `check:repository` で検査 |
| Secret scanning | 本作業中に管理者操作で有効化。変更後の独立した GET でも `enabled` を確認 |
| Secret scanning push protection | 同じく変更後の GET で `enabled` を確認 |
| 追加の検出機能 | non-provider patterns / validity checks は `disabled`。検出範囲を拡張したとは扱わない |
| Dependabot security updates | `disabled`。既存の version updates 設定とは区別する。自動修正 PR の運用方針は別途判断 |
| Artifact 一覧 | `total_count: 0`。現在取得できる Artifact がないことのみ確認。過去の削除済み成果物やログの非漏えい証明ではない |

利用した API は `GET /repos/{owner}/{repo}`、`/actions/permissions`、`/actions/permissions/workflow`、`/actions/permissions/fork-pr-contributor-approval`、`/actions/artifacts`。Secret の一覧・値を記録しない。

Secret scanning と push protection の仕様・設定方法は [GitHub の Secret scanning 資料](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning)と[push protection 資料](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection)を参照。検出対象外の値や迂回を含むため、有効化だけをもって漏えいゼロとは判定しない。

## ワークフローの信頼境界

| ワークフロー | 入力と実行コード | 権限・外部接続 | 公開される情報 / 確認結果 |
| --- | --- | --- | --- |
| CI | pull_request / main push。PR コードを実行 | contents read、隔離 DB の試験用資格情報のみ。repository Secret 参照なし | テスト・型・静的検査・build の出力。試験には合成データを使用 |
| Semgrep CE | PR / main push / 定期。設定を含む PR コードを検査 | contents read、Secret 参照なし。固定 digest の scanner | 該当ソース・検査結果。成果物 upload なし |
| PR Governance | pull_request の本文をデータとして検査。checkout / eval なし | contents read / pull-requests read、Secret 参照なし | 不足した必須見出しを通知。PR 本文全体を出力しない |
| CI failure triage | workflow_run。既定ブランチの固定 github-script のみ。checkout・Artifact download・PR コード実行なし | issues write のみに縮小。repository Secret 参照なし | 対象 workflow 名、短縮 SHA、実行 URL の定型コメント。自分の Actions bot コメントだけ更新 |
| Production Smoke | schedule / dispatch / main CI 完了 | 公開 URL の GET と Incident の issues write。Secret 参照なし | HTTP 検査失敗、実行 URL の定型 Incident。自身の bot Issue のみ再開・終了 |
| Commerce Worker | schedule / **main dispatch のみ** | Worker Secret を Authorization header で使用。issues write | response は runner の一時ファイル。Incident には整数の要確認件数だけを取り込み、本文や顧客情報を展開しない。無効時は既存 Incident を終了しない |
| Commerce Inbox Requeue | main dispatch + 明示確認。入力は環境変数経由で検証 | Worker Secret。contents read | 実行入力の provider event ID / Incident 番号と API 結果は公開実行記録となる。個人情報を入力しない |
| Stripe Test Mode Readiness | **main dispatch のみ**。checkout token を永続化しない | stripe-test 環境の権限限定 Secret、contents read | 合成 M/L probe の額、照合用 ID、`cs_test_` ID、期限切れ結果をログ/Step Summary に記録。Checkout URL・鍵・住所・カード情報は出力しない。live mode を拒否。実支払い E2E ではない |
| Production Release | main dispatch + 確認、対象 main SHA 検証後に同じ SHA を配備 | verify は隔離 DB、deploy は production 環境の migration / hook Secret | 検査結果・migration・health の確認。環境保護と承認者は [GOVERNANCE.md](GOVERNANCE.md) の別管理事項 |

GitHub では fork PR に repository Secret が渡らず、通常のトークンも読み取り権限に制限される一方、`workflow_run` は前段より強い権限を持てる。[公式のイベント仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)に従い、後段で PR のコードや Artifact を取り込まない構成を維持する。`pull_request_target` はリポジトリ検査で禁止している。

main 条件は現ワークフローを別ブランチから誤って手動起動することを防ぐ。ワークフロー自体を変更できる協力者への完全な隔離ではないため、ブランチ・環境保護の代わりにはならない。Actions の承認も、未レビューコードへ Secret を渡す許可として扱わない。

## 今回の改善と検証

- 自動 Incident / コメントの更新対象を、マーカーに加えて `github-actions[bot]` の Bot 作成物に限定。ユーザーや別の bot の記録は操作しない。
- Commerce Worker と Stripe Test Mode Readiness の手動実行を main に限定。Stripe 検証用 checkout の資格情報永続化を停止。
- CI failure triage の不要な actions / contents 読み取り権限を削除。
- 実ワークフロー内の JavaScript を、通信しない GitHub API モックで実行して検証。異なる作成者・同じマーカー・PR・復旧・既存 bot 記録を扱い、誤更新と誤終了を防ぐ。併せて workflow_run の checkout / Artifact download / shell 実行を禁止する回帰検査を追加。

検証：`scripts/public-actions-security.test.mjs` 14 件成功。通常テスト 1,269 件成功（DB 接続等を要する 237 件は skip）。`pnpm check:static`（リポジトリ規則・アーキテクチャ・DB migration・design・hardcoding・型・lint）成功。追加の CI 結果は本変更の PR を参照。GitHub 上で本番ジョブを故意に失敗・復旧させる検証はしていない。

## 未確認・運営判断が必要な残件

1. **担当者・期限・保管先**：公開ログ、Step Summary、Artifact、Incident、provider event ID / test Session ID の保持と削除条件、閲覧・一次対応担当を指定する。実際の Actions retention 設定値は未確認。推測で既定値や日数を記入・変更しない。
2. **既存履歴の点検**：今回ログ本体や全 Git 履歴を走査していない。秘密情報検知の結果を担当者が非公開で確認し、疑いがあれば [SECURITY.md](../../SECURITY.md) に沿って対応する。公開 Issue に値や再現用 payload を転載しない。
3. **漏えい時の運用演習**：鍵の失効・再発行、該当ログの削除、履歴に残る参照、復旧後の確認を担当者付きで演習する。削除だけでは漏れた鍵は無効にならない。[GitHub の保護ガイド](https://docs.github.com/en/actions/reference/security/secure-use)を参照。
4. **外部実行・Actions の組織方針**：全外部 contributor 承認、許可 action 制限、組織 SHA 強制、追加検出機能、Dependabot security updates を採用するかは管理者が判断。現設定の事実と強化案を区別する。
5. **実運用での確認**：上記の保持・担当と環境保護を確定後、実際の障害・復旧時に通知先が対応し、必要な証跡を安全に保存できることを確認する。#114 を「すべての運用が完了」として閉じる根拠はまだそろっていない。

本変更はスキーマ・商用受付・顧客/管理者権限を変更しない。必要なら PR を revert し、手動実行を止めた状態で再修正する。秘密情報検知の外部設定はコードの revert で戻さない。
