# DM Solitaire - 実装指示書 v5

作成日: 2026-03-16（v4実行後のレビューを反映）

---

## 前回の指示（v4）の実施確認

| 項目 | 状態 | 備考 |
|---|---|---|
| Bug 1: selectDesktopHandCard() + ゾーン選択ポップアップ | ✅ 完了 | `ui-desktop.js` L1360-1407。ターンガード・座標補正も完備 |
| Bug 2: askDesktopInput() / askMobileInput() + newDeck() async化 | ❌ 未実装 | `newDesktopDeck()` L2071 / `newMobileDeck()` L1886 ともに `prompt()` のまま |
| Bug 3: SSE reconnect 時の remoteSeq リセット | ❌ 未実装 | `olStartEventListenerDesktop()` L3032 / `olStartEventListenerMobile()` L2529 ともに `window._ol.remoteSeq = 0` なし |
| Bug 4: clipboard fallback の window.prompt() 削除 | ❌ 未実装 | `desktopOnlineCopyRoomId()` L2570, L2575 に `window.prompt()` が残存 |

---

## 今回の大規模変更の評価（良好）

今回のアップデートで追加された以下の機能は**正常に動作する設計**であることを確認した。

| 追加機能 | 評価 |
|---|---|
| `game-controller.js` 大幅拡充（GameController として window に export） | ✅ 問題なし |
| `game-engine.js` に `moveCardBetweenZones()`, `insertCardUnderCard()` 追加 | ✅ 問題なし |
| デスクトップ 右クリック ゾーンメニュー (`openDesktopCardZoneMenu()`) | ✅ 問題なし |
| モバイル 長押しゾーンメニュー (`openMobileCardZoneMenu()`) | ✅ 問題なし |
| カード詳細モーダル（両プラットフォーム） | ✅ 問題なし |
| アンダーカード重ねシステム (`insertCardUnderCard()`) | ✅ 問題なし |
| SSEハンドラでのターン開始時カードアンタップ + ドローガイド | ✅ 問題なし |
| `createSearchController()` による検索ページング | ✅ 問題なし |
| `.dark` / `.darkness` 両クラス対応 CSS | ✅ 問題なし |

---

## 未実装バグ（v4から引き続き修正が必要）

---

### Bug 1（再掲）【🟡 中】デッキ新規作成で `prompt()` を使用

**場所**: `ui-desktop.js` L2071、`ui-mobile.js` L1886

**症状**: 「新規デッキ」ボタン押下時に `prompt('デッキ名を入力:')` が呼ばれる。

**現在のコード**:
```javascript
// ui-desktop.js L2070 (現在)
function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');

// ui-mobile.js L1885 (現在)
function newMobileDeck() {
  const name = String(prompt('デッキ名を入力:') || '').trim();
```

**修正方針**: 既存の `dm-confirm-modal` 構造を流用してテキスト入力モーダルを追加する。

#### 変更 1: `askDesktopInput()` を `ui-desktop.js` に追加（`askDesktopConfirm()` の直後、L98付近）

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

    const input     = document.getElementById('desktop-input-field');
    const okBtn     = document.getElementById('desktop-input-ok');
    const cancelBtn = document.getElementById('desktop-input-cancel');
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

#### 変更 2: `newDesktopDeck()` を async に変更（`ui-desktop.js` L2070）

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

#### 変更 3: `askMobileInput()` を `ui-mobile.js` に追加（`askMobileConfirm()` L215の直後）

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

#### 変更 4: `newMobileDeck()` を async に変更（`ui-mobile.js` L1885）

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

#### 変更 5: CSS を `index.html` の `</style>` 前に追加

```css
/* Input modal field (desktop & mobile shared) */
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
  display: block;
}
.dm-input-field:focus {
  outline: none;
  border-color: var(--accent, #b37a4c);
  box-shadow: 0 0 0 2px rgba(179, 122, 76, 0.15);
}
```

---

