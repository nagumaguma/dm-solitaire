# DM 一人回しツール

## ファイル構成

```
dm-solitaire.html   ゲーム本体
dm-proxy.py         カード検索用プロキシサーバ
```

---

## 起動方法

### 1. ゲームを開く
`dm-solitaire.html` をブラウザで開くだけ。

### 2. カード検索を使う場合（任意）
ターミナルで `dm-proxy.py` と同じフォルダに移動して：

```
python dm-proxy.py
```

起動したまま `dm-solitaire.html` を開くと、カード名で検索できるようになる。
停止は `Ctrl+C`。

---

## Python が入っていない場合

### Windows
```
winget install Python.Python.3
```
インストール後、ターミナルを再起動してから `python dm-proxy.py` を実行。

### Mac
```
brew install python
```
または [python.org](https://python.org) からインストーラーをダウンロード。

---

## デッキデータについて

デッキはブラウザの `localStorage` に保存される。
別のPCに移したい場合は、デッキ管理画面の「書き出し」でJSONファイルに保存し、移行先で「読み込み」する。

---

## 動作確認済み環境

- Chrome / Edge 推奨
- Firefox でも動作するが、カード検索のCORSで問題が出ることがある
