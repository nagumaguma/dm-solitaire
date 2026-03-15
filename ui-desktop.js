/**
 * DM Solitaire - Desktop UI
 * PC版レイアウト（3カラム: 検索 | デッキ | ゲーム）
 */

let engine = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    <div style="display: grid; grid-template-columns: 250px 1fr 300px; gap: 10px; height: 100vh; padding: 10px; background: #f0f2f5;">
      
      <!-- 左: カード検索パネル -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="margin-bottom: 10px; font-size: 0.95rem;">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." 
          style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px;"
          onkeyup="desktopSearchCards(this.value)">
        <div id="desktop-search-results" style="display: flex; flex-direction: column; gap: 6px;"></div>
      </div>
      
      <!-- 中央: デッキ一覧 -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="margin-bottom: 10px; font-size: 0.95rem;">デッキ一覧</h3>
        <button onclick="newDesktopDeck()" 
          style="width: 100%; padding: 10px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 10px; font-weight: 600;">
          ➕ 新規作成
        </button>
        <div id="desktop-deck-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
      </div>
      
      <!-- 右: ゲームボード -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="margin-bottom: 10px; font-size: 0.95rem;" id="desktop-game-title">ゲーム情報</h3>
        <div id="desktop-game-board" style="font-size: 0.85rem;">
          <p style="color: #999;">デッキを選択してゲーム開始</p>
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
  const savedDecks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
  const account = AuthService.getCurrentAccount();
  
  const deckList = document.getElementById('desktop-deck-list');
  deckList.innerHTML = '';
  
  // ローカルデッキ
  for (const [name, cards] of Object.entries(savedDecks)) {
    const count = cards?.length || 0;
    const el = document.createElement('div');
    el.style.cssText = `
      padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; 
      border-radius: 6px; cursor: pointer; transition: all 0.15s;
    `;
    el.onmouseover = () => el.style.background = '#eff6ff';
    el.onmouseout = () => el.style.background = '#f9fafb';
    el.innerHTML = `
      <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(name)}</div>
      <div style="font-size: 0.8rem; color: #6b7280; margin: 4px 0;">📋 ${count}枚</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        <button onclick="openDesktopDeck('${escapeHtml(name)}')" style="flex: 1; min-width: 60px; padding: 6px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">✏️ 編集</button>
        <button onclick="startDesktopGame('${escapeHtml(name)}')" style="flex: 1; min-width: 60px; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">▶ START</button>
        <button onclick="showDesktopOnlineModal('${escapeHtml(name)}')" style="flex: 1; min-width: 60px; padding: 6px; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🌐 オンライン</button>
        <button onclick="deleteDesktopDeck('${escapeHtml(name)}')" style="flex: 1; min-width: 60px; padding: 6px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
      </div>
    `;
    deckList.appendChild(el);
  }
  
  // サーバーデッキ
  if (account && window._serverDeckNames) {
    for (const name of window._serverDeckNames) {
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 10px; background: #fef3c7; border: 1px solid #fcd34d; 
        border-radius: 6px; cursor: pointer; transition: all 0.15s;
      `;
      el.onmouseover = () => el.style.background = '#fef9e7';
      el.onmouseout = () => el.style.background = '#fef3c7';
      el.innerHTML = `
        <div style="font-weight: 600; font-size: 0.9rem;">☁️ ${escapeHtml(name)}</div>
        <div style="display: flex; gap: 6px; margin-top: 6px;">
          <button onclick="startDesktopGame('${escapeHtml(name)}')" style="flex: 1; padding: 6px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">▶ START</button>
          <button onclick="showDesktopOnlineModal('${escapeHtml(name)}')" style="flex: 1; padding: 6px; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🌐 オンライン</button>
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
    el.style.cssText = `
      padding: 8px; background: #f3f4f6; border: 1px solid #e5e7eb; 
      border-radius: 4px; cursor: pointer; font-size: 0.8rem; transition: all 0.15s;
    `;
    el.onmouseover = () => el.style.background = '#e5e7eb';
    el.onmouseout = () => el.style.background = '#f3f4f6';
    el.innerHTML = `
      <div style="font-weight: 600;">${escapeHtml(card.name)}</div>
      <div style="color: #6b7280; font-size: 0.75rem;">${escapeHtml(card.text || '')}</div>
      <button onclick="addToDesktopDeck('${escapeHtml(JSON.stringify(card).replace(/'/g, "\\'"))}')" 
        style="width: 100%; margin-top: 4px; padding: 4px; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.75rem;">+追加</button>
    `;
    container.appendChild(el);
  });
}

