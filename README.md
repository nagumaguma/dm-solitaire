# DM マルチプレイ一人回し

> 非公式のファンコンテンツです。ウィザーズ社の認可・許諾は得ていません。題材の一部にウィザーズ・オブ・ザ・コースト社の財産を含みます。©Wizards of the Coast LLC.

デュエル・マスターズのデッキを試して、友達とオンライン対戦できる手動シミュレーターです。

- **一人回し** — デッキのテスト環境（シールド5枚＋初期手札5枚で開始）
- **オンライン対戦** — 6桁ルームコードでリアルタイム対戦（SSE）
- **カード検索** — 公式カードDB由来の画像つき。同名カードは**イラスト違いをバージョン選択**可能
- **アカウント** — デッキをクラウド保存（PIN認証、複数端末で同期）

## 公開URL

- アプリ（フロント）: https://nagumaguma.github.io/dm-solitaire/
- API（バックエンド）: https://dm-solitaire-production.up.railway.app/ping

推奨ブラウザ: Chrome / Edge / Safari 最新版。PC/SPは画面幅で自動切替。

## 構成

静的フロントエンド（バニラJS・ビルドなし）と、Python標準ライブラリのみのプロキシサーバーの2層。

| 層 | 配信先 | 反映方法 |
|---|---|---|
| フロント（HTML/JS/CSS） | GitHub Pages（`main` ブランチ直下） | `git push origin main` |
| API（検索・認証・デッキ・対戦・画像） | Railway | `railway up` |

フロントは API ベースURLをホスト名で自動判定（ローカルは `http://localhost:8765`、それ以外は Railway）。`?api=` で一時上書き、`?clearApi=1` で解除。

## ファイル構成

```
index.html          単一エントリ。認証画面＋PC/SP振り分け＋共有モーダル（大半がCSS）
game-engine.js      GameEngine：UI非依存のゲームロジック・undo履歴
auth-service.js     AuthService：sessionStorageベース認証
network-service.js  NetworkService：検索/詳細/ルーム/SSE/デッキ通信
app-state.js        AppState：中央状態ストア
game-controller.js  GameController：エンジン操作＋オンライン同期の共有ロジック
ui-desktop.js       PC版UI（デッキ編集・対局・オンライン）
ui-mobile.js        SP版UI（同上のモバイル版）
dm-proxy-server.py  バックエンド（BaseHTTPRequestHandler / SQLite）
crawl_official.py   公式カードDBクロール（カード名・画像・イラスト違いを取得）
enrich_text.py      公式詳細ページからカード効果テキストを補完（ツインパクトの上下面対応）
recover_missing.py  取りこぼし印刷の回収
_archive/           旧版HTML（参照用）
```

`dm_cache.db`（カードキャッシュ）と `dm_user.db`（プロフィール/デッキ/画像）はローカル生成のデータで、Gitには含めません。

## カードデータの仕組み

カード名・画像・イラスト違いの正本は **公式カードDB（dm.takaratomy.co.jp）** を巡回して得ます。

- 公式サイトは Railway（国外IP）から地理ブロックされるため、**日本国内のローカル環境で先に全カードを `dm_cache.db` へ焼き込み**、本番は実行時に公式へアクセスしない（cache-only）方式です。
- これにより、間違ったカード画像を出さず、冠詞付きカード（例「蒼き団長 ドギラゴン剣」）も正しく解決できます。
- 同名カードは全印刷（イラスト違い）を保持し、カード詳細でバージョンを選べます。

### カードデータの月次更新

新カードが出たら、ローカル（日本IP）で増分クロール → デプロイするだけです。

```bash
# Windows の場合、HTTPS検証用にCAバンドルを指定
$env:SSL_CERT_FILE = (python -c "import certifi; print(certifi.where())")

python crawl_official.py     # 増分（初回のみ全件、約1.5時間）。--force で全再構築
python enrich_text.py        # 効果テキストを未取得分だけ補完（増分は数分）
railway up                   # 焼き込んだ dm_cache.db ごとデプロイ
```

`crawl_official.py` は公式の全印刷を列挙し、未取得分だけ取得します。公式側が中身を持たない空枠は `crawl_skip` テーブルで自動スキップします。取りこぼしが出た場合は `recover_missing.py` で回収できます。

`enrich_text.py` はクロールが拾わない**カード効果テキスト**を公式詳細ページから補完します（`card_index.rules_text`）。ツインパクトは上面（クリーチャー側）と下面（呪文側）が詳細ページ本文に分かれているため、両面のテキストを取得して結合します。処理済みカードは `text_enriched` テーブルで記録し、再実行時は新規分のみ取得します（バニラ＝効果なしのカードは空のまま）。

## ローカル開発

依存は Python 3.10+（標準ライブラリのみ）。

```bash
git clone https://github.com/nagumaguma/dm-solitaire.git
cd dm-solitaire

# 1. バックエンド起動（http://localhost:8765）
python dm-proxy-server.py

# 2. フロントを開く（別ターミナル）
python -m http.server 8000
# → http://localhost:8000/index.html
```

`dm_cache.db` はGit管理外なので、初回はカード検索結果が空になることがあります。ローカルで検索画像を出すには上記の `crawl_official.py` を一度実行してください。

## デプロイ

### フロント（GitHub Pages）

`main` ブランチへ push すると、Pages が自動で反映します。

```bash
git push origin main
```

### バックエンド（Railway）

```bash
railway up        # ローカル作業ツリーをそのままビルド&デプロイ
```

- ビルドは `nixpacks.toml`（`providers = ["python"]`）で Python を強制。`package.json`（テスト用）による Node 誤検出を防ぎます。
- `.railwayignore` で `.venv` / テスト / `dm_user.db` 等を除外します。
- 確認: `curl https://…/ping`（`status: ok`）、`railway logs`。

### 環境変数（Railway）

| 変数 | 値 | 説明 |
|---|---|---|
| `OFFICIAL_SEARCH_ENABLED` | `0` | 本番では公式サイトを呼ばない（地理ブロック回避、cache-only） |
| `CACHE_DB_PATH` | `/app/dm_cache.db` | 出荷した焼き込み済みキャッシュを使用 |
| `BASE_URL` | 公開URL | `/img` プロキシのURL生成に使用（未設定でも自動推定） |
| `PORT` | 自動 | 待ち受けポート |

## API エンドポイント

| 方法 | パス | 説明 |
|---|---|---|
| GET | `/ping` | ステータス |
| GET | `/search?q=` | カード検索（画像つき） |
| GET | `/detail?id=` / `?name=` | カード詳細 |
| GET | `/illustrations?name=` | イラスト違い一覧（バージョン選択） |
| GET | `/img?url=` | 画像プロキシ（CORS回避＋キャッシュ） |
| GET | `/events?room=&p=` | 対戦イベント（SSE） |
| POST | `/room/create` `/room/join` `/action` `/chat` | オンライン対戦 |
| POST | `/profile/{create,login,update}` | アカウント |
| POST | `/deck/{save,delete,list,names,get,fetch}` | デッキ（PINをURLに出さないため POST専用） |

オンライン対戦では相手のカード名は送信せず、枚数・伏せ札のみ同期します。ターン制御はクライアント側、サーバーは状態をリレーします。

## ライセンス

MIT License（コード部分）。カード画像・名称等の権利は各権利者に帰属します。
