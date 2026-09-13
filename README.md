# BloomBox

想い・花・ことば・受取体験をひとつにつなぐ、ギフト体験プラットフォームの MVP です。

## 開発を引き継ぐ方へ

AI・人を問わず、最初に [AGENTS.md](AGENTS.md) → [開発引き継ぎ](docs/operations/HANDOFF.md) → [残課題台帳](docs/operations/BACKLOG.md) の順に確認してください。現行方針、確認済みの範囲、未完了事項、次の順序、記録の更新方法を共有しています。課題の状態は台帳へ集約し、チャット履歴を前提にしません。

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

通常のPreview購入は検証用データで動き、実決済は発生しません。Google認証や商品管理を隔離DBへ接続する検証は別で、確認用のデータが保存される場合があります。Previewという表示だけで非永続と判断しないでください。

自作PostgreSQLの商品・在庫管理、顧客Google認証、購入者紐付け、在庫予約・確定・解放、送料固定、Stripe Adapterと接続確認ツールを実装済みです。実Stripe購入から発送・復旧までの検証、本番設定、正式な商品・販売条件の承認が残り、新規の本番注文はコードとリリース判定で停止しています。実装と実接続の証拠は [残課題台帳](docs/operations/BACKLOG.md) で区別しています。

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

ADR 0009 により、顧客・商品・価格・在庫・注文・発送はBloomBoxのPostgreSQLで管理します。顧客はGoogleで直接認証し、次の決済接続には既存のStripe Checkoutを使用します。支払・返金の事実は検証済み事業者通知と照合で確定し、SDKをInfrastructure Adapterに隔離します。Shopify実装は移行前の経路として残っており、現在の新規開発の前提ではありません。

本番移行の完了条件とデプロイ手順は [RELEASE.md](docs/operations/RELEASE.md)、判断理由は [ADR 0009](docs/architecture/adr/0009-native-commerce-and-google-customers.md) を参照してください。
