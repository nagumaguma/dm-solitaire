/**
 * DM Solitaire - Desktop UI
 * PC版レイアウト（3カラム: 検索 | デッキ | ゲーム）
 */

let engine = null;
let _desktopTurnNoticeTimer = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** onclick 等のシングルクォート文字列用（デッキ名に ' が含まれると壊れるのを防ぐ） */
function escapeAttrJs(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function ensureDesktopChatLog() {
  if (!Array.isArray(window._olChatLogDesktop)) {
    window._olChatLogDesktop = [];
  }
  return window._olChatLogDesktop;
}

function renderDesktopBackCards(count, palette = 'default') {
  const safeCount = Math.max(0, Number(count) || 0);
  const visible = Math.min(safeCount, 12);
  const cardClass = palette === 'shield' ? 'dg-back-card shield' : 'dg-back-card';

  const cards = Array.from({ length: visible }).map(() => `
    <div class="${cardClass}"></div>
  `).join('');

  const rest = safeCount > visible
    ? `<div class="dg-more-chip">+${safeCount - visible}</div>`
    : '';

  if (!cards && !rest) {
    return '<div class="dg-back-empty">0</div>';
  }

  return `<div class="dg-back-cards">${cards}${rest}</div>`;
}

function showDesktopTurnNotification(message) {
  let el = document.getElementById('desktop-turn-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'desktop-turn-notification';
    el.className = 'dg-turn-toast';
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.style.opacity = '1';

  if (_desktopTurnNoticeTimer) {
    clearTimeout(_desktopTurnNoticeTimer);
  }
  _desktopTurnNoticeTimer = setTimeout(() => {
    const current = document.getElementById('desktop-turn-notification');
    if (current) current.style.opacity = '0';
  }, 3000);
}

function renderDesktopChatMessages() {
  const box = document.getElementById('desktop-chat-messages');
  if (!box) return;

  const log = ensureDesktopChatLog();
  box.innerHTML = log.map((entry) => {
    const mine = entry.p && window._ol && entry.p === window._ol.p;
    const roleClass = mine ? 'mine' : 'other';
    return `
      <div class="dg-chat-item ${roleClass}">
        <div class="dg-chat-name">${escapeHtml(entry.name || 'Player')}</div>
        <div class="dg-chat-text">${escapeHtml(entry.msg || '')}</div>
      </div>
    `;
  }).join('');

  box.scrollTop = box.scrollHeight;
}

function appendDesktopChatMessage(name, msg, p = '') {
  const log = ensureDesktopChatLog();
  log.push({ name, msg, p });
  if (log.length > 100) log.shift();
  renderDesktopChatMessages();
}

async function sendDesktopChat() {
  if (!window._ol) return;

  const input = document.getElementById('desktop-chat-input');
  const msg = (input?.value || '').trim();
  if (!msg) return;

  input.value = '';
  try {
    const ok = await NetworkService.sendChat(window._ol.room, window._ol.p, msg);
    if (!ok) {
      appendDesktopChatMessage('SYSTEM', 'メッセージ送信に失敗しました。', 'sys');
    }
  } catch (err) {
    console.error('send chat error', err);
    appendDesktopChatMessage('SYSTEM', 'メッセージ送信に失敗しました。', 'sys');
  }
}

function onDesktopChatKeyDown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  sendDesktopChat();
}

/** localStorage dm_decks を安全に取得（破損時は {}） */
function getSavedDecks() {
  try {
    const raw = localStorage.getItem('dm_decks');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('dm_decks parse error', e);
    return {};
  }
}

/**
 * PC版UI初期化
 */
function initDesktopUI() {
  engine = new GameEngine();
  renderDesktopDeckList();
}

/**
 * 3カラムレイアウトのデッキ一覧画面
 */
function renderDesktopDeckList() {
  const container = document.getElementById('app-desktop');
  
  container.innerHTML = `
    <div class="dl-root">
      
      <!-- 左: カード検索パネル -->
      <div class="dl-panel">
        <h3 class="dl-heading">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." 
          class="dl-input"
          onkeyup="desktopSearchCards(this.value)">
        <div id="desktop-search-results" class="dl-stack dl-stack-tight"></div>
      </div>
      
      <!-- 中央: デッキ一覧 -->
      <div class="dl-panel">
        <div class="dl-list-head">
          <h3 class="dl-heading dl-heading-inline">デッキ一覧</h3>
          <div class="dl-inline-actions">
            <button type="button" onclick="renderDesktopOnlineLobby()" class="dl-mini-btn dl-mini-btn-online">オンライン対戦</button>
            <button type="button" onclick="logout()" class="dl-mini-btn dl-mini-btn-ghost">ログアウト</button>
          </div>
        </div>
        <button onclick="newDesktopDeck()" 
          class="dl-main-btn">
          新規デッキ
        </button>
        <div id="desktop-deck-list" class="dl-stack"></div>
      </div>
      
      <!-- 右: ゲームボード -->
      <div class="dl-panel dl-game-panel">
        <h3 class="dl-heading" id="desktop-game-title">ゲーム情報</h3>
        <div id="desktop-game-board" class="dl-game-board">
          <p class="dl-empty-text">デッキを選択してゲーム開始</p>
        </div>
      </div>
      
    </div>
  `;
  
  updateDesktopDeckList();
}

/**
 * デッキ一覧を更新
 */
function updateDesktopDeckList() {
  // ローカルデッキ読み込み
  const savedDecks = getSavedDecks();
  const account = AuthService.getCurrentAccount();
  
  const deckList = document.getElementById('desktop-deck-list');
  deckList.innerHTML = '';
  
  // ローカルデッキ
  for (const [name, cards] of Object.entries(savedDecks)) {
    const count = cards?.length || 0;
    const el = document.createElement('div');
    el.className = 'dl-deck-item';
    el.innerHTML = `
      <div class="dl-deck-name">${escapeHtml(name)}</div>
      <div class="dl-deck-meta">デッキ: ${count}枚</div>
      <div class="dl-item-actions">
        <button onclick="openDesktopDeck('${escapeAttrJs(name)}')" class="dl-item-btn edit">編集</button>
        <button onclick="startDesktopGame('${escapeAttrJs(name)}')" class="dl-item-btn play">一人回し</button>
        <button onclick="openDesktopOnlineWithDeck('${escapeAttrJs(name)}')" class="dl-item-btn online">オンライン</button>
        <button onclick="deleteDesktopDeck('${escapeAttrJs(name)}')" class="dl-item-btn delete">削除</button>
      </div>
    `;
    deckList.appendChild(el);
  }
  
  // サーバーデッキ
  if (account && window._serverDeckNames) {
    for (const name of window._serverDeckNames) {
      const el = document.createElement('div');
      el.className = 'dl-deck-item cloud';
      el.innerHTML = `
        <div class="dl-deck-name">クラウド: ${escapeHtml(name)}</div>
        <div class="dl-item-actions dl-item-actions-cloud">
          <button onclick="startDesktopGame('${escapeAttrJs(name)}')" class="dl-item-btn play">一人回し</button>
          <button onclick="openDesktopOnlineWithDeck('${escapeAttrJs(name)}')" class="dl-item-btn online">オンライン</button>
        </div>
      `;
      deckList.appendChild(el);
    }
  }
}

/**
 * カード検索（PC版）
 */
async function desktopSearchCards(q) {
  if (!q.trim()) {
    document.getElementById('desktop-search-results').innerHTML = '';
    return;
  }
  
  const results = await NetworkService.searchCards(q, 1);
  const container = document.getElementById('desktop-search-results');
  container.innerHTML = '';
  
  results.slice(0, 10).forEach(card => {
    const el = document.createElement('div');
    el.className = 'dl-search-item';
    el.innerHTML = `
      <div class="dl-search-name">${escapeHtml(card.name)}</div>
      <div class="dl-search-text">${escapeHtml(card.text || '')}</div>
      <button onclick="addToDesktopDeck('${escapeHtml(JSON.stringify(card).replace(/'/g, "\\'"))}')" 
        class="dl-add-btn">+追加</button>
    `;
    container.appendChild(el);
  });
}

/**
 * ゲーム開始（PC版）
 */
async function startDesktopGame(deckName) {
  const savedDecks = getSavedDecks();
  let deckData = null;
  
  // ローカルから探す
  if (savedDecks[deckName]) {
    deckData = savedDecks[deckName];
  } 
  // サーバーから取得
  else {
    const account = AuthService.getCurrentAccount();
    if (account) {
      deckData = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
    }
  }
  
  if (!deckData || !deckData.length) {
    alert('デッキが取得できませんでした。ネットワークまたはデッキ名を確認してください。');
    return;
  }
  
  // ゲームエンジン初期化
  engine.initGame(deckData);
  window._ol = null;
  window._olOpponent = null;
  renderDesktopGame();
}

/**
 * ゲーム画面レンダリング（PC版）
 */
function renderDesktopGame() {
  const state = engine.getState();
  const gameBoard = document.getElementById('desktop-game-board');
  const ol = window._ol;
  const opp = window._olOpponent || {};
  const myNum = ol ? (ol.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = ol && window._olCurrentPlayer && window._olCurrentPlayer === myNum;
  const myName = ol ? (ol.p === 'p1' ? (ol.p1Name || 'Player 1') : (ol.p2Name || 'Player 2')) : '自分';
  const oppName = ol ? (ol.p === 'p1' ? (ol.p2Name || 'Player 2') : (ol.p1Name || 'Player 1')) : '相手';
  
  gameBoard.innerHTML = `
    <div class="dg-root">
      <div class="dg-turn-bar">
        <strong>ターン:</strong> ${state.turn}
        ${ol ? `<span class="dg-turn-state ${isMyTurn ? 'mine' : 'opponent'}">${isMyTurn ? '自分のターン' : '相手のターン'}</span>` : ''}
      </div>
      ${ol ? `<div class="dg-online-meta">
        オンライン対戦: ${escapeHtml(ol.p1Name)} vs ${ol.p2Name ? escapeHtml(ol.p2Name) : '待機中'}
      </div>` : ''}

      ${ol ? `<div class="dg-opp-wrap">
        <div class="dg-opp-title">相手エリア: ${escapeHtml(oppName)}</div>
        <div class="dg-opp-grid">
          <div class="dg-opp-panel">
            <div class="dg-opp-label">手札 (${Number(opp.hand ?? 0)})</div>
            ${renderDesktopBackCards(Number(opp.hand ?? 0))}
          </div>
          <div class="dg-opp-panel">
            <div class="dg-opp-label">シールド (${Number(opp.shields ?? 0)})</div>
            ${renderDesktopBackCards(Number(opp.shields ?? 0), 'shield')}
          </div>
          <div class="dg-opp-panel">
            <div class="dg-opp-label">バトル (${Number(opp.battleZone ?? 0)})</div>
            ${renderDesktopBackCards(Number(opp.battleZone ?? 0))}
          </div>
          <div class="dg-opp-panel">
            <div class="dg-opp-label">マナ (${Number(opp.manaZone ?? 0)})</div>
            ${renderDesktopBackCards(Number(opp.manaZone ?? 0))}
          </div>
        </div>
        <div class="dg-opp-panel dg-opp-grave">
          <div class="dg-opp-label">墓地 (${Number(opp.graveyard ?? 0)})</div>
          ${renderDesktopBackCards(Number(opp.graveyard ?? 0))}
        </div>
      </div>` : ''}

      <div class="dg-me-wrap">
        <div class="dg-me-title">自分エリア: ${escapeHtml(myName)}</div>
        <strong class="dg-zone-title">デッキ残枚数</strong>
        <div class="dg-deck-count">${state.deck.length}</div>
      </div>
      
      <div class="dg-section">
        <strong class="dg-zone-title">手札 (${state.hand.length})</strong>
        <div id="desktop-hand-zone" class="dg-hand-zone">
          ${state.hand.map((c, i) => `
            <div class="dg-card-chip hand" draggable="true"
              onclick="playDesktopCard(${i}, 'battle')" 
              onmouseenter="showDesktopCardPreview(event, ${i})"
              onmouseleave="hideDesktopCardPreview()"
              ondragstart="dragDesktopCard(event, ${i})"
              ondragend="dragDesktopCardEnd()"
              title="${escapeHtml(c.name)}">
              ${escapeHtml(c.name).substring(0, 4)}
            </div>
          `).join('')}
        </div>
        <div id="desktop-card-preview" class="dg-preview">
          <div id="desktop-preview-content"></div>
        </div>
      </div>
      
      <div class="dg-section">
        <strong class="dg-zone-title">バトル (${state.battleZone.length})</strong>
        <div id="desktop-battle-zone" ondrop="dropDesktopCard(event, 'battle')" ondragover="dragDesktopOver(event)"
          class="dg-play-zone battle">
          ${state.battleZone.map(c => `
            <div class="dg-card-chip battle"
              title="${escapeHtml(c.name)}" onmouseenter="showDesktopCardPreview(event, -1, '${escapeAttrJs(JSON.stringify(c))}')"
              onmouseleave="hideDesktopCardPreview()">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="dg-section">
        <strong class="dg-zone-title">マナ (${state.manaZone.length})</strong>
        <div id="desktop-mana-zone" ondrop="dropDesktopCard(event, 'mana')" ondragover="dragDesktopOver(event)"
          class="dg-play-zone mana">
          ${state.manaZone.map(c => `
            <div class="dg-card-chip mana"
              title="${escapeHtml(c.name)}" onmouseenter="showDesktopCardPreview(event, -1, '${escapeAttrJs(JSON.stringify(c))}')"
              onmouseleave="hideDesktopCardPreview()">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="dg-section">
        <strong class="dg-zone-title">シールド (${state.shields.length})</strong>
        <div class="dg-shield-zone">
          ${state.shields.map(() => `
            <div class="dg-card-chip shield">
              SH
            </div>
          `).join('')}
        </div>
      </div>

      <div class="dg-section">
        <strong class="dg-zone-title">墓地 (${state.graveyard.length})</strong>
        <div class="dg-grave-zone">
          ${state.graveyard.slice(-10).map(c => `
            <div class="dg-card-chip grave" title="${escapeHtml(c.name)}">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
          ${state.graveyard.length > 10 ? `<div class="dg-more-chip">+${state.graveyard.length - 10}</div>` : ''}
        </div>
      </div>
      
      <div class="dg-action-row">
        <button onclick="drawDesktopCard()" class="dg-btn draw">ドロー</button>
        <button onclick="turnDesktopEnd()" class="dg-btn end">ターン終了</button>
        <button onclick="moveDesktopToGraveyard('battle')" class="dg-btn battle-grave">戦→墓地</button>
        <button onclick="moveDesktopToGraveyard('mana')" class="dg-btn mana-grave">マナ→墓地</button>
        <button onclick="returnDesktopFromGraveyard('hand')" class="dg-btn grave-return">墓地→手札</button>
        ${!window._ol ? `<button onclick="undoDesktopGame()" class="dg-btn undo">やり直し</button>` : ''}
        <button onclick="renderDesktopDeckList()" class="dg-btn back">戻る</button>
      </div>

      ${ol ? `
        <div class="dg-chat-wrap">
          <div class="dg-chat-title">チャット</div>
          <div id="desktop-chat-messages" class="dg-chat-messages"></div>
          <div class="dg-chat-input-row">
            <input id="desktop-chat-input" type="text" maxlength="200" placeholder="メッセージを入力" onkeydown="onDesktopChatKeyDown(event)"
              class="dg-chat-input">
            <button onclick="sendDesktopChat()" class="dg-chat-send">送信</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  if (ol) {
    renderDesktopChatMessages();
  }
}

function canActDesktopOnline() {
  if (!window._ol) return true;
  if (!window._olCurrentPlayer) return false;
  const me = window._ol.p === 'p1' ? 1 : 2;
  return window._olCurrentPlayer === me;
}

function playDesktopCard(idx, zone) {
  if (window._ol && !canActDesktopOnline()) {
    alert('相手のターンです');
    return;
  }

  engine.playCard(engine.state.hand[idx], zone);
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

/**
 * カードプレビュー表示（hover拡大）
 */
let _currentDragIdx = null;

function showDesktopCardPreview(event, idx, card) {
  if (idx >= 0) {
    card = engine.state.hand[idx];
  } else if (typeof card === 'string') {
    try {
      card = JSON.parse(card);
    } catch {
      return;
    }
  } else if (!card) {
    return;
  }
  
  const preview = document.getElementById('desktop-card-preview');
  const content = document.getElementById('desktop-preview-content');
  
  if (!preview || !content) return;
  
  content.innerHTML = `
    <div class="dg-preview-name">${escapeHtml(card.name)}</div>
    <div class="dg-preview-text">
      ${escapeHtml(card.text || '説明文なし')}
    </div>
  `;
  
  preview.style.display = 'block';
  preview.style.left = (event.pageX + 10) + 'px';
  preview.style.top = (event.pageY + 10) + 'px';
}

function hideDesktopCardPreview() {
  const preview = document.getElementById('desktop-card-preview');
  if (preview) {
    preview.style.display = 'none';
  }
}

/**
 * ドラッグ & ドロップ
 */
function dragDesktopCard(event, idx) {
  _currentDragIdx = idx;
  event.dataTransfer.effectAllowed = 'move';
}

function dragDesktopCardEnd() {
  _currentDragIdx = null;
}

function dragDesktopOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function dropDesktopCard(event, zone) {
  event.preventDefault();
  
  if (_currentDragIdx === null) return;
  if (window._ol && !canActDesktopOnline()) {
    _currentDragIdx = null;
    alert('相手のターンです');
    return;
  }
  
  const card = engine.state.hand[_currentDragIdx];
  if (card) {
    engine.playCard(card, zone);
    if (window._ol) olSendActionDesktop('state');
    renderDesktopGame();
  }
  
  _currentDragIdx = null;
}

function drawDesktopCard() {
  if (window._ol && !canActDesktopOnline()) {
    alert('相手のターンです');
    return;
  }

  engine.drawCard();
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function turnDesktopEnd() {
  if (window._ol && !canActDesktopOnline()) {
    alert('相手のターンです');
    return;
  }

  engine.turnEnd();
  if (window._ol) olSendActionDesktop('turn_end');
  renderDesktopGame();
}

function moveDesktopToGraveyard(fromZone) {
  if (window._ol && !canActDesktopOnline()) {
    alert('相手のターンです');
    return;
  }

  if (!engine.moveToGraveyard(-1, fromZone)) return;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function returnDesktopFromGraveyard(toZone) {
  if (window._ol && !canActDesktopOnline()) {
    alert('相手のターンです');
    return;
  }

  if (!engine.returnFromGraveyard(-1, toZone || 'hand')) return;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function undoDesktopGame() {
  if (window._ol) return;
  if (engine.undo()) renderDesktopGame();
}

function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');
  if (!name) return;
  
  const decks = getSavedDecks();
  if (decks[name]) {
    alert('このデッキは既に存在します');
    return;
  }
  
  decks[name] = [];
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  updateDesktopDeckList();
}

function deleteDesktopDeck(name) {
  if (!confirm('削除してよろしいですか？')) return;
  
  const decks = getSavedDecks();
  delete decks[name];
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  updateDesktopDeckList();
}

/**
 * PC版 デッキ編集画面
 */
function renderDesktopDeckEdit() {
  const container = document.getElementById('app-desktop');
  const deckName = window._deckEditing;
  const cards = window._deckCards;
  const account = AuthService.getCurrentAccount();
  const canCloudSave = !!account;
  
  // カード統計
  const cardCount = cards.reduce((sum, c) => sum + (c.count || 1), 0);
  const uniqueCount = cards.length;
  
  // 文明別集計
  const civCounts = {};
  cards.forEach(c => {
    const civ = c.civilization || 'multi';
    civCounts[civ] = (civCounts[civ] || 0) + (c.count || 1);
  });
  
  container.innerHTML = `
    <div class="dl-root">
      
      <!-- 左: カード検索パネル -->
      <div class="dl-panel">
        <h3 class="dl-heading">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." 
          class="dl-input"
          onkeyup="desktopSearchCards(this.value)">
        <div id="desktop-search-results" class="dl-stack dl-stack-tight"></div>
      </div>
      
      <!-- 中央: デッキ構成 -->
      <div class="dl-panel">
        <div class="dl-edit-summary">
          <div class="dl-edit-title">${escapeHtml(deckName)}</div>
          <div class="dl-edit-stats">
            <div>カード枚数: <strong>${cardCount}</strong> / 40</div>
            <div>🎴 ユニーク: <strong>${uniqueCount}</strong></div>
          </div>
        </div>
        
        <div id="desktop-deck-cards" class="dl-stack dl-stack-tight">
          ${cards.map((c, i) => `
            <div class="dl-edit-card">
              <div class="dl-edit-card-main">
                <div class="dl-edit-card-name">${escapeHtml(c.name)}</div>
                <div class="dl-edit-card-text">${escapeHtml(c.text || '')}</div>
              </div>
              <div class="dl-count-controls">
                <button onclick="decrementDesktopCardCount(${i})" class="dl-count-btn minus">−</button>
                <span class="dl-count-num">${c.count || 1}</span>
                <button onclick="incrementDesktopCardCount(${i})" class="dl-count-btn plus">+</button>
                <button onclick="removeDesktopCard(${i})" class="dl-count-btn delete">削除</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- 右: デッキ情報 -->
      <div class="dl-panel">
        <h3 class="dl-heading">文明構成</h3>
        <div class="dl-civ-list">
          ${Object.entries(civCounts).map(([civ, count]) => `
            <div class="dl-civ-item">
              <span class="dl-civ-name">${escapeHtml(getCivLabel(civ))}</span>
              <strong class="dl-civ-count">${count}枚</strong>
            </div>
          `).join('')}
        </div>
        
        <div class="dl-side-actions">
          <button onclick="playDesktopDeckGame()" class="dl-side-btn play">一人回しを開始</button>
          <button onclick="saveDesktopDeck()" class="dl-side-btn save">💾 保存</button>
          <button onclick="saveDesktopDeckToCloud()" ${canCloudSave ? '' : 'disabled'} class="dl-side-btn cloud ${canCloudSave ? '' : 'disabled'}">☁ クラウドに保存</button>
          <button onclick="renderDesktopDeckList()" class="dl-side-btn back">← 戻る</button>
        </div>
      </div>
      
    </div>
  `;
}

/**
 * デッキ編集を開く
 */
function openDesktopDeck(name) {
  const savedDecks = getSavedDecks();
  window._deckEditing = name;
  window._deckCards = savedDecks[name] ? JSON.parse(JSON.stringify(savedDecks[name])) : [];
  renderDesktopDeckEdit();
}

/**
 * カード枚数増加
 */
function incrementDesktopCardCount(idx) {
  const card = window._deckCards[idx];
  if (!card) return;
  card.count = (card.count || 1) + 1;
  if (card.count > 4) card.count = 4;
  renderDesktopDeckEdit();
}

/**
 * カード枚数減少
 */
function decrementDesktopCardCount(idx) {
  const card = window._deckCards[idx];
  if (!card) return;
  card.count = (card.count || 1) - 1;
  if (card.count < 1) {
    window._deckCards.splice(idx, 1);
  }
  renderDesktopDeckEdit();
}

/**
 * カード削除
 */
function removeDesktopCard(idx) {
  window._deckCards.splice(idx, 1);
  renderDesktopDeckEdit();
}

/**
 * デッキに カード追加
 */
function addToDesktopDeck(cardJson) {
  try {
    const card = JSON.parse(cardJson);
    
    // 既に存在するカードなら枚数+1
    const existing = window._deckCards.find(c => c.id === card.id);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      if (existing.count > 4) existing.count = 4;
    } else {
      window._deckCards.push({ ...card, count: 1 });
    }
    
    renderDesktopDeckEdit();
  } catch (e) {
    console.error('カード追加エラー:', e);
  }
}

/**
 * デッキ保存
 */
function saveDesktopDeck() {
  const decks = getSavedDecks();
  decks[window._deckEditing] = window._deckCards;
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  alert('デッキを保存しました');
}

async function saveDesktopDeckToCloud() {
  const account = AuthService.getCurrentAccount();
  if (!account) {
    alert('クラウド保存にはログインが必要です。');
    return;
  }

  const deckName = window._deckEditing;
  const deckData = window._deckCards;
  if (!deckName) return;

  const result = await NetworkService.saveDeck(account.username, account.pin, deckName, deckData);
  if (result.error) {
    alert(result.error);
    return;
  }

  window._serverDeckNames = await NetworkService.loadServerDecks(account.username, account.pin);
  alert('クラウドに保存しました。');
}

/**
 * デッキからゲーム開始
 */
function playDesktopDeckGame() {
  if (!window._deckCards.length) {
    alert('デッキが空です');
    return;
  }
  
  engine.initGame(window._deckCards);
  renderDesktopGame();
}

/**
 * 文明ラベル取得
 */
function getCivLabel(civ) {
  return {
    'fire': '火',
    'water': '水',
    'light': '光',
    'dark': '闇',
    'nature': '自然',
    'multi': '多'
  }[civ] || civ;
}

// ─── オンライン対戦（PC版）────────────────────────────────────────────────

let _olReconnectTimerDesktop = null;
const DESKTOP_ONLINE_STAGE_LIST = [
  '浮遊城ナイトフェザー',
  '蒼海都市ヴァリア',
  '黒嵐のコロシアム',
  '緑影の聖域',
  '光導の神殿跡'
];

function openDesktopOnlineWithDeck(deckName) {
  if (deckName) window._olDeckName = deckName;
  renderDesktopOnlineLobby();
}

function desktopOnlineBackToDeckList() {
  if (window._ol && window._ol.eventSource) {
    window._ol.eventSource.close();
    window._ol.eventSource = null;
  }
  if (_olReconnectTimerDesktop) {
    clearTimeout(_olReconnectTimerDesktop);
    _olReconnectTimerDesktop = null;
  }

  if (window._ol && !window._olOpponent) {
    window._ol = null;
    window._olDeckData = null;
  }

  renderDesktopDeckList();
}

function desktopOnlineRandomStage() {
  const stage = DESKTOP_ONLINE_STAGE_LIST[Math.floor(Math.random() * DESKTOP_ONLINE_STAGE_LIST.length)];
  window._olStageName = stage;
  const stageName = document.getElementById('desktop-online-stage-name');
  if (stageName) stageName.textContent = stage;
}

function desktopOnlineGetSelected() {
  const nameInput = document.getElementById('desktop-online-player-name');
  const deckSelect = document.getElementById('desktop-online-deck-select');
  const codeInput = document.getElementById('desktop-online-room-code');
  return {
    playerName: (nameInput?.value || 'Player').trim().slice(0, 20),
    deckName: (deckSelect?.value || '').trim(),
    roomCode: (codeInput?.value || '').trim().toUpperCase().slice(0, 6)
  };
}

function desktopOnlineUpdateStatus(message) {
  const box = document.getElementById('desktop-online-status');
  if (box) box.textContent = message;
}

function desktopOnlineUpdateRoomId() {
  const roomText = window._ol?.room || '------';
  const roomEl = document.getElementById('desktop-online-room-id');
  if (roomEl) roomEl.textContent = roomText;

  const copyBtn = document.getElementById('desktop-online-copy-btn');
  if (copyBtn) copyBtn.disabled = !window._ol?.room;
}

function desktopOnlineUpdateOpponentName(name) {
  const target = document.getElementById('desktop-online-opponent-name');
  if (!target) return;
  target.textContent = name || '対戦相手を待機中';
}

function desktopOnlineSetWaitingUi(isWaiting) {
  const createBtn = document.getElementById('desktop-online-create-btn');
  const cancelBtn = document.getElementById('desktop-online-cancel-btn');
  const nameInput = document.getElementById('desktop-online-player-name');
  const deckSelect = document.getElementById('desktop-online-deck-select');
  const roomInput = document.getElementById('desktop-online-room-code');
  const joinBtn = document.getElementById('desktop-online-join-btn');

  if (createBtn) {
    createBtn.disabled = isWaiting;
    createBtn.textContent = isWaiting ? '対戦相手を待機中…' : 'ルームを作成';
    createBtn.classList.toggle('is-waiting', isWaiting);
  }

  if (cancelBtn) cancelBtn.classList.toggle('open', isWaiting);
  if (nameInput) nameInput.disabled = isWaiting;
  if (deckSelect) deckSelect.disabled = isWaiting;
  if (roomInput) roomInput.disabled = isWaiting;
  if (joinBtn) joinBtn.disabled = isWaiting;
}

async function desktopOnlineCopyRoomId(silent = false) {
  const room = window._ol?.room;
  if (!room) {
    if (!silent) desktopOnlineUpdateStatus('先にルームを作成してください。');
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(room);
      if (!silent) desktopOnlineUpdateStatus(`ルームID ${room} をコピーしました。`);
    } else {
      window.prompt('ルームIDをコピーしてください', room);
      if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
    }
  } catch (err) {
    console.warn('clipboard write failed', err);
    window.prompt('ルームIDをコピーしてください', room);
    if (!silent) desktopOnlineUpdateStatus('ルームIDを手動でコピーしてください。');
  }
}

async function desktopOnlineInviteFriend() {
  if (!window._ol?.room) {
    desktopOnlineUpdateStatus('フレンド招待にはルーム作成が必要です。');
    return;
  }
  await desktopOnlineCopyRoomId(true);
  desktopOnlineUpdateStatus('ルームIDをコピーしました。DM/LINEで共有してください。');
}

function desktopOnlineOpenRecruitX() {
  const room = window._ol?.room;
  const text = room
    ? `DM Solitaire 対戦募集 / ルームID: ${room} #DMSolitaire`
    : 'DM Solitaire 対戦募集 #DMSolitaire';
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

function desktopOnlineCancelWaiting() {
  const selected = desktopOnlineGetSelected();
  if (selected.deckName) window._olDeckName = selected.deckName;

  if (window._ol && window._ol.eventSource) {
    window._ol.eventSource.close();
    window._ol.eventSource = null;
  }
  if (_olReconnectTimerDesktop) {
    clearTimeout(_olReconnectTimerDesktop);
    _olReconnectTimerDesktop = null;
  }

  window._ol = null;
  window._olDeckData = null;
  window._olOpponent = null;
  window._olCurrentPlayer = null;

  desktopOnlineSetWaitingUi(false);
  desktopOnlineUpdateRoomId();
  desktopOnlineUpdateOpponentName('対戦相手を待機中');
  desktopOnlineUpdateStatus('待機をキャンセルしました。');
}

function desktopOnlineStartWaitingForJoin() {
  if (!window._ol || window._ol.p !== 'p1') return;

  if (_olReconnectTimerDesktop) {
    clearTimeout(_olReconnectTimerDesktop);
    _olReconnectTimerDesktop = null;
  }
  if (window._ol.eventSource) {
    window._ol.eventSource.close();
    window._ol.eventSource = null;
  }

  const connect = () => {
    if (!window._ol || window._ol.p !== 'p1') return;

    const expectedRoom = window._ol.room;
    const es = NetworkService.createEventSource(expectedRoom, 'p1');
    window._ol.eventSource = es;

    es.addEventListener('joined', (e) => {
      const data = JSON.parse(e.data);
      if (!window._ol || window._ol.room !== expectedRoom) return;

      window._ol.p2Name = data.p2_name || 'Player 2';
      desktopOnlineUpdateOpponentName(window._ol.p2Name);
      desktopOnlineUpdateStatus(`${window._ol.p2Name} が入室しました。ゲームを開始します…`);

      es.close();
      window._ol.eventSource = null;

      if (_olReconnectTimerDesktop) {
        clearTimeout(_olReconnectTimerDesktop);
        _olReconnectTimerDesktop = null;
      }

      setTimeout(() => {
        if (window._ol && window._ol.room === expectedRoom && window._ol.p2Name) {
          startDesktopOnlineGame();
        }
      }, 550);
    });

    es.onerror = () => {
      es.close();
      if (!window._ol || window._ol.p !== 'p1') return;

      window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
      if (window._ol.reconnectAttempt <= 3) {
        const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
        desktopOnlineUpdateStatus(`接続を再試行中… (${window._ol.reconnectAttempt}/3)`);
        _olReconnectTimerDesktop = setTimeout(connect, delay);
      } else {
        desktopOnlineUpdateStatus('接続が不安定なため待機を終了しました。再度お試しください。');
        desktopOnlineCancelWaiting();
      }
    };
  };

  window._ol.reconnectAttempt = 0;
  connect();
}

async function desktopOnlineCreateRoom() {
  if (window._ol && window._ol.p === 'p1' && window._ol.room && !window._ol.p2Name) {
    desktopOnlineUpdateStatus(`ルームID ${window._ol.room} で待機中です。`);
    return;
  }

  const { playerName, deckName } = desktopOnlineGetSelected();
  if (!deckName) {
    desktopOnlineUpdateStatus('デッキを選択してください。');
    return;
  }

  const deckData = await getDesktopDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    desktopOnlineUpdateStatus('デッキが取得できませんでした。');
    return;
  }

  desktopOnlineSetWaitingUi(true);
  desktopOnlineUpdateStatus('ルームを作成しています…');

  let result;
  try {
    result = await NetworkService.createRoom(playerName || 'Player 1');
  } catch (err) {
    console.error('create room error', err);
    desktopOnlineSetWaitingUi(false);
    desktopOnlineUpdateStatus('サーバーに接続できませんでした。');
    return;
  }

  if (result.error) {
    desktopOnlineSetWaitingUi(false);
    desktopOnlineUpdateStatus(result.error);
    return;
  }

  const room = result.room;
  window._ol = { room, p: 'p1', p1Name: playerName || 'Player 1', p2Name: null, eventSource: null, reconnectAttempt: 0 };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  window._olOpponent = null;

  desktopOnlineUpdateRoomId();
  desktopOnlineUpdateOpponentName('対戦相手の入室待ち');
  desktopOnlineUpdateStatus(`ルームID ${room} を共有してください。相手の参加を待機中です。`);
  desktopOnlineStartWaitingForJoin();
}

async function desktopOnlineJoinRoom() {
  const { playerName, deckName, roomCode } = desktopOnlineGetSelected();

  if (window._ol && window._ol.p === 'p1' && window._ol.room && !window._ol.p2Name) {
    desktopOnlineUpdateStatus('待機中のルームがあります。キャンセルしてから参加してください。');
    return;
  }

  if (!deckName) {
    desktopOnlineUpdateStatus('デッキを選択してください。');
    return;
  }
  if (!roomCode || roomCode.length !== 6) {
    desktopOnlineUpdateStatus('ルームコードは6文字で入力してください。');
    return;
  }

  const deckData = await getDesktopDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    desktopOnlineUpdateStatus('デッキが取得できませんでした。');
    return;
  }

  const joinBtn = document.getElementById('desktop-online-join-btn');
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.textContent = '参加中…';
  }
  desktopOnlineUpdateStatus('ルームに参加しています…');

  let result;
  try {
    result = await NetworkService.joinRoom(roomCode, playerName || 'Player 2');
  } catch (err) {
    console.error('join room error', err);
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'ルームに参加';
    }
    desktopOnlineUpdateStatus('サーバーに接続できませんでした。');
    return;
  }

  if (result.error) {
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'ルームに参加';
    }
    desktopOnlineUpdateStatus(result.error);
    return;
  }

  window._ol = {
    room: roomCode,
    p: 'p2',
    p1Name: result.p1_name || 'Player 1',
    p2Name: playerName || 'Player 2',
    eventSource: null,
    reconnectAttempt: 0
  };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  window._olOpponent = null;

  desktopOnlineUpdateRoomId();
  desktopOnlineUpdateOpponentName(result.p1_name || 'Player 1');
  desktopOnlineUpdateStatus('ルームに参加しました。ゲーム画面へ移動します。');

  startDesktopOnlineGame();
}

function renderDesktopOnlineLobby() {
  const container = document.getElementById('app-desktop');
  const account = AuthService.getCurrentAccount();
  const savedDecks = getSavedDecks();
  const localNames = Object.keys(savedDecks);
  const cloudNames = Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [];

  const deckOptions = [
    ...localNames.map(name => ({ label: `ローカル: ${name}`, value: name })),
    ...cloudNames.map(name => ({ label: `クラウド: ${name}`, value: name }))
  ];

  const optionsHtml = deckOptions.length
    ? deckOptions.map(opt => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join('')
    : '<option value="">利用可能なデッキがありません</option>';

  const defaultName = window._ol
    ? (window._ol.p === 'p1' ? window._ol.p1Name : window._ol.p2Name)
    : (account?.username || '');

  container.innerHTML = `
    <div class="dol-root">
      <div class="dol-panel dol-owner">
        <div class="dol-strip">
          <div class="dol-badge-title">OWNER</div>
          <div class="dol-badge-sub">準備中</div>
        </div>

        <div class="dol-profile">
          <div class="dol-avatar">
            ${escapeHtml((defaultName || 'P').charAt(0).toUpperCase())}
          </div>
          <div class="dol-grow">
            <div class="dol-label">プレイヤー名</div>
            <input id="desktop-online-player-name" type="text" value="${escapeHtml(defaultName)}" class="dol-input">
          </div>
        </div>

        <div>
          <div class="dol-label dol-label-owner">デッキ1</div>
          <select id="desktop-online-deck-select" class="dol-select">
            <option value="">デッキを選択してください</option>
            ${optionsHtml}
          </select>
        </div>

        <div class="dol-owner-actions">
          <button type="button" onclick="desktopOnlineBackToDeckList()" class="dol-owner-btn back">← デッキ一覧へ戻る</button>
          <button type="button" onclick="logout()" class="dol-owner-btn logout">ログアウト</button>
        </div>
      </div>

      <div class="dol-panel dol-center">
        <div class="dol-head">
          <div>
            <div class="dol-head-kicker">ルームマッチ</div>
            <div class="dol-head-title">オンライン対戦ロビー</div>
          </div>
          <button type="button" onclick="desktopOnlineCopyRoomId()" id="desktop-online-copy-btn" class="dol-copy-btn">ルームIDコピー</button>
        </div>

        <div class="dol-room-card">
          <div class="dol-room-label">ルームID</div>
          <div id="desktop-online-room-id" class="dol-room-code">------</div>
        </div>

        <div class="dol-stat-grid">
          <div class="dol-stat-box">
            <div class="dol-stat-label">ルール</div>
            <div class="dol-stat-value">BO1</div>
          </div>
          <div class="dol-stat-box">
            <div class="dol-stat-label">先手</div>
            <div class="dol-stat-value">ランダム</div>
          </div>
        </div>

        <div class="dol-stage-box">
          <div class="dol-stage-head">
            <div class="dol-stage-label">ステージ</div>
            <button type="button" onclick="desktopOnlineRandomStage()" class="dol-stage-shuffle">シャッフル</button>
          </div>
          <div id="desktop-online-stage-name" class="dol-stage-name">ステージ未選択</div>
        </div>

        <button type="button" onclick="desktopOnlineCreateRoom()" id="desktop-online-create-btn" class="dol-create-btn">ルームを作成</button>

        <button type="button" onclick="desktopOnlineCancelWaiting()" id="desktop-online-cancel-btn" class="dol-cancel-btn">待機をキャンセル</button>

        <div id="desktop-online-status" class="dol-status">ルームを作成するか、右側のルームID入力から参加してください。</div>
      </div>

      <div class="dol-panel dol-guest">
        <div class="dol-strip">
          <div class="dol-badge-title">GUEST</div>
          <div class="dol-badge-sub">募集中</div>
        </div>

        <div class="dol-opponent-card">
          <div class="dol-opponent-label">対戦相手</div>
          <div id="desktop-online-opponent-name" class="dol-opponent-name">対戦相手を待機中</div>
        </div>

        <div>
          <div class="dol-room-entry-label">ルームIDで参加</div>
          <input id="desktop-online-room-code" type="text" placeholder="例: ABCD12" maxlength="6" class="dol-room-input">
        </div>

        <button type="button" onclick="desktopOnlineJoinRoom()" id="desktop-online-join-btn" class="dol-join-btn">ルームに参加</button>

        <div class="dol-guest-actions">
          <button type="button" onclick="desktopOnlineInviteFriend()" class="dol-ghost-action">フレンド招待</button>
          <button type="button" onclick="desktopOnlineOpenRecruitX()" class="dol-ghost-action">Xで募集</button>
        </div>

        <div class="dol-note">友達と遊ぶ場合は、中央のルームIDを共有してください。<br>野良募集は「Xで募集」を利用できます。</div>
      </div>
    </div>
  `;

  if (!window._olStageName) {
    desktopOnlineRandomStage();
  } else {
    const stageEl = document.getElementById('desktop-online-stage-name');
    if (stageEl) stageEl.textContent = window._olStageName;
  }

  const select = document.getElementById('desktop-online-deck-select');
  if (select && window._olDeckName) {
    select.value = window._olDeckName;
  }

  desktopOnlineUpdateRoomId();

  if (window._ol && window._ol.p === 'p1') {
    desktopOnlineSetWaitingUi(!window._ol.p2Name);
    desktopOnlineUpdateOpponentName(window._ol.p2Name || '対戦相手の入室待ち');

    if (window._ol.p2Name) {
      desktopOnlineUpdateStatus('対戦相手が参加済みです。ゲームを開始できます。');
    } else {
      desktopOnlineUpdateStatus(`ルームID ${window._ol.room} を共有して参加を待機中です。`);
      if (!window._ol.eventSource) {
        desktopOnlineStartWaitingForJoin();
      }
    }
  } else {
    desktopOnlineSetWaitingUi(false);
    if (window._ol && window._ol.p === 'p2') {
      desktopOnlineUpdateOpponentName(window._ol.p1Name || 'Player 1');
      desktopOnlineUpdateStatus('参加済みのルームがあります。');
      const roomInput = document.getElementById('desktop-online-room-code');
      if (roomInput) roomInput.value = window._ol.room || '';
    } else {
      desktopOnlineUpdateOpponentName('対戦相手を待機中');
      desktopOnlineUpdateStatus('ルームを作成するか、右側のルームID入力から参加してください。');
    }
  }
}

async function getDesktopDeckDataForOnline(deckName) {
  const savedDecks = getSavedDecks();
  if (savedDecks[deckName]) return Array.isArray(savedDecks[deckName]) ? savedDecks[deckName] : null;
  const account = AuthService.getCurrentAccount();
  if (account) return await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
  return null;
}

function startDesktopOnlineGame() {
  const deckData = window._olDeckData;
  if (!deckData || !window._ol) return;

  if (_olReconnectTimerDesktop) {
    clearTimeout(_olReconnectTimerDesktop);
    _olReconnectTimerDesktop = null;
  }

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
    window._ol.eventSource = null;
  }

  window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30, graveyard: 0 };
  window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
  window._olChatLogDesktop = [];
  appendDesktopChatMessage('SYSTEM', 'オンライン対戦を開始しました。', 'sys');

  engine.initGame(deckData);
  olStartEventListenerDesktop();
  renderDesktopGame();

  setTimeout(() => olSendActionDesktop('state'), 200);
}

