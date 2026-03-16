/**
 * DM Solitaire - Mobile UI
 * SP版レイアウト（1カラム: 敵 | バトル | 手札）
 */

let engineMobile = null;
let _mobileTurnNoticeTimer = null;
let _mobileChatOpen = false;

function escapeHtmlMobile(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** onclick 等のシングルクォート文字列用（デッキ名に ' が含まれると壊れるのを防ぐ） */
function escapeAttrJsMobile(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function ensureMobileChatLog() {
  if (!Array.isArray(window._olChatLogMobile)) {
    window._olChatLogMobile = [];
  }
  return window._olChatLogMobile;
}

function renderMobileBackCards(count, palette = 'default') {
  const safeCount = Math.max(0, Number(count) || 0);
  const visible = Math.min(safeCount, 10);
  const cardClass = palette === 'shield' ? 'mg-back-card shield' : 'mg-back-card';

  const cards = Array.from({ length: visible }).map(() => `
    <div class="${cardClass}"></div>
  `).join('');

  const rest = safeCount > visible
    ? `<div class="mg-more-chip">+${safeCount - visible}</div>`
    : '';

  if (!cards && !rest) {
    return '<div class="mg-back-empty">0</div>';
  }

  return `<div class="mg-back-cards">${cards}${rest}</div>`;
}

function showMobileTurnNotification(message) {
  let el = document.getElementById('mobile-turn-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mobile-turn-toast';
    el.className = 'mg-turn-toast';
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.style.opacity = '1';

  if (_mobileTurnNoticeTimer) {
    clearTimeout(_mobileTurnNoticeTimer);
  }
  _mobileTurnNoticeTimer = setTimeout(() => {
    const current = document.getElementById('mobile-turn-toast');
    if (current) current.style.opacity = '0';
  }, 3000);
}

function renderMobileChatMessages() {
  const box = document.getElementById('mobile-chat-messages');
  if (!box) return;

  const log = ensureMobileChatLog();
  box.innerHTML = log.map((entry) => {
    const mine = entry.p && window._ol && entry.p === window._ol.p;
    const roleClass = mine ? 'mine' : 'other';
    return `
      <div class="mg-chat-item ${roleClass}">
        <div class="mg-chat-name">${escapeHtmlMobile(entry.name || 'Player')}</div>
        <div class="mg-chat-text">${escapeHtmlMobile(entry.msg || '')}</div>
      </div>
    `;
  }).join('');

  box.scrollTop = box.scrollHeight;
}

function appendMobileChatMessage(name, msg, p = '') {
  const log = ensureMobileChatLog();
  log.push({ name, msg, p });
  if (log.length > 100) log.shift();
  renderMobileChatMessages();
}

function toggleMobileChatPanel() {
  _mobileChatOpen = !_mobileChatOpen;
  renderMobileGame();
}

async function sendMobileChat() {
  if (!window._ol) return;

  const input = document.getElementById('mobile-chat-input');
  const msg = (input?.value || '').trim();
  if (!msg) return;

  input.value = '';
  try {
    const ok = await NetworkService.sendChat(window._ol.room, window._ol.p, msg);
    if (!ok) {
      appendMobileChatMessage('SYSTEM', 'メッセージ送信に失敗しました。', 'sys');
    }
  } catch (err) {
    console.error('send mobile chat error', err);
    appendMobileChatMessage('SYSTEM', 'メッセージ送信に失敗しました。', 'sys');
  }
}

function onMobileChatKeyDown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  sendMobileChat();
}

function canActMobileOnline() {
  if (!window._ol) return true;
  if (!window._olCurrentPlayer) return false;
  const myNum = window._ol.p === 'p1' ? 1 : 2;
  return window._olCurrentPlayer === myNum;
}

/** localStorage dm_decks を安全に取得（破損時は {}） */
function getSavedDecksMobile() {
  try {
    const raw = localStorage.getItem('dm_decks');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('dm_decks parse error', e);
    return {};
  }
}

/**
 * SP版UI初期化
 */
function initMobileUI() {
  engineMobile = new GameEngine();
  renderMobileDeckList();
}

/**
 * 1カラムレイアウトのデッキ一覧画面
 */
function renderMobileDeckList() {
  const container = document.getElementById('app-mobile');
  
  container.innerHTML = `
    <div class="ml-root">
      
      <!-- ヘッダー -->
      <div class="ml-header">
        <span class="ml-title">DM Solitaire</span>
        <button type="button" onclick="logout()" class="ml-logout-btn">ログアウト</button>
      </div>
      
      <!-- メインコンテンツ -->
      <div class="ml-main">
        
        <!-- デッキ一覧 -->
        <div class="ml-panel">
          <h3 class="ml-heading">デッキを選択</h3>
          <button onclick="newMobileDeck()" 
            class="ml-main-btn">
            新規デッキ
          </button>
          <div id="mobile-deck-list" class="ml-stack"></div>
        </div>
        
        <!-- カード検索 -->
        <div class="ml-panel">
          <h3 class="ml-heading">カード検索</h3>
          <input type="text" id="mobile-search-input" placeholder="カード名..." 
            class="ml-input"
            onkeyup="mobileSearchCards(this.value)">
          <div id="mobile-search-results" class="ml-stack ml-stack-tight"></div>
        </div>
        
      </div>
    </div>
  `;
  
  updateMobileDeckList();
}

/**
 * デッキ一覧を更新
 */
function updateMobileDeckList() {
  const savedDecks = getSavedDecksMobile();
  const account = AuthService.getCurrentAccount();
  
  const deckList = document.getElementById('mobile-deck-list');
  deckList.innerHTML = '';
  
  // ローカルデッキ
  for (const [name, cards] of Object.entries(savedDecks)) {
    const count = cards?.length || 0;
    const el = document.createElement('div');
    el.className = 'ml-deck-item';
    el.innerHTML = `
      <div class="ml-deck-name">${escapeHtmlMobile(name)}</div>
      <div class="ml-deck-meta">デッキ: ${count}枚</div>
      <div class="ml-item-actions">
        <button onclick="openMobileDeck('${escapeAttrJsMobile(name)}')" class="ml-item-btn edit">編集</button>
        <button onclick="startMobileGame('${escapeAttrJsMobile(name)}')" class="ml-item-btn play">一人回し</button>
        <button onclick="showMobileOnlineModal('${escapeAttrJsMobile(name)}')" class="ml-item-btn online">オンライン</button>
        <button onclick="deleteMobileDeck('${escapeAttrJsMobile(name)}')" class="ml-item-btn delete">削除</button>
      </div>
    `;
    deckList.appendChild(el);
  }
  
  // サーバーデッキ
  if (account && window._serverDeckNames) {
    for (const name of window._serverDeckNames) {
      const el = document.createElement('div');
      el.className = 'ml-deck-item cloud';
      el.innerHTML = `
        <div class="ml-deck-name">クラウド: ${escapeHtmlMobile(name)}</div>
        <div class="ml-item-actions ml-item-actions-cloud">
          <button onclick="startMobileGame('${escapeAttrJsMobile(name)}')" class="ml-item-btn play">一人回し</button>
          <button onclick="showMobileOnlineModal('${escapeAttrJsMobile(name)}')" class="ml-item-btn online">オンライン</button>
        </div>
      `;
      deckList.appendChild(el);
    }
  }
}

/**
 * カード検索（SP版）
 */
async function mobileSearchCards(q) {
  if (!q.trim()) {
    document.getElementById('mobile-search-results').innerHTML = '';
    return;
  }
  
  const results = await NetworkService.searchCards(q, 1);
  const container = document.getElementById('mobile-search-results');
  container.innerHTML = '';
  
  results.slice(0, 10).forEach(card => {
    const el = document.createElement('div');
    el.className = 'ml-search-item';
    el.innerHTML = `
      <div class="ml-search-name">${escapeHtmlMobile(card.name)}</div>
      <div class="ml-search-text">${escapeHtmlMobile(card.text || '')}</div>
      <button onclick="addToMobileDeck('${escapeHtmlMobile(JSON.stringify(card).replace(/'/g, "\\'"))}')" 
        class="ml-add-btn">+追加</button>
    `;
    container.appendChild(el);
  });
}

/**
 * ゲーム開始（SP版）
 */
async function startMobileGame(deckName) {
  const savedDecks = getSavedDecksMobile();
  let deckData = null;
  
  if (savedDecks[deckName]) {
    deckData = savedDecks[deckName];
  } else {
    const account = AuthService.getCurrentAccount();
    if (account) {
      deckData = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
    }
  }
  
  if (!deckData || !deckData.length) {
    alert('デッキが取得できませんでした。ネットワークまたはデッキ名を確認してください。');
    return;
  }
  
  window._ol = null;
  window._olOpponent = null;
  engineMobile.initGame(deckData);
  renderMobileGame();
}

/**
 * ゲーム画面レンダリング（SP版）
 */
function renderMobileGame() {
  const state = engineMobile.getState();
  const container = document.getElementById('app-mobile');
  const ol = window._ol;
  const opp = window._olOpponent || {};
  const myNum = ol ? (ol.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = ol && window._olCurrentPlayer && window._olCurrentPlayer === myNum;
  const myName = ol ? (ol.p === 'p1' ? (ol.p1Name || 'Player 1') : (ol.p2Name || 'Player 2')) : '自分';
  const oppName = ol ? (ol.p === 'p1' ? (ol.p2Name || 'Player 2') : (ol.p1Name || 'Player 1')) : '相手';
  
  container.innerHTML = `
    <div class="mg-root">
      
      <!-- ヘッダー -->
      <div class="mg-header">
        ターン ${state.turn} | デッキ: ${state.deck.length}
        ${ol ? ` | <span class="mg-turn-state ${isMyTurn ? 'mine' : 'opponent'}">${isMyTurn ? '自分のターン' : '相手のターン'}</span>` : ''}
      </div>
      ${ol ? `<div class="mg-online-meta">
        オンライン対戦: ${escapeHtmlMobile(ol.p1Name)} vs ${ol.p2Name ? escapeHtmlMobile(ol.p2Name) : '待機中'}
      </div>` : ''}

      ${ol ? `
        <div class="mg-opp-wrap">
          <div class="mg-opp-title">相手エリア: ${escapeHtmlMobile(oppName)}</div>
          <div class="mg-opp-grid">
            <div class="mg-opp-panel">
              <div class="mg-opp-label">手札 (${Number(opp.hand ?? 0)})</div>
              ${renderMobileBackCards(Number(opp.hand ?? 0))}
            </div>
            <div class="mg-opp-panel">
              <div class="mg-opp-label">シールド (${Number(opp.shields ?? 0)})</div>
              ${renderMobileBackCards(Number(opp.shields ?? 0), 'shield')}
            </div>
            <div class="mg-opp-panel">
              <div class="mg-opp-label">バトル (${Number(opp.battleZone ?? 0)})</div>
              ${renderMobileBackCards(Number(opp.battleZone ?? 0))}
            </div>
            <div class="mg-opp-panel">
              <div class="mg-opp-label">マナ (${Number(opp.manaZone ?? 0)})</div>
              ${renderMobileBackCards(Number(opp.manaZone ?? 0))}
            </div>
          </div>
          <div class="mg-opp-panel mg-opp-grave">
            <div class="mg-opp-label">墓地 (${Number(opp.graveyard ?? 0)})</div>
            ${renderMobileBackCards(Number(opp.graveyard ?? 0))}
          </div>
        </div>
      ` : ''}
      
      <!-- メインゲーム画面 -->
      <div class="mg-main">

        <div class="mg-me-wrap">
          <div class="mg-me-title">自分エリア: ${escapeHtmlMobile(myName)}</div>
        </div>
        
        <!-- バトルゾーン -->
        <div class="mg-zone-section battle">
          <div class="mg-zone-title">バトルゾーン (${state.battleZone.length})</div>
          <div class="mg-card-grid">
            ${state.battleZone.map(c => `
              <div class="mg-card-chip battle"
                title="${escapeHtmlMobile(c.name)}">
                ${escapeHtmlMobile(c.name).substring(0, 4)}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- マナゾーン -->
        <div class="mg-zone-section mana">
          <div class="mg-zone-title">マナゾーン (${state.manaZone.length})</div>
          <div class="mg-card-grid">
            ${state.manaZone.map(c => `
              <div class="mg-card-chip mana"
                title="${escapeHtmlMobile(c.name)}">
                ${escapeHtmlMobile(c.name).substring(0, 4)}
              </div>
            `).join('')}
          </div>
        </div>
        
        <!-- シールド -->
        <div class="mg-zone-section shield">
          <div class="mg-zone-title">シールド (${state.shields.length})</div>
          <div class="mg-card-grid center">
            ${state.shields.map(() => `
              <div class="mg-card-chip shield">
                SH
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 墓地 -->
        <div class="mg-zone-section grave">
          <div class="mg-zone-title">墓地 (${state.graveyard.length})</div>
          <div class="mg-card-grid">
            ${state.graveyard.slice(-12).map(c => `
              <div class="mg-card-chip grave"
                title="${escapeHtmlMobile(c.name)}">
                ${escapeHtmlMobile(c.name).substring(0, 3)}
              </div>
            `).join('')}
            ${state.graveyard.length > 12 ? `<div class="mg-more-chip">+${state.graveyard.length - 12}</div>` : ''}
          </div>
        </div>
        
      </div>
      
      <!-- 手札（固定下部） -->
      <div class="mg-hand-dock">
        <div class="mg-hand-title">手札 (${state.hand.length})</div>
        <div class="mg-hand-row">
          ${state.hand.map((c, i) => `
            <div class="mg-card-chip hand"
              onclick="playMobileCard(${i})"
              title="${escapeHtmlMobile(c.name)}">
              ${escapeHtmlMobile(c.name).substring(0, 5)}
            </div>
          `).join('')}
        </div>
      </div>

      ${ol ? `
        <div class="mg-chat-wrap">
          <button onclick="toggleMobileChatPanel()" class="mg-chat-toggle">
            ${_mobileChatOpen ? 'チャットを閉じる' : 'チャットを開く'}
          </button>
          <div id="mobile-chat-panel" class="mg-chat-panel ${_mobileChatOpen ? 'open' : ''}">
            <div id="mobile-chat-messages" class="mg-chat-messages"></div>
            <div class="mg-chat-input-row">
              <input id="mobile-chat-input" type="text" maxlength="200" placeholder="メッセージを入力" onkeydown="onMobileChatKeyDown(event)"
                class="mg-chat-input">
              <button onclick="sendMobileChat()" class="mg-chat-send">送信</button>
            </div>
          </div>
        </div>
      ` : ''}
      
      <!-- ボタン -->
      <div class="mg-action-row">
        <button onclick="drawMobileCard()" class="mg-btn draw">ドロー</button>
        <button onclick="turnMobileEnd()" class="mg-btn end">ターン終</button>
        <button onclick="moveMobileToGraveyard('battle')" class="mg-btn battle-grave">戦→墓</button>
        <button onclick="moveMobileToGraveyard('mana')" class="mg-btn mana-grave">マナ→墓</button>
        <button onclick="returnMobileFromGraveyard('hand')" class="mg-btn grave-return">墓→手</button>
        ${!window._ol ? '<button onclick="undoMobileGame()" class="mg-btn undo">やり直し</button>' : ''}
        <button onclick="renderMobileDeckList()" class="mg-btn back">戻る</button>
      </div>
      
    </div>
  `;

  if (ol) {
    renderMobileChatMessages();
  }
}

function playMobileCard(idx) {
  if (window._ol && !canActMobileOnline()) {
    alert('相手のターンです');
    return;
  }

  const zone = confirm('バトルに配置? (OK: バトル, キャンセル: マナ)') ? 'battle' : 'mana';
  engineMobile.playCard(engineMobile.state.hand[idx], zone);
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function drawMobileCard() {
  if (window._ol && !canActMobileOnline()) {
    alert('相手のターンです');
    return;
  }

  engineMobile.drawCard();
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function turnMobileEnd() {
  if (window._ol && !canActMobileOnline()) {
    alert('相手のターンです');
    return;
  }

  engineMobile.turnEnd();
  if (window._ol) olSendActionMobile('turn_end');
  renderMobileGame();
}

function moveMobileToGraveyard(fromZone) {
  if (window._ol && !canActMobileOnline()) {
    alert('相手のターンです');
    return;
  }

  if (!engineMobile.moveToGraveyard(-1, fromZone)) return;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function returnMobileFromGraveyard(toZone) {
  if (window._ol && !canActMobileOnline()) {
    alert('相手のターンです');
    return;
  }

  if (!engineMobile.returnFromGraveyard(-1, toZone || 'hand')) return;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function undoMobileGame() {
  if (window._ol) return;
  if (engineMobile.undo()) renderMobileGame();
}

function newMobileDeck() {
  const name = prompt('デッキ名を入力:');
  if (!name) return;
  
  const decks = getSavedDecksMobile();
  if (decks[name]) {
    alert('このデッキは既に存在します');
    return;
  }
  
  decks[name] = [];
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  updateMobileDeckList();
}

function deleteMobileDeck(name) {
  if (!confirm('削除してよろしいですか？')) return;
  
  const decks = getSavedDecksMobile();
  delete decks[name];
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  updateMobileDeckList();
}

/**
 * SP版 デッキ編集画面
 */
function renderMobileDeckEdit() {
  const container = document.getElementById('app-mobile');
  const deckName = window._deckEditing;
  const cards = window._deckCards;
  const account = AuthService.getCurrentAccount();
  const canCloudSave = !!account;
  
  const cardCount = cards.reduce((sum, c) => sum + (c.count || 1), 0);
  
  container.innerHTML = `
    <div class="ml-root">
      
      <!-- ヘッダー -->
      <div class="ml-header ml-edit-header">
        <button type="button" onclick="renderMobileDeckList()" class="ml-back-btn">←</button>
        <span class="ml-edit-title">${escapeHtmlMobile(deckName)}</span>
        <span class="ml-edit-count">${cardCount}/40</span>
      </div>
      
      <!-- メインコンテンツ -->
      <div class="ml-main">
        
        <!-- カード検索 -->
        <div class="ml-panel">
          <h3 class="ml-heading">カード追加</h3>
          <input type="text" id="mobile-search-input" placeholder="カード名..." 
            class="ml-input"
            onkeyup="mobileSearchCards(this.value)">
          <div id="mobile-search-results" class="ml-stack ml-stack-tight"></div>
        </div>
        
        <!-- デッキリスト -->
        <div class="ml-panel">
          <h3 class="ml-heading">デッキカード</h3>
          <div id="mobile-deck-cards" class="ml-stack">
            ${cards.map((c, i) => `
              <div class="ml-edit-card">
                <div class="ml-edit-card-name">${escapeHtmlMobile(c.name)}</div>
                <div class="ml-edit-card-row">
                  <span class="ml-edit-card-text">${escapeHtmlMobile(c.text || '')}</span>
                  <div class="ml-count-controls">
                    <button onclick="decrementMobileCardCount(${i})" class="ml-count-btn minus">−</button>
                    <span class="ml-count-num">${c.count || 1}</span>
                    <button onclick="incrementMobileCardCount(${i})" class="ml-count-btn plus">+</button>
                    <button onclick="removeMobileCard(${i})" class="ml-count-btn delete">削除</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
      </div>
      
      <!-- ボタン -->
      <div class="ml-edit-actions">
        <button onclick="playMobileDeckGame()" class="ml-edit-btn play">一人回しを開始</button>
        <button onclick="saveMobileDeck()" class="ml-edit-btn save">💾 保存</button>
        <button onclick="saveMobileDeckToCloud()" ${canCloudSave ? '' : 'disabled'} class="ml-edit-btn cloud ${canCloudSave ? '' : 'disabled'}">☁ 保存</button>
      </div>
      
    </div>
  `;
}

/**
 * デッキ編集を開く（SP版）
 */
function openMobileDeck(name) {
  const savedDecks = getSavedDecksMobile();
  window._deckEditing = name;
  window._deckCards = savedDecks[name] ? JSON.parse(JSON.stringify(savedDecks[name])) : [];
  renderMobileDeckEdit();
}

/**
 * カード枚数増加（SP版）
 */
function incrementMobileCardCount(idx) {
  const card = window._deckCards[idx];
  if (!card) return;
  card.count = (card.count || 1) + 1;
  if (card.count > 4) card.count = 4;
  renderMobileDeckEdit();
}

/**
 * カード枚数減少（SP版）
 */
function decrementMobileCardCount(idx) {
  const card = window._deckCards[idx];
  if (!card) return;
  card.count = (card.count || 1) - 1;
  if (card.count < 1) {
    window._deckCards.splice(idx, 1);
  }
  renderMobileDeckEdit();
}

/**
 * カード削除（SP版）
 */
function removeMobileCard(idx) {
  window._deckCards.splice(idx, 1);
  renderMobileDeckEdit();
}

/**
 * デッキに カード追加（SP版）
 */
function addToMobileDeck(cardJson) {
  try {
    const card = JSON.parse(cardJson);
    
    const existing = window._deckCards.find(c => c.id === card.id);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      if (existing.count > 4) existing.count = 4;
    } else {
      window._deckCards.push({ ...card, count: 1 });
    }
    
    renderMobileDeckEdit();
  } catch (e) {
    console.error('カード追加エラー:', e);
  }
}

/**
 * デッキ保存（SP版）
 */
function saveMobileDeck() {
  const decks = getSavedDecksMobile();
  decks[window._deckEditing] = window._deckCards;
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  alert('デッキを保存しました');
}

async function saveMobileDeckToCloud() {
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
 * デッキからゲーム開始（SP版）
 */
function playMobileDeckGame() {
  if (!window._deckCards.length) {
    alert('デッキが空です');
    return;
  }
  
  engineMobile.initGame(window._deckCards);
  renderMobileGame();
}

// ─── オンライン対戦（SP版）────────────────────────────────────────────────

let _olReconnectTimerMobile = null;

function hideMobileOnlineModal() {
  const overlay = document.getElementById('mobile-ol-overlay');
  if (overlay) overlay.classList.remove('open');
}

function showMobileOnlineModal(deckName) {
  window._olDeckName = deckName;
  const overlay = document.getElementById('mobile-ol-overlay');
  if (overlay) {
    overlay.classList.add('open');
    document.getElementById('mobile-ol-deck-name').textContent = deckName;
    document.getElementById('mobile-ol-player-name').value = '';
    document.getElementById('mobile-ol-room-code').value = '';
    return;
  }
  const div = document.createElement('div');
  div.id = 'mobile-ol-overlay';
  div.className = 'ml-ol-overlay open';
  div.innerHTML = `
    <div class="ml-ol-modal">
      <h3 class="ml-ol-title">オンライン対戦</h3>
      <p class="ml-ol-caption">デッキ: <strong id="mobile-ol-deck-name">${escapeHtmlMobile(deckName)}</strong></p>
      <label class="ml-ol-label">プレイヤー名</label>
      <input type="text" id="mobile-ol-player-name" placeholder="Player 1" class="ml-ol-input">
      <button type="button" onclick="olCreateRoomMobile()" class="ml-ol-btn create">ルームを作成</button>
      <hr class="ml-ol-sep">
      <label class="ml-ol-label">ルームコード（6文字）</label>
      <input type="text" id="mobile-ol-room-code" placeholder="ABCD12" maxlength="6" class="ml-ol-input room">
      <button type="button" onclick="olJoinRoomMobile()" class="ml-ol-btn join">参加</button>
      <button type="button" onclick="hideMobileOnlineModal()" class="ml-ol-btn cancel">キャンセル</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function olCreateRoomMobile() {
  const deckName = window._olDeckName;
  if (!deckName) return;
  const name = (document.getElementById('mobile-ol-player-name').value || 'Player 1').trim().slice(0, 20);
  const deckData = await getMobileDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    alert('デッキが取得できませんでした。');
    return;
  }
  const result = await NetworkService.createRoom(name);
  if (result.error) {
    alert(result.error);
    return;
  }
  const room = result.room;
  window._ol = { room, p: 'p1', p1Name: name, p2Name: null, eventSource: null, reconnectAttempt: 0 };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  const modal = document.getElementById('mobile-ol-overlay')?.querySelector('.ml-ol-modal');
  if (modal) {
    modal.innerHTML = `
      <h3 class="ml-ol-title">ルーム作成完了</h3>
      <p class="ml-ol-room-code">${room}</p>
      <p class="ml-ol-caption">相手にこのコードを伝えてください。</p>
      <button type="button" onclick="olCancelMobileWait()" class="ml-ol-btn close">キャンセル</button>
    `;
  }

  if (_olReconnectTimerMobile) {
    clearTimeout(_olReconnectTimerMobile);
    _olReconnectTimerMobile = null;
  }

  window._ol.reconnectAttempt = 0;
  olWaitForJoinedMobile();
}

function olWaitForJoinedMobile() {
  if (!window._ol || window._ol.p !== 'p1') return;

  if ((window._ol.reconnectAttempt || 0) >= 3) {
    alert('接続に失敗しました。ロビーに戻ります。');
    olCancelMobileWait();
    return;
  }

  if (window._ol.eventSource) {
    window._ol.eventSource.close();
    window._ol.eventSource = null;
  }

  const room = window._ol.room;
  const es = NetworkService.createEventSource(room, 'p1');
  window._ol.eventSource = es;

  es.addEventListener('joined', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    const data = JSON.parse(e.data);
    window._ol.p2Name = data.p2_name || 'Player 2';

    es.close();
    window._ol.eventSource = null;

    if (_olReconnectTimerMobile) {
      clearTimeout(_olReconnectTimerMobile);
      _olReconnectTimerMobile = null;
    }

    hideMobileOnlineModal();
    startMobileOnlineGame();
  });

  es.onerror = () => {
    es.close();
    if (!window._ol || window._ol.room !== room || window._ol.p !== 'p1') return;

    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
    _olReconnectTimerMobile = setTimeout(olWaitForJoinedMobile, delay);
  };
}

function olCancelMobileWait() {
  if (_olReconnectTimerMobile) {
    clearTimeout(_olReconnectTimerMobile);
    _olReconnectTimerMobile = null;
  }

  if (window._ol && window._ol.eventSource) window._ol.eventSource.close();

  window._ol = null;
  window._olDeckName = null;
  window._olDeckData = null;

  hideMobileOnlineModal();

  renderMobileDeckList();
}

async function olJoinRoomMobile() {
  const deckName = window._olDeckName;
  const code = (document.getElementById('mobile-ol-room-code').value || '').trim().toUpperCase().slice(0, 6);
  if (!code || code.length !== 6) {
    alert('ルームコードは6文字で入力してください。');
    return;
  }
  const name = (document.getElementById('mobile-ol-player-name').value || 'Player 2').trim().slice(0, 20);
  const deckData = await getMobileDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    alert('デッキが取得できませんでした。');
    return;
  }
  const result = await NetworkService.joinRoom(code, name);
  if (result.error) {
    alert(result.error);
    return;
  }
  hideMobileOnlineModal();
  window._ol = { room: code, p: 'p2', p1Name: result.p1_name || 'Player 1', p2Name: name, eventSource: null, reconnectAttempt: 0 };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  startMobileOnlineGame();
}

async function getMobileDeckDataForOnline(deckName) {
  const savedDecks = getSavedDecksMobile();
  if (savedDecks[deckName]) return Array.isArray(savedDecks[deckName]) ? savedDecks[deckName] : null;
  const account = AuthService.getCurrentAccount();
  if (account) return await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
  return null;
}

function startMobileOnlineGame() {
  const deckData = window._olDeckData;
  if (!deckData || !window._ol) return;

  if (window._ol.eventSource) window._ol.eventSource.close();

  window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30, graveyard: 0 };
  window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
  window._olChatLogMobile = [];
  _mobileChatOpen = false;
  appendMobileChatMessage('SYSTEM', 'オンライン対戦を開始しました。', 'sys');

  engineMobile.initGame(deckData);
  window._ol.eventSource = null;
  olStartEventListenerMobile();
  renderMobileGame();
  setTimeout(() => olSendActionMobile('state'), 200);
}

function olStartEventListenerMobile() {
  if (!window._ol || !engineMobile) return;
  if (window._ol.eventSource) window._ol.eventSource.close();

  const room = window._ol.room;
  const es = NetworkService.createEventSource(room, window._ol.p);
  window._ol.eventSource = es;

  es.addEventListener('opponent_state', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    if (other) window._olOpponent = other;
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    renderMobileGame();
  });

  es.addEventListener('turn_end', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (data.turn) engineMobile.state.turn = data.turn;
    if (data.active) {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      showMobileTurnNotification('あなたのターンです！');
    }

    renderMobileGame();
  });

  es.addEventListener('chat_message', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    appendMobileChatMessage(data.name || 'Player', data.msg || '', data.p || '');
  });

  es.onerror = () => {
    es.close();
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    if (window._ol.reconnectAttempt < 3) {
      setTimeout(olStartEventListenerMobile, Math.pow(2, window._ol.reconnectAttempt) * 1000);
    } else {
      alert('接続が切れました。ロビーに戻ります。');
      window._ol = null;
      window._olOpponent = null;
      window._olCurrentPlayer = null;
      renderMobileDeckList();
    }
  };
}

function olSendActionMobile(actionType) {
  if (!window._ol || !engineMobile) return;

  const s = engineMobile.state;
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
