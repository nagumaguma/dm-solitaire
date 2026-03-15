# DM マルチプレイ一人回し

> DM マルチプレイ一人回しツール はファンコンテンツ・ポリシーに沿った非公式のファンコンテンツです。ウィザーズ社の認可/許諾は得ていません。題材の一部に、ウィザーズ・オブ・ザ・コースト社の財産を含んでいます。©Wizards of the Coast LLC.

---

**デュエルマスターズのデッキを試して、友達とオンライン対戦できるツール**

- **一人回し** - デッキテスト環境
- **マルチプレイ** - リアルタイムオンライン対戦（６文字ルームコード）
- **アカウント** - デッキをクラウド保存、複数デバイス間で同期
- **セキュア** - PIN による暗号化認証、rate limiting

---

## クイックスタート（おすすめ）

ブラウザでアクセス - インストール不要

**PC版:**
https://example.com/dm-solitaire-web.html

**スマホ版:**
https://example.com/dm-solitaire-sp.html

推奨: Chrome / Edge / Safari 最新版

---

## 使い方

### 1. デッキを作る

```
デッキ管理 → 新規作成 → カード検索・追加 → 40枚完成
```

- カード名で検索（例：「ボルメテウス」）
- 枚数を指定して追加
- デッキ名を付けて保存

### 2. 一人回しモード

```
デッキ選択 → ゲーム開始 → 相手を自動生成してプレイ
```

シールド5枚 + 初期手札5枚でゲーム開始

### 3. マルチプレイ（友達と対戦）

**相手をホストする側:**
```
オンライン → 新規ルーム → ルームコード表示 → 友達に伝える
```

**友達が参加する側:**
```
オンライン → ルームに参加 → コード入力 → 対戦開始
```

操作は自分のシールド・ハンドを右クリック、相手のアクションはリアルタイム表示

### 4. アカウント作成（デッキクラウド保存）

```
ログイン → 新規登録 → ユーザー名 + 4桁PIN
```

その後：

- **デッキ保存**: クラウドボタンでデッキをクラウドに保存
- **同期**: 別PCでログイン → デッキを自動利用可能
- **セキュア**: PIN は暗号化（誰も平文で見えない）

---

## 基本操作

| 操作 | 効果 |
|---|---|
| **左クリック** | カードをタップ / アンタップ |
| **右クリック** | カードメニュー（移動・破壊など） |
| **ボタン群** | ドロー・ターン終了・チャット |
| **相手操作** | アニメーション + ログで表示 |

**マルチプレイ時:**
- 相手のアクション → 画面上にリアルタイム表示
- 接続が切れた → 自動再接続 (3回まで)
- 通信タイムアウト → 10秒待機 → キャンセル可能

---

## デバイス別

| デバイス | ファイル | 特徴 |
|---|---|---|
| **PC** | `dm-solitaire-web.html` | キーボード対応、`prompt()` ダイアログ |
| **スマホ** | `dm-solitaire-sp.html` | タッチ最適化、モーダル UI |

両方同じアカウントで利用可能（デッキ自動同期）

---

## 💾 デッキ管理

### ローカル保存（デフォルト）

- デッキデータはブラウザに自動保存
- 同じブラウザなら永続化
- 別ブラウザ/PC には見えない

### クラウド保存（おすすめ）

```
ログイン → デッキ選択 → ☁️ 画面で保存 → 別PCでログイン → デッキ自動表示
```

**利点:**
- 複数デバイス間で同期
- ブラウザキャッシュ削除しても消えない (サーバー保存)
- デッキ名で管理

**セキュリティ:**
- PIN は PBKDF2-SHA256 で 100,000 回ハッシュ化
- サーバーには PIN は保存されない（ハッシュのみ）
- sessionStorage 使用（ブラウザ閉じたら自動ログアウト）

### バックアップ（クラシック方法）

```
デッキ管理 → 書き出し(JSON) → PCに保存
```

復元時：
```
デッキ管理 → 読み込み → 保存したJSONを選択
```

---

## 🌐 マルチプレイ詳細

### ルームシステム

- 6文字ランダムコード生成
- TTL: 10分（誰も接続してなければ自動削除）
- 最大2人（P1/P2）
- リアルタイムSSE通信

