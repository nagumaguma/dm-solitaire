/**
 * DM Solitaire - Mobile UI
 * SP版レイアウト（1カラム: 敵 | バトル | 手札）
 */

let engineMobile = null;

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
    <div style="display: flex; flex-direction: column; height: 100vh; background: #f2f4f1;">
      
      <!-- ヘッダー -->
      <div style="background: #6b8f8a; color: #fff; padding: 12px; font-weight: 600; text-align: center; display: flex; justify-content: space-between; align-items: center;">
        <span>DM Solitaire</span>
        <button type="button" onclick="logout()" style="padding: 4px 10px; font-size: 0.8rem; background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.5); border-radius: 4px; cursor: pointer;">ログアウト</button>
      </div>
      
      <!-- メインコンテンツ -->
      <div style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- デッキ一覧 -->
        <div style="background: #fafbf9; border-radius: 10px; padding: 12px; border: 1px solid #e0e5e0;">
          <h3 style="margin-bottom: 10px; font-size: 0.95rem; color: #3d4a44;">デッキを選択</h3>
          <button onclick="newMobileDeck()" 
            style="width: 100%; padding: 10px; background: #6b8f8a; color: #fff; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 10px; font-weight: 600; font-size: 0.9rem;">
            新規デッキ
          </button>
          <div id="mobile-deck-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>
        
        <!-- カード検索 -->
        <div style="background: #fafbf9; border-radius: 10px; padding: 12px; border: 1px solid #e0e5e0;">
          <h3 style="margin-bottom: 10px; font-size: 0.95rem; color: #3d4a44;">カード検索</h3>
          <input type="text" id="mobile-search-input" placeholder="カード名..." 
            style="width: 100%; padding: 10px; border: 1px solid #e0e5e0; border-radius: 6px; margin-bottom: 10px; font-size: 1rem; background: #fff;"
            onkeyup="mobileSearchCards(this.value)">
          <div id="mobile-search-results" style="display: flex; flex-direction: column; gap: 6px;"></div>
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
    el.style.cssText = `
      padding: 12px; background: #f5f6f4; border: 1px solid #e0e5e0; 
      border-radius: 6px; cursor: pointer; transition: all 0.15s;
    `;
    el.ontouchstart = () => el.style.background = '#eef1ef';
    el.ontouchend = () => el.style.background = '#f5f6f4';
    el.onmouseover = () => el.style.background = '#eef1ef';
    el.onmouseout = () => el.style.background = '#f5f6f4';
    el.innerHTML = `
      <div style="font-weight: 600; font-size: 0.95rem; color: #3d4a44;">${escapeHtmlMobile(name)}</div>
      <div style="font-size: 0.85rem; color: #6b7b72; margin: 6px 0;">デッキ: ${count}枚</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        <button onclick="openMobileDeck('${escapeAttrJsMobile(name)}')" style="flex: 1; min-width: 70px; padding: 10px; background: #7a94a8; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">編集</button>
        <button onclick="startMobileGame('${escapeAttrJsMobile(name)}')" style="flex: 1; min-width: 70px; padding: 10px; background: #7a9a7a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">一人回し</button>
        <button onclick="showMobileOnlineModal('${escapeAttrJsMobile(name)}')" style="flex: 1; min-width: 70px; padding: 10px; background: #6b8f8a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">オンライン</button>
        <button onclick="deleteMobileDeck('${escapeAttrJsMobile(name)}')" style="flex: 1; min-width: 70px; padding: 10px; background: #a67c7c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">削除</button>
      </div>
    `;
    deckList.appendChild(el);
  }
  
  // サーバーデッキ
  if (account && window._serverDeckNames) {
    for (const name of window._serverDeckNames) {
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 12px; background: #f0f3f1; border: 1px solid #c5d4ce; 
        border-radius: 6px; cursor: pointer; transition: all 0.15s;
      `;
      el.ontouchstart = () => el.style.background = '#e8efe8';
      el.ontouchend = () => el.style.background = '#f0f3f1';
      el.onmouseover = () => el.style.background = '#e8efe8';
      el.onmouseout = () => el.style.background = '#f0f3f1';
      el.innerHTML = `
        <div style="font-weight: 600; font-size: 0.95rem; color: #3d4a44;">クラウド: ${escapeHtmlMobile(name)}</div>
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button onclick="startMobileGame('${escapeAttrJsMobile(name)}')" style="flex: 1; padding: 10px; background: #7a9a7a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">一人回し</button>
          <button onclick="showMobileOnlineModal('${escapeAttrJsMobile(name)}')" style="flex: 1; padding: 10px; background: #6b8f8a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">オンライン</button>
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
    el.style.cssText = `
      padding: 12px; background: #f5f6f4; border: 1px solid #e0e5e0; 
      border-radius: 6px; cursor: pointer; font-size: 0.9rem; transition: all 0.15s;
    `;
    el.ontouchstart = () => el.style.background = '#eef1ef';
    el.ontouchend = () => el.style.background = '#f5f6f4';
    el.onmouseover = () => el.style.background = '#eef1ef';
    el.onmouseout = () => el.style.background = '#f5f6f4';
    el.innerHTML = `
      <div style="font-weight: 600; color: #3d4a44;">${escapeHtmlMobile(card.name)}</div>
      <div style="color: #6b7b72; font-size: 0.8rem; margin: 4px 0;">${escapeHtmlMobile(card.text || '')}</div>
      <button onclick="addToMobileDeck('${escapeHtmlMobile(JSON.stringify(card).replace(/'/g, "\\'"))}')" 
        style="width: 100%; margin-top: 6px; padding: 8px; background: #7a94a8; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">+追加</button>
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
  const isMyTurn = ol && window._olCurrentPlayer && ((ol.p === 'p1' && window._olCurrentPlayer === 1) || (ol.p === 'p2' && window._olCurrentPlayer === 2));
  
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100vh; background: #f2f4f1; color: #3d4a44;">
      
      <!-- ヘッダー -->
      <div style="background: #6b8f8a; color: #fff; padding: 12px; font-weight: 600; text-align: center; font-size: 0.95rem;">
        ターン ${state.turn} | デッキ: ${state.deck.length}
        ${ol ? ` | ${isMyTurn ? '自分のターン' : '相手のターン'}` : ''}
      </div>
      ${ol ? `<div style="padding: 8px 12px; background: #e8efe8; font-size: 0.8rem; color: #3d4a44;">
        オンライン対戦: ${escapeHtmlMobile(ol.p1Name)} vs ${ol.p2Name ? escapeHtmlMobile(ol.p2Name) : '待機中'}
        ${opp.hand !== undefined ? `｜ 相手: 手札${opp.hand} バトル${opp.battleZone || 0} マナ${opp.manaZone || 0} シールド${opp.shields || 0}` : ''}
      </div>` : ''}
      
      <!-- メインゲーム画面 -->
      <div style="flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 12px; gap: 12px;">
        
        <!-- 敵フィールド -->
        <div style="background: #f5f6f4; border: 1px solid #d4c4bc; border-radius: 8px; padding: 12px; text-align: center;">
          <div style="font-size: 0.85rem; color: #6b7b72; margin-bottom: 8px;">敵フィールド</div>
          <div style="font-size: 1.3rem; color: #9fb0b8;">ENEMY</div>
        </div>
        
        <!-- バトルゾーン -->
        <div style="background: #f3ebe8; border: 1px solid #d4c4bc; border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.85rem; color: #3d4a44; margin-bottom: 8px;">バトルゾーン (${state.battleZone.length})</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${state.battleZone.map(c => `
              <div style="width: 50px; height: 70px; background: #ebe0dc; border: 1px solid #c4b4ac; 
                border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; text-align: center; padding: 4px; color: #3d4a44;"
                title="${escapeHtmlMobile(c.name)}">
                ${escapeHtmlMobile(c.name).substring(0, 4)}
              </div>
            `).join('')}
          </div>
        </div>
        
        <!-- シールド -->
        <div style="background: #eef2f4; border: 1px solid #b8c8d4; border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.85rem; color: #3d4a44; margin-bottom: 8px;">シールド (${state.shields.length})</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;">
            ${state.shields.map(() => `
              <div style="width: 40px; height: 40px; background: #9fb8c4; border: 1px solid #7a94a8; 
                border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #fff; font-size: 0.75rem;">
                SH
              </div>
            `).join('')}
          </div>
        </div>
        
      </div>
      
      <!-- 手札（固定下部） -->
      <div style="background: #fafbf9; border-top: 1px solid #e0e5e0; padding: 12px; max-height: 150px; overflow-x: auto;">
        <div style="font-size: 0.85rem; color: #6b7b72; margin-bottom: 8px;">手札 (${state.hand.length})</div>
        <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px;">
          ${state.hand.map((c, i) => `
            <div style="min-width: 60px; height: 85px; background: linear-gradient(145deg, #c8d4dc 0%, #dce4e8 100%); border: 1px solid #9fb0b8; 
              border-radius: 6px; display: flex; align-items: center; justify-content: center; 
              font-size: 0.65rem; text-align: center; padding: 6px; cursor: pointer; transition: all 0.15s; color: #3d4a44;"
              ontouchstart="this.style.background='#b8c8d0'; playMobileCard(${i})"
              onmouseover="this.style.background='#b8c8d0'"
              onmouseout="this.style.background='linear-gradient(145deg, #c8d4dc 0%, #dce4e8 100%)'"
              title="${escapeHtmlMobile(c.name)}">
              ${escapeHtmlMobile(c.name).substring(0, 5)}
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- ボタン -->
      <div style="background: #f5f6f4; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid #e0e5e0;">
        <button onclick="drawMobileCard()" style="flex: 1; min-width: 70px; padding: 12px; background: #7a94a8; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">ドロー</button>
        <button onclick="turnMobileEnd()" style="flex: 1; min-width: 70px; padding: 12px; background: #7a9a7a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">ターン終</button>
        ${!window._ol ? '<button onclick="undoMobileGame()" style="flex: 1; min-width: 70px; padding: 12px; background: #8a8a8a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">やり直し</button>' : ''}
        <button onclick="renderMobileDeckList()" style="flex: 1; min-width: 70px; padding: 12px; background: #a67c7c; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">戻る</button>
      </div>
      
    </div>
  `;
}

function playMobileCard(idx) {
  const zone = confirm('バトルに配置? (OK: バトル, キャンセル: マナ)') ? 'battle' : 'mana';
  engineMobile.playCard(engineMobile.state.hand[idx], zone);
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function drawMobileCard() {
  engineMobile.drawCard();
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function turnMobileEnd() {
  engineMobile.turnEnd();
  if (window._ol) olSendActionMobile('turn_end');
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
  
  const cardCount = cards.reduce((sum, c) => sum + (c.count || 1), 0);
  
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100vh; background: #f2f4f1;">
      
      <!-- ヘッダー -->
      <div style="background: #6b8f8a; color: #fff; padding: 12px; font-weight: 600; text-align: center; display: flex; justify-content: space-between; align-items: center;">
        <span onclick="renderMobileDeckList()" style="cursor: pointer; font-size: 1.2rem;">←</span>
        <span>${escapeHtmlMobile(deckName)}</span>
        <span style="font-size: 0.85rem;">${cardCount}/40</span>
      </div>
      
      <!-- メインコンテンツ -->
      <div style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- カード検索 -->
        <div style="background: #fafbf9; border-radius: 10px; padding: 12px; border: 1px solid #e0e5e0;">
          <h3 style="margin-bottom: 10px; font-size: 0.95rem; color: #3d4a44;">カード追加</h3>
          <input type="text" id="mobile-search-input" placeholder="カード名..." 
            style="width: 100%; padding: 10px; border: 1px solid #e0e5e0; border-radius: 6px; margin-bottom: 10px; font-size: 1rem; background: #fff;"
            onkeyup="mobileSearchCards(this.value)">
          <div id="mobile-search-results" style="display: flex; flex-direction: column; gap: 6px;"></div>
        </div>
        
        <!-- デッキリスト -->
        <div style="background: #fafbf9; border-radius: 10px; padding: 12px; border: 1px solid #e0e5e0;">
          <h3 style="margin-bottom: 10px; font-size: 0.95rem; color: #3d4a44;">デッキカード</h3>
          <div id="mobile-deck-cards" style="display: flex; flex-direction: column; gap: 8px;">
            ${cards.map((c, i) => `
              <div style="padding: 10px; background: #f5f6f4; border: 1px solid #e0e5e0; border-radius: 6px;">
                <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: #3d4a44;">${escapeHtmlMobile(c.name)}</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8rem; color: #6b7b72;">${escapeHtmlMobile(c.text || '')}</span>
                  <div style="display: flex; gap: 4px;">
                    <button onclick="decrementMobileCardCount(${i})" style="width: 28px; height: 28px; background: #a67c7c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">−</button>
                    <span style="width: 28px; text-align: center; font-weight: 600; color: #3d4a44;">${c.count || 1}</span>
                    <button onclick="incrementMobileCardCount(${i})" style="width: 28px; height: 28px; background: #7a9a7a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">+</button>
                    <button onclick="removeMobileCard(${i})" style="width: 28px; height: 28px; background: #a67c7c; color: #fff; border: none; border-radius: 4px; cursor: pointer;">削除</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
      </div>
      
      <!-- ボタン -->
      <div style="background: #f5f6f4; padding: 12px; display: flex; gap: 8px; border-top: 1px solid #e0e5e0;">
        <button onclick="playMobileDeckGame()" style="flex: 1; padding: 12px; background: #7a9a7a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">一人回しを開始</button>
        <button onclick="saveMobileDeck()" style="flex: 1; padding: 12px; background: #6b8f8a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">💾 保存</button>
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

function showMobileOnlineModal(deckName) {
  window._olDeckName = deckName;
  const overlay = document.getElementById('mobile-ol-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.getElementById('mobile-ol-deck-name').textContent = deckName;
    document.getElementById('mobile-ol-player-name').value = '';
    document.getElementById('mobile-ol-room-code').value = '';
    return;
  }
  const div = document.createElement('div');
  div.id = 'mobile-ol-overlay';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.25);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;';
  div.innerHTML = `
    <div style="background:#fafbf9;border-radius:12px;padding:20px;max-width:360px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:1px solid #e0e5e0;">
      <h3 style="margin-bottom:12px;font-size:1.1rem;color:#3d4a44;">オンライン対戦</h3>
      <p style="font-size:0.9rem;color:#6b7b72;margin-bottom:10px;">デッキ: <strong id="mobile-ol-deck-name">${escapeHtmlMobile(deckName)}</strong></p>
      <label style="display:block;margin-bottom:4px;font-size:0.85rem;color:#3d4a44;">プレイヤー名</label>
      <input type="text" id="mobile-ol-player-name" placeholder="Player 1" style="width:100%;padding:12px;border:1px solid #e0e5e0;border-radius:6px;margin-bottom:12px;font-size:1rem;background:#fff;">
      <button type="button" onclick="olCreateRoomMobile()" style="width:100%;padding:12px;background:#6b8f8a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;margin-bottom:16px;">ルームを作成</button>
      <hr style="margin:12px 0;border:none;border-top:1px solid #e0e5e0;">
      <label style="display:block;margin-bottom:4px;font-size:0.85rem;color:#3d4a44;">ルームコード（6文字）</label>
      <input type="text" id="mobile-ol-room-code" placeholder="ABCD12" maxlength="6" style="width:100%;padding:12px;border:1px solid #e0e5e0;border-radius:6px;margin-bottom:10px;letter-spacing:4px;text-transform:uppercase;font-size:1rem;background:#fff;">
      <button type="button" onclick="olJoinRoomMobile()" style="width:100%;padding:12px;background:#7a94a8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">参加</button>
      <button type="button" onclick="document.getElementById('mobile-ol-overlay').style.display='none'" style="width:100%;margin-top:10px;padding:10px;background:#eef1ef;color:#3d4a44;border:none;border-radius:6px;cursor:pointer;">キャンセル</button>
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
  document.getElementById('mobile-ol-overlay').querySelector('div').innerHTML = `
    <h3 style="margin-bottom:12px;color:#3d4a44;">ルーム作成完了</h3>
    <p style="font-size:1.4rem;font-weight:700;letter-spacing:8px;color:#6b8f8a;margin:12px 0;">${room}</p>
    <p style="font-size:0.9rem;color:#6b7b72;">相手にこのコードを伝えてください。</p>
    <button type="button" onclick="olCancelMobileWait()" style="width:100%;margin-top:16px;padding:12px;background:#a67c7c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">キャンセル</button>
  `;
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
          document.getElementById('mobile-ol-overlay').style.display = 'none';
          startMobileOnlineGame();
        });
        es2.onerror = es.onerror;
      }, delay);
    } else {
      alert('接続に失敗しました。ロビーに戻ります。');
      olCancelMobileWait();
    }
  };
}

function olCancelMobileWait() {
  if (window._ol && window._ol.eventSource) window._ol.eventSource.close();
  window._ol = null;
  window._olDeckName = null;
  window._olDeckData = null;
  const ov = document.getElementById('mobile-ol-overlay');
  if (ov) ov.style.display = 'none';
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
  document.getElementById('mobile-ol-overlay').style.display = 'none';
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
  window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30 };
  window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
  engineMobile.initGame(deckData);
  window._ol.eventSource = null;
  olStartEventListenerMobile();
  renderMobileGame();
  setTimeout(() => olSendActionMobile('state'), 200);
}

function olStartEventListenerMobile() {
  if (!window._ol || !engineMobile) return;
  if (window._ol.eventSource) window._ol.eventSource.close();
  const es = NetworkService.createEventSource(window._ol.room, window._ol.p);
  window._ol.eventSource = es;
  es.addEventListener('opponent_state', (e) => {
    const data = JSON.parse(e.data);
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    if (other) window._olOpponent = other;
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    renderMobileGame();
  });
  es.addEventListener('turn_end', (e) => {
    const data = JSON.parse(e.data);
    if (data.turn) engineMobile.state.turn = data.turn;
    window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    renderMobileGame();
  });
  es.onerror = () => {
    es.close();
    if (!window._ol) return;
    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    if (window._ol.reconnectAttempt < 3) {
      setTimeout(olStartEventListenerMobile, Math.pow(2, window._ol.reconnectAttempt) * 1000);
    } else {
      alert('接続が切れました。ロビーに戻ります。');
      window._ol = null;
      window._olOpponent = null;
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
    p1: window._ol.p === 'p1' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: 0 } : null,
    p2: window._ol.p === 'p2' ? { hand: s.hand.length, battleZone: s.battleZone.length, manaZone: s.manaZone.length, shields: s.shields.length, deck: s.deck.length, graveyard: 0 } : null
  };
  NetworkService.sendAction(payload);
}
