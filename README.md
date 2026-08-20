# BloomBox

想い・花・ことば・受取体験をひとつにつなぐ、ギフト体験プラットフォームの MVP です。

## 現在できること

- 季節の商品一覧と商品詳細の閲覧
- 贈り先、お届け希望日、ギフトメッセージの入力
- サーバー側の商品価格を使った注文下書きの作成
- 受付番号、購入時価格スナップショット、明示的な注文状態の確認
- モバイル表示、キーボード操作、入力エラー、404、予期しないエラーの表示

決済は意図的に未接続です。注文下書きは画面上でのみ確認でき、個人情報や注文情報は永続保存されず、金銭も発生しません。現在のカタログと注文処理はプレビュー専用であり、本番 Commerce のリリース判定は必ず失敗する設計です。

## 開発

```bash
pnpm install
pnpm dev
```

通常の検証:

```bash
pnpm check:ci
```

本番候補の検証:

```bash
pnpm check:release
```

個別の検査は `package.json` の `check:*` スクリプトから実行できます。

## アーキテクチャ

`src/modules` 配下を業務モジュールに分割した Modular Monolith です。

```text
Presentation → Application → Domain
                         ↑
                 Infrastructure
```

- Domain は React / Next.js / ベンダー SDK に依存しません。
- UI は Application Use Case を介してデータを操作します。
- 他モジュールは `public.ts` だけを参照します。
- Product と OrderItem の購入時価格は分離されています。
- Order の状態は boolean ではなく transition table で管理します。
- 入力境界は Zod で検証し、価格はブラウザから受け取りません。
- サイト文言とプレビュー商品は `content/` で一元管理し、起動時に Zod で検証します。
- 色は semantic token に集約し、直接指定を自動検出します。

開発時は最初に [`AGENTS.md`](AGENTS.md) を確認し、変更領域に応じて [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) または [`docs/engineering/DEVELOPMENT.md`](docs/engineering/DEVELOPMENT.md) の該当箇所だけを参照してください。

## 本番化に必要な次の境界

ADR 0001 により、Shopify を商品、価格、在庫、チェックアウト、決済、注文、返金の正本とします。Next.js はブランド体験とギフト設定を担当し、Shopify との通信は Infrastructure Adapter に隔離します。

本番移行の完了条件と自動デプロイ手順は [`docs/operations/RELEASE.md`](docs/operations/RELEASE.md)、判断理由は [`docs/architecture/adr/0001-shopify-first-commerce-boundary.md`](docs/architecture/adr/0001-shopify-first-commerce-boundary.md) を参照してください。
