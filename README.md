# Redmine Gantt for Obsidian

オンプレの Redmine からチケットを取得し、Obsidian 上にガントチャートとして表示するプラグインです。現バージョンは**表示専用**(Redmine への書き込みは行いません)。将来的にガント上からのチケット更新に対応予定です。

構成の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## 機能(Phase 1 / MVP)

- Redmine REST API からチケットを全件取得(ページング対応、完了チケットの表示切替可)
- 専用ビューでのガントチャート表示
  - 日 / 週 / 月のスケール切替
  - 進捗率(`done_ratio`)による塗り分け、今日の縦線、日スケールでの週末表示
  - 親チケット配下に子チケットをインデント表示
  - チケット名・バークリックでブラウザの Redmine チケットを開く
- 日付のフォールバック
  - 開始日なし・期日あり → 作成日を開始日として推定(破線表示)
  - 開始日あり・期日なし → 1日分のバー(破線表示)
  - 両方なし → チャート下部に「日付未設定」として一覧表示

## 事前準備(Redmine 側)

1. 「管理 → 設定 → API」で **REST APIを有効にする** をオンにする
2. 「個人設定」ページで **APIアクセスキー** を確認する

## インストール(手動)

1. `npm install && npm run build` で `main.js` を生成
2. Vault の `.obsidian/plugins/redmine-gantt/` に `main.js` / `manifest.json` / `styles.css` を配置
3. Obsidian の設定 → コミュニティプラグインで「Redmine Gantt」を有効化

## 設定

| 項目 | 説明 |
|---|---|
| Redmine URL | 例: `https://redmine.example.local` |
| APIキー | 個人設定ページの API アクセスキー |
| プロジェクト | プロジェクト識別子または ID。空欄で閲覧可能な全チケット |
| 完了チケットを含める | 終了ステータスのチケットも表示 |
| 既定のスケール | 日 / 週 / 月 |

> **注意**: API キーは Vault 内の `.obsidian/plugins/redmine-gantt/data.json` に平文で保存されます。Vault を同期サービスに載せている場合はキーも同期されます。

## 使い方

リボンのガントチャートアイコン、またはコマンドパレットの「Redmine Gantt: ガントチャートを開く」でビューを開きます。ツールバーの更新ボタンで再取得、ドロップダウンでスケールを切り替えられます。

## 開発

```bash
npm install
npm run dev    # watch ビルド
npm run build  # 型チェック + 本番ビルド
```
