# Redmine Gantt for Obsidian — 構成設計書

オンプレの Redmine からチケットを取得し、Obsidian 上にガントチャートとして**表示するだけ**(読み取り専用)のプラグイン。Redmine 側の状態更新は行わない。

## 1. 全体構成

中間サーバーは置かず、**Obsidian プラグイン単体で完結**させる。

```
┌────────────────── Obsidian (Electron) ──────────────────┐
│  Redmine Gantt Plugin (TypeScript)                       │
│                                                          │
│   SettingTab ──┐                                         │
│   (URL/APIキー/ │                                         │
│    フィルタ設定) │                                         │
│                ▼                                         │
│   RedmineClient ──► Mapper ──► GanttView / CodeBlock     │
│   (requestUrl)    (Issue→Task)   (SVG レンダリング)        │
│        │                                                 │
│        └──► Cache(前回取得結果、オフライン表示用)             │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS GET のみ(更新系は実装しない)
                        ▼
              オンプレ Redmine REST API
              /issues.json  /projects.json  /versions.json
```

### 設計上の判断とその理由

| 論点 | 採用 | 理由 |
|---|---|---|
| 通信方法 | Obsidian の `requestUrl` API | Electron のメインプロセス経由で通信するため **CORS 制約を受けない**。オンプレ Redmine に CORS 設定を入れる必要がなくなる。`fetch` は CORS で失敗するため使わない |
| 認証 | 個人 API キー(`X-Redmine-API-Key` ヘッダー) | Redmine 標準の認証方式。ユーザーの権限で見えるチケットだけが取得され、権限管理を Redmine 側に委ねられる |
| ガント描画 | **自前 SVG レンダリング** | 読み取り専用ならドラッグ編集等は不要で、描画は単純な矩形+時間軸。外部ライブラリ(frappe-gantt 等)を束ねるよりバンドルが軽く、Obsidian の CSS 変数でライト/ダークテーマに追従できる |
| 中間サーバー | 置かない | 取得+整形+描画だけならプラグイン内で完結する。運用対象が増えるだけでメリットがない |
| 書き込み | 現フェーズでは実装しない(将来対応予定) | クライアント内部では HTTP メソッドを抽象化しておき、公開 API は読み取り(GET)のみとする。将来のチケット更新(Phase 4)ではこの抽象の上に PUT を追加するだけで済む |

### 代替案(不採用)

- **Mermaid gantt へ変換してコードブロック出力**: Obsidian 標準機能だけで描けるが、チケット数が多いと崩れやすく、スケール切替・ツールチップ・クリックでチケットを開く等の制御ができないため不採用。ただし実装コストは最小なのでプロトタイプ用途には有効。
- **frappe-gantt 等のライブラリ同梱**: 編集(ドラッグ)機能が主眼のライブラリであり、読み取り専用要件には過剰。テーマ追従も自前で上書きが必要になる。

## 2. ディレクトリ構成

```
obsidian-redmine-tool/
├── manifest.json          # Obsidian プラグインマニフェスト
├── package.json
├── tsconfig.json
├── esbuild.config.mjs     # main.ts → main.js へバンドル
├── styles.css             # ガントの見た目(Obsidian CSS変数を使用)
└── src/
    ├── main.ts            # Plugin本体: ビュー登録・コマンド・リボン・設定ロード
    ├── settings.ts        # SettingTab(接続先URL, APIキー, 既定フィルタ, 自動更新間隔)
    ├── redmine/
    │   ├── types.ts       # Redmine APIレスポンスの型 (Issue, Project, Version, ...)
    │   ├── client.ts      # requestUrl ベースのREST クライアント(GETのみ・ページネーション対応)
    │   └── mapper.ts      # Issue → GanttTask 変換(日付フォールバック・親子ツリー化)
    ├── gantt/
    │   ├── GanttView.ts   # ItemView 派生の専用ビュー(ツールバー: 更新/スケール切替/フィルタ)
    │   ├── renderer.ts    # SVG描画(時間軸・バー・進捗・今日線・マイルストーン)
    │   └── scale.ts       # 日/週/月スケールの座標計算
    ├── codeblock.ts       # ```redmine-gantt``` コードブロックプロセッサ(ノート埋め込み用)
    └── cache.ts           # 最終取得結果の保存(オフライン時・起動直後の表示用)
```

## 3. データフロー

1. **設定** — Redmine URL・API キー・既定プロジェクト等を SettingTab で入力。`saveData()` で保存。
2. **取得** — `RedmineClient` が `GET /issues.json?project_id=...&status_id=*&limit=100&offset=...` を `total_count` に達するまでページング取得。保存済みクエリ(`query_id`)にも対応。
3. **変換** — `mapper.ts` で `GanttTask` に変換:
   - `start_date` / `due_date` / `done_ratio`(進捗)/ `assigned_to` / `status` を使用
   - `parent.id` で親子ツリーを構築(親チケット配下にインデント表示)
   - `fixed_version` はマイルストーン(◆)として時間軸上に表示
   - **日付欠損時のフォールバック**: `start_date` なし→ `created_on` の日付、`due_date` なし→ 開始日のみの点表示(またはバー1日分)。両方なしのチケットは一覧下部に「日付未設定」として別掲
