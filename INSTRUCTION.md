# DM Solitaire - 実装指示書

作成日: 2026-03-16
対象AI: 次の実装担当

---

## 1. プロジェクト構成（現状）

```
index.html          - エントリーポイント。認証画面 + PC/SP振り分け
game-engine.js      - ゲームロジック（シングルプレイ用のみ）
auth-service.js     - 認証（SessionStorage + サーバーAPI）
network-service.js  - 全サーバー通信抽象化
ui-desktop.js       - PC版UI（1216行）
ui-mobile.js        - SP版UI（686行）
dm-proxy-server.py  - バックエンド（カード検索・認証・ルーム管理・SSE）
```

### データフロー
- クライアント → `NetworkService` → `dm-proxy-server.py` → Railway
- オンライン同期: クライアント→ `POST /action` → サーバー → SSE → 相手クライアント
- 状態同期内容: カード枚数のみ（手札N枚、BZ N枚…）。カード実体は相手に送らない（正しい設計）

---

## 2. バグ（必ず修正）

### Bug 1【致命的】サーバー: `/deck/list` と `/deck/get` が `do_POST` に書かれているがクライアントはGETで呼ぶ

**場所**: `dm-proxy-server.py` の `do_POST` メソッド内（approx. line 988-1030）
**症状**: クライアントが `GET /deck/list` を呼ぶとサーバーは `do_GET` で処理するが、そこにこのルートがないため 404 "unknown endpoint" が返る。デッキのクラウド保存・読み込みが一切動かない。
**修正方法**: `do_GET` ハンドラに以下の2ルートを追加する。

```python
# /deck/list?username=X&pin=Y
elif parsed.path == "/deck/list":
    username = p("username")
    pin_val  = p("pin")
    if not username or not pin_val:
        return self._json({"error": "username and pin required"}, 400)
    with _profiles_lock:
        profile = _profiles.get(username)
    if not profile or not verify_pin(pin_val, profile["pin_hash"], profile["pin_salt"]):
        return self._json({"error": "invalid username or pin"}, 401)
    with _decks_lock:
        deck_list = list(_decks.get(username, {}).keys())
    self._json({"ok": True, "decks": deck_list})

# /deck/get?username=X&pin=Y&deck_name=Z
elif parsed.path == "/deck/get":
    username  = p("username")
    pin_val   = p("pin")
    deck_name = p("deck_name")
    if not username or not pin_val or not deck_name:
        return self._json({"error": "username, pin, deck_name required"}, 400)
    with _profiles_lock:
        profile = _profiles.get(username)
    if not profile or not verify_pin(pin_val, profile["pin_hash"], profile["pin_salt"]):
        return self._json({"error": "invalid username or pin"}, 401)
    with _decks_lock:
        deck_data = _decks.get(username, {}).get(deck_name)
    if not deck_data:
        return self._json({"error": "deck not found"}, 404)
    self._json({"ok": True, "deck_data": deck_data})
```

また、`do_POST` 内の同名ルート（approx. line 988-1055）はまだ残っているので、
**`do_POST` から `/deck/list` と `/deck/get` のブロックを丸ごと削除する**（do_GETに移すだけで良い）。

---

### Bug 2【致命的】モバイル: SSEリコネクト時に壊れたリスナーが生成される

**場所**: `ui-mobile.js` `olCreateRoomMobile()` 関数 (line 558-580)
**症状**: `es2.onerror = es.onerror` により、`es2` がエラーになったとき古い `es` への参照でリコネクトしようとする。3回目以降は正しくキャンセルされない。
**修正方法**: リコネクトをクリーンな再帰呼び出しに書き直す。

```javascript
// 現在の es.onerror / es2.onerror の実装を以下に置き換える
function _waitForJoinedMobile() {
  if (!window._ol || window._ol.reconnectAttempt >= 3) {
    alert('接続に失敗しました。ロビーに戻ります。');
    olCancelMobileWait();
    return;
  }
  const room = window._ol.room;
  const es = NetworkService.createEventSource(room, 'p1');
  window._ol.eventSource = es;
  es.addEventListener('joined', (e) => {
    const data = JSON.parse(e.data);
    window._ol.p2Name = data.p2_name || 'Player 2';
    es.close();
    document.getElementById('mobile-ol-overlay').style.display = 'none';
    startMobileOnlineGame();
  });
  es.onerror = () => {
    es.close();
    if (!window._ol || window._ol.room !== room) return;
    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
    setTimeout(_waitForJoinedMobile, delay);
  };
}
// olCreateRoomMobile の末尾で es を生成する部分を _waitForJoinedMobile() 呼び出しに置き換える
```

---

### Bug 3【中】デスクトップ: バトルゾーンカードプレビューの `c` 参照が壊れている