### Bug 2（再掲）【🔴 致命的】SSE 再接続後に相手の盤面更新が完全に無視される

**場所**: `ui-desktop.js` L3032〜3042（`olStartEventListenerDesktop()`）、`ui-mobile.js` L2529〜2535（`olStartEventListenerMobile()`）

**症状**: SSE 切断→再接続時に `window._ol.remoteSeq` がリセットされない。再接続後に受信したパケットの `seq` が古い `remoteSeq` 以下と判定され、`shouldApplyRemotePayload()` が永遠に `false` を返す。相手の手札枚数・BZ・マナ・シールドが一切更新されなくなる。

**現在のコード**（ui-desktop.js L3032）:
```javascript
function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
  }
                                    // ← ここに remoteSeq = 0 がない
  const room = window._ol.room;
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
```

**修正**: 1行追加するだけ。

```javascript
// ui-desktop.js の修正 (L3037〜3038 の間に1行追加)
function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
  }

  window._ol.remoteSeq = 0;          // ← 追加

  const room = window._ol.room;
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
```

```javascript
// ui-mobile.js の修正 (L2531〜2533 の間に1行追加)
function olStartEventListenerMobile() {
  if (!window._ol || !engineMobile) return;
  if (window._ol.eventSource) window._ol.eventSource.close();

  window._ol.remoteSeq = 0;          // ← 追加

  const room = window._ol.room;
  const es = NetworkService.createEventSource(room, window._ol.p);
```

---

### Bug 3（再掲）【🟢 低】クリップボード失敗時に `window.prompt()` を使用

**場所**: `ui-desktop.js` L2570, L2575（`desktopOnlineCopyRoomId()` 内）

**現在のコード**（L2564〜2577）:
```javascript
try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(room);
    if (!silent) desktopOnlineUpdateStatus(`ルームID ${room} をコピーしました。`);
  } else {
    window.prompt('ルームIDをコピーしてください', room);   // ← L2570 削除
    if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
  }
} catch (err) {
  console.warn('clipboard write failed', err);
  window.prompt('ルームIDをコピーしてください', room);     // ← L2575 削除
  if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
}
```

**修正後**:
```javascript
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
Phase 1（致命的バグ）:
  1. Bug 2: olStartEventListenerDesktop/Mobile に window._ol.remoteSeq = 0 追加（1行追加ずつ）

Phase 2（中優先バグ）:
  2. Bug 1: askDesktopInput() / askMobileInput() 追加 + newDeck() async 化 + .dm-input-field CSS 追加

Phase 3（低優先）:
  3. Bug 3: desktopOnlineCopyRoomId() の window.prompt() → showDesktopToast() に変更
```

---

## ファイル別 変更サマリ

| ファイル | 変更内容 |
|---|---|
| `ui-desktop.js` | `askDesktopInput()` 追加（L98直後）、`newDesktopDeck()` async化（L2070）、`olStartEventListenerDesktop()` に remoteSeq = 0 追加（L3037付近）、`desktopOnlineCopyRoomId()` の prompt → toast（L2570/2575） |
| `ui-mobile.js` | `askMobileInput()` 追加（L215直後）、`newMobileDeck()` async化（L1885）、`olStartEventListenerMobile()` に remoteSeq = 0 追加（L2531付近） |
| `index.html` | `.dm-input-field` CSS 追加（`</style>` 前） |

---

## 技術的前提（変更なし）

- サーバーURL: `window.DM_API_BASE`（index.htmlで設定）
- Railwayデプロイ: `https://dm-solitaire-production.up.railway.app`
- `window.GameController`: 全操作の中継点として実装済み（`game-controller.js`）
- SSEイベント: `opponent_state`, `turn_end`, `chat_message`, `ping`, `joined`
- テーマカラー: `--bg: #f6efe6`, `--accent: #b37a4c`, `--text: #3f332a`, `--border: #e2d6c8`
- 文明クラス: desktop は `dark`, mobile は `darkness` —両方 CSS に定義済みなので問題なし
