# DM Solitaire - 実装指示書 v4

作成日: 2026-03-16（v3実行後のレビューを反映）

---

## 前回の指示（v3）の実施確認

| 項目 | 状態 | 備考 |
|---|---|---|
| Bug 1: alert() → showDesktopToast() | ✅ 完了 | `showDesktopToast()` L1-43, 全 alert 置換済み |
| Bug 2: confirm() → askDesktopConfirm() | ✅ 完了 | Promise モーダル L44- 実装, L1355, L1647 で使用 |
| Design-1: ロビー配色統一 | ✅ 完了 | `index.html` L3433-3458 に V3 CSS オーバーライド追加済み |
| Design-2: ターン開始ドロー促進 | ✅ 完了 | `_desktopNeedDrawGuide` / `_mobileNeedDrawGuide` フラグ + SSE ハンドラでセット済み |
| Design-3: 手札カード文明色 | ✅ 完了 | `getDesktopCardCivClass(c)` が手札チップにも適用 (`ui-desktop.js` L987) |
| Design-4: デッキ一覧 空状態・文明バッジ | ✅ 完了 | 空状態メッセージ + `.dl-civ-badge` 実装済み |
| Design-5: ゾーン視認性向上 | ✅ 完了 | `.dg-zone-title` border-left + 空プレースホルダー追加 |
| Design-6: モバイル ゾーン順序 | ✅ 完了 | シールドを BZ の前に移動済み |
| Design-7: デスクトップ ヘッダーバー | ✅ 完了 | `.dg-header-bar.my-turn` / `.opp-turn` + `.dg-turn-badge` |
| Design-8: 墓地モーダルビューア | ✅ 完了 | `openDesktopGraveyardModal()` / `closeDesktopGraveyardModal()` L1327 |

---

## 新規バグ（今回発見・修正指示）

---

### Bug 1【🔴 高】デスクトップ 手札クリックが常にバトルゾーンへ

**場所**: `ui-desktop.js` L993

**症状**: 手札カードをクリックすると `playDesktopCard(i, 'battle')` が直接呼ばれ、常にバトルゾーンへ出る。マナゾーンへ置く操作がクリックでできない（ドラッグ&ドロップしか手段がない）。

**確認コード**:
```javascript
// ui-desktop.js L993 (現在)
onclick="playDesktopCard(${i}, 'battle')"
```

**修正方針**: クリックでゾーン選択ポップアップを表示する。

#### 変更 1: `onclick` をピッカー呼び出しに変更

```javascript
// 変更前 (ui-desktop.js L993)
onclick="playDesktopCard(${i}, 'battle')"

// 変更後
onclick="selectDesktopHandCard(${i}, event)"
```

#### 変更 2: `selectDesktopHandCard()` 関数を追加 (`ui-desktop.js` の先頭付近に追記)

```javascript
function selectDesktopHandCard(idx, event) {
  event.stopPropagation();
  closeDesktopHandPicker();

  const picker = document.createElement('div');
  picker.id = 'dg-hand-picker';
  picker.className = 'dg-hand-picker';
  picker.innerHTML = `
    <button onclick="playDesktopCard(${idx},'battle');closeDesktopHandPicker()">バトルゾーン</button>
    <button onclick="playDesktopCard(${idx},'mana');closeDesktopHandPicker()">マナゾーン</button>
    <button onclick="closeDesktopHandPicker()" class="dg-hand-picker-cancel">キャンセル</button>
  `;

  const rect = event.currentTarget.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
  document.body.appendChild(picker);

  setTimeout(() => {
    document.addEventListener('click', closeDesktopHandPicker, { once: true });
  }, 0);
}

function closeDesktopHandPicker() {
  const el = document.getElementById('dg-hand-picker');
  if (el) el.remove();
}
```

#### 変更 3: CSS を `index.html` の `</style>` 前に追加

