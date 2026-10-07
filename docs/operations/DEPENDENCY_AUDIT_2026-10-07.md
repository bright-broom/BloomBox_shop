# 依存監査の復旧（2026-10-07）

main `ba27d3f` のCIで、Next.js → PostCSS → source-map-js 1.2.1のHigh検出を確認し、ローカルのproduction監査でも再現した。[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)は1.2.2を修正版としている。依存の存在は確認済みだが、公開アプリからの悪用可能性や侵害を実証したものではない。

`pnpm-workspace.yaml` で `source-map-js@<1.2.2` のみ1.2.2へ上書きし、pnpm 10.23.0でlockfileを再生成。直接依存・Next.js・PostCSSの版は変更しない。上流の全利用経路が修正版以上を要求するようになった時点で指定を削除し、再解決・監査・CIを検証する。監査の除外・閾値変更はしない。

同じpnpmによる再生成で既存Sharpパッケージのlibcメタデータが除かれるが、版とintegrityは維持する。macOSの固定インストール・buildに加え、Linux CIも確認する。生成ファイルの手修正はしない。

固定インストール、本番依存と全依存の監査を実行。公開への配備、販売有効化、DB変更は行っていない。#250の配備失敗や公開healthのrelease空欄は別途調査が必要。PR #254は開発依存更新のため本修正と分離する。

戻す場合はworkspace設定とlockfileを一緒にrevertする。ただし既知の監査失敗が再発するため、通常は修正版を維持する。

本番依存監査は既知の脆弱性0件。開発依存を含む監査には別件7件（High 5 / Moderate 2）が残る。全依存が安全になったとは扱わず、開発ツール更新 #142 / PR #254の後続調査とする。通常テスト1,733件は成功、DB等319件はローカル通常suiteではskip。
