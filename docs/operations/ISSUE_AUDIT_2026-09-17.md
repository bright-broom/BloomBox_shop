# BloomBox open Issue監査（2026-09-17）

対象: 監査開始時に開いていた57件。[GitHubの現在のIssue一覧](https://github.com/bright-broom/BloomBox_shop/issues) と [全体計画 #113](https://github.com/bright-broom/BloomBox_shop/issues/113) を参照。これは2026-09-17時点の監査スナップショットであり、下表を常に最新の状態と見なさない。監査自体は読み取り専用で、Issue編集/close、設定変更、公開配備を行っていない。実装・外部設定・事業判断・検証を区別している。

## 監査後の確認・更新（2026-09-17）

後続の実装・5件の完了整理・公開Vercel設定の再確認は [対応結果](ISSUE_RESOLUTION_2026-09-17.md) が新しい記録。下表は監査開始時の57件を保存する。

- この文書を取り込む際のmain基準は `7472c5f`（#188までマージ済み）。監査開始時のPR188 OPENという記述は下記の履歴であり現在値ではない。
- `PRODUCTION_BASE_URL` は https://bloom-box-shop-ybb9.vercel.app に修正済みと再取得で確認。この修正は監視先の整合であり、新しいコードの公開配備ではない。
- 上記URLの `/api/health` を再取得し、`status=ok`、稼働SHA `259356edf51def7030729822df32e07ff82a3b54` を確認。新しいTOP変更と稼働SHAは別に扱う。
- #143 の履歴画面は [PR #190](https://github.com/bright-broom/BloomBox_shop/pull/190) に実装・検証済み。PR/CI/マージ/公開状態は使用時に再確認。
- #145 は本記録と入口・運用文書を整合。#6の保護設定は別担当・別Issueの更新を確認し、下記の「無保護」スナップショットを現在の断定に使わない。
- [公開プレビュー監視と商用フッター検証](PUBLIC_PREVIEW_VERIFICATION_2026-09-17.md) に、今回の読み取り専用の公開確認と販売を有効にしない表示証跡を記録。

## 監査開始時の結論

- **現時点で閉じられる候補は #148**。当初範囲のプロフィール編集・住所帳・返金表示・退会と注文保持は実装、隔離検証、公開反映まで存在。PR175/176は現在MERGED。実顧客退会や住所変更を試していないことは残すが、破壊的な本番試験は当初の完了条件ではない。追加要望は別Issue。
- **#182 はコード側完了**。公開後の確認を残件として書いているため、既存公開URLが259356eのままの現在は閉じない。TOP187を安全に配備しFAQ確認後に閉じられる。
- **#184 はコード側完了**。更新担当者の割当が完了条件に含まれ未割当。技術担当の編集・公開手順はある。人名を捏造せず、営業の原稿確認者を確定後に完了。
- **#186 はコード側完了**。商用候補の表示証跡を追加すれば完了。販売有効化は不要、商用runtimeの isolated fixture/画面で確認する。
- #137/#138/#140/#145 は既存の部分実装を新規実装不足と混同しない。順に「Inbox再処理のみ」「イベント照合のみ」「検索のみ」「文書入口更新のみ」があり、下記残件は実在する。

## 監査開始時の外部証拠（秘密値なし・履歴）

1. GitHub PR187/176/175/174はMERGED、PR188はOPEN。APIで再確認。
2. main protectionはHTTP404（Branch not protected）、rulesets=[]。Actions workflow permissionはread、PR承認false、fork承認first_time_contributors、allowed_actions=all、sha_pinning_required=false。
3. EnvironmentはPreview（保護なし）、Production（branch_policyのみ、reviewerなし）、Production – bloom-box-shop-ybb9（保護なし）。レビュー承認を備えたとは言えない。
4. Repo変数PRODUCTION_BASE_URLは **https://bloom-box-shop.vercel.app**。現在利用者が見ているURLと不一致。Repo Actions secretsのリストは空。Environment/Vercel秘密設定はこの監査では未取得なので未設定と断定しない。
5. Stripe Test Mode Readiness workflowは実行0件。
6. https://bloom-box-shop-ybb9.vercel.app/api/health は status=ok / release=259356edf51def7030729822df32e07ff82a3b54。公開トップHTMLにhome-faqはない。TOP187は公開URLに未反映。

## 根拠参照

- A: docs/operations/BACKLOG.md・HANDOFF.md（古い状態を含むため下位の新証拠を優先）
- B: docs/operations/CUSTOMER_SELF_SERVICE.md・CUSTOMER_SELF_SERVICE_RELEASE_2026-09-17.md、src/modules/customer/infrastructure/postgres-customer-portal.ts（closeはoptional portal削除とidentity停止、注文を削除しない）、customer-portal.database.test.ts
- C: docs/operations/TOP_PAGE.md、src/ui/home-sections.tsx/.test.tsx、src/shared/infrastructure/content/home-content.ts/.test.ts、content/home.json
- D: docs/operations/COMMERCE_WORKER_INCIDENTS.md、src/modules/payment/application/requeue-failed-inbox-events.ts、infrastructure/postgres-failed-inbox-requeue.ts、.github/workflows/commerce-inbox-requeue.yml
- E: src/modules/payment/infrastructure/stripe-event-reconciler.ts、stripe-commerce-event-processor.ts、.github/workflows/commerce-reconciliation.yml（イベント再取得・処理、入金/手数料集計ではない）
- F: src/modules/catalog/application/search-products.ts、infrastructure/postgres-product-repository.ts（上限+1で超過拒否、全件取得後filter/sort）、同database.test.ts
- G: docs/operations/RELEASE.md（旧bloom-box-shop配備先、protected承認を期待）、pnpm-workspace.yaml、AGENTS.md（ADR0009更新済み）
- H: docs/operations/REFUNDS_AND_CANCELLATIONS.md、ADR0016（Stripe管理画面採用済み）
- I: docs/operations/OPERATIONS_CONSOLE.md、CUSTOMER_MANAGEMENT.md、src/app/operations、customer module
- J: docs/operations/ADVERTISING.md、src/modules/advertising、migration0026（購入イベント接続と外部送達/帰属を区別）
- K: docs/operations/NATIVE_INVENTORY.md、STRIPE.md、stripe-unrecorded-checkout-recovery.ts、config/production-commerce-activation.json（blocked維持）

## 全57件: 残りの性質・一つの次アクション・必要入力

実=追加実装 / 外=外部設定 / 判=事業判断 / 検=検証。完了は現行証拠に限定。P2は採用条件を無視して実装しない。

| Issue | 残分類・現状 | 次アクション | 必要な外部入力 / 根拠 |
|---|---|---|---|
| [#6](https://github.com/bright-broom/BloomBox_shop/issues/6) | 外/検: main無保護・本番reviewer無 | main required checks/承認者と実配備Environmentの保護を設定して未承認拒否を確認 | 実承認者・bypass方針 / 外部証拠2,3 |
| [#113](https://github.com/bright-broom/BloomBox_shop/issues/113) | 計画: 全子Issue未収束 | この監査で実装/判断/設定/検証を更新し依存ごとの担当を明示 | 子Issueの完了証拠 / A |
| [#114](https://github.com/bright-broom/BloomBox_shop/issues/114) | 検: default read、fork初回承認あり | workflow_runとArtifact/Incidentが非信頼内容/PIIを公開しないことを監査 | 保持期間・担当 / 外部証拠2、ci-failure-triage.yml |
| [#115](https://github.com/bright-broom/BloomBox_shop/issues/115) | 外/検: 取消UI含む内部処理済み | 隔離Google→Stripe test→署名通知→本人注文→取消を実走 | Stripe test key/webhook、隔離DB / K |
| [#116](https://github.com/bright-broom/BloomBox_shop/issues/116) | 判/検: 不明Session期限後照合まで実装 | 実テスト決済と同時購入/期限切れ/通信断/返金の在庫照合 | 実在庫と24h予約上限承認 / K |
| [#117](https://github.com/bright-broom/BloomBox_shop/issues/117) | 判→実/検: 日付3〜60日だけ | 締切/休業日/地域リードタイム/製作枠を承認表にする | 配送契約・営業カレンダー・日別上限 / A |
| [#118](https://github.com/bright-broom/BloomBox_shop/issues/118) | 判/検: M/L1箱税込送料固定済み | 返品取消再配達条件と配送原価を承認し住所後総額を照合 | キャリア見積・取消期限・費用負担 / PURCHASE_SHIPPING.md |
| [#119](https://github.com/bright-broom/BloomBox_shop/issues/119) | 外/判/検: 管理基盤済み | 専用管理権限で承認済みM/Lを正式DBに登録する | 花材/本数/画像/在庫/販売可否 / NATIVE_CATALOG_MANAGEMENT.md |
| [#120](https://github.com/bright-broom/BloomBox_shop/issues/120) | 外/判/検: readiness実行0 | 分離されたStripe test環境を構成しReadinessを実行 | 所有Stripeアカウント・制限キー・採用支払方法 / 外部証拠5,K |
| [#121](https://github.com/bright-broom/BloomBox_shop/issues/121) | 外/検: 公開DB0027まで、support分離済み | 販売用application/worker/catalog/migrationの権限表と復元を検証 | 販売DB接続・鍵管理責任者 / B |
| [#122](https://github.com/bright-broom/BloomBox_shop/issues/122) | 外/検: URL変数が旧サイト、worker実稼働未証明 | 正式ターゲットを一本化し対象SHA/healthと実workerイベントを照合 | Deploy hook/Worker secret/正式origin / 外部証拠4,6 |
| [#123](https://github.com/bright-broom/BloomBox_shop/issues/123) | 検: intake停止と遅延処理の実装済み | 隔離実接続で新規拒否中にも既存通知処理・再開できることを試験 | Stripe testと隔離DB / K |
| [#124](https://github.com/bright-broom/BloomBox_shop/issues/124) | 実/検: native発送指示不足 | nativeの権限付き状態遷移・追跡登録・顧客表示をDB試験する | 配送条件確定は117/118/133、合成実装は独立可能 / I,A |
| [#125](https://github.com/bright-broom/BloomBox_shop/issues/125) | 判/実/外/検: Outbox書込のみ | 通知委譲か自社配信かを決め、必要consumerを追加 | 送信元ドメイン/事業者/購入者と受取人への通知種別 / D,E |
| [#126](https://github.com/bright-broom/BloomBox_shop/issues/126) | 判: storefront draft | 正式販売者/連絡窓口/引渡返品条件を原稿に反映・承認 | 業者名/責任者/住所/電話/窓口時間 / content/storefront.json |
| [#127](https://github.com/bright-broom/BloomBox_shop/issues/127) | 判/実/検: セルフサービスと削除依頼済み | 注文・問い合わせ・監査・バックアップの保持と本人確認運用を承認 | 保持年限・責任者・開示範囲 / B |
| [#128](https://github.com/bright-broom/BloomBox_shop/issues/128) | 外/検: 合成試験中心 | Stripe testに通した決済/返金/紛争/並行操作の証跡マトリクスを埋める | 120/121の隔離接続 / K |
| [#129](https://github.com/bright-broom/BloomBox_shop/issues/129) | 検: axe/小幅等済み | 実機Safari/読み上げ/200%/商用状態を対象SHAで確認 | 実機と商用fixtureまたは隔離接続 / docs/design/VERIFICATION.md |
| [#130](https://github.com/bright-broom/BloomBox_shop/issues/130) | 外/検: countsとIncident実装済み | DB復元→切戻し→遅延通知→取引照合を演習 | 障害担当/連絡先/復元先 / D,B（backup復元未実施） |
| [#131](https://github.com/bright-broom/BloomBox_shop/issues/131) | 判/外/検: 証跡8項目未完 | 子Issue証拠をSHAへ紐付け、承認後にrelease gate/配備 | 商用開始の明示承認 / K |
| [#132](https://github.com/bright-broom/BloomBox_shop/issues/132) | 外/検: 顧客と運営者1名公開確認済み | Google一般公開条件/brandを確認し失効・拒否・障害を公開対象で検証 | Google Console権限・正式公開対象・残り運営者本人login / B |
| [#133](https://github.com/bright-broom/BloomBox_shop/issues/133) | 判/実物検証 | M/L試作を実測・撮影し配送耐久/鮮度/原価を記録 | 実物、寸法重量、資材、花材、本数、仕入 / A |
| [#134](https://github.com/bright-broom/BloomBox_shop/issues/134) | 実/外/検: native管理はUnsplash限定 | 自社正式画像の検証ルール/保管運用/Next設定を合わせる | 133の正式画像と権利・配信管理者 / catalog image validation |
| [#135](https://github.com/bright-broom/BloomBox_shop/issues/135) | 実/判/検: 検索/集計/問合せ回答と1名公開接続済み | 必要な氏名連絡先検索/メモ等をPII範囲とともに限定し追加 | 担当・監査保持、必要検索属性 / I,B |
| [#136](https://github.com/bright-broom/BloomBox_shop/issues/136) | 実/判/検: ADR0016でStripe管理画面採用済み | 返送/再発送と返金成功後失敗訂正を運用・イベントで扱う | 118の条件とStripe担当権限、実test返金 / H |
| [#137](https://github.com/bright-broom/BloomBox_shop/issues/137) | 実/判/検: bounded Inbox requeue実装済み | 本文消去後の解決、滞留一覧、Outbox consumer/保持を整備 | 125の配信方式、保持期限 / D（75,98行に未実装） |
| [#138](https://github.com/bright-broom/BloomBox_shop/issues/138) | 実/判/外/検: Ledger/イベント照合のみ | 読取専用の台帳vsStripe差異と入金/手数料のレポートを設計 | Stripe balance/payout読取権限・会計確認担当/期間 / E |
| [#139](https://github.com/bright-broom/BloomBox_shop/issues/139) | 判/検→実 | 想定販売量で購入/郵便番号/参照/webhookの負荷・濫用を計測 | 目標同時数/件数、隔離DB・決済設定 / A |
| [#140](https://github.com/bright-broom/BloomBox_shop/issues/140) | 条件/検: 検索済み、全件filter、上限超過拒否 | 初期2商品と上限付近のDB量/時間を測りページング要否を判断 | 将来商品数・SLO（初期M/Lに巨大検索基盤不要） / F |
| [#141](https://github.com/bright-broom/BloomBox_shop/issues/141) | 時期/検: 3版例外 | 2026-09-18以降に実release-ageを再計算して不要例外のみ削除 | registry publish日時（本日は9/17） / G |
| [#142](https://github.com/bright-broom/BloomBox_shop/issues/142) | 条件/実/検: TS5.9.3維持 | 次期TSのAST scanner互換性を専用候補で確認し移行可否を判断 | サポート版/移行採用タイミング / check-architecture.mjs,A |
| [#143](https://github.com/bright-broom/BloomBox_shop/issues/143) | 実/検: 履歴保存ありUI無し | 既存catalog権限で監査検索・変更差分閲覧を追加 | なし（合成DBで実装可能） / NATIVE_CATALOG_MANAGEMENT.md |
| [#144](https://github.com/bright-broom/BloomBox_shop/issues/144) | 条件/検: 再現なし、一度の記録 | 再発時にcookie送受信メタデータを採取して原因を特定 | 再発操作/ブラウザ時刻（秘密なし） / NATIVE_CATALOG_CONNECTION_VERIFICATION.md |
| [#145](https://github.com/bright-broom/BloomBox_shop/issues/145) | 実: AGENTS更新済み、BACKLOG/RELEASE古い | 0027/広告/公開SHA/旧Vercel URLと承認期待記述を最新証拠へ整合 | なし、ただし旧取引/秘密の削除は行わない / G,外部証拠4,6 |
| [#146](https://github.com/bright-broom/BloomBox_shop/issues/146) | 判/外/検: rank計算/割引snapshot済み | 料率閾値を承認後Google→Stripe割引→返金→ランク変動を実走 | 採算/返金条件・120/121 / CUSTOMER_LOYALTY.md |
| [#147](https://github.com/bright-broom/BloomBox_shop/issues/147) | 判/実 | eGiftの採用/未受取時返金・期限/受取人通知を確定 | 配送在庫/原価/期限決定 / A |
| [#148](https://github.com/bright-broom/BloomBox_shop/issues/148) | **完了候補** | PR175/176・BをIssueに記録して完了へ、追加領収書等は別Issue | 追加外部入力なし。当初範囲実装、公開済み、退会で注文は消さない / B |
| [#149](https://github.com/bright-broom/BloomBox_shop/issues/149) | 判/実: M/Lは済み | 新しいSKU/色追加が必要か決定、採用時だけ設計 | 追加商品の実体と価格在庫 / A |
| [#150](https://github.com/bright-broom/BloomBox_shop/issues/150) | 判/実: 初期1箱は確認済み | 1回複数箱へ変更する採用判断と送料/部分返金を先に確定 | 合算送料/在庫割当/部分取消条件 / A |
| [#151](https://github.com/bright-broom/BloomBox_shop/issues/151) | 判/実 | 複数宛先の需要と注文/送料分割単位を決める | 宛先数・送料・発送取消単位 / A |
| [#152](https://github.com/bright-broom/BloomBox_shop/issues/152) | 判/実/検: referralはtestのみ | 本番紹介制度の対象/不正対応/割引重複条件を確定 | 特典採算/成立条件/異議窓口 / REFERRALS.md |
| [#153](https://github.com/bright-broom/BloomBox_shop/issues/153) | 判/実 | flower lot追跡の必要単位と仕入廃棄運用を確定 | 生産者・ロットID・代替・在庫移動要件 / A |
| [#154](https://github.com/bright-broom/BloomBox_shop/issues/154) | 判/実 | 受取特典/用途別同梱物の原価と条件を決める | 資材/QR/対象サイズ/期限/回数 / A |
| [#155](https://github.com/bright-broom/BloomBox_shop/issues/155) | 外/判/検: 購入広告基盤済み | 安全な媒体test送信とcron/retentionを所有accountで構成 | Google/Meta所有権・OAuth/権限・担当、販売前live送信不可 / J |
| [#156](https://github.com/bright-broom/BloomBox_shop/issues/156) | 判/実 | Google以外が必要な利用者とID方式を決定 | 採用可否・本人確認メール基盤 / A |
| [#157](https://github.com/bright-broom/BloomBox_shop/issues/157) | 判/実/外 | 対象媒体と正式商品feedの公開契約を決定 | 所有SNS/媒体・正式domain/商品画像/公開条件 / J |
| [#158](https://github.com/bright-broom/BloomBox_shop/issues/158) | 判/実/外/検 | 閲覧/カートイベントの目的・同意・送信データを決定 | 媒体/保持/retargeting採用可否 / J |
| [#159](https://github.com/bright-broom/BloomBox_shop/issues/159) | 判/実/外/検 | 媒体別refund訂正要件を調べ適用範囲を確定 | 広告費権限/集計粒度/訂正API採用媒体 / J |
| [#178](https://github.com/bright-broom/BloomBox_shop/issues/178) | 判/素材/検: 表示コンポーネント済み | 許諾済み実花/開封/飾った画像を登録して各幅を確認 | 133/134の実写と商品対応 / C |
| [#179](https://github.com/bright-broom/BloomBox_shop/issues/179) | 判/素材/検: 比較UI済み | 同縮尺写真と実測仕様を既存比較に登録する | M/L寸法・花材量・用途適性根拠 / C |
| [#180](https://github.com/bright-broom/BloomBox_shop/issues/180) | 判/実/検: 希望日範囲は済み | 117の確定カレンダーで地域別到着見積もりを実装 | 地域別leadtime/休業/締切/製作枠 / C |
| [#181](https://github.com/bright-broom/BloomBox_shop/issues/181) | 判/検: 安心情報UI済み | 包装/不良時窓口/書類の正式条件を承認し単一contentへ反映 | 118/126/133 / C |
| [#182](https://github.com/bright-broom/BloomBox_shop/issues/182) | **実装完了/公開検証残** | TOP187を配備後FAQ4件・リンク・開閉を公開確認 | 配備はリリース担当判断、回答承認は126へ分離 / C,外部証拠6 |
| [#183](https://github.com/bright-broom/BloomBox_shop/issues/183) | 判/検: account導線と準備中表示済み | 146の正式料率/条件後に準備中案内を切替えて確認 | 会員条件・割引実接続 / C |
| [#184](https://github.com/bright-broom/BloomBox_shop/issues/184) | **実装完了/運用割当残** | 営業原稿確認者と技術更新担当を定め、期間付き告知を確認 | 実際の更新担当者と必要な告知原稿 / C |
| [#185](https://github.com/bright-broom/BloomBox_shop/issues/185) | 判/素材/検: 非表示/許諾条件済み | 実購入者の許諾と匿名原稿を得て登録する | 実レビュー・写真権利・削除窓口 / C |
| [#186](https://github.com/bright-broom/BloomBox_shop/issues/186) | **実装完了/商用画面検証残** | 販売停止を維持した商用fixtureのfooter証跡を残す | 商用runtimeだけで可能、実課金不要 / C,preview-footer-links.tsx |

## 担当者への実装上の推奨

追加実装の独立候補は #124 native発送、#143 catalog監査UI、#134 画像契約、#138 読取レポート（外部照合と区別）、#137 bounded監視/保持契約。外部情報不要なものを先行し、#145で古い未実装記述を整理する。#125/#147〜159を「全部」の一言で商用条件を創作して強制有効化しない。