```css
/* Hand zone picker popup */
.dg-hand-picker {
  position: fixed;
  background: var(--panel, #faf6f1);
  border: 1px solid var(--border, #e2d6c8);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  z-index: 8500;
  min-width: 130px;
}
.dg-hand-picker button {
  background: none;
  border: none;
  padding: 7px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text, #3f332a);
  text-align: left;
  white-space: nowrap;
}
.dg-hand-picker button:hover {
  background: var(--border, #e2d6c8);
}
.dg-hand-picker button.dg-hand-picker-cancel {
  color: var(--text-dim, #a08060);
  font-size: 0.8rem;
}
```

---

### Bug 2【🟡 中】デッキ新規作成で `prompt()` を使用

**場所**: `ui-desktop.js` L1333、`ui-mobile.js` L1271

**症状**: 「新規デッキ」ボタン押下時に `prompt('デッキ名を入力:')` が呼ばれる。ネイティブダイアログがテーマと合わない。

**確認コード**:
```javascript
// ui-desktop.js L1333 (現在)
function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');

// ui-mobile.js L1271 (現在)
function newMobileDeck() {
  const name = String(prompt('デッキ名を入力:') || '').trim();
```

**修正方針**: 既存の `dm-confirm-modal` 構造を流用してテキスト入力モーダルを追加する。

#### 変更 1: `askDesktopInput()` を `ui-desktop.js` に追加（`askDesktopConfirm()` の直後）

```javascript
function askDesktopInput(placeholder = 'デッキ名を入力') {
  return new Promise((resolve) => {
    let modal = document.getElementById('desktop-input-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'desktop-input-modal';
      modal.className = 'dm-confirm-modal';
      modal.innerHTML = `
        <div class="dm-confirm-backdrop"></div>
        <div class="dm-confirm-body">
          <input id="desktop-input-field" class="dm-input-field" type="text" autocomplete="off">
          <div class="dm-confirm-actions">
            <button id="desktop-input-ok" class="dm-confirm-btn ok">OK</button>
            <button id="desktop-input-cancel" class="dm-confirm-btn cancel">キャンセル</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const input    = document.getElementById('desktop-input-field');
    const okBtn    = document.getElementById('desktop-input-ok');
    const cancelBtn = document.getElementById('desktop-input-cancel');
    const backdrop = modal.querySelector('.dm-confirm-backdrop');

    input.placeholder = placeholder;
    input.value = '';

    const close = (result) => {
      modal.classList.remove('open');
      okBtn.onclick     = null;
      cancelBtn.onclick = null;
      backdrop.onclick  = null;
      input.onkeydown   = null;
      resolve(result);
    };

    okBtn.onclick     = () => close(input.value.trim() || null);
    cancelBtn.onclick = () => close(null);
    backdrop.onclick  = () => close(null);
    input.onkeydown   = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); close(input.value.trim() || null); }
      if (e.key === 'Escape') close(null);
    };

    modal.classList.add('open');
    input.focus();
  });
}
```

#### 変更 2: `newDesktopDeck()` を async に変更 (`ui-desktop.js` L1332)

```javascript
// 変更前
function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');
  if (!name) return;

