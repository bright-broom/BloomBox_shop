# 売上・返金・手数料・入金の照合

Issue #138 / P1-04。2026-09-17：既存の決済・返金・台帳とStripeの読取情報を照合するCLIを追加。取引状態や仕訳を変更せず、相違点を担当者に渡す。会計ソフトの代替ではない。ADR 0016の `OPEN_DISPUTES` / `REFUND_TOTAL_MISMATCH` / `REFUNDS_NOT_SETTLED` はこのレポートに出力する。

## 対象と境界

- 小規模な販売開始前後を対象に、専用BloomBox DBのStripe取引全履歴と、指定Stripeアカウントの全履歴を読む。日付を片側だけで絞って過去注文への新しい返金を取り落とさない。
- DBは反復可能読取・読取専用のトランザクション、StripeはGETだけ。外部通信中にDBトランザクションは保持しない。既存の決済ワーカーや返金操作の権限は再利用しない。
- 各一覧は最大10,000件。Stripeは1ページ100件で最後まで取得する。上限・重複ページ・ページが進まない・接続障害・権限不足・未知の形式では**不完全な合計を出さず終了コード1**とする。件数増大時は決済と返金を同じ対象集合で取得する期間方式を別途設計する。
- DB読取時刻とStripe読取完了時刻を別々に出す。両者をまたぐ新しい通知/決済により一時的な差が出るため、相違を即座に不正取引と判断しない。通知処理後に再実行する。
- `totals` は通貨別の注文請求額・成功返金・台帳額。税/送料込みであり、会計上の税抜売上ではない。`netBeforeFees` から送料原価や税金を推測しない。
- `balanceSummary` はStripe残高取引を通貨・種別・available/pending別に集計した金額、手数料、差引額。為替換算後の残高通貨と支払通貨を混ぜない。payoutやadjustmentを商品売上に加算しない。
- `payouts` はStripeの入金予定/状態。`paid` でも銀行口座への着金証明にはしない。`bankReceipt=UNVERIFIED`、`bankReconciliation=NOT_PERFORMED` を常に表示し、銀行明細との照合は担当者が別途行う。
- 氏名・メール・住所・カード情報・自由記述は取得結果から除外して出力する。注文/支払/返金/入金IDは運用情報として扱い、公開Issueや公開リポジトリへ実取引レポートを添付しない。

## 設定と実行

DB管理者が専用のログインを作成し、`bloombox` schemaのUSAGEと次のテーブルへのSELECTだけを付与する。アプリ/ワーカー/DB所有者の接続先を流用しない。

```sql
-- finance_report_reader は例。実ログインと秘密値は管理者が別途安全に作成する。
GRANT USAGE ON SCHEMA bloombox TO finance_report_reader;
GRANT SELECT ON bloombox.payments, bloombox.refunds, bloombox.disputes,
  bloombox.financial_transactions, bloombox.ledger_entries TO finance_report_reader;
```

Stripe管理者が読取専用のRestricted keyを作成する。Account（本人確認）、Charges、Refunds、Disputes、Balance Transactions、Payoutsの読取に必要な権限を確認し、書込・返金指示権限は付与しない。既存のイベント再取得キーへ権限を継ぎ足さない。

秘密管理環境から以下を設定する。シェル履歴やコマンド引数にキーを直接書かない。

| 環境変数 | 内容 |
| --- | --- |
| DATABASE_FINANCE_REPORT_URL | 対象DBの専用読取ログイン |
| DATABASE_FINANCE_REPORT_SSL | 通常は `require`（既定）。隔離localhostのみ `disable` 可 |
| STRIPE_FINANCE_READ_KEY | 対象モードの読取制限キー `rk_test_…` / `rk_live_…` |
| STRIPE_ACCOUNT_ID | このDBに対応するStripeアカウント |
| STRIPE_MODE | `test` / `live`。キーと各取得オブジェクトのモードが一致すること |

Node 24と既存の依存を使用する。新規パッケージは不要。

```sh
node scripts/finance-reconciliation.mjs > /安全な保存先/finance-report.json
```

- 終了0：取得できた比較範囲で相違なし（銀行着金確認完了という意味ではない）。
- 終了2：レポート完成、要確認項目あり。
- 終了1：レポート未完成。標準エラーに失敗した段階のみ表示し、APIの生レスポンスや秘密値は表示しない。

## 差異の調査