### 接続フロー

```
P1: ルーム作成 → コード発行 → イベント待機
P2: コード入力 → POST /room/join → P1に通知
P1: P2参加を受け取り → ゲーム開始
```

### 操作同期

各ターン:
1. P1 が操作 → `POST /room/action` 送信
2. P2 が `GET /events` で受け取り
3. 画面にアニメーション表示
4. ターン終了 → P2 ターン

**ネットワークエラー時:**
- 最大3回自動再接続（指数バックオフ）
- 接続失敗 → ロビーに戻る

### レート制限

不正アクセス防止:
- **15リクエスト/5分/IP**
- 超過時 → 429 Too Many Requests

---

## ローカル実行

ダウンロードして自分のサーバーで運用する場合：

### 依存関係

```
python 3.8+
sqlite3 (Python 同梱)
```

### セットアップ

```bash
# リポジトリクローン
git clone https://github.com/[USER]/dm-solitaire.git
cd dm-solitaire

# Python サーバー起動
python dm-proxy-server.py
```

サーバー起動メッセージ:
```
[db] integrity check: OK
[db] Loaded X profiles, Y decks
[DM Proxy] Starting on http://localhost:8765
```

### ブラウザアクセス

```
file:///path/to/dm-solitaire-web.html
```

**URL の `PROXY` をローカルに指す場合:**

HTML 内の設定行を編集:
```javascript
const PROXY = 'http://localhost:8765';  // デフォルト
```

### PORT 変更

```bash
PORT=9999 python dm-proxy-server.py
```

---

## 🛡️ セキュリティ機能

| 機能 | 説明 |
|---|---|
| PIN 暗号化 | PBKDF2-SHA256 + 16 byte salt (100k iterations) |
| Rate Limiting | 15 req/5min/IP (ブルートフォース防止) |
| sessionStorage | ブラウザ終了で自動ログアウト (localStorage 使わない) |
| CORS | Cross-Origin リクエスト許可 (API 開放) |
| DB 整合性チェック | サーバー起動時に PRAGMA integrity_check 実行 |
| JSON エラー回複 | 破損デッキをスキップ、ログに記録 |

---

## 📊 データベーススキーマ

SQLite (`dm_cache.db`):

```sql
-- カード情報キャッシュ
CREATE TABLE card_cache (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  cached_at REAL NOT NULL
);

-- ユーザープロフィール
CREATE TABLE profiles (
  username TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,        -- PBKDF2-SHA256
  pin_salt TEXT NOT NULL,        -- 16 byte hex
  last_deck TEXT                 -- 最後に使ったデッキ名
);

-- ユーザーのデッキ
CREATE TABLE decks (
  username TEXT NOT NULL,
  deck_name TEXT NOT NULL,
  deck_data TEXT NOT NULL,       -- JSON
  PRIMARY KEY (username, deck_name)
);
```

---

## API エンドポイント

### 認証

| 方法 | エンドポイント | 説明 |
|---|---|---|
| POST | `/profile/create` | アカウント作成（username, pin） |
| POST | `/profile/login` | ログイン（入力 PIN → ハッシュ化 → DB で検証） |
| POST | `/profile/update` | last_deck 更新 |

### デッキ

| 方法 | エンドポイント | 説明 |
|---|---|---|
| POST | `/deck/save` | デッキ保存（username, pin, deck_name, deck_data） |
| GET | `/deck/list` | ユーザーのデッキ一覧 |
| GET | `/deck/get` | 特定デッキ取得 |
| POST | `/deck/delete` | デッキ削除 |

### ルーム

| 方法 | エンドポイント | 説明 |
|---|---|---|
| POST | `/room/create` | ルーム作成 → 6 文字コード返却 |
| POST | `/room/join` | ルーム参加 |
| POST | `/room/action` | ターンアクション送信 |
| GET | `/events` | イベントストリーム（SSE） |

### 診断

| 方法 | エンドポイント | 説明 |
|---|---|---|
| GET | `/ping` | サーバーステータス |
| GET | `/test/rate-limit-status` | Rate limit 状態確認（開発用） |

---

## 🐛 キャッシュ無効化