/**
 * ゲーム開始（PC版）
 */
async function startDesktopGame(deckName) {
  const savedDecks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
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
  const isMyTurn = ol && window._olCurrentPlayer && ((ol.p === 'p1' && window._olCurrentPlayer === 1) || (ol.p === 'p2' && window._olCurrentPlayer === 2));
  
  gameBoard.innerHTML = `
    <div style="font-size: 0.85rem;">
      <div style="margin-bottom: 12px; padding: 8px; background: #f3f4f6; border-radius: 4px;">
        <strong>ターン:</strong> ${state.turn}
        ${ol ? `<span style="margin-left: 8px;">${isMyTurn ? '<span style="color: #059669;">自分のターン</span>' : '<span style="color: #6b7280;">相手のターン</span>'}</span>` : ''}
      </div>
      ${ol ? `<div style="margin-bottom: 8px; padding: 6px; background: #fef3c7; border-radius: 4px; font-size: 0.8rem;">
        <strong>🌐</strong> ${escapeHtml(ol.p1Name)} vs ${ol.p2Name ? escapeHtml(ol.p2Name) : '待機中'}
        ${opp.hand !== undefined ? `｜ 相手: 手札${opp.hand} バトル${opp.battleZone || 0} マナ${opp.manaZone || 0} シールド${opp.shields || 0}` : ''}
      </div>` : ''}
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">デッキ残枚数</strong>
        <div style="font-size: 1.2rem; color: #dc2626;">${state.deck.length}</div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">手札 (${state.hand.length})</strong>
        <div id="desktop-hand-zone" style="display: flex; flex-wrap: wrap; gap: 4px; min-height: 70px; padding: 8px; background: #f9fafb; border-radius: 4px; position: relative;">
          ${state.hand.map((c, i) => `
            <div class="card-in-hand" draggable="true" 
              onclick="playDesktopCard(${i}, 'battle')" 
              onmouseenter="showDesktopCardPreview(event, ${i})"
              onmouseleave="hideDesktopCardPreview()"
              ondragstart="dragDesktopCard(event, ${i})"
              ondragend="dragDesktopCardEnd()"
              style="
                width: 45px; height: 65px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border: 1px solid #4f46e5; border-radius: 3px; position: relative;
                cursor: grab; display: flex; align-items: center; justify-content: center;
                font-size: 0.6rem; padding: 2px; text-align: center; color: white;
                flex-shrink: 0; transition: transform 0.1s;
              "
              title="${escapeHtml(c.name)}">
              ${escapeHtml(c.name).substring(0, 4)}
            </div>
          `).join('')}
        </div>
        <div id="desktop-card-preview" style="position: fixed; display: none; z-index: 1000; background: white; border: 2px solid #333; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); padding: 8px; max-width: 200px;">
          <div id="desktop-preview-content"></div>
        </div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">バトル (${state.battleZone.length})</strong>
        <div id="desktop-battle-zone" ondrop="dropDesktopCard(event, 'battle')" ondragover="dragDesktopOver(event)"
          style="display: flex; flex-wrap: wrap; gap: 4px; min-height: 70px; padding: 8px; background: #fee2e2; border: 2px dashed #fca5a5; border-radius: 4px;">
          ${state.battleZone.map(c => `
            <div style="width: 45px; height: 65px; background: #fecaca; border: 2px solid #ef4444; 
              border-radius: 4px; font-size: 0.6rem; padding: 2px; text-align: center; cursor: pointer;"
              title="${escapeHtml(c.name)}" onmouseenter="showDesktopCardPreview(event, -1, c)"
              onmouseleave="hideDesktopCardPreview()">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">マナ (${state.manaZone.length})</strong>
        <div id="desktop-mana-zone" ondrop="dropDesktopCard(event, 'mana')" ondragover="dragDesktopOver(event)"
          style="display: flex; flex-wrap: wrap; gap: 4px; min-height: 70px; padding: 8px; background: #dbeafe; border: 2px dashed #60a5fa; border-radius: 4px;">
          ${state.manaZone.map(c => `
            <div style="width: 45px; height: 65px; background: #bfdbfe; border: 2px solid #3b82f6; 
              border-radius: 4px; font-size: 0.6rem; padding: 2px; text-align: center; cursor: pointer;"
              title="${escapeHtml(c.name)}" onmouseenter="showDesktopCardPreview(event, -1, c)"
              onmouseleave="hideDesktopCardPreview()">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong style="display: block; margin-bottom: 4px;">シールド (${state.shields.length})</strong>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${state.shields.map(s => `
            <div style="width: 40px; height: 50px; background: #60a5fa; border: 1px solid #3b82f6; 
              border-radius: 3px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">
              <span>🛡️</span>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div style="display: flex; gap: 6px;">
        <button onclick="drawDesktopCard()" style="flex: 1; padding: 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">ドロー</button>
        <button onclick="turnDesktopEnd()" style="flex: 1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">ターン終了</button>
        <button onclick="renderDesktopDeckList()" style="flex: 1; padding: 8px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">戻る</button>
      </div>
    </div>
  `;
}

function playDesktopCard(idx, zone) {
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
  } else if (!card) {
    return;
  }
  
  const preview = document.getElementById('desktop-card-preview');
  const content = document.getElementById('desktop-preview-content');
  
  if (!preview || !content) return;
  
  content.innerHTML = `
    <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px;">${escapeHtml(card.name)}</div>
    <div style="font-size: 0.75rem; color: #666; line-height: 1.3;">
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
  
  const card = engine.state.hand[_currentDragIdx];
  if (card) {
    engine.playCard(card, zone);
    if (window._ol) olSendActionDesktop('state');
    renderDesktopGame();
  }
  
  _currentDragIdx = null;
}

function drawDesktopCard() {
  engine.drawCard();
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function turnDesktopEnd() {
  engine.turnEnd();
  if (window._ol) olSendActionDesktop('turn_end');
  renderDesktopGame();
}

function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');
  if (!name) return;
  
  const decks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
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
  
  const decks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
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
    <div style="display: grid; grid-template-columns: 250px 1fr 300px; gap: 10px; height: 100vh; padding: 10px; background: #f0f2f5;">
      
      <!-- 左: カード検索パネル -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="margin-bottom: 10px; font-size: 0.95rem;">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." 
          style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px;"
          onkeyup="desktopSearchCards(this.value)">
        <div id="desktop-search-results" style="display: flex; flex-direction: column; gap: 6px;"></div>
      </div>
      
      <!-- 中央: デッキ構成 -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="margin-bottom: 12px; padding: 10px; background: #f3f4f6; border-radius: 6px;">
          <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px;">${escapeHtml(deckName)}</div>
          <div style="font-size: 0.8rem; color: #6b7280;">
            <div>📋 カード枚数: <strong>${cardCount}</strong> / 40</div>
            <div>🎴 ユニーク: <strong>${uniqueCount}</strong></div>
          </div>
        </div>
        
        <div id="desktop-deck-cards" style="display: flex; flex-direction: column; gap: 6px;">
          ${cards.map((c, i) => `
            <div style="padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(c.name)}</div>
                <div style="font-size: 0.7rem; color: #6b7280;">${escapeHtml(c.text || '')}</div>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                <button onclick="decrementDesktopCardCount(${i})" style="width: 24px; height: 24px; background: #ef4444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">−</button>
                <span style="width: 24px; text-align: center; font-weight: 600; font-size: 0.9rem;">${c.count || 1}</span>
                <button onclick="incrementDesktopCardCount(${i})" style="width: 24px; height: 24px; background: #10b981; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">+</button>
                <button onclick="removeDesktopCard(${i})" style="width: 24px; height: 24px; background: #dc2626; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- 右: デッキ情報 -->
      <div style="background: white; border-radius: 10px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="margin-bottom: 10px; font-size: 0.95rem;">文明構成</h3>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
          ${Object.entries(civCounts).map(([civ, count]) => `
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px; display: flex; justify-content: space-between;">
              <span style="font-size: 0.85rem;">${escapeHtml(getCivLabel(civ))}</span>
              <strong style="font-size: 0.85rem;">${count}枚</strong>
            </div>
          `).join('')}
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <button onclick="playDesktopDeckGame()" style="width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">▶ ゲーム開始</button>
          <button onclick="saveDesktopDeck()" style="width: 100%; padding: 12px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">💾 保存</button>
          <button onclick="renderDesktopDeckList()" style="width: 100%; padding: 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">← 戻る</button>
        </div>
      </div>
      
    </div>
  `;
}

/**
 * デッキ編集を開く
 */
function openDesktopDeck(name) {
  const savedDecks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
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
  const decks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
  decks[window._deckEditing] = window._deckCards;
  localStorage.setItem('dm_decks', JSON.stringify(decks));
  alert('デッキを保存しました');
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

function showDesktopOnlineModal(deckName) {
  window._olDeckName = deckName;
  const overlay = document.getElementById('desktop-ol-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.getElementById('desktop-ol-deck-name').textContent = deckName;
    document.getElementById('desktop-ol-player-name').value = '';
    document.getElementById('desktop-ol-room-code').value = '';
    return;
  }
  const div = document.createElement('div');
  div.id = 'desktop-ol-overlay';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:white;border-radius:12px;padding:24px;max-width:360px;width:90%;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
      <h3 style="margin-bottom:16px;">🌐 オンライン対戦</h3>
      <p style="font-size:0.9rem;color:#6b7280;margin-bottom:12px;">デッキ: <strong id="desktop-ol-deck-name">${escapeHtml(deckName)}</strong></p>
      <label style="display:block;margin-bottom:4px;font-size:0.85rem;">プレイヤー名</label>
      <input type="text" id="desktop-ol-player-name" placeholder="Player 1" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;margin-bottom:16px;">
      <div style="margin-bottom:12px;">
        <button type="button" onclick="olCreateRoomDesktop()" style="width:100%;padding:12px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">ルームを作成</button>
      </div>
      <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;">
      <label style="display:block;margin-bottom:4px;font-size:0.85rem;">ルームコード（6文字）</label>
      <input type="text" id="desktop-ol-room-code" placeholder="ABCD12" maxlength="6" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;margin-bottom:12px;letter-spacing:4px;text-transform:uppercase;">
      <button type="button" onclick="olJoinRoomDesktop()" style="width:100%;padding:12px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">参加する</button>
      <button type="button" onclick="document.getElementById('desktop-ol-overlay').style.display='none'" style="width:100%;margin-top:10px;padding:10px;background:#e5e7eb;color:#374151;border:none;border-radius:6px;cursor:pointer;">キャンセル</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function olCreateRoomDesktop() {
  const deckName = window._olDeckName;
  if (!deckName) return;
  const name = (document.getElementById('desktop-ol-player-name').value || 'Player 1').trim().slice(0, 20);
  const deckData = await getDesktopDeckDataForOnline(deckName);
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
  document.getElementById('desktop-ol-overlay').querySelector('div').innerHTML = `
    <h3 style="margin-bottom:16px;">ルーム作成完了</h3>
    <p style="font-size:1.2rem;font-weight:700;letter-spacing:8px;color:#059669;margin:16px 0;">${room}</p>
    <p style="font-size:0.9rem;color:#6b7280;">相手にこのコードを伝えてください。参加を待っています...</p>
    <button type="button" onclick="olCancelDesktopWait()" style="width:100%;margin-top:16px;padding:10px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;">キャンセル</button>
  `;
  const es = NetworkService.createEventSource(room, 'p1');
  window._ol.eventSource = es;
  es.addEventListener('joined', (e) => {
    const data = JSON.parse(e.data);
    window._ol.p2Name = data.p2_name || 'Player 2';
    es.close();
    document.getElementById('desktop-ol-overlay').style.display = 'none';
    startDesktopOnlineGame();
  });
  es.onerror = () => {
    es.close();
    if (!window._ol || !window._ol.reconnectAttempt) window._ol.reconnectAttempt = 0;
    if (window._ol.reconnectAttempt < 3) {
      window._ol.reconnectAttempt++;
      const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
      setTimeout(() => {
        const es2 = NetworkService.createEventSource(window._ol.room, 'p1');
        window._ol.eventSource = es2;
        es2.addEventListener('joined', (e) => {
          const data = JSON.parse(e.data);
          window._ol.p2Name = data.p2_name || 'Player 2';
          es2.close();
          document.getElementById('desktop-ol-overlay').style.display = 'none';
          startDesktopOnlineGame();
        });
        es2.onerror = es.onerror;
      }, delay);
    } else {
      alert('接続に失敗しました。ロビーに戻ります。');
      olCancelDesktopWait();
    }
  };
}

function olCancelDesktopWait() {
  if (window._ol && window._ol.eventSource) {
    window._ol.eventSource.close();
  }
  window._ol = null;
  window._olDeckName = null;
  window._olDeckData = null;
  const ov = document.getElementById('desktop-ol-overlay');
  if (ov) ov.style.display = 'none';
  renderDesktopDeckList();
}

async function olJoinRoomDesktop() {
  const deckName = window._olDeckName;
  const code = (document.getElementById('desktop-ol-room-code').value || '').trim().toUpperCase().slice(0, 6);
  if (!code || code.length !== 6) {
    alert('ルームコードは6文字で入力してください。');
    return;
  }
  const name = (document.getElementById('desktop-ol-player-name').value || 'Player 2').trim().slice(0, 20);
  const deckData = await getDesktopDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    alert('デッキが取得できませんでした。');
    return;
  }
  const result = await NetworkService.joinRoom(code, name);
  if (result.error) {
    alert(result.error);
    return;
  }
  document.getElementById('desktop-ol-overlay').style.display = 'none';
  window._ol = { room: code, p: 'p2', p1Name: result.p1_name || 'Player 1', p2Name: name, eventSource: null, reconnectAttempt: 0 };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  startDesktopOnlineGame();
}

async function getDesktopDeckDataForOnline(deckName) {
  const savedDecks = JSON.parse(localStorage.getItem('dm_decks') || '{}');
  if (savedDecks[deckName]) return Array.isArray(savedDecks[deckName]) ? savedDecks[deckName] : null;
  const account = AuthService.getCurrentAccount();
  if (account) return await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
  return null;
}

function startDesktopOnlineGame() {
  const deckData = window._olDeckData;
  if (!deckData || !window._ol) return;
  if (window._ol.eventSource) window._ol.eventSource.close();
  window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30 };
  window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
  engine.initGame(deckData);
  window._ol.eventSource = null;
  olStartEventListenerDesktop();
  renderDesktopGame();
  setTimeout(() => olSendActionDesktop('state'), 200);
}

function olStartEventListenerDesktop() {
  if (!window._ol || !engine) return;
  if (window._ol.eventSource) window._ol.eventSource.close();
  const es = NetworkService.createEventSource(window._ol.room, window._ol.p);
  window._ol.eventSource = es;
  es.addEventListener('opponent_state', (e) => {
    const data = JSON.parse(e.data);
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    if (other) window._olOpponent = other;
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    renderDesktopGame();
  });
  es.addEventListener('turn_end', (e) => {
    const data = JSON.parse(e.data);
    if (data.turn) engine.state.turn = data.turn;
    window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    renderDesktopGame();
  });
  es.onerror = () => {
    es.close();
    if (!window._ol) return;
    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    if (window._ol.reconnectAttempt < 3) {
      const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
      setTimeout(olStartEventListenerDesktop, delay);
    } else {
      alert('接続が切れました。ロビーに戻ります。');
      window._ol = null;
      window._olOpponent = null;
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
    p1: window._ol.p === 'p1' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: 0 } : null,
    p2: window._ol.p === 'p2' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: 0 } : null
  };
  NetworkService.sendAction(payload);
}
