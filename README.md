# BloomBox

想い・花・ことば・受取体験をひとつにつなぐ、ギフト体験プラットフォームの MVP です。

## 現在できること

- 季節の商品一覧、商品検索、贈る場面での絞り込み、並び替え
- 商品詳細、販売可否、関連商品の閲覧
- 数量、贈り先、お届け希望日、ギフトメッセージの入力
- サーバー側の商品価格を使った注文下書きの作成
- Stripe Checkout への安全な接続準備と、検証済み Webhook による注文確定
- 受付番号、購入時価格スナップショット、決済・配送・返金状態の確認
- ご利用ガイド、FAQ、配送・返品、Privacy、利用規約、特定商取引法、問い合わせ導線
- Canonical、Open Graph、Product JSON-LD、Sitemap、環境別 Robots
- Mobile 表示、Keyboard 操作、入力エラー、404、予期しないエラーの表示

Preview では個人情報や購入情報を永続保存せず、金銭も発生しません。Production 用の Shopify Catalog、PostgreSQL、Stripe Adapter は実装済みですが、実アカウントの E2E、在庫確保、税・送料、法務・Privacy・Support の承認が完了するまで、本番 Commerce のリリース判定は必ず失敗する設計です。

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