最新版に更新後、キャッシュが古いままの場合：

**ブラウザ:**
- `Ctrl+Shift+Delete` または `Cmd+Shift+Delete` でキャッシュ削除
- 該当ドメインのキャッシュを「すべて削除」

**対象ファイル:**
- `dm-solitaire-web.html`
- `dm-solitaire-sp.html`

---

## 💬 チャット機能

マルチプレイ中に相手と会話:

```
画面下部のチャット入力 → メッセージ送信 → リアルタイム表示
```

- 最大 100 件履歴保持
- サーバーに保存されない（その時のルームのみ）

---

## 📝 操作ログ

ゲーム中の全操作を記録:

```
- カード移動
- ターン情報
- ドロー
- マナ供給
```

ゲーム終了で自動クリア

---

## ✅ タイムアウト設定

| 操作 | タイムアウト | 説明 |
|---|---|---|
| サーバーデッキ取得 | 10秒 | `/deck/get` |
| ルーム作成/参加 | 10秒 | `/room/create`, `/room/join` |
| イベントストリーム | 20秒 | SSE キープアライブ |

---

## 🌍 環境変数

```bash
# ポート変更
PORT=8765

# ベースURL（デプロイ時）
BASE_URL=https://example.com
```

---

## 📋 トラブルシューティング

| 問題 | 原因 | 解決 |
|---|---|---|
| デッキが保存されない | sessionStorage 無効/private mode | プライベートモードを解除 |
| サーバーが起動しない | ポート占有 | netstat -ano \| findstr 8765 で確認、別ポートで起動 |
| マルチプレイが接続できない | ファイアウォール/プロキシ | 8765 ポートをホワイトリスト化 |
| 相手に操作が見えない | SSE 接続切断 | 自動再接続 3 回実行、その後ロビーへ |
| ログインできない | PIN 誤り/rate limit | 15 分待って再度試行 |

---

## 🎨 UIガイド

### PC 版（web.html）

- メニュー: 画面上部タブ形式
- デッキ: テキスト入力（`deck-name` input）
- ルーム: `prompt()` ダイアログで入力

### スマホ版（sp.html）

- メニュー: モーダルタップで展開
- デッキ: `<select>` ドロップダウン
- ルーム: モーダルフォーム

---

## 開発リソース

### コード構成

```
dm-solitaire-sp.html     (2300+ 行)  - スマホ版フロント + ロジック
dm-solitaire-web.html    (2900+ 行)  - PC 版フロント + ロジック
dm-proxy-server.py       (1360+ 行)  - バックエンド / API / DB
dm_cache.db              (自動生成)  - SQLite データベース
```

### 主要な JavaScript 関数

| 領域 | 関数 |
|---|---|
| **Account** | `registerAccount()`, `loginAccount()`, `saveAccount()`, `loadAccount()` |
| **Deck** | `loadServerDecks()`, `fetchServerDeck()`, `saveDeckToServer()` |
| **Room** | `olCreateRoom()`, `olJoinRoom()`, `olWaitForOpponent()` |
| **Sync** | `olSendAction()`, `olSyncTurnEnd()`, `startOnlineVs()` |
| **UI** | `showOnlineLobby()`, `updateDeckSelector()`, `toast()` |

### Python 関数

| 領域 | 関数 |
|---|---|
| **Crypto** | `hash_pin()`, `verify_pin()` |
| **Rate Limit** | `check_rate_limit()` |
| **DB** | `_init_cache()`, `_load_from_db()`, `_verify_db_integrity()` |
| **Deck** | `_save_deck_to_db()`, `_delete_deck_from_db()` |

---

## デプロイメント

### Vercel / Netlify（フロント）

```
dm-solitaire-web.html + dm-solitaire-sp.html をアップロード
```

### Railway / Heroku（バック - Python）

```
Procfile:
web: python dm-proxy-server.py

PORT は自動割り当て使用
```

---

## 📜 ライセンス

MIT License

---

## 🙏 謝辞

- デュエルマスターズ Wiki API
- Python community
- ゲーム好きな皆さん

---

**最終更新:** 2026-03-16  
**バージョン:** 2.0 (Multiplayer + Account + Security)  
**ステータス:** 本番利用可能
