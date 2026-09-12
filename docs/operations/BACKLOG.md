# Remaining work inventory

2026-09-11 時点。調査対象は `main` の `9d4d385`、コード、運用文書、GitHub設定・Issue・実行履歴。これは残課題の台帳であり、全項目の実装や本番有効化の承認ではない。

優先度は P0＝販売開始前、P1＝運営の安定化、P2＝必要性を決めてから拡張。P2は現行仕様の不具合ではない。外部アカウントとホスティングの未確認事項は、未設定と断定しない。

## 確認済みの状態

- PR #18 はマージ済み。修正時のCI、PostgreSQLテスト、依存監査、Semgrep、Vercel Previewは成功。調査開始時の未コミット・未プッシュ変更はなし。
- GitHubはPUBLIC。mainのbranch protection APIは「Branch not protected」、rulesetsは空。Production Environmentに必須reviewerはなく、branch policyのみ。既存Issueは [#6](https://github.com/bright-broom/BloomBox_shop/issues/6)。
- Repository SecretおよびProduction Environment Secretの一覧は空。Repository/ProductionのVariableには `PRODUCTION_BASE_URL` がある。ホスティング側や組織経由の秘密情報は未確認で、値は取得していない。
- `stripe-test` Environmentは取得したEnvironment一覧に存在しない。
- `pnpm check:production` は、案内コンテンツ未承認・本番販売未承認で失敗。activation evidenceの8項目はすべて未完了。
- 商品検索、Shopify商品取得、単一商品カート、Preview購入導線、郵便番号検索、購入情報の永続化、Stripe署名検証・Inbox処理・イベント再照合、注文状態参照、暗号化・一時データ保持期限処理は実装済み。これらを丸ごと未実装とは扱わない。

## P0：販売開始までに必要

| ID | 課題 | 状態・根拠 | 完了条件 |
| --- | --- | --- | --- |
| P0-01 | main保護とレビュー必須化 | 設定不足。GitHub API、Issue #6、GOVERNANCE.md | PR経由、必須CI、CODEOWNER承認、会話解決、最新mainへの追従、管理者迂回制限を設定しAPIで確認。承認者の実際の運営体制も決める |
| P0-02 | 本番Environmentの必須承認 | 設定不足。Productionにreviewerなし | 適切な承認者・main制限・迂回ルールを設定し、未承認のデプロイが進まないことを確認 |
| P0-03 | 公開リポジトリ向け運用確認 | 確認待ち。公開へ変更された | Actions権限、外部PRでのSecret非公開、ログ・Artifact・自動Incidentに公開不可データを出さない運用、公開を前提とした履歴・成果物の確認を完了 |
| P0-04 | 決済方針をADRと一致させる | ADR 0003でShopify Checkout + Shopify Payments + KOMOJUを選定。本番利用の承認ではない | 選定済み。加盟店審査・方法別の接続条件と導入証跡はPAYMENTS.mdで追跡 |
| P0-05 | 選択した本番購入経路を完成 | Shopifyカートの接続境界に加え、外部要求前の永続的な試行確保・事業者固定・暗号化・結果不明時の停止・再取得を内部ワークフローに実装。購入画面への組込みは未完了 | 通知の署名検証・参照保存・重複排除も実装（[受付](SHOPIFY_WEBHOOKS.md)）。残件は所有権確認、結果不明の照合/終了/削除、関連付けの実店舗検証/在庫の実店舗検証/出荷承認・個別返金詳細・注文表示/再照合（[Admin API読取境界](SHOPIFY_ORDER_READS.md)、[購入試行関連付け](SHOPIFY_ORDER_LINKS.md)、[決済状態照合・保存](SHOPIFY_PAYMENT_EVIDENCE.md)、[入金後の配送期限照合](SHOPIFY_DELIVERY_TIMING.md)、[配送先の構造・地域検証](SHOPIFY_DELIVERY_DESTINATION.md)は実装済み（地域方針は未承認））。[注文・暗号化ギフト/配送先の原子的保存](SHOPIFY_ORDER_ACCEPTANCE.md)も内部の決済照合から任意注入Gatewayで接続済み（公開経路は未接続）。[確定後の決済反映・返金集計・購入状態更新](SHOPIFY_ORDER_COMPLETION.md)も内部接続済み。[発送受付・外部発送活動の照合と保持・未着手受付の取消](SHOPIFY_FULFILLMENT_INTAKE.md)も内部接続済み。残件に購入画面への組込みを含む。SHOPIFY_CHECKOUT_ATTEMPTS.md参照 |
| P0-06 | 在庫予約・解放・確定・再照合 | 未実装。予約Strategy証跡未完了、在庫書込方針はSTRIPE.mdで明示的に未決定 | 同時購入、決済失敗・期限切れ・キャンセル・通信断で売り越し、二重減算、永久予約を防止。Shopifyとの整合を検証 |
| P0-07 | 配送日・締切・休業日・地域制約 | 一部実装。delivery-date.tsは3〜60日の範囲のみ | 商用の配送約束を定義し、必要な休業日、締切、対象外地域、配送日別上限をAsia/Tokyoで検証。不要な制約は業務判断で明記 |
| P0-08 | 税・送料・最終総額・返品条件 | 設定/判断/証跡待ち。[正式APIの金額照合](SHOPIFY_ORDER_PRICING.md)を実装（税込の二重加算防止、商品/送料割引・税額配賦の照合とスナップショット生成、不完全/変更済み注文の保留）。条件付き注文保存まで内部接続済みだが、公開購入経路への接続・店舗設定の承認は未完了 | 実事業者の料金と表示を確定し、商品・数量・税・送料・総額・条件が最終確認画面と注文スナップショットで整合 |
| P0-09 | Shopify実店舗接続契約 | 実店舗の証跡待ち。商品一覧/ID取得の条件統一、ID/価格/API版検証、ストリーム上限・タイムアウト・再試行の回帰テストを追加（SHOPIFY.md） | 商品公開、1商品1variant、JPY、metafield、売切れ、価格変更、認証拒否、制限・障害を隔離店舗で検証。SHOPIFY.mdの証跡を保存 |
| P0-10 | 決済事業者のテスト環境設定 | Shopify Payments + KOMOJUを選定。加盟店アカウント・審査・接続は未確認 | Shopify隔離店舗でKOMOJUの方法別アプリとテストモードを設定。送料/税/規約/通知/API版、正常/失敗/遅延入金/返金を検証。PAYMENTS.mdの証跡を保存 |
| P0-11 | 本番DB・権限・鍵の運用 | 外部環境未確認。Migration/Role/暗号化は実装済み | Application/Worker/Migration資格情報の分離、TLS、接続数、鍵保管・ローテーション、失効手順を本番相当環境で確認 |
| P0-12 | デプロイとWorkerの設定 | 一部設定不足。確認したGitHub Secret一覧は空 | Deploy Hook、Migration URL、Worker Secret等を適切なスコープに設定。対象SHAの配備・health一致・Worker実行を確認。Previewへ本番資格情報を渡さない |
| P0-13 | 新規決済停止と既存取引処理の分離 | 受付専用フラグ、Applicationの拒否、顧客向けエラー、停止/再開/実行中Sessionの回帰テストを実装。Provider設定を維持する手順へ更新 | 残作業は本番相当環境での設定反映・遅延イベントの決済確定・再開演習。分散環境へ瞬時に反映する制御ではなく、発行済みSessionを取り消すものでもない |
| P0-14 | 出荷処理・配送追跡更新 | 一部実装。正式なShopify発送活動を読取・保存し、発送記録がある注文の自動取消を保留。[注文全体・分割配送の数量照合](SHOPIFY_FULFILLMENT_QUANTITIES.md)も内部実装済み。[割当先拠点の在庫確認](SHOPIFY_FULFILLMENT_STOCK.md)も内部実装済み。[店舗別の担当者権限・不変の承認記録](SHOPIFY_FULFILLMENT_APPROVAL.md)を内部実装済み。[権限付き参照・確認画面プレビュー](SHOPIFY_FULFILLMENT_REVIEW.md)も実装済み。[Google担当者認証](GOOGLE_OPERATOR_LOGIN.md)と実注文の確認画面、[店舗別の注文一覧](OPERATOR_FULFILLMENT_INBOX.md)は実装済み・実接続設定待ち。[承認フォームと再送保護](OPERATOR_APPROVAL_FORM.md)も接続済み。事業条件 PENDING で操作無効。[担当者別の送信制限](OPERATOR_APPROVAL_RATE_LIMIT.md)も実装済み。[監査付き権限失効の内部コマンド](OPERATOR_PERMISSION_REVOCATION.md)も実装済み。[ログイン付き権限確認・失効画面](OPERATOR_PERMISSION_MANAGEMENT.md)も実装済み。[担当者単位の既存セッション失効](OPERATOR_SESSION_REVOCATION.md)も実装済み（環境設定の版更新・全プロセスへの反映が必要）。[DB所有者向けの権限登録・更新ツール](OPERATOR_ACCESS_PROVISIONING.md)も実装済み。実 Google 接続・実管理者指定・実店舗 E2E と出荷Commandは残件 | 権限付き準備・発送・配達更新、配送番号登録、顧客画面への反映。重複指示で二重発送しない。初期版は手動登録でも可 |
| P0-15 | 注文・発送・返金通知 | Provider通知の証跡待ち。独自通知consumerなし | Providerに委譲する範囲と独自通知の必要性を決定。正しい宛先に一度だけ通知し、購入者/受取人を分離。独自配信を選ぶ場合だけOutbox consumer、retry、再送を実装 |
| P0-16 | 法務・配送返品・問い合わせ情報 | 未承認。content/storefront.json、production gate | 実在する販売者情報・窓口・支払/引渡/返品条件等を担当者が確定し、案内ページとCheckoutを承認。単にapprovedへ変更しない |
| P0-17 | 個人情報・サポート権限・保持方針 | 一部実装。暗号化/一時データ削除はある。注文データの別途方針が必要 | 確定注文の保持、本人確認、閲覧権限、開示/削除依頼、バックアップ中のPII、ログ確認、受取人への開示範囲を決定・必要処理を実装 |
| P0-18 | 購入経路のブラウザーE2E | 未整備。Vitest/DBテストはあるがブラウザーE2E構成なし | 商品→カート→Hosted Checkout→検証済みイベント→注文表示。二重送信、価格変更、在庫切れ、支払失敗、遅延・重複・順序逆転、返金まで隔離環境で検証 |
| P0-19 | 商用状態のUI・アクセシビリティ検証 | 証跡待ち。画面と一部状態は実装済み | モバイル/PC/200%拡大/キーボード/読み上げ、空・エラー・処理中・キャンセル・発送・返金を確認。指摘はL1/L3の該当範囲で修正 |
| P0-20 | 監視・障害検知・復旧演習 | 一部実装。Smoke/Worker Incident/構造化エラーあり。[Shopify Inboxの件数・待機時間・再試行・恒久失敗・保持期限の診断](SHOPIFY_INBOX_DIAGNOSTICS.md)を専用閲覧接続のCLIで実装 | 診断の定期実行・通知先接続、決済引継ぎ失敗、署名失敗、未着通知の検知が残件。連絡先・対処・再処理手順、DB復元、ロールバック、取引照合の証跡を残す |
| P0-21 | 本番公開証跡とGate整合 | 未承認。activation evidence全8項目がfalse | 上記の証跡を対象SHAと結び付ける。決済方針変更時はGateのSTRIPE固定条件もADRに沿って更新。最後にcheck:release成功、承認、公開後Smokeを確認 |

## P1：運営を安定させる

| ID | 課題 | 状態・根拠 | 完了条件 |
| --- | --- | --- | --- |
| P1-01 | サポート用注文検索・操作 | 独自画面/認証なし。Provider管理画面への委譲も可能 | 最小権限、注文検索、参照・変更監査、PII閲覧制限。販売開始時点で少なくとも担当者と代替手順は必要 |
| P1-02 | キャンセル・部分返金・返品・再配送 | 返金イベント受信はあるが独自の指示Use Caseなし | Provider管理画面か独自Commandかを選ぶ。金額上限、重複防止、返金確定の非同期反映、在庫/出荷との整合を検証 |
| P1-03 | Inbox/Outboxの再処理運用 | Inbox自動retryとFAILED隔離、[復元不能な通知の分離](PROVIDER_INBOX_RECOVERY.md)、[DB所有者による確認・監査付きFAILED再投入](WEBHOOK_RETRY.md)を実装。Outboxは書込のみ | 原因解消・接続設定を伴う復旧演習、[専用認証・テスト限定のShopify worker接続](SHOPIFY_INBOX_WORKER.md)を追加。実店舗での正式API再照合・恒久保留の解決・未着通知回復が残件。必要なconsumerを決め、記録だけのOutboxの保持/肥大化方針を定める |
| P1-04 | 台帳と事業者の集計照合 | イベント再取得とLedger記録はあるが集計レポートなし | 売上・返金・入金・手数料等の責任範囲を決め、差異の検知と調査手順を設ける。会計システム全体の新規開発は不要 |
| P1-05 | 負荷・濫用・外部API上限の検証 | Timeout/一部retry/入力検証はある。商用負荷証跡なし | 購入開始、郵便番号検索、注文参照、Webhookの負荷/上限を測定。必要なRate Limit・Cache・DB poolを実測に基づき追加 |
| P1-06 | 商品数拡大時の検索・ページング | Shopify取得上限は50件×20ページ。検索は取得結果上 | 実カタログ件数で待ち時間・API量を測定し、必要ならProvider検索/ページングを実装。小規模時は現行構成を維持 |
| P1-07 | Dependabot更新処理の失敗調査 | 実行34572684620の原因は、7日間のrelease-age制約がPR #18で採用済みの最低バージョンを拒否したこと。pnpm設定に採用済み3バージョンだけの例外を追加し、隔離コピーで修正前の失敗・修正後の更新を検証 | 残作業はmain反映後のDependabot実更新成功の確認、および2026-09-18以降の例外削除。アプリCI成功だけで更新ジョブ復旧と扱わない |
| P1-08 | 開発ツールの次期移行 | TypeScript/Node型のmajor更新は意図的に保留 | Node baselineと型の整合、TypeScript AST API利用箇所、ESLint等の互換性を専用PRで検証。保留設定を無条件に解除しない |
| P1-09 | カート編集と期限切れ復旧 | 実装済み。ギフトの入力復元・変更保存・破棄、期限外日付の再選択、商品入れ替え確認、古い確認の無効化 | [仕様と検証](CART_RECOVERY.md)。本番Hosted Checkoutで発行済みのSessionの取消は対象外 |

## P2：採否を決める追加機能

| ID | 候補 | 現行仕様と着手条件 |
| --- | --- | --- |
| P2-01 | eGift受取リンク | 住所を知らずに贈る。トークンのハッシュ保存・期限・単回使用・失効、受取人入力、未受取処理。在庫/配送/通知完成後 |
| P2-02 | 顧客アカウント・住所帳・注文履歴 | 現行はguest-first。Shopify Customer Account接続を優先し、本人確認・購入者/受取人分離を設計 |
| P2-03 | 商品バリエーション | 初期M/Lの2SKU選択・入力保持・価格/送料/購入スナップショットをpreviewに実装。本番Adapterは1商品1variantのまま。実Shopifyの2variant・在庫・実写・税/配送条件が残件。[会議反映](MEETING_2026-09-11.md) |
| P2-04 | 複数商品カート | 現行は単一item。商品ごとの金額・在庫と注文合計・部分取消/返金を設計 |
| P2-05 | 複数配送先 | 明示的な非対応仕様。注文分割・送料・キャンセル・返金・サポートをADRで決めてから実装 |
| P2-06 | クーポン・販促・分析・推薦 | 友人500円・紹介者500円の紹介特典をTest Modeに実装（[仕様・本番残件](REFERRALS.md)）。本番は顧客認証・永続台帳・Shopify割引・検証済み配達/返金イベント・不正対策が必要。分析/推薦は未実装、購入をブロックしない |
| P2-07 | 生産者・花材・ロット・季節運用 | 現行は商品metadata。ロット追跡、代替花材、仕入/廃棄が業務上必要になったら所有Moduleと在庫移動を定義 |
| P2-08 | 受取人特典・増量・用途別同梱物 | 受取人案内と無効状態を実装。特典・箱仕様・同梱資材・物流出力は業務条件待ち。[B09〜B11](MEETING_2026-09-11.md) |
| P2-09 | SNS・商品フィード・効果測定 | 同意して開始するタブ内の動線確認を実装。実測定のサービス/ID/同意、公式SNS、Shopify→Googleの商品URL整合と店舗設定は待ち。[B13〜B15](MEETING_2026-09-11.md) |

## 次に進める順序

1. P0-01/02：公開化で取り除けるガバナンス課題を閉じる。承認者の決定は人が行う。
2. P0-04の方針はADR 0003で確定。P0-05：Shopify + KOMOJU経路の残る購入処理・在庫・通知・Gateを完成。
3. P0-05/06/13：購入・在庫・緊急停止を一つの取引経路として検証。
4. P0-07/14/15：届けられる日付、実出荷、通知を完成。
5. 並行して設定・規約・PII方針をそろえ、P0-18〜21で販売開始条件を確認。

通知をProviderに任せるなど、受入条件を満たす小さな運用で代替できる項目は独自実装を増やさない。会員機能・複数商品・AI等は販売開始の必須条件にしない。

## 証跡と既存資料

- [本番公開条件](RELEASE.md)、[ガバナンス](GOVERNANCE.md)、[Shopify](SHOPIFY.md)、[Stripe](STRIPE.md)、[Storefront](STOREFRONT.md)
- [ADR 0001](../architecture/adr/0001-shopify-first-commerce-boundary.md)、[ADR 0002](../architecture/adr/0002-commerce-persistence-and-payment-boundaries.md)
- [本番証跡設定](../../config/production-commerce-activation.json)、[本番Gate](../../scripts/check-production-readiness.mjs)
- [構成の組み立て](../../src/shared/infrastructure/composition-root.ts)、[配送日](../../src/modules/fulfillment/domain/delivery-date.ts)
- [PR #18](https://github.com/bright-broom/BloomBox_shop/pull/18)、[Issue #6](https://github.com/bright-broom/BloomBox_shop/issues/6)

公開後のAPI設定は変化するため、実施時に再取得する。ホスティング・Shopify・Stripeのアカウント状態、承認済み法務文書、バックアップ実体は本調査では確認していない。