function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
  }

  const room = window._ol.room;
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
  window._ol.eventSource = es;

  es.addEventListener('opponent_state', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;

    if (other) window._olOpponent = other;
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;

    renderDesktopGame();
  });

  es.addEventListener('turn_end', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (data.turn) engine.state.turn = data.turn;
    if (data.active) {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      showDesktopTurnNotification('あなたのターンです！');
    }

    renderDesktopGame();
  });

  es.addEventListener('chat_message', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    appendDesktopChatMessage(data.name || 'Player', data.msg || '', data.p || '');
  });

  es.onerror = () => {
    es.close();

    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    if (window._ol.reconnectAttempt < 3) {
      const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
      _olReconnectTimerDesktop = setTimeout(() => {
        if (window._ol && window._ol.room === room) {
          olStartEventListenerDesktop();
        }
      }, delay);
    } else {
      alert('接続が切れました。ロビーに戻ります。');
      window._ol = null;
      window._olOpponent = null;
      window._olCurrentPlayer = null;
      renderDesktopDeckList();
    }
  };
}

function olSendActionDesktop(actionType) {
  if (!window._ol || !engine) return;
  const s = engine.state;
  const payload = {
    room: window._ol.room,
    p: window._ol.p,
    type: actionType,
    turn: s.turn,
    active: actionType === 'turn_end' ? (window._ol.p === 'p1' ? 'p2' : 'p1') : window._ol.p,
    p1: window._ol.p === 'p1' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: s.graveyard.length } : null,
    p2: window._ol.p === 'p2' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: s.graveyard.length } : null
  };
  NetworkService.sendAction(payload);
}
