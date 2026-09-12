# 失敗通知の確認付き再投入

上限まで失敗した通知を、原因の解消後に1件ずつ処理待ちへ戻すオフライン運用ツールです。最初の実行は読取のみのPLAN、表示された内容を確認して同じ入力とplanHashを渡したときだけAPPLIEDになります。外部決済、注文、発送の処理は実行しません。

## 接続と対象の確認

移行0020を先に適用します。再投入の監査記録をruntimeの監査書込み権限から保護し、変更・削除を拒否します。Inbox側にもFAILEDから別状態への変更を所有者に限定するトリガーを追加し、通常のworker権限で直接再投入することを防ぎます。通常の取得・再試行・保持期限の削除は継続できます。いずれかの保護がない、または無効な場合はPLAN/APPLYとも停止します。既存の移行を書き換えず、新規ロール付与も不要です。

`DATABASE_WEBHOOK_ADMIN_URL`にはInboxテーブルとbloomboxスキーマを所有する専用の運用接続を設定します。Webアプリ、worker、担当者、権限管理者、診断用、readonly接続では実行できません。接続変数のフォールバックはなく、既定TLSはverify-full、disableはlocalhost/127.0.0.1の隔離DBに限定します。この資格情報をWebアプリやプレビュー配信に設定しません。

対象の接続先環境・DB名・provider・アカウントを確認します。DB名の一致だけで、同名の別環境や複製DBを区別できるとは限りません。DB所有者は次のようなメタデータだけの照会で内部Inbox UUIDを確認できます。イベント本文や外部注文参照を取り出す必要はありません。

```sql
SELECT id, status, attempts, received_at, payload_expires_at
FROM bloombox.webhook_inbox
WHERE commerce_provider = 'SHOPIFY'
  AND provider_account_id = 'example.myshopify.com' AND status = 'FAILED'
ORDER BY received_at, id LIMIT 20;
```

## PLANからAPPLYへ

Node 24で実行します。公開リポジトリ外の権限を限定したJSONファイルに、次の合成例を実際の対象へ置き換えて保存します。`changeId`は今回の復旧依頼専用のUUIDです。`reviewExpiresAt`は確認時刻から10分以内のUTC時刻とし、例えば`node -p 'new Date(Date.now() + 300000).toISOString()'`で5分後を取得します。

```json
{
  "changeId": "9a380f39-5d51-4cac-a697-9f4b7ad62c31",
  "database": "bloombox_test",
  "inboxId": "51c813ae-399d-482b-9450-f73d5ed64c99",
  "provider": "SHOPIFY",
  "accountId": "example.myshopify.com",
  "reviewExpiresAt": "2026-09-12T00:05:00.000Z",
  "reason": "DEPENDENCY_RECOVERED"
}
```

例の日時は固定の説明用です。実行時に更新します。reasonはKEYS_RESTORED、DEPENDENCY_RECOVERED、PROVIDER_RECONCILEDから、実際に確認した原因解消に合わせて選びます。Stripeの場合はproviderをSTRIPE、accountIdを対象のacct_識別子にします。

```sh
node scripts/retry-provider-webhook.mjs /private/path/retry.json
node scripts/retry-provider-webhook.mjs /private/path/retry.json --apply=<PLANに表示されたplanHash>
```

PLANは現在の状態・過去の試行回数・受信時刻・本文期限と、PENDING/attempts=0/実行時刻から再開する変更案を返します。対象・期限・変更内容を確認し、同じ入力でAPPLYします。任意のplanHashや、確認後に変わった本文・参照・状態は拒否します。内部では暗号文のSHA-256とメタデータを計画に結合しますが、本文を復号せず、本文・暗号文・外部参照・自由文エラーは出力や監査に含めません。

## 保護と結果

再投入できるのは、試行履歴があり、処理済み履歴・処理ロックがなく、本文が残り保存期限内のFAILEDだけです。PENDING/PROCESSING/PROCESSED、本文削除済み、期限切れ、不正な必須メタデータは対象外です。FAILEDに残る次回試行予定時刻は通常取得には使われないため、確認した再投入で実行時刻へ置き換えます。

APPLYは対象行をロックして計画を再検証し、状態・試行回数・再試行日時と監査記録を同一トランザクションで保存します。記録中に確認期限や本文期限を越えた場合も両方を戻します。変更前の試行回数を監査へ残すため、0へのリセットで履歴を失いません。元の通知ID・暗号文・保持期限・最終失敗コードは書き換えません。新しい通知の複製や保持期限の延長もしません。

同じchangeId・入力・planHashの再送はDUPLICATEになります。既にworkerが処理済み、再びFAILED、または本文削除済みになっていても、元の再投入を繰り返しません。別の内容でchangeIdを使い回すとCONFLICTです。通信結果が不明なら新しいUUIDを発行せず、同じ依頼を再送して確認します。DUPLICATEのrequeuedAtは過去の受付時刻で、現在の処理状態を示しません。

終了コード0はPLAN/APPLIED/DUPLICATE、1は拒否または診断不能です。REVIEW_REQUIREDでは原因を確認して新しい計画を作り直します。NOT_AUTHORIZED/WRONG_DATABASE/NOT_FOUNDは接続・対象を、UNAVAILABLEはDB障害や監査保護・ロック競合を確認します。SQLは2秒、ロック待ちは1秒、接続は5秒で打ち切り、固定の安全なエラーだけを返します。

## 運用上の限界と戻し方

再投入の理由は担当者の確認記録であり、鍵の正しさや外部依存の復旧をツールが検証した証拠ではありません。workerの接続設定と原因解消を先に確認します。復旧していなければ既存の最大12回の失敗管理へ戻ります。正当な再投入でも、既に行われた処理の二重実行を防ぐ責任は通常のprocessorの冪等性・正式API照合に残ります。

Shopifyは引き続きcapture-onlyで、自動処理workerは未接続です。このツールを使ってもShopify通知は処理待ちに戻るだけで、販売開始や注文反映を有効にしません。期限切れ・本文欠落の通知は再投入せず、正式APIと保存済み注文の再照合が必要です。自動再投入、Web画面、定期実行は追加していません。

戻す場合はツールの利用を止め、運用資格情報を外します。移行0020と不変の監査記録は保持します。APPLIED後はworkerが処理を始めた可能性があるため、状態・attemptsを直接戻したり通知を削除したりしません。必要ならworkerを停止し、現在の事実を確認して所有モジュールから前進修復します。

## 検証記録

`pnpm check:ci`で通常テスト768件・型・静的検査・ビルドが成功し、隔離PostgreSQLの191件も成功しました。新規の復旧DBテスト27件でPLANの無変更、同時再送、通常workerによる消費、再失敗・本文削除後のDUPLICATE、別依頼の競合、期限・本文変更、実権限による拒否、両DB保護、監査障害・ロック待ち・期限経過の取消、実CLIを確認しました。専用接続設定のテストは12件、依存監査は既知の脆弱性なしです。実環境の資格情報・実決済・本番DBは使用せず、試験DBだけに移行を適用しました。
