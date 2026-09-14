# ADR 0015: 自作注文の発送運用

- Status: Accepted implementation direction, 2026-09-14. 本番販売開始・実配送・顧客通知の承認ではない。
- Extends: ADR 0005、0006、0009、0011。
- Issue: #124（P0-14）

## 背景

Stripe経由の自作注文は、署名検証済みの決済通知を処理するときに `fulfillments` を `UNFULFILLED` で作成する。しかし運営者が準備・保留・取消・発送・配達を記録する経路と、配送会社・追跡番号を購入者へ示す経路がない。既存の発送承認（ADR 0005）はShopify店舗単位の権限と受付を前提にしており、自作注文の運用には使わない。

## 判断

### 1. 状態と操作

既存の `FulfillmentStatus` に `ON_HOLD` を追加する。`SCHEDULED` は旧Shopify受付用に残し、自作注文では使わない。`RETURNED` への遷移は #136（P1-02）で扱い、この変更では操作を提供しない。

| 操作 | 許可する現在状態 | 次の状態 | 追加条件 |
| --- | --- | --- | --- |
| `START_PREPARATION` | UNFULFILLED | PROCESSING | 注文・支払条件 |
| `MARK_READY` | PROCESSING | READY | 注文・支払条件 |
| `HOLD` | UNFULFILLED, PROCESSING, READY | ON_HOLD | 保留理由 |
| `RESUME` | ON_HOLD | PROCESSING | 注文・支払条件 |
| `CANCEL` | UNFULFILLED, PROCESSING, READY, ON_HOLD | CANCELLED | 取消理由。返金は実行しない |
| `SHIP` | READY | SHIPPED | 注文・支払条件、数量合計1、発送記録なし、配送会社・追跡番号 |
| `CORRECT_TRACKING` | SHIPPED, DELIVERED | 変更なし | 発送記録あり |
| `MARK_DELIVERED` | SHIPPED | DELIVERED | 発送記録あり |

注文・支払条件は、注文が `CONFIRMED` で、支払状態がちょうど `CAPTURED` の1種類だけであること。満たさない場合はそれぞれ `ORDER_NOT_ACTIVE`、`PAYMENT_NOT_SETTLED` で拒否する。`HOLD` と `CANCEL` は発送前であれば注文・支払状態にかかわらず許可する。発送後に返金・紛争が起きても、配達記録と追跡番号の訂正は物理的な事実の記録として許可する。

判定の順序は、入力不正 `INVALID` → 状態遷移 `TRANSITION_NOT_ALLOWED` → `ORDER_NOT_ACTIVE` → `PAYMENT_NOT_SETTLED` → `MULTI_BOX_UNSUPPORTED` とする。

### 2. 部分発送と複数箱

初期は1注文1箱とし、1件の発送記録が履行全体を表す。数量合計が1以外の注文の `SHIP` は `MULTI_BOX_UNSUPPORTED` で拒否する。DBでも `shipments` は履行ごとに1行に制限する。複数箱・部分発送はP2-04で拡張する。

### 3. 配送会社と追跡番号

配送会社は `YAMATO`、`SAGAWA`、`JAPAN_POST` に限る。追跡番号は前後の空白と内部の空白・ハイフンを除き、英字を大文字にした8〜32文字の英数字に正規化する。それ以外は `INVALID`。発送・配達日時はDB時刻で記録し、ブラウザーの値を使わない。実配送条件（P0-07/08/23）が確定したら配送会社の一覧を見直す。

### 4. 権限と接続

Shared securityが所有する `native_fulfillment_operators`（期限付き・既定無効）で権限を確認する。Shopify発送権限・商品管理権限・顧客閲覧権限から自動付与しない。既存の運営者を自動登録しない。専用ロール `bloombox_native_fulfillment` と専用接続 `DATABASE_NATIVE_FULFILLMENT_URL` を使い、他の接続へフォールバックしない。

読み取りとServer Actionのたびに運営者Google認証を確認し、変更は同一Originを検査する。フォームの運営者IDや権限は受け付けない。ADR 0011と同じく、権限行を共有ロックし、処理の前後にDB時刻で権限期限とログイン期限を確認する。

### 5. 重複・競合

各操作は `requestId`（UUID）と `expectedVersion` を持つ。処理順は「履行行をロック → 同じ運営者・送信番号の既存記録を確認 → version確認 → 判定 → 保存」とする。

- 同じ運営者・送信番号・内容の再送は追加更新せず、保存済みの結果を `replayed: true` で返す。
- 同じ送信番号で内容が異なる場合、古い `expectedVersion` の場合は `CONFLICT`。
- 履行行を `FOR UPDATE`、注文・支払行を `FOR SHARE` でロックし、返金処理との競合を直列化する。主キー・一意制約違反は `CONFLICT` として最後の防御にする。
- 追跡番号の訂正を含むすべての操作で `fulfillments.version` を1増やす。

### 6. 宛先の表示

詳細画面に限り、決済確定時に暗号化保存した配送先（氏名・郵便番号・都道府県・市区町村・住所）を復号して表示する。購入者のメールアドレス・電話番号・ギフトメッセージは表示しない。表示のたびに運営者・履行ID・時刻を `native_fulfillment_accesses` へ保存し、保存できなければ表示しない。一覧には宛先を含めない。運営者の閲覧範囲と保持期間の承認はP0-17の公開条件とする。

### 7. 購入者への表示