**場所**: `ui-desktop.js` `renderDesktopGame()` (approx. line 265-271)
**症状**: テンプレートリテラル内で `onmouseenter="showDesktopCardPreview(event, -1, c)"` と書かれているが、`c` はJSのループ変数であり、onclickの文字列として展開されたHTML上では `c` という識別子は存在しない。プレビューが動かない。
**修正方法**: カードオブジェクトをJSON化してインライン埋め込みにする。

```javascript
// 修正前
onmouseenter="showDesktopCardPreview(event, -1, c)"

// 修正後
onmouseenter="showDesktopCardPreview(event, -1, ${escapeAttrJs(JSON.stringify(c))})"
```

`showDesktopCardPreview` のシグネチャを確認し、第3引数をカードオブジェクトとして受け取るよう調整すること。

---

### Bug 4【中】オンライン: ターン制御が機能していない

**場所**: `ui-desktop.js` の `playDesktopCard`, `drawDesktopCard`, `turnDesktopEnd` / `ui-mobile.js` の対応関数
**症状**: `isMyTurn` は計算されているがアクション関数に渡されていない。オンライン中、相手のターンでも自由に操作できる。
**修正方法**: 各アクション関数の先頭にガード追加。

```javascript
// ui-desktop.js の各オンラインアクション関数の先頭に追加
function playDesktopCard(idx, zone) {
  if (window._ol) {
    const isMyTurn = window._olCurrentPlayer === (window._ol.p === 'p1' ? 1 : 2);
    if (!isMyTurn) { alert('相手のターンです'); return; }
  }
  engine.playCard(engine.state.hand[idx], zone);
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

// drawDesktopCard と turnDesktopEnd にも同様のガードを追加
// ui-mobile.js の playMobileCard, drawMobileCard, turnMobileEnd にも同様
```

---

### Bug 5【軽微】`GameEngine._expandFrom` のシャローコピー問題

**場所**: `game-engine.js` line 135
**症状**: `count === 1` のカードは `{ ...cardRef }` でコピーされるが、`count > 1` の場合も `{ ...cardRef }` なのでOK（1段階展開）。ただし、ネストしたプロパティ（将来の追加）は共有される。現時点では問題なし。
**修正**: 将来のために `structuredClone(cardRef)` に変更しておくことを推奨。

---

## 3. 未実装機能（実装すること）

### 【優先度: 高】Feature A: オンラインゲームで相手陣の視覚表示

**背景**: 現在の `renderDesktopGame()` / `renderMobileGame()` はオンライン中、相手の状態を数字のテキスト（「手札3 バトル1 マナ2 シールド5」）でのみ表示している。視覚的な対戦ボードがない。

**実装方針**:
ゲームボードを上下に分割し、上半分を相手（カード裏面 × N枚）、下半分を自分（操作可能）として表示する。

**具体的な実装 (ui-desktop.js)**:
`renderDesktopGame()` の `gameBoard.innerHTML` を2セクション構成に変更:

```javascript
// 上段: 相手エリア（window._olOpponent から描画）
const opp = window._olOpponent || {};
// 相手のBZは opp.battleZone 枚のカード裏面を表示
// 相手のシールドは opp.shields 枚の裏向きシールドを表示
// 相手の手札は opp.hand 枚のカード裏面を表示（カード名は非表示）
// 相手のマナは opp.manaZone 枚のカード裏面

// 下段: 自分エリア（engine.state から描画、操作可能）
// 既存の手札・バトルゾーン・マナゾーン・シールド表示はそのまま
```

モバイル (`ui-mobile.js`) の `renderMobileGame()` にも同様の変更。

---

### 【優先度: 高】Feature B: ターン変更通知

**背景**: 相手がターン終了したとき、自分のターンになったことがわかる通知がない。

**実装方針**:
`olStartEventListenerDesktop/Mobile` の `turn_end` ハンドラに通知を追加。

```javascript
es.addEventListener('turn_end', (e) => {
  const data = JSON.parse(e.data);
  // ...既存の処理...
  const wasMyTurn = window._olCurrentPlayer === myNum;
  // active更新後に自分のターンになったら通知
  const nowMyTurn = data.active === window._ol.p;
  if (!wasMyTurn && nowMyTurn) {
    // デスクトップ: アラートは避け、ゲームボード上部に「あなたのターンです！」バナーを表示
    // モバイル: トースト通知（3秒後に消える）
    showTurnNotification('あなたのターンです！');
  }
  renderDesktopGame(); // or renderMobileGame()
});
```

`showTurnNotification(msg)` をそれぞれのUIファイルに実装する（固定位置バナー、3秒でフェードアウト）。

---

### 【優先度: 高】Feature C: チャットUI

**背景**: サーバーに `POST /chat` と SSE `chat_message` イベントが実装済み。`NetworkService.sendChat()` も実装済み。UIのみ未実装。

**実装 (ui-desktop.js)**:

