# ESLint 10への移行と既存ルールの維持

2026-09-18 JST、#142。main基準 `aa84ba7`、Dependabot PR #205のESLint 10.10.0更新コミット `aab7324` を引き継ぐ。

## 問題と変更

PR #205は依存解決後のLintで `react/display-name` のロードに失敗した。原因は `eslint-plugin-react@7.37.5` がESLint 10で削除された `context.getFilename()` を使用すること。同じcommitとNode.js 24.21.0/pnpm 10.23.0でローカルの失敗も再現した。

ESLint公式の `@eslint/compat@2.1.1` を開発依存へ追加し、既存の `nextVitals` と `nextTypescript` に `fixupConfigRules()` を適用する。ルール・重大度・対象範囲・global ignoresの指定は維持する。互換機能の独自実装、node_modulesの書き換え、ルール停止、Lintスキップは行わない。ESLint本体はPR #205の `^10.10.0`、現解決10.10.0を採用する。

## 依存の確認

| 観点 | 確認した内容 |
| --- | --- |
| 取得元・版 | npm `@eslint/compat@2.1.1`、ESLint公式 `eslint/rewrite` リポジトリ |
| 公開日時 | registryのtimeより2026-09-03 18:09:58.686 UTC。7日の待機期間を経過済み |
| ライセンス | Apache-2.0 |
| 対応環境 | Node `^20.19.0 / ^22.13.0 / >=24`、peer ESLint `^8.40 / 9 / 10`。このプロジェクトはNode 24で検証。Node 23は使わない |
| 実行範囲 | 開発時のLintのみ。顧客アプリのruntime/ブラウザーバンドルへimportしない |
| 追加依存 | `@eslint/core ^1.2.1`。今回のlockfileでは既に採用済みの1.2.1を利用 |
| 代替案 | 現行ESLint 9維持は可能。ただし次期移行を進めるため、既存Nextのルールを保つ公式adapterを選定。別のLint製品への全面変更は不要 |

一次資料：[ESLint 10移行ガイド](https://eslint.org/docs/latest/use/migrate-to-10.0.0)、[公式互換パッケージ](https://github.com/eslint/rewrite/tree/main/packages/compat)、[配布メタデータ](https://registry.npmjs.org/@eslint%2fcompat)。ローカルのNext.js 16.3.4のESLintガイドも確認した。

## 検証と残る制約

- 修正前：ESLint 10.10.0で `pnpm lint` が `contextOrFilename.getFilename is not a function` により終了コード2。PR #205のCIと一致。
- 修正後：`pnpm check:ci` 成功。通常1,438件・型・全体Lint・静的検査・build。DB/外部接続用283件はローカルではスキップ。
- 全依存（開発依存を含む）の監査で既知の脆弱性なし。frozen-lockfile install成功。
- 別の使い捨てコピーで10,080分の公開後待機条件を付けた `pnpm update @eslint/compat@2.1.1 --lockfile-only --no-save -r --config.minimumReleaseAge=10080` 成功。新しいrelease-age例外は追加していない。試験コピーの更新は含めない。
- 実設定を使う7テストで正常なTSXが通り、React表示名・Hooks条件付き呼出・alt欠落・Next画像・TypeScript any・匿名default exportが診断されることを確認。単なるルール設定値の比較ではなく、実際に誤ったコードを検出する。
- production依存の解決結果はmainと同一。pnpm 10.23.0でlockfileを生成し、手編集していない。
- 一部上流プラグイン（React 7.37.5、jsx-a11y 6.10.2、import 2.32.0）のpeer範囲にESLint 10が未記載のため、インストール時の警告は残る。警告を隠す設定やpeer範囲の偽装は行わない。公式adapterによる互換動作と、このプロジェクトで検証できた範囲を根拠にする。全ルール・全入力での互換性を証明したわけではない。
- TypeScript majorのAST API移行、Node型の更新、実機のエディター拡張は別途検証が必要。#142全体を完了として閉じない。

## main統合後のlockfile修復（2026-09-18）

PR #204取り込み後のmain `030b3ff` をPR #207へ統合した `e455490` では、manifestのReact型指定が旧版へ戻り、lockfile内のStripe解決情報も22.6.1のまま残った。固定インストールで指定不一致を再現し、型指定の修正後にはStripe 22.6.2のsnapshot欠落を再現した。

`@types/react` / `@types/react-dom` をmainと同じ `^19.3.0` に戻し、pnpm 10.23.0の `install --lockfile-only --fix-lockfile` でlockfileを再生成した。Stripe 22.6.2とESLint 10/compatを維持する。再生成にはpeer参照とプラットフォームmetadataの正規化も含む。新たな依存版の選定やCIの固定検査の解除は行わない。修復後の `pnpm install --frozen-lockfile` と全依存監査が成功。全体試験・build・CI結果はPR #207に記録する。

## 撤去・切り戻し

担当は `bright-broom`、追跡は #142。次回の `eslint-config-next` または内包プラグイン更新時にnative ESLint 10対応とpeer宣言を確認する。対応版が揃ったらadapterを外し、7つの検出試験・全体Lint・型・テスト・buildを通した専用PRで開発依存も削除する。

障害時は移行PR全体をrevertし、ESLint 9.39.5と以前のlockfile/設定へ戻す。依存パッケージだけを下げて不一致な設定を残さない。DB・販売停止条件・稼働アプリの設定に変更はない。