本人の注文詳細で、履行と発送記録がちょうど1件ずつある場合に限り、配送会社・追跡番号・発送日・配達日を表示する。複数件・欠落・不整合のときは表示せず、推測しない。受取人やゲスト注文には表示経路を追加しない。通知（メール等）は#125で扱い、この変更ではOutboxイベントを追加しない。

### 8. 監査

`native_fulfillment_changes` に運営者ID・送信番号・操作・前後の状態・前後のversion・コマンドを追加専用で保存する。状態が変わる操作は、既存の `fulfillment_status_transitions` にも `idempotency_key = requestId` で記録する。ログには宛先・追跡番号を出力しない。

## DB契約（migration 0027）

- `native_fulfillment_operators`: `operator_id uuid PK`、`enabled boolean NOT NULL DEFAULT false`、`valid_until timestamptz NOT NULL`、`created_at timestamptz NOT NULL DEFAULT clock_timestamp()`、`CHECK (valid_until > created_at)`。
- `lock_native_fulfillment_operator(actor uuid) RETURNS SETOF native_fulfillment_operators`: `SECURITY DEFINER`、`search_path` 固定、`FOR SHARE`、PUBLICの実行権限なし。
- `native_fulfillment_changes`: `operator_id`、`request_id`（PK）、`fulfillment_id`（FK）、`action`（8操作のCHECK）、`from_status`、`to_status`、`previous_version`、`version`（`= previous_version + 1`）、`command jsonb`、`occurred_at`。`UNIQUE (fulfillment_id, version)`。UPDATE・DELETEをトリガーで拒否。
- `native_fulfillment_accesses`: `id uuid PK`、`operator_id`、`fulfillment_id`（FK）、`occurred_at`。UPDATE・DELETEをトリガーで拒否。
- `fulfillments.status`、`fulfillment_status_transitions.from_status/to_status` のCHECKに `ON_HOLD` を追加。
- `shipments`: `fulfillment_id` の一意制約、`carrier_code` と `tracking_reference` の値域CHECK。既存行があれば影響を記録し、必要なら `NOT VALID` で追加する。
- ロール `bloombox_native_fulfillment`: 一覧・判定・宛先表示に必要な列のSELECT、`fulfillments (status, version, updated_at)` のUPDATE、`shipments` のINSERTと `(carrier_code, tracking_reference, shipped_at, delivered_at, updated_at)` のUPDATE、`fulfillment_status_transitions`・`native_fulfillment_changes`・`native_fulfillment_accesses` のINSERT、ロック用の最小限の `UPDATE (id)`、lock関数のEXECUTE。顧客・連絡先・購入者の顧客列・ギフトメッセージ・Webhook・台帳へのアクセスは付与しない。

## モジュール契約

- Domain（Fulfillment）: `native-fulfillment.ts`（型・定数・エラー）、`decideNativeFulfillment(facts, command)`、`normalizeTrackingNumber(input)`。
- Application（Fulfillment）: `NativeFulfillmentStore`（1トランザクションに束縛）、`ApplyNativeFulfillmentCommand`。
- Infrastructure（Fulfillment）: `PostgresNativeFulfillmentStore(tx, protector)`。
- Shared security: `withNativeFulfillmentOperator(sql, actor, work)`。
- Order: `CustomerOrderDetail.shipment`。発送記録はOrderの読み取り専用クエリで参照し、Fulfillmentのテーブルを変更しない。
- 画面: `/operations/native-fulfillments`、`/operations/native-fulfillments/[fulfillmentId]`。

## 採用しない案

- Shopify発送権限・承認テーブルの流用: 店舗スコープとShopify受付が前提で、自作注文の責任範囲と一致しない。
- 保留を真偽値フラグで表す: 状態機械で表すという方針に反し、取消・発送との組み合わせが曖昧になる。
- 配送会社APIとの自動連携: 配送契約（P0-07）が未確定。初期は権限付きの手動登録とする。
- 取消時の自動返金: 返金方式は#136で決める。発送取消は決済を変更しない。

## 展開

1. 新規注文受付の停止を維持したまま、migration 0027と `database/roles.sql` を適用する。
2. `bloombox_native_fulfillment` だけを付与した専用ログインを作り、`DATABASE_NATIVE_FULFILLMENT_URL` を設定する。
3. 承認済みoperator UUIDの `native_fulfillment_operators` 行を、DB管理者が期限付きで明示登録する。
4. テスト環境で一覧→詳細→準備→発送→配達→マイページ表示、権限の無効化・期限切れ、再送・競合を確認する。

## 復旧

権限行を `enabled=false` にして新規操作を止める。追加テーブル・履歴・発送記録は削除しない。誤登録は新しい操作（訂正・保留・取消）で記録し、履歴を書き換えない。

旧版のアプリへ戻す場合、`ON_HOLD` の履行は旧画面で未知の状態として表示される。戻す前に保留を解除するか、未知の状態として扱うことを確認する。migration 0027は残す。

## 検証

- Domain: 全操作×全状態の遷移、注文・支払ガード、複数箱、追跡番号の正規化と境界値。
- DB: migrationの2回適用、専用ロールの最小権限、再送・内容違い・古いversion・並行実行、権限の無効・期限切れ、アクセス記録の保存失敗時に表示しないこと。
- 画面: 権限なしでnot-found、各エラーの表示、空・処理中の状態、320px・1440px。
- 購入者表示: 本人以外・複数発送・未発送で表示しないこと。
