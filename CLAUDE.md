# CLAUDE.md — shift-scheduler-ai-liff

## リポジトリの目的・スコープ

`shift-scheduler-ai-liff` は MNML のシフト管理システムの LIFF フロントエンドおよびリマインダーバックエンドを管理するリポジトリです。

- **LIFF アプリ** (`index.html`): LINE 上で動作するシフト希望入力 UI。スタッフ登録・シフト希望入力（アルバイト）・休み希望入力（社員）を提供。Vercel にデプロイ。
- **リマインダーサービス** (`backend/`): シフト未提出者を検出して LINE プッシュ通知を送る Node.js + Express + node-cron サービス。Railway にデプロイ。

スコープ外: シフト確定ロジック・バックエンド API (`shift-scheduler-ai` リポジトリが担当)。

## MNML 組織構造との関係

| 区分                         | 担当             |
| ---------------------------- | ---------------- |
| **技術オーナー**             | **thebotch** M層 |
| **ビジネスステークホルダー** | **shift** M層    |

コードレビュー・デプロイ判断は thebotch が行い、シフト運用要件の定義は shift M層 が行います。

## claude-code-action 運用ルール

### トリガー

- GitHub Issue 本文または最初のコメントに `@claude` を含めると claude-code-action が起動します。
- Issue の内容に従い、Claude が `claude/issue-<issue番号>-<YYYYMMDD>-<HHMM>` ブランチを作成して PR を提出します。

### マージ

- `auto-merge` ラベルが付いた PR は CI 通過後に自動マージされます。
- レビューが必要な場合は `auto-merge` ラベルを付けず、thebotch / shift M層 がレビューします。

### PR タイトル・コミットメッセージ

- **英語で記述** してください (日本語不可)。
- Conventional Commits 形式を推奨: `feat:`, `fix:`, `docs:`, `chore:` 等。

### CI チェック

- PR 作成前に必ず以下を通してください:
  ```bash
  npm run lint          # ESLint (root)
  npm run format:check  # Prettier
  ```
- CI (`lint-and-format.yml`) が自動実行されます。lint/format エラーがある場合は修正してから push してください。

## Issue / PR テンプレートへの期待

Issue および PR の本文には以下のセクションを含めてください:

```markdown
## 経緯

（背景・なぜこの変更が必要か）

## 要件

（何を実装・修正するか）

## 受け入れ条件

- [ ] 条件1
- [ ] 条件2
```

## コーディング規約

### 共通

- **インデント**: 2スペース（Prettier 設定に準拠）
- **クォート**: シングルクォート (`'`) を使用（ESLint ルール）
- **セミコロン**: 必須（ESLint ルール）
- **モジュール**: ESM (`import`/`export`) を使用。`require()` は使わない。

### フロントエンド (`index.html`)

- Vanilla JS (フレームワーク不使用)。新たな npm パッケージを LIFF フロントに追加しない。
- LIFF SDK は CDN 経由で読み込む。
- `liff` グローバル変数は ESLint で `readonly` として定義済み。未定義エラーは出ない。

### バックエンド (`backend/`)

- Node.js ESM (`"type": "module"`)。
- 環境変数は `dotenv` 経由で読み込む。ハードコード禁止。
- 非同期処理は `async/await` を使用。コールバックは使わない。

### リント・フォーマット

```bash
# 全ファイルチェック
npm run lint            # ESLint
npm run format:check    # Prettier

# 変更ファイルのみ（高速）
npm run lint:changed
npm run format:changed

# 自動修正
npm run lint:fix
npm run format
```

Husky + lint-staged により、コミット前に変更ファイルへ自動でリント・フォーマットが走ります。

## 機密ファイル禁止

以下のファイルは**絶対にコミットしない**こと:

- `.env` / `.env.*` (`.env.example` は除く)
- `**/credentials*.json`
- `.tokens*.json`
- LINE Channel Access Token、DATABASE_URL 等の秘匿情報を含むすべてのファイル

`.gitignore` に `backend/.env` が設定済みですが、ルートや他ディレクトリの `.env` にも注意してください。

## ブランチ・マージルール

| ルール                 | 内容                                                  |
| ---------------------- | ----------------------------------------------------- |
| **デフォルトブランチ** | `main`                                                |
| **main 直 push 禁止**  | PR 経由のみ                                           |
| **Claude ブランチ名**  | `claude/issue-<num>-<YYYYMMDD>-<HHMM>`                |
| **新規ブランチの起点** | 特別な指示がない限り `staging` ブランチから切り出す   |
| **自動デプロイ**       | `main` への merge で Vercel (frontend) が自動デプロイ |

```bash
# 手動でブランチを切る場合
git checkout staging
git pull origin staging
git checkout -b feature/my-feature
```

## デプロイ先

| サービス                  | プラットフォーム | 対象                 | URL                                                       |
| ------------------------- | ---------------- | -------------------- | --------------------------------------------------------- |
| LIFF フロントエンド       | Vercel           | `index.html`         | https://shift-scheduler-ai-liff.vercel.app                |
| リマインダーサービス      | Railway          | `backend/`           | https://shift-scheduler-ai-liff-production.up.railway.app |
| バックエンド API (別リポ) | Railway          | `shift-scheduler-ai` | https://shift-scheduler-ai-production.up.railway.app      |

## 関連リポジトリ・ドキュメント

- `info-mnml/shift-scheduler-ai` — バックエンド API (別リポジトリ)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — システム構成図
- [`docs/LIFF_FEATURES.md`](docs/LIFF_FEATURES.md) — LIFF 機能仕様
- [`docs/REMINDER_SYSTEM.md`](docs/REMINDER_SYSTEM.md) — リマインダーシステム仕様
