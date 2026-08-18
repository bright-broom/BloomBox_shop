# BloomBox

想い・花・ことば・受取体験をひとつにつなぐ、ギフト体験プラットフォームの MVP です。

## 現在できること

- 季節の商品一覧と商品詳細の閲覧
- 贈り先、お届け希望日、ギフトメッセージの入力
- サーバー側の商品価格を使った注文下書きの作成
- 注文番号、購入時価格スナップショット、明示的な注文状態の保持
- モバイル表示、キーボード操作、入力エラー、404、予期しないエラーの表示

決済は意図的に未接続です。注文は `PENDING_PAYMENT` まで進み、金銭は発生しません。

## 開発

```bash
pnpm install
pnpm dev
```

検証コマンド:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## アーキテクチャ

`src/modules` 配下を業務モジュールに分割した Modular Monolith です。

```text
Presentation → Application → Domain
                         ↑
                 Infrastructure
```

- Domain は React / Next.js / ベンダー SDK に依存しません。
- UI は Application Use Case を介してデータを操作します。
- Product と OrderItem の購入時価格は分離されています。
- Order の状態は boolean ではなく transition table で管理します。
- 入力境界は Zod で検証し、価格はブラウザから受け取りません。

## 本番化に必要な次の境界

現在の Repository は体験確認用のインメモリ実装です。本番化では interface を維持したまま PostgreSQL 実装へ交換し、同一トランザクションで Order / OrderItem / PriceSnapshot / Outbox を保存します。その後、PaymentGateway の Stripe 実装、署名検証済み webhook、idempotency key、Outbox worker を追加します。
