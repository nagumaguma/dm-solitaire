/**
 * DM Solitaire - Desktop UI
 * PC版レイアウト（3カラム: 検索 | デッキ | ゲーム）
 */

let engine = null;

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
      <div style="display: flex; gap: 6px;">
        <button onclick="startDesktopGame('${escapeHtml(name)}')" style="flex: 1; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">▶ START</button>
        <button onclick="deleteDesktopDeck('${escapeHtml(name)}')" style="flex: 1; padding: 6px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
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
        <button onclick="startDesktopGame('${escapeHtml(name)}')" style="width: 100%; margin-top: 6px; padding: 6px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">▶ START</button>
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
    alert('デッキを読み込めません');
    return;
  }
  
  // ゲームエンジン初期化
  engine.initGame(deckData);
  renderDesktopGame();
}

/**
 * ゲーム画面レンダリング（PC版）
 */
function renderDesktopGame() {
  const state = engine.getState();
  const gameBoard = document.getElementById('desktop-game-board');
  
  gameBoard.innerHTML = `
    <div style="font-size: 0.85rem;">
      <div style="margin-bottom: 12px; padding: 8px; background: #f3f4f6; border-radius: 4px;">
        <strong>ターン:</strong> ${state.turn}
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">デッキ残枚数</strong>
        <div style="font-size: 1.2rem; color: #dc2626;">${state.deck.length}</div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">手札 (${state.hand.length})</strong>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${state.hand.map((c, i) => `
            <div style="width: 40px; height: 50px; background: #e5e7eb; border: 1px solid #d1d5db; 
              border-radius: 3px; font-size: 0.6rem; padding: 2px; text-align: center; cursor: pointer;"
              title="${escapeHtml(c.name)}" onclick="playDesktopCard(${i}, 'battle')">
              ${escapeHtml(c.name).substring(0, 3)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <strong style="display: block; margin-bottom: 4px;">バトル (${state.battleZone.length})</strong>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${state.battleZone.map(c => `
            <div style="width: 40px; height: 50px; background: #fecaca; border: 1px solid #fca5a5; 
              border-radius: 3px; font-size: 0.6rem; padding: 2px; text-align: center;"
              title="${escapeHtml(c.name)}">
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
  renderDesktopGame();
}

function drawDesktopCard() {
  engine.drawCard();
  renderDesktopGame();
}

function turnDesktopEnd() {
  engine.turnEnd();
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

function addToDesktopDeck(cardJson) {
  const card = JSON.parse(cardJson);
  alert('デッキに追加機能は実装中');
}

/**
 * HTML エスケープ
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