| コード | 確認すること |
| --- | --- |
| CAPTURE_TOTAL_MISMATCH / PROVIDER_PAYMENT_MISSING | Stripeの成功Charge/PaymentIntentと対象DB、同一モード、Webhook反映を確認。別店舗の取引が混在するアカウントでは対象の再分離が必要 |
| REFUND_TOTAL_MISMATCH / LOCAL_REFUND_TOTAL_MISMATCH | 成功返金の合計と支払の返金額を確認。非同期返金完了と通知再取得を確認 |
| REFUND_RECORD_MISSING / REFUND_STATUS_MISMATCH / REFUND_AMOUNT_MISMATCH / REFUND_PAYMENT_MISMATCH | ID単位で返金状態・金額・紐付けを確認。成功後に失敗へ変わった返金も検出対象 |
| REFUNDS_NOT_SETTLED / REFUND_FAILED | pending/requires_actionの対応や失敗理由はStripe管理画面で確認。自動で再返金しない |
| OPEN_DISPUTES | `openDisputes` のStripe/DBのID・状態・期限を確認してStripe管理画面で対応。通知遅延により同一IDが両方に現れることがある |
| LEDGER_CAPTURE_MISMATCH / LEDGER_REFUND_MISMATCH / LEDGER_UNBALANCED / ORPHAN_LEDGER_TRANSACTION | 金額・台帳の複式整合・同じ通貨の記録を調査。レポートから直接台帳修正しない |
| FEES_UNVERIFIED / BALANCE_NET_MISMATCH | Chargeの残高取引と amount-fee=net を確認。未取得の手数料を0円と見なさない |
| PAYOUT_NOT_PAID / PAYOUT_BALANCE_UNVERIFIED / PAYOUT_AMOUNT_MISMATCH | 入金状態・対応する残高取引・銀行明細を確認。failed/canceledを着金に算入しない |
| CURRENCY_MISMATCH / PAYOUT_CURRENCY_MISMATCH | 取引通貨と残高通貨を確認し、違う通貨の数値をそのまま比較・合算しない |

## 運用の担当と残る確認

役割の分担：財務担当が日次（および返金操作後）に取得・銀行明細照合、決済運用担当がStripe/Webhook差異を調査、DB管理者が読取権限を管理する。具体的な担当者、実行時刻、保存場所・保持期間、障害時の連絡先は販売前に事業責任者が確定する。未指名の担当者を設定済みとは扱わない。

差異は取引IDと原因・対応・再確認結果を制限された運用記録へ残す。イベント欠落は [Worker障害手順](COMMERCE_WORKER_INCIDENTS.md) に従って再取得/再処理し、読取CLIでは状態を変更しない。成功後に失敗へ変わった返金の自動逆仕訳はADR 0016に記載の別課題。

実Stripeのテスト取引で成功/部分返金/全額返金/失敗返金/異議申し立て/手数料を照合すること、実際の入金の銀行明細照合、キーの権限設定と担当者承認は未完了。合成データや隔離DB試験だけで商用運用の完了としない。

## 検証と復旧

2026-09-17：`pnpm check:ci` が成功（静的検査、通常1,238件、ビルド）。追加した財務/SDK/CLI試験は15件、専用PostgreSQLの実SQL/権限試験は3件。CLIの設定不足・モード不一致・外部DBのTLS無効を実プロセスで拒否し、stdoutが空で秘密値が出ないことも確認。実Stripe通信・銀行明細照合は実施していない。

単体試験で照合正常系・差額・状態逆転・異通貨・未完/失敗返金・異議申し立て・未確認手数料・入金・安全な整数範囲を確認。Stripe SDKに合成HTTPを接続し、GETのみ/アカウント・モード/ページング/重複/上限/失敗/個人情報の除外を確認。専用隔離DBのSELECTのみのロールで実SQLを実行し、更新と顧客連絡先の読取が拒否されることを確認。

戻すときはCLI利用を止め、専用Stripeキー・DBログインを失効する。レポート以外の状態を書き換えないため、取引・台帳の復元やスキーマ巻き戻しは不要。

## 一次資料（2026-09-17確認）

- [Stripe Charge](https://docs.stripe.com/api/charges/object)：支払のcaptured amountとPaymentIntent参照。
- [Stripe Refund](https://docs.stripe.com/api/refunds/object)：成功/未完/失敗と支払への参照。
- [Stripe Balance Transaction](https://docs.stripe.com/api/balance_transactions/object)：amount/fee/net、通貨、available/pending。
- [Stripe Payout](https://docs.stripe.com/api/payouts/object)：入金状態と到着予定日。