4. **描画** — `renderer.ts` が SVG を生成。左ペインにチケット一覧(題名・担当・ステータス)、右ペインに時間軸+バー。バーは `done_ratio` で進捗塗り分け、今日の縦線を表示。バークリックで Redmine のチケット URL をブラウザで開く(表示のみ、編集はブラウザ側で)。
5. **更新** — 手動更新ボタン+設定した間隔での自動再取得(任意)。取得失敗時は `cache.ts` の前回結果を表示し、ヘッダーに「最終更新: xx:xx(オフライン)」と明示。

## 4. Redmine API の利用(すべて GET)

| エンドポイント | 用途 | 主なパラメータ |
|---|---|---|
| `/issues.json` | チケット取得 | `query_id`(保存クエリ), `parent_id`(親チケット配下の再帰探索), `status_id`, `limit`/`offset` |
| `/issues/:id.json` | 親チケット配下フィルタのルートチケット取得 | — |
| `/projects.json` | 設定画面のプロジェクト選択肢 | `limit`/`offset` |
| `/projects/:id/versions.json` | マイルストーン表示 | — |

**Redmine 側の前提**: 「管理 → 設定 → API」で **REST API を有効化** しておくこと。ユーザーごとの API キーは「個人設定」ページで確認できる。

## 5. 表示 UI(2系統)

1. **専用ビュー(`GanttView`)** — リボンアイコン/コマンドパレットから開く。メインペインに大きく表示。ツールバーで日/週/月スケール切替、プロジェクト・担当者・ステータスの絞り込み、再取得。
2. **コードブロック埋め込み** — ノート内に書いてプロジェクトノートへガントを埋め込む:

   ````markdown
   ```redmine-gantt
   project: my-project
   status: open
   assignee: me
   scale: week
   ```
   ````

## 6. セキュリティ / 制約事項

- **API キーの保存**: プラグイン設定は Vault 内の `data.json` に平文保存される。Vault を同期サービスに載せる場合はキーが同期される点を設定画面で注意書きする(読み取り専用キー相当の権限ユーザーで発行するのが安全)。
- **自己署名証明書**: オンプレで自己署名 HTTPS の場合、Electron が証明書エラーを返すことがある。エラーメッセージで原因(証明書)を明示する。証明書検証の無効化オプションは設けない。
- **書き込みの扱い**: 現フェーズの `client.ts` は読み取り用メソッドのみ公開する。将来の更新対応(Phase 4)に備え、内部のリクエスト処理は HTTP メソッドを引数に取る共通実装とし、更新系はその上に追加する。
- **大量チケット**: 1,000 件超を想定し、取得はページング・描画は表示範囲の仮想化(行の遅延描画)を Phase 3 で検討。

## 7. 実装フェーズ

| Phase | 内容 |
|---|---|
| **1 (MVP)** | 設定画面 / RedmineClient(ページング)/ 専用ビュー / SVG ガント(週スケール・進捗・今日線)/ 手動更新 |
| **2** | 日/月スケール切替、親子ツリー表示、マイルストーン、バークリックでチケットを開く、コードブロック埋め込み |
| **2.5(実装済み)** | 表示フィルタの切り替え: 親チケット配下(`parent_id` で再帰探索) / 保存クエリ(`query_id`)を設定に複数登録し、ビューのツールバーで切り替え。負荷対策としてプロジェクト全体の一括取得は廃止し、フィルタ指定を必須とした |
| **2.6(実装済み)** | 表示モード切替(ガント / チケット一覧テーブル)。全体予定: Redmineとは独立した予定(名前・期間・状態)を data.json で管理し、ガント最上段に状態別の色で表示。編集はビューのモーダルから |
| **3** | 自動更新、キャッシュ(オフライン表示)、担当者/ステータスのフィルタ UI、行仮想化 |
| **4** | **チケット更新対応**: ガント上での期日変更(バーのドラッグ/リサイズ)・進捗率変更を `PUT /issues/:id.json` で Redmine へ反映。楽観ロック(取得時の `updated_on` 比較)と更新確認ダイアログを設ける |

## 8. 技術スタック

- TypeScript + Obsidian Plugin API(`obsidian` パッケージ)
- esbuild でバンドル(Obsidian 公式サンプルプラグインと同構成)
- 外部ランタイム依存: なし(ガントは自前 SVG)
- 対応: Obsidian デスクトップ版。モバイルは `requestUrl` が使えるため原理上動作するが、オンプレ到達性(VPN 等)に依存
