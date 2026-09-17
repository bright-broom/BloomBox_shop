# 依存パッケージの公開後待機と一時例外の見直し

2026-09-18 JST、Issue #141。main基準 `c586175e6efa3834a7a6074aadc9d1e868e8c225`。

## 判断と実装

PR #18で採用した3版は全て公開後7日を超えたため、例外を削除する。一方、PR #187で採用済みの `lucide-react@1.46.0` が同じ待機制限で更新を止めることを今回の実行で確認した。この**厳密な1版だけ**を期限付き例外にする。パッケージ全体や将来版を除外せず、Dependabotの7日cooldownを維持する。package.json・lockfile・採用バージョンは変更しない。

## npm registryの確認

2026-09-17 19:28:36 UTC（2026-09-18 04:28:36 JST）に旧3版の `time[version]` を取得し、公開からの経過分数を10,080分と比較した。Lucideは追加調査の19:30:12 UTC時点。

| パッケージ | 公開日時 UTC | 経過分数（概数） | 判断 |
| --- | --- | ---: | --- |
| @types/node@24.13.4 | 2026-09-09 18:10:47.240 | 11,597.82 | 旧例外を削除 |
| next@16.3.4 | 2026-08-31 20:00:51.381 | 24,447.75 | 旧例外を削除 |
| eslint-config-next@16.3.4 | 2026-08-31 19:53:33.284 | 24,455.05 | 旧例外を削除 |
| lucide-react@1.46.0 | 2026-09-14 09:23:23.473 | 4,926.82 | 採用済み厳密版のみ例外 |

一次資料：[Node型](https://registry.npmjs.org/@types%2fnode)、[Next.js](https://registry.npmjs.org/next)、[ESLint設定](https://registry.npmjs.org/eslint-config-next)、[Lucide](https://registry.npmjs.org/lucide-react)、[pnpmの待機と厳密版例外](https://pnpm.io/10.x/settings#minimumreleaseageexclude)。採用履歴：[PR #18](https://github.com/bright-broom/BloomBox_shop/pull/18)、[PR #187](https://github.com/bright-broom/BloomBox_shop/pull/187)は取得時MERGED。

## 再現・検証

Node.js 24.21.0 / pnpm 10.23.0。別々の使い捨てディレクトリへ package.json / pnpm-lock.yaml / pnpm-workspace.yaml のみをコピーし、以下を実行した。秘密値・DB接続・顧客データは渡していない。

```bash
# production依存の再解決
pnpm update next@16.3.4 --lockfile-only --no-save -r --config.minimumReleaseAge=10080
# development依存の再解決（別コピーで実行）
pnpm update @types/node@24.13.4 --lockfile-only --no-save -r --config.minimumReleaseAge=10080
```

- 例外0件：両方とも `ERR_PNPM_NO_MATCHING_VERSION`。`lucide-react@1.46.0` の公開日時が待機期間内であることを出力。
- Lucideの厳密版1件のみ例外：両方成功。旧3件の例外は不要と確認。
- 元のlockfileによる `pnpm install --frozen-lockfile` 成功。これは再解決を省略するため、上記試験の代用にしていない。
- production依存監査：既知の脆弱性なし。
- `pnpm check:ci` 成功：静的検査・型・Lint・通常テスト1,431件・build。DB/外部接続用283件はスキップ。本変更でDB・外部接続の成功を主張しない。
- GitHub Dependabotの実ジョブ再実行は未実施。上記は同じ待機時間を指定したローカルの再解決試験。
- 試験用コピーのlockfile変更はPRへ含めない。

## 残る1件の解除と切り戻し

担当は `bright-broom`、追跡は #141。**2026-09-21 18:23:23.473 JST以降**にregistry日時と現在の採用版を再取得し、残る厳密版例外を外して同じ2試験を行う。成功後に設定・本台帳・Issueを更新する。日付到来だけで成功としない。

リスクは依存更新の解決失敗。失敗時は本変更をrevertして直前の設定へ戻し、失敗した版・公開日時・必要最小限の例外を再確認する。package.json、lockfile、DB、認証、販売停止条件、配備先は変更しない。待機制限の全解除や全版除外で回避しない。
