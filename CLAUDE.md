# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 何のアプリか

デュエル・マスターズの手動対戦シミュレーター（一人回し＋6桁ルームコードのオンライン対戦）。
非公式ファンコンテンツ。公開URL等は `README.md` 参照。日本語UIのプロジェクト。

## 2層アーキテクチャ（ビルドなし）

- **フロント**: バニラJS（バンドラ無し・トランスパイル無し）。GitHub Pages（`main`ブランチ直下）配信。`git push origin main`で反映。
- **API**: Python標準ライブラリのみのプロキシ（`dm-proxy-server.py`、`BaseHTTPRequestHandler`+SQLite。外部依存は実質なし）。Railway配信。`railway up`で反映。
- フロントはAPIベースURLをホスト名で自動判定（ローカル=`http://localhost:8765`、それ以外=Railway）。`?api=`で一時上書き、`?clearApi=1`で解除。

## フロントのレイヤー分離（スクリプト読込順が重要）

`index.html` 末尾で次の順にロードする。**`game-controller.js` は必ず `ui-*.js` より前**（UIはオンライン送信をここに委譲し、`window.GameController` 存在を前提にする）:

```
game-engine.js → auth-service.js → network-service.js → app-state.js → game-controller.js → ui-desktop.js → ui-mobile.js
```

- `game-engine.js` — UI非依存のゲームロジック＋undo履歴。`state` に全ゾーンを保持（battleZone / manaZone / shields / deck / graveyard / hand / hyperZone(超次元) / grZone(GR) / specialZone(禁断等) / revealedZone / deckRevealZone）。
- `game-controller.js` — エンジン操作＋**オンライン同期共有ロジックの正本**（`buildPublicState` / `buildActionPayload` / `sendOnlineAction` / `shouldApplyRemotePayload` 等）。最後に1つのオブジェクトとして公開API群をexportする。
- `app-state.js` — 中央状態ストア（`AppState`）。`network-service.js` — 検索/詳細/イラスト/ルーム/SSE/デッキ/画像プロキシ通信。`auth-service.js` — sessionStorageベースのPIN認証。
- `ui-desktop.js` / `ui-mobile.js` — PC版/SP版UI（画面幅で自動切替）。**PC/SPは別実装**。`buildDesktopPublicState`↔`buildMobilePublicState`、ゾーン操作メニュー、ブレイクモーダル等は対で存在するので、**片方を変えたら他方の同等関数も合わせる**こと。

### 注意点
- UIはインラインの `onclick`/`oncontextmenu` 文字列ハンドラを多用する。関数はグローバル定義。ハンドラから呼ぶ関数名のタイポは実行時まで気づけないので、関数のリネーム時はハンドラ側も確認する。
- ソースに実日本語を含む（Readで `\uXXXX` 表示になることがある）。Editでマッチしない時は Python（`io.open(encoding="utf-8")` + `str.replace`/正規表現）で編集する方が確実。
- 絵文字はUIに使わない方針。

## オンライン対戦のプライバシー規約（重要）

ターン制御はクライアント側、サーバーは状態をリレーするだけ。相手へ送る公開状態は
`game-controller.buildPublicState` が**正本**で、次を厳守する（UI側フォールバックの `build*PublicState` も同仕様に揃える）:

- 手札 / 山札 / **GRゾーン**は**枚数のみ**送る（GRは山札と同じく非公開）。**超次元ゾーンは公開**（カードを送る）。
- ブレイク処理中のシールド（`_breaking` フラグ）は `revealedZone` から除外して送る（相手にカードを見せず「ブレイク中」注釈のみ表示）。

## カードデータ＝公式クロール方式（最重要）

カード名/画像/イラスト違い/効果テキストの正本は**公式カードDB(dm.takaratomy.co.jp)を日本IPで巡回**し `dm_cache.db`(SQLite, 約82MB)へ焼き込む。本番は実行時に公式へアクセスしない（cache-only）。

- スキーマ: `card_index`(検索/詳細の代表行。`rules_text`=効果テキスト含む) / `card_prints`(全印刷=イラスト違い) / `crawl_skip`(公式の空枠) / `text_enriched`(テキスト補完済み記録)。
- 公式idは **case-sensitive**（`...a002F` ≠ `...a002f`）。ツインパクトは上面(クリーチャー)/下面(呪文)が公式詳細ページ本文の別`<td>`に分かれる→両面を取得して結合する。
- 月次更新（ローカル・日本IPで実行）:
  ```bash
  $env:SSL_CERT_FILE = (python -c "import certifi;print(certifi.where())")  # .venvにcert無いため
  python crawl_official.py     # 名前/画像/イラスト違い（増分。初回のみ全件 約1.5h、--forceで全再構築）
  python enrich_text.py        # 効果テキスト補完（未取得分のみ。数分）
  railway up                   # 焼き込んだ dm_cache.db ごとデプロイ
  ```
- 本番env: `OFFICIAL_SEARCH_ENABLED=0` / `CACHE_DB_PATH=/app/dm_cache.db`。
- 手動でDBを触ったら末尾で `PRAGMA wal_checkpoint(TRUNCATE)`（`railway up`は本体DBのみ出荷し`-wal`は送らない）。

### ★デプロイの落とし穴（過去に本番障害あり）

`railway up` は**アップロード対象をgitのファイル列挙で決める**（`.gitignore` も `.git/info/exclude` も尊重する）。
そのため **`dm_cache.db` をgit無視すると本番に出荷されず、空キャッシュ（`card_index`=0、`/detail`が全404、カード詳細/効果/画像が一切出ない）で起動する**。オンライン対戦はDB非依存なので気づきにくい。

→ **`dm_cache.db` は未追跡のまま置く**（`.gitignore` にも `.git/info/exclude` にも入れない）。82MBの誤コミット防止のため**コミットは常に明示パス**で行い、`git add -A` / `git add .` は使わない。`/ping` の `cards` 件数で空出荷を即検知できる（正常=12098）。

## コマンド

```bash
# ローカル開発（依存: Python 3.10+ 標準ライブラリのみ）
python dm-proxy-server.py              # API（http://localhost:8765）
python -m http.server 8000             # フロント → http://localhost:8000/index.html

# テスト（Playwright）
npm test                               # 全テスト
npm run test:search-image              # 単体: 検索画像
npm run test:dm-operation-ui           # 単体: 操作UI
npx playwright test tests/api-status.spec.js   # 任意の1ファイルだけ
npm run prod:check                     # 本番スモーク（/ping・配信HTML確認）

# 構文チェック（CIは無いので手元で）
node --check ui-desktop.js             # JS各ファイル
python -m py_compile dm-proxy-server.py

# デプロイ
git push origin main                   # フロント（GitHub Pages）
railway up                             # API＋焼き込み済み dm_cache.db（Railway）
```

## API エンドポイント（主要）

`/ping`(status+cards件数) / `/search?q=` / `/detail?id=|?name=` / `/illustrations?name=`(バージョン選択) /
`/img?url=`(画像プロキシ) / `/events?room=&p=`(SSE) / `/room/{create,join}` `/action` `/chat` /
`/profile/{create,login,update}` / `/deck/{save,delete,list,names,get,fetch}`（PINをURLに出さないためPOST専用）。