```javascript
// renderDesktopOnlineLobby のゲーム中レイアウトに追加
// チャットパネル（サイドバー）:
// - メッセージ表示エリア（最大100件、スクロール可能）
// - 入力フィールド + 送信ボタン
// - エンター送信対応

// olStartEventListenerDesktop に追加:
es.addEventListener('chat_message', (e) => {
  const d = JSON.parse(e.data);
  appendChatMessage(d.name, d.msg); // チャットパネルにメッセージ追加
});

// 送信関数:
async function sendDesktopChat() {
  const input = document.getElementById('desktop-chat-input');
  const msg = input.value.trim();
  if (!msg || !window._ol) return;
  input.value = '';
  await NetworkService.sendChat(window._ol.room, window._ol.p, msg);
}
```

モバイル版はゲーム画面下部に折りたたみ式チャットパネルとして実装する。

---

### 【優先度: 中】Feature D: 墓地（グレイブヤード）のトラッキング

**背景**: サーバーは `graveyard: 0` を常に受け取っている。`GameEngine` に墓地の概念がない。

**実装 (game-engine.js)**:

```javascript
// GameEngine.state に graveyard を追加
this.state = {
  hand: [], battleZone: [], manaZone: [], deck: [], shields: [],
  graveyard: [],  // 追加
  turn: 1
};

// 新しいメソッドを追加:
// moveToGraveyard(card, fromZone) - 指定ゾーンのカードを墓地へ
// returnFromGraveyard(cardIdx, toZone) - 墓地から指定ゾーンへ
```

`olSendActionDesktop/Mobile` の `graveyard: 0` を `s.graveyard.length` に変更。

---

### 【優先度: 中】Feature E: デッキのローカル→クラウド同期UI

**背景**: `deck/save` エンドポイントとローカルデッキ保存は独立して動いているが、「このデッキをクラウドに保存」ボタンが必要。

**実装方針**:
- デッキ編集画面に「☁ クラウドに保存」ボタンを追加
- `AuthService.getCurrentAccount()` がnullの場合はボタンをグレーアウトまたは非表示
- クリックで `POST /deck/save` を呼ぶ（既にNetworkServiceには無い → 追加が必要）

`network-service.js` に追加:
```javascript
async saveDeck(username, pin, deckName, deckData) {
  const base = this.getApiBase();
  const res = await fetch(`${base}/deck/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin, deck_name: deckName, deck_data: deckData })
  });
  const data = await res.json();
  return res.ok ? { ok: true } : { error: data.error || '保存失敗' };
}
```

---

### 【優先度: 低】Feature F: オンライン対戦のゲームボード改善

現在の `renderDesktopGame()` はインラインスタイルだらけで保守しにくい。
**index.html の `<style>` ブロックにゲームボード用CSSクラスを追加**してテンプレートを整理することを推奨（ただし機能追加より後で良い）。

---

## 4. セキュリティ改善（任意）

### S1: GETリクエストのURLにPINが含まれる問題
`/deck/list?pin=1234` のようなURLはサーバーログ・ブラウザ履歴に残る。
**対策案**: `/deck/list` と `/deck/get` をPOSTに変更し、PINをリクエストボディに入れる。
ただしNetworkService側も変更が必要（現在GETで呼んでいる）。

---

## 5. 実装順序（推奨）

```
1. Bug 1: /deck/list, /deck/get を do_GET に追加（デッキクラウドが壊れているので最優先）
2. Bug 2: Mobile SSEリコネクト修正
3. Bug 4: ターン制御ガード追加
4. Feature A: 相手陣の視覚表示（デスクトップ優先、その後モバイル）
5. Feature B: ターン変更通知
6. Bug 3: バトルゾーンプレビューバグ修正
7. Feature C: チャットUI
8. Feature D: 墓地トラッキング
9. Feature E: デッキクラウド同期UI
```

---

## 6. ファイル別 変更サマリ

| ファイル | 変更内容 |
|---|---|
| `dm-proxy-server.py` | do_GET に /deck/list, /deck/get 追加; do_POST からこの2ルート削除 |
| `ui-desktop.js` | Bug3/Bug4修正; Feature A/B/C実装 |
| `ui-mobile.js` | Bug2/Bug4修正; Feature A/B/C実装 |
| `game-engine.js` | Feature D: graveyard追加 |
| `network-service.js` | Feature E: saveDeck追加 |
| `index.html` | Feature F(任意): CSSクラス整理 |

---

## 7. 前提知識

- サーバーURL: `window.DM_API_BASE` (index.htmlで設定、デフォルト `http://localhost:8765`)
- Railwayデプロイ先: `https://dm-solitaire-production.up.railway.app`
- オンライン同期方式: SSE (server→client) + HTTP POST (client→server)
- 認証: sessionStorageにusername+pinを保存、各リクエストに添付
- デッキデータ形式: `[{id, name, civ, cost, type, power, img, race, text, count}, ...]`
- SSEイベント種別: `opponent_state`, `turn_end`, `chat_message`, `ping`, `joined`