// 変更後
async function newDesktopDeck() {
  const name = await askDesktopInput('デッキ名を入力');
  if (!name) return;
```

#### 変更 3: `askMobileInput()` を `ui-mobile.js` に追加（`askMobileConfirm()` の直後）

```javascript
function askMobileInput(placeholder = 'デッキ名を入力') {
  return new Promise((resolve) => {
    let modal = document.getElementById('mobile-input-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mobile-input-modal';
      modal.className = 'dm-confirm-modal';
      modal.innerHTML = `
        <div class="dm-confirm-backdrop"></div>
        <div class="dm-confirm-body mobile">
          <input id="mobile-input-field" class="dm-input-field" type="text" autocomplete="off">
          <div class="dm-confirm-actions">
            <button id="mobile-input-ok" class="dm-confirm-btn ok">OK</button>
            <button id="mobile-input-cancel" class="dm-confirm-btn cancel">キャンセル</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const input     = document.getElementById('mobile-input-field');
    const okBtn     = document.getElementById('mobile-input-ok');
    const cancelBtn = document.getElementById('mobile-input-cancel');
    const backdrop  = modal.querySelector('.dm-confirm-backdrop');

    input.placeholder = placeholder;
    input.value = '';

    const close = (result) => {
      modal.classList.remove('open');
      okBtn.onclick     = null;
      cancelBtn.onclick = null;
      backdrop.onclick  = null;
      input.onkeydown   = null;
      resolve(result);
    };

    okBtn.onclick     = () => close(input.value.trim() || null);
    cancelBtn.onclick = () => close(null);
    backdrop.onclick  = () => close(null);
    input.onkeydown   = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); close(input.value.trim() || null); }
      if (e.key === 'Escape') close(null);
    };

    modal.classList.add('open');
    input.focus();
  });
}
```

#### 変更 4: `newMobileDeck()` を async に変更 (`ui-mobile.js` L1270)

```javascript
// 変更前
function newMobileDeck() {
  const name = String(prompt('デッキ名を入力:') || '').trim();
  if (!name) return;

// 変更後
async function newMobileDeck() {
  const name = await askMobileInput('デッキ名を入力');
  if (!name) return;
```

#### 変更 5: CSS を `index.html` の `</style>` 前に追加（desktop/mobile 共通）

```css
/* Input modal field */
.dm-input-field {
  width: 100%;
  border: 1px solid var(--border, #e2d6c8);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 1rem;
  color: var(--text, #3f332a);
  background: #fff;
  margin-bottom: 14px;
  box-sizing: border-box;
}
.dm-input-field:focus {
  outline: none;
  border-color: var(--accent, #b37a4c);
  box-shadow: 0 0 0 2px rgba(179,122,76,0.15);
}
```

---

### Bug 3【🟡 中】SSE 再接続後に相手の状態更新が無視される

**場所**: `ui-desktop.js` L2290〜2300（`olStartEventListenerDesktop()`）、`ui-mobile.js` L1909〜1915（`olStartEventListenerMobile()`）

**症状**: SSE が切断→再接続されると `createEventSource()` が新しい接続を作るが、`window._ol.remoteSeq` がリセットされない。再接続後に受信した相手のパケットの `seq` が古い `remoteSeq` 以下と判断され、`shouldApplyRemotePayload()` が `false` を返し続ける。結果、再接続後に相手の盤面が一切更新されなくなる。

**確認コード**:
```javascript
// ui-desktop.js L2290〜2300 (現在)
function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
  }

  const room = window._ol.room;      // ← ここに remoteSeq リセットがない
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
  window._ol.eventSource = es;

// ui-mobile.js L1909〜1915 (現在)
function olStartEventListenerMobile() {
  if (!window._ol || !engineMobile) return;
  if (window._ol.eventSource) window._ol.eventSource.close();

  const room = window._ol.room;      // ← ここに remoteSeq リセットがない
  const es = NetworkService.createEventSource(room, window._ol.p);
  window._ol.eventSource = es;
```

**修正**: 新しい EventSource を作る直前に `remoteSeq = 0` をリセットする。

```javascript
// ui-desktop.js の修正 (L2295〜2300 あたりに1行追加)
function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
  }

  window._ol.remoteSeq = 0;          // ← 追加：再接続時にシーケンス番号をリセット

  const room = window._ol.room;
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
  window._ol.eventSource = es;
  // ... 以降は変更なし

// ui-mobile.js の修正 (L1911〜1915 あたりに1行追加)
function olStartEventListenerMobile() {
  if (!window._ol || !engineMobile) return;
  if (window._ol.eventSource) window._ol.eventSource.close();

  window._ol.remoteSeq = 0;          // ← 追加：再接続時にシーケンス番号をリセット

  const room = window._ol.room;
  const es = NetworkService.createEventSource(room, window._ol.p);
  window._ol.eventSource = es;
  // ... 以降は変更なし
```

---

### Bug 4【🟢 低】クリップボード失敗時に `window.prompt()` を使用

**場所**: `ui-desktop.js` L1829, L1834（`desktopOnlineCopyRoomId()` 関数内）

**症状**: Clipboard API が使えない環境でルームIDをコピーしようとすると `window.prompt()` が開く。ネイティブダイアログがテーマと合わず、またモバイルブラウザでは prompt が完全にブロックされる場合がある。

**確認コード**:
```javascript
// ui-desktop.js L1825〜1836 (現在)
try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(room);
    if (!silent) desktopOnlineUpdateStatus(`ルームID ${room} をコピーしました。`);
  } else {
    window.prompt('ルームIDをコピーしてください', room);  // L1829 ← 削除
    if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
  }
} catch (err) {
  console.warn('clipboard write failed', err);
  window.prompt('ルームIDをコピーしてください', room);     // L1834 ← 削除
  if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
}
```

**修正**: `window.prompt()` を削除し、`showDesktopToast()` でルームIDを目立つ表示に変更する。

```javascript
// 変更後
try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(room);
    if (!silent) desktopOnlineUpdateStatus(`ルームID ${room} をコピーしました。`);
  } else {
    showDesktopToast(`ルームID: ${room}`, 'info', 6000);
    if (!silent) desktopOnlineUpdateStatus(`ルームID: ${room} をメモしてください。`);
  }
} catch (err) {
  console.warn('clipboard write failed', err);
  showDesktopToast(`ルームID: ${room}`, 'info', 6000);
  if (!silent) desktopOnlineUpdateStatus(`ルームID: ${room} をメモしてください。`);
}
```

---

## 実装順序（推奨）

```
Phase 1（バグ修正・高優先）:
  1. Bug 1: selectDesktopHandCard() 追加 + onclick 変更 + CSS
  2. Bug 2: askDesktopInput() / askMobileInput() 追加 + newDeck() async 化 + CSS
  3. Bug 3: olStartEventListenerDesktop/Mobile に remoteSeq = 0 追加

Phase 2（低優先バグ）:
  4. Bug 4: clipboard fallback の window.prompt() → showDesktopToast() に変更
```

---

## ファイル別 変更サマリ

| ファイル | 変更内容 |
|---|---|
| `ui-desktop.js` | `selectDesktopHandCard()` + `closeDesktopHandPicker()` 追加、手札 onclick 変更、`askDesktopInput()` 追加、`newDesktopDeck()` async 化、`olStartEventListenerDesktop()` に remoteSeq リセット追加、`desktopOnlineCopyRoomId()` の prompt → toast |
| `ui-mobile.js` | `askMobileInput()` 追加、`newMobileDeck()` async 化、`olStartEventListenerMobile()` に remoteSeq リセット追加 |
| `index.html` | `.dg-hand-picker` CSS 追加、`.dm-input-field` CSS 追加 |

---

## 技術的前提（変更なし）

- サーバーURL: `window.DM_API_BASE`（index.htmlで設定）
- Railwayデプロイ: `https://dm-solitaire-production.up.railway.app`
- デッキ形式: `[{id, name, civ, civilization, cost, type, power, race, text, count}, ...]`
- SSEイベント: `opponent_state`, `turn_end`, `chat_message`, `ping`, `joined`
- `/deck/list`, `/deck/get` はPOST（PINをbodyに含める）
- 認証: sessionStorage に `{username, pin}` を保存
- テーマカラー: `--bg: #f6efe6`, `--accent: #b37a4c`, `--text: #3f332a`, `--border: #e2d6c8`
- `window.GameController`: 意図的に未定義（拡張ポイント）、全参照は `if (window.GameController)` でガード済み
