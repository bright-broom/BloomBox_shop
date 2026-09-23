# ADR 0020: 本番の新規購入受付の開始条件

- 状態：採用（2026-09-19）。ユーザーの「リリースできる状態にして」という依頼に対応。
- 範囲：本番runtimeで新しい購入手続き（Stripe Checkoutの作成）を受け付けるかどうかの判定。
- 関連：[ADR 0009](0009-native-commerce-and-google-customers.md)（証跡がそろうまで販売を停止）、[RELEASE](../../operations/RELEASE.md)。

## 背景

- これまで `acceptsNewCheckout` は `runtime === "preview" && enabled` で、本番runtimeでは常に拒否していた。
- そのため、証跡・承認がすべてそろっても、販売を始めるにはこの判定をコードで書き換える必要があった。リリース時にレビューされていないコード変更が入りやすく、判定の根拠も記録に残らない。
- 一方、`pnpm check:production` は activation設定の証跡8項目と、案内コンテンツの承認を検査している。

## 決定

本番の新規購入は、次の3つがすべてそろったときだけ受け付ける。

1. `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true`（運営者のスイッチ）
2. ビルドに含まれる `config/production-commerce-activation.json` が承認済みで、証跡8項目がすべて完了し、参照先が記録されている
3. `content/storefront.json` の `publicationStatus` が `approved`

- 判定は純粋関数 `acceptsNewCheckout`（`src/shared/domain/commerce-activation.ts`）に置く。証跡の規則はリリース前の検査スクリプトと同じにする。テストで、検査スクリプトと実行時の判定の結果が一致することを確かめる。
- 2と3はリポジトリのファイルなので、レビュー済みのPRと再配備でしか変わらない。環境変数だけでは販売を始められない。
- 停止は1だけで即時に行える（環境変数を `false` にする）。
- previewでは、従来どおりスイッチだけで判定する。
- 既存の支払い・Webhook・照合・返金・発送・購入手続きの取消は、この判定に依存しない。

## 影響

- 現在のactivation設定は `blocked`、案内は `draft` なので、本番の挙動は変わらない（受け付けない）。
- 販売開始の手順は、RELEASEの「Commercial activation sequence」に従う。
- 公開監視（Production Smoke）は `/api/health` の `commerce` を読み、停止中はプレビュー用の表示、販売中は商用の表示（プレビュー・ダミー決済の文言がないこと、特商法表記の項目がそろうこと、カートに購入条件があること、ダミー決済の経路が404であること）を検査する。2026-09-23に実装。

## 切り戻し

- 即時停止：`BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false`。
- 承認の取消：activation設定の `status` を `blocked` に戻すPRを出し、再配備する。
- コードのrevertでは、以前の「本番は常に拒否」に戻る。
