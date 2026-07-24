# ヘルスチェック（日次外形監視）

Production LIFF バックエンド（Railway）の死活監視の仕組みと設定方法。

## 背景

2026-03-04 から約 4.5 ヶ月間、Production バックエンドがデプロイ切断状態だったことが「8月シフト提出0件」という間接指標でしか検知できなかった（Issue #15 / #16）。再発時に 24 時間以内に検知するため、GitHub Actions による日次外形監視を導入した。

## 導入手順（workflow ファイルの配置）

> **注意**: claude-code-action の GitHub App トークンには `workflows` 権限がないため、workflow ファイル本体はこの PR に含められない。テンプレートを [`docs/templates/health-check.yml`](templates/health-check.yml) に配置しているので、`workflow` スコープを持つトークン（GH_ADMIN_PAT または開発者自身のアカウント）で以下を実行して配置する:

```bash
git mv docs/templates/health-check.yml .github/workflows/health-check.yml
git commit -m "feat(ci): place health check workflow"
git push
```

## 仕組み

- **Workflow**: `.github/workflows/health-check.yml`（配置後）
- **スケジュール**: 毎日 JST 09:00（UTC 00:00、cron `0 0 * * *`）。`workflow_dispatch` で手動実行も可能。
- **監視対象**: `GET /`（Production バックエンドのヘルスチェックエンドポイント）
  - 注意: `/api/health` は存在しない。`GET /` が `{ "status": "ok", ... }` を返す実装（`backend/src/index.js`）。
- **正常判定**: HTTP 200 かつレスポンスボディに `"status":"ok"` を含む
- **誤検知抑制**: 3回リトライ（10秒間隔・各30秒タイムアウト）。3回すべて失敗した場合のみ「異常」と判定。
- **異常時**: Slack Incoming Webhook へ通知し、job を失敗（赤）にする
- **正常時**: 通知なし（Actions ログのみ）

## GitHub Secrets 設定

リポジトリの Settings → Secrets and variables → Actions で設定する。

| Secret 名           | 必須 | 用途                                                                                                                 |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `SLACK_WEBHOOK_URL` | 必須 | 異常時の通知先 Slack Incoming Webhook（既存の月次バッチ通知と共用可）                                                |
| `LIFF_BACKEND_URL`  | 任意 | Production バックエンド URL。未設定時は `https://shift-scheduler-ai-liff-production.up.railway.app` にフォールバック |
| `RAILWAY_LOG_URL`   | 任意 | 通知に載せる Railway ログ画面へのリンク。未設定なら通知から省略                                                      |

## Slack 通知フォーマット

```
:rotating_light: LIFF バックエンド ヘルスチェック失敗
• 検知日時: 2026-07-24 09:00 JST
• エンドポイント: https://shift-scheduler-ai-liff-production.up.railway.app/
• HTTP ステータス: 502 （または "timeout / connection failed"）
• 判定: 3回連続で 200/ok を得られず
• Railway ログ: <RAILWAY_LOG_URL があれば表示>
• Actions Run: <run URL>
```

## 検証方法

- **正常系**: Actions タブから `Health Check` workflow を `workflow_dispatch` で手動実行 → 通知なし・job 成功（緑）
- **異常系**: `LIFF_BACKEND_URL` を一時的に到達不能 URL（例 `https://example.invalid`）に設定して手動実行 → Slack 通知が届き job 失敗（赤）。確認後 secret を削除または元に戻す
- **フォールバック**: `LIFF_BACKEND_URL` 未設定でも既知 URL で正常判定されること

## 障害検知時の対応手順

1. Slack 通知の Actions Run リンクからログを確認（HTTP ステータス・失敗理由）
2. Railway ダッシュボードでサービスの状態・デプロイログを確認
   - リポジトリのリンク切断・デプロイ失敗・環境変数不正が過去の障害原因（Issue #15）
3. 復旧後、`workflow_dispatch` で手動実行して正常（緑）を確認

## 既知の限界

- **DB 障害は検知不可**: `GET /` はプロセス生存のみ確認し、DB 接続は検証しない。shift-scheduler-ai#22（health エンドポイント修正）完了後に `/api/health` へ切替予定。
- **デプロイ陳腐化は検知不可**: 旧デプロイが 200 を返し続けるケースは外形監視では検知できない。health レスポンスに build SHA/version を含める案は別 Issue 候補。
- **cron 遅延**: GitHub Actions の schedule は数分〜数十分遅延しうるが、要件（24時間以内検知）は満たす。
