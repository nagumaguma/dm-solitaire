/**
 * DM Solitaire - Mobile UI
 * SP版レイアウト（1カラム: 敵 | バトル | 手札）
 */

let engineMobile = null;
let _mobileTurnNoticeTimer = null;
let _mobileChatOpen = false;
let _mobileSelectedShieldIdx = null;
let _mobileNeedDrawGuide = false;
let _mobileSelectedHandIdx = null;
let _mobileSearchDebounceTimer = null;
let _mobileSearchController = null;
let _mobileDelegatedEventsBound = false;
let _mobileDeckHydrateToken = 0;
const _mobileSearchHydrateNoImage = new Set();
let _mobileSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };

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

function getMobileCardImageUrl(card) {
  return String(
    card?.imageUrl
    || card?.img
    || card?.thumb
    || ''
  ).trim();
}

function renderMobileCardThumb(card, className = 'ml-search-thumb') {
  const url = getMobileCardImageUrl(card);
  const alt = escapeHtmlMobile(getMobileCardDisplayName(card));

  if (!url) {
    return `<div class="${className} placeholder">NO IMG</div>`;
  }

  return `
    <img
      src="${escapeHtmlMobile(url)}"
      alt="${alt}"
      class="${className}"
      loading="lazy"
      decoding="async"
      onerror="handleMobileCardImageError(this)">
  `;
}

function handleMobileCardImageError(img) {
  if (!img) return;
  img.onerror = null;
  img.outerHTML = `<div class="${img.className} placeholder">NO IMG</div>`;
}

function countMobileDeckCards(cards) {
  if (!Array.isArray(cards)) return 0;
  return cards.reduce((sum, card) => sum + (Number(card?.count) || 1), 0);
}

function getMobileCardDisplayName(card) {
  const name = String(card?.name || card?.nameEn || card?.cardName || '').trim();
  if (name) return name;

  const sourceId = String(card?.sourceId || card?.id || '').trim();
  if (sourceId) return `ID:${sourceId}`;

  const cardId = String(card?.cardId || '').trim();
  return cardId || '名称不明';
}

function getMobileCardCostValue(card) {
  const n = Number(card?.cost);
  return Number.isFinite(n) ? n : 999;
}

function getMobileCardCostLabel(card) {
  const cost = getMobileCardCostValue(card);
  return cost === 999 ? '-' : String(cost);
}

function sortMobileDeckCards(cards) {
  const next = Array.isArray(cards) ? [...cards] : [];
  next.sort((a, b) => {
    const costDiff = getMobileCardCostValue(a) - getMobileCardCostValue(b);
    if (costDiff !== 0) return costDiff;

    const countDiff = (Number(b?.count) || 1) - (Number(a?.count) || 1);
    if (countDiff !== 0) return countDiff;

    return getMobileCardDisplayName(a).localeCompare(getMobileCardDisplayName(b), 'ja');
  });
  return next;
}

function sortCurrentMobileDeckCards() {
  const sorted = sortMobileDeckCards(window._deckCards || []);
  window._deckCards = sorted;
  return sorted;
}

function getMobileUserLabel(account) {
  if (!account) return 'Guest';
  if (account.isGuest) return `Guest ${account.username || 'guest'}`;
  return account.username || 'User';
}

function getMobileCardCivClass(card) {
  const c = String(card?.civilization || '').toLowerCase();
  if (c.includes('fire') || c.includes('火')) return 'fire';
  if (c.includes('water') || c.includes('水')) return 'water';
  if (c.includes('nature') || c.includes('自然')) return 'nature';
  if (c.includes('light') || c.includes('光')) return 'light';
  if (c.includes('darkness') || c.includes('dark') || c.includes('闇')) return 'darkness';
  return 'neutral';
}

function getMobileCardShortName(name, max = 8) {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function getMobileDeckCivs(cards) {
  if (!Array.isArray(cards)) return [];
  const set = new Set();
  cards.forEach((card) => {
    const civ = getMobileCardCivClass(card);
    if (civ) set.add(civ);
  });
  return Array.from(set);
}

function renderMobileDeckCivDots(cards) {
  const civs = getMobileDeckCivs(cards);
  if (!civs.length) return '<span class="ml-civ-dot none">-</span>';
  return civs.map(civ => `<span class="ml-civ-dot ${escapeHtmlMobile(civ)}"></span>`).join('');
}

function onMobileSearchInput(query) {
  if (_mobileSearchDebounceTimer) clearTimeout(_mobileSearchDebounceTimer);
  _mobileSearchDebounceTimer = setTimeout(() => {
    mobileSearchCards(query);
  }, 280);
}

function decodeMobileData(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function bindMobileDelegatedEvents() {
  if (_mobileDelegatedEventsBound) return;

  const root = document.getElementById('app-mobile');
  if (!root) return;

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-mg-action]');
    if (!target || !root.contains(target)) return;

    const action = target.getAttribute('data-mg-action');
    const encodedDeck = target.getAttribute('data-deck');
    const deckName = decodeMobileData(encodedDeck);

    if (action === 'open-deck') {
      openMobileDeck(deckName);
      return;
    }
    if (action === 'start-game') {
      startMobileGame(deckName);
      return;
    }
    if (action === 'open-online') {
      showMobileOnlineModal(deckName);
      return;
    }
    if (action === 'delete-deck') {
      deleteMobileDeck(deckName);
      return;
    }
    if (action === 'add-card') {
      addToMobileDeck(decodeMobileData(target.getAttribute('data-card-json')));
      return;
    }
    if (action === 'inc-card') {
      incrementMobileCardCount(Number(target.getAttribute('data-idx')));
      return;
    }
    if (action === 'dec-card') {
      decrementMobileCardCount(Number(target.getAttribute('data-idx')));
      return;
    }
    if (action === 'remove-card') {
      removeMobileCard(Number(target.getAttribute('data-idx')));
    }
  });

  _mobileDelegatedEventsBound = true;
}

function askMobileConfirm(message, confirmLabel = 'OK', cancelLabel = 'キャンセル') {
  return new Promise((resolve) => {
    let modal = document.getElementById('mobile-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mobile-confirm-modal';
      modal.className = 'dm-confirm-modal';
      modal.innerHTML = `
        <div class="dm-confirm-backdrop"></div>
        <div class="dm-confirm-body mobile">
          <div id="mobile-confirm-message" class="dm-confirm-message"></div>
          <div class="dm-confirm-actions">
            <button id="mobile-confirm-ok" class="dm-confirm-btn ok">OK</button>
            <button id="mobile-confirm-cancel" class="dm-confirm-btn cancel">キャンセル</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const msg = document.getElementById('mobile-confirm-message');
    const okBtn = document.getElementById('mobile-confirm-ok');
    const cancelBtn = document.getElementById('mobile-confirm-cancel');
    const backdrop = modal.querySelector('.dm-confirm-backdrop');

    if (!msg || !okBtn || !cancelBtn || !backdrop) {
      resolve(false);
      return;
    }

    msg.textContent = String(message || '確認してください。');
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;

    const close = (result) => {
      modal.classList.remove('open');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      resolve(result);
    };

    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    backdrop.onclick = () => close(false);

    modal.classList.add('open');
  });
}

function showMobileToast(message, type = 'info', timeout = 2200) {
  let el = document.getElementById('mobile-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mobile-toast';
    el.className = 'mg-toast';
    document.body.appendChild(el);
  }

  el.className = `mg-toast ${type}`;
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    const current = document.getElementById('mobile-toast');
    if (current) current.style.opacity = '0';
  }, timeout);
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

function normalizeMobilePublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => NetworkService.normalizeCardData(card));
}

function normalizeMobilePublicZone(zone) {
  if (Array.isArray(zone)) return normalizeMobilePublicCards(zone);
  return Math.max(0, Number(zone) || 0);
}

function normalizeMobileOpponentState(rawState) {
  const src = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    hand: Math.max(0, Number(src.hand) || 0),
    deck: Math.max(0, Number(src.deck) || 0),
    shields: Math.max(0, Number(src.shields) || 0),
    battleZone: normalizeMobilePublicZone(src.battleZone),
    manaZone: normalizeMobilePublicZone(src.manaZone),
    graveyard: normalizeMobilePublicZone(src.graveyard)
  };
}

function serializeMobilePublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => {
    const name = String(card?.name || card?.nameEn || '').trim();
    const cost = card?.cost ?? '';
    const power = String(card?.power || '').trim();
    const civilization = String(card?.civilization || card?.civ || '').trim();
    const imageUrl = String(card?.imageUrl || card?.img || card?.thumb || '').trim();

    return {
      name,
      cost,
      power,
      civilization,
      civ: civilization,
      imageUrl,
      img: imageUrl,
      thumb: imageUrl,
      tapped: !!card?.tapped
    };
  });
}

function buildMobilePublicState(state) {
  return {
    hand: state.hand.length,
    deck: state.deck.length,
    shields: state.shields.length,
    battleZone: serializeMobilePublicCards(state.battleZone),
    manaZone: serializeMobilePublicCards(state.manaZone),
    graveyard: serializeMobilePublicCards(state.graveyard)
  };
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
  if (window.GameController) {
    return window.GameController.canActOnline(window._ol, window._olCurrentPlayer);
  }
  if (!window._ol) return true;
  if (!window._olCurrentPlayer) return false;
  const myNum = window._ol.p === 'p1' ? 1 : 2;
  return window._olCurrentPlayer === myNum;
}

/** localStorage dm_decks を安全に取得（破損時は {}） */
function getSavedDecksMobile() {
  if (window.GameController) {
    return window.GameController.getSavedDecks();
  }
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
  if (window.GameController) {
    _mobileSearchController = window.GameController.createSearchController({
      searchFn: (keyword, page) => NetworkService.searchCards(keyword, page),
      transformPage: (items) => hydrateMobileSearchCards(items),
      pageSize: 20
    });
  }
  renderMobileDeckList();
  bindMobileDelegatedEvents();
}

/**
 * 1カラムレイアウトのデッキ一覧画面
 */
function renderMobileDeckList() {
  const container = document.getElementById('app-mobile');
  const savedDecks = getSavedDecksMobile();
  const account = AuthService.getCurrentAccount();
  const userLabel = getMobileUserLabel(account);
  const editingState = window.GameController
    ? window.GameController.getDeckEditingState()
    : { deckName: window._deckEditing, cards: window._deckCards };
  let deckName = editingState.deckName;
  let cards = Array.isArray(editingState.cards) ? editingState.cards : [];

  const localDeckNames = Object.keys(savedDecks);
  const cloudDeckNames = Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [];
  const mergedDeckNames = Array.from(new Set([...localDeckNames, ...cloudDeckNames]))
    .sort((a, b) => String(a).localeCompare(String(b), 'ja'));

  if (deckName && !mergedDeckNames.includes(deckName)) {
    deckName = null;
    cards = [];
    if (window.GameController) {
      window.GameController.setDeckEditingState(null, []);
    } else {
      window._deckEditing = null;
      window._deckCards = [];
    }
  }

  const orderedCards = sortMobileDeckCards(cards);
  if (deckName) {
    window._deckCards = orderedCards;
  }

  const hasDeckSelected = !!deckName;
  const canSaveSelectedDeck = !!(hasDeckSelected && account && !account.isGuest && account.pin);
  const canPlaySelectedDeck = !!(hasDeckSelected && countMobileDeckCards(orderedCards) > 0);
  const cardCount = countMobileDeckCards(orderedCards);
  const uniqueCount = orderedCards.length;

  const deckOptionsHtml = mergedDeckNames.length
    ? mergedDeckNames.map((name) => `
      <option value="${escapeHtmlMobile(name)}" ${deckName === name ? 'selected' : ''}>${escapeHtmlMobile(name)}</option>
    `).join('')
    : '<option value="">デッキがありません</option>';

  const deckGridHtml = orderedCards.length
    ? orderedCards.map((card, i) => {
      const civClass = getMobileCardCivClass(card);
      const thumb = renderMobileCardThumb(card, 'ml-deck-thumb');
      return `
        <div class="ml-deck-tile ${civClass}">
          ${thumb}
          <div class="ml-deck-tile-name">${escapeHtmlMobile(getMobileCardDisplayName(card))}</div>
          <div class="ml-deck-tile-meta">
            <span>コスト ${escapeHtmlMobile(getMobileCardCostLabel(card))}</span>
            <span>${escapeHtmlMobile(String(card.count || 1))}枚</span>
          </div>
          <div class="ml-deck-controls">
            <button type="button" data-mg-action="dec-card" data-idx="${i}" class="ml-deck-btn minus">-</button>
            <button type="button" data-mg-action="inc-card" data-idx="${i}" class="ml-deck-btn plus">+</button>
            <button type="button" data-mg-action="remove-card" data-idx="${i}" class="ml-deck-btn delete">削除</button>
          </div>
        </div>
      `;
    }).join('')
    : '<div class="ml-empty-decks">カードがありません。下の検索から追加してください。</div>';

  container.innerHTML = `
    <div class="ml-root ml-builder-root">
      <div class="ml-builder-top">
        <div class="ml-builder-left">
          <select id="mobile-deck-select" class="ml-input ml-builder-select" onchange="onMobileDeckSelectChange(this.value)">
            <option value="">デッキを選択</option>
            <option value="__new__">＋新規デッキ作成</option>
            ${deckOptionsHtml}
          </select>
        </div>
        <div class="ml-builder-center">
          <div class="ml-builder-account">${escapeHtmlMobile(userLabel)}</div>
          <button type="button" onclick="logout()" class="ml-account-logout">ログアウト</button>
        </div>
        <div class="ml-builder-right">
          <button type="button" onclick="deleteSelectedMobileDeck()" ${hasDeckSelected ? '' : 'disabled'} class="ml-top-btn delete ${hasDeckSelected ? '' : 'disabled'}">削除</button>
          <button type="button" onclick="saveMobileDeck()" ${canSaveSelectedDeck ? '' : 'disabled'} class="ml-top-btn save ${canSaveSelectedDeck ? '' : 'disabled'}">保存</button>
          <button type="button" onclick="playMobileDeckGame()" ${canPlaySelectedDeck ? '' : 'disabled'} class="ml-top-btn play ${canPlaySelectedDeck ? '' : 'disabled'}">一人回し</button>
          <button type="button" onclick="openSelectedMobileDeckOnline()" ${hasDeckSelected ? '' : 'disabled'} class="ml-top-btn online ${hasDeckSelected ? '' : 'disabled'}">オンライン対戦</button>
        </div>
      </div>

      <div class="ml-main ml-builder-main">
        <div class="ml-panel ml-builder-summary">
          <div class="ml-summary-name">${hasDeckSelected ? escapeHtmlMobile(deckName) : 'デッキ未選択'}</div>
          <div class="ml-summary-stats">合計 ${cardCount}枚 / ユニーク ${uniqueCount}</div>
        </div>

        <div class="ml-panel ml-deck-grid-wrap">
          <h3 class="ml-heading">デッキ表示</h3>
          <div class="ml-deck-grid">
            ${hasDeckSelected ? deckGridHtml : '<div class="ml-empty-decks">左上でデッキを選択してください。</div>'}
          </div>
        </div>

        <div class="ml-panel ml-builder-search">
          <h3 class="ml-heading">カード名検索</h3>
          <input
            type="text"
            id="mobile-search-input"
            placeholder="カード名..."
            value="${escapeHtmlMobile(_mobileSearchState.query || '')}"
            class="ml-input"
            onkeyup="onMobileSearchInput(this.value)">
          <div id="mobile-search-results" class="ml-stack ml-stack-tight"></div>
        </div>
      </div>
    </div>
  `;

  if (_mobileSearchState.query) {
    renderMobileSearchResults();
  }
}

/**
 * デッキ一覧を更新
 */
function updateMobileDeckList() {
  renderMobileDeckList();
}

function onMobileDeckSelectChange(name) {
  const deckName = String(name || '').trim();
  if (deckName === '__new__') {
    newMobileDeck();
    return;
  }
  if (!deckName) {
    clearMobileDeckSelection();
    return;
  }
  openMobileDeck(deckName);
}

function deleteSelectedMobileDeck() {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }
  deleteMobileDeck(window._deckEditing);
}

function openSelectedMobileDeckOnline() {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }
  showMobileOnlineModal(window._deckEditing);
}

function clearMobileDeckSelection() {
  if (window.GameController) {
    window.GameController.setDeckEditingState(null, []);
  } else {
    window._deckEditing = null;
    window._deckCards = [];
  }
  renderMobileDeckList();
}

/**
 * カード検索（SP版）
 */
async function mobileSearchCards(q) {
  if (!window.GameController) {
    const keyword = (q || '').trim();
    const container = document.getElementById('mobile-search-results');
    if (!container) return;

    if (!keyword) {
      _mobileSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };
      container.innerHTML = '';
      return;
    }

    if (keyword !== _mobileSearchState.query) {
      _mobileSearchState = { query: keyword, page: 0, items: [], hasMore: false, loading: false };
    }
    if (_mobileSearchState.loading) return;

    _mobileSearchState.loading = true;
    try {
      const results = await NetworkService.searchCards(keyword, 1);
      const pageItems = Array.isArray(results) ? results.slice(0, 20) : [];
      const hydratedItems = await hydrateMobileSearchCards(pageItems);
      _mobileSearchState.query = keyword;
      _mobileSearchState.page = 1;
      _mobileSearchState.items = hydratedItems;
      _mobileSearchState.hasMore = pageItems.length >= 20;
    } finally {
      _mobileSearchState.loading = false;
    }

    renderMobileSearchResults();
    return;
  }

  if (!_mobileSearchController) {
    _mobileSearchController = window.GameController.createSearchController({
      searchFn: (keyword, page) => NetworkService.searchCards(keyword, page),
      transformPage: (items) => hydrateMobileSearchCards(items),
      pageSize: 20
    });
  }

  const container = document.getElementById('mobile-search-results');
  if (!container) return;

  _mobileSearchState = await _mobileSearchController.search(q);

  if (!_mobileSearchState.query) {
    container.innerHTML = '';
    return;
  }

  renderMobileSearchResults();
}

async function mobileSearchMore() {
  if (!window.GameController) {
    if (!_mobileSearchState.query || _mobileSearchState.loading || !_mobileSearchState.hasMore) return;
    _mobileSearchState.loading = true;
    const nextPage = _mobileSearchState.page + 1;
    try {
      const results = await NetworkService.searchCards(_mobileSearchState.query, nextPage);
      const pageItems = Array.isArray(results) ? results.slice(0, 20) : [];
      const hydratedItems = await hydrateMobileSearchCards(pageItems);
      _mobileSearchState.page = nextPage;
      _mobileSearchState.items = [..._mobileSearchState.items, ...hydratedItems];
      _mobileSearchState.hasMore = pageItems.length >= 20;
    } finally {
      _mobileSearchState.loading = false;
    }
    renderMobileSearchResults();
    return;
  }

  if (!_mobileSearchController || !_mobileSearchState.query || _mobileSearchState.loading || !_mobileSearchState.hasMore) return;

  _mobileSearchState = await _mobileSearchController.searchMore();

  renderMobileSearchResults();
}

function getMobileSearchHydrateKey(card) {
  const raw = String(card?.sourceId || card?.id || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('src:') ? raw.slice(4) : raw;
  if (!normalized || normalized.includes('|')) return '';
  return normalized;
}

async function hydrateMobileSearchCards(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) return [];

  const hydrated = await Promise.all(sourceItems.map(async (card) => {
    const normalizedCard = NetworkService.normalizeCardData(card);
    if (getMobileCardImageUrl(normalizedCard)) return normalizedCard;

    const key = getMobileSearchHydrateKey(normalizedCard);
    if (key && _mobileSearchHydrateNoImage.has(key)) {
      return normalizedCard;
    }

    try {
      const enriched = await NetworkService.enrichCardImage(normalizedCard);
      const normalized = NetworkService.normalizeCardData(enriched);
      if (!getMobileCardImageUrl(normalized) && key) {
        _mobileSearchHydrateNoImage.add(key);
      }
      return normalized;
    } catch {
      if (key) _mobileSearchHydrateNoImage.add(key);
      return normalizedCard;
    }
  }));

  return hydrated;
}

function renderMobileSearchResults() {
  const container = document.getElementById('mobile-search-results');
  if (!container) return;

  const cards = _mobileSearchState.items || [];
  if (!cards.length) {
    container.innerHTML = '<div class="ml-search-empty">検索結果なし</div>';
    return;
  }

  const rows = cards.map(card => {
    const civ = getMobileCardCivClass(card);
    const payload = encodeURIComponent(JSON.stringify(card));
    const cost = getMobileCardCostLabel(card);
    const cardName = getMobileCardDisplayName(card);
    const thumb = renderMobileCardThumb(card);
    return `
      <div class="ml-search-item ${civ}">
        <div class="ml-search-card-head">
          ${thumb}
          <div class="ml-search-main">
            <div class="ml-search-row">
              <div class="ml-search-name">${escapeHtmlMobile(cardName)}</div>
              <div class="ml-search-cost">${escapeHtmlMobile(String(cost))}</div>
            </div>
            <div class="ml-search-meta">${escapeHtmlMobile(String(card?.civilization || ''))}</div>
            <div class="ml-search-text">${escapeHtmlMobile(card.text || '')}</div>
          </div>
        </div>
        <button type="button" data-mg-action="add-card" data-card-json="${payload}" class="ml-add-btn">+追加</button>
      </div>
    `;
  }).join('');

  const moreBtn = _mobileSearchState.hasMore
    ? `<button onclick="mobileSearchMore()" class="ml-more-btn" ${_mobileSearchState.loading ? 'disabled' : ''}>${_mobileSearchState.loading ? '読込中...' : 'もっと見る'}</button>`
    : '';

  container.innerHTML = `${rows}${moreBtn}`;
}

/**
 * ゲーム開始（SP版）
 */
async function startMobileGame(deckName) {
  const account = AuthService.getCurrentAccount();
  let deckData = window.GameController
    ? await window.GameController.resolveDeckData(deckName, account)
    : null;

  if (!deckData) {
    const savedDecks = getSavedDecksMobile();
    if (savedDecks[deckName]) {
      deckData = savedDecks[deckName];
    } else if (account && !account.isGuest && account.pin) {
      deckData = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
    }
  }
  
  if (!deckData || !deckData.length) {
    showMobileToast('デッキが取得できませんでした', 'warn');
    return;
  }
  
  if (window.GameController) {
    window.GameController.initSoloGame(engineMobile, deckData);
  } else {
    window._ol = null;
    window._olOpponent = null;
    engineMobile.initGame(deckData);
  }
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileNeedDrawGuide = true;
  renderMobileGame();
}

/**
 * ゲーム画面レンダリング（SP版）
 */
function renderMobileGame() {
  const state = engineMobile.getState();
  if (_mobileSelectedShieldIdx !== null && _mobileSelectedShieldIdx >= state.shields.length) {
    _mobileSelectedShieldIdx = null;
  }
  if (_mobileSelectedHandIdx !== null && _mobileSelectedHandIdx >= state.hand.length) {
    _mobileSelectedHandIdx = null;
  }

  const container = document.getElementById('app-mobile');
  const ol = window._ol;
  const opp = window._olOpponent || {};
  const myNum = ol ? (ol.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = ol && window._olCurrentPlayer && window._olCurrentPlayer === myNum;
  const headerTurnClass = ol ? (isMyTurn ? 'mine-turn' : 'opponent-turn') : 'solo-turn';
  const myName = ol ? (ol.p === 'p1' ? (ol.p1Name || 'Player 1') : (ol.p2Name || 'Player 2')) : '自分';
  const oppName = ol ? (ol.p === 'p1' ? (ol.p2Name || 'Player 2') : (ol.p1Name || 'Player 1')) : '相手';
  const selectedHandCard = _mobileSelectedHandIdx === null ? null : state.hand[_mobileSelectedHandIdx];
  const shieldBreakLabel = _mobileSelectedShieldIdx === null ? 'シールド破壊' : `シールド破壊 (${_mobileSelectedShieldIdx + 1})`;

  const getZoneCount = (zone) => Array.isArray(zone) ? zone.length : Math.max(0, Number(zone) || 0);

  const renderOpponentPublicZone = (zone, zoneClass) => {
    if (!Array.isArray(zone)) {
      return renderMobileBackCards(getZoneCount(zone));
    }

    if (!zone.length) {
      return '<div class="mg-back-empty">0</div>';
    }

    const visibleLimit = 10;
    const visibleCards = zoneClass === 'grave' ? zone.slice(-visibleLimit) : zone.slice(0, visibleLimit);
    const chips = visibleCards.map((card) => renderChip(card, zoneClass, -1)).join('');
    const rest = zone.length > visibleCards.length
      ? `<div class="mg-more-chip">+${zone.length - visibleCards.length}</div>`
      : '';

    return `<div class="mg-back-cards">${chips}${rest}</div>`;
  };

  const renderChip = (card, zoneClass, idx = -1) => {
    const civ = getMobileCardCivClass(card);
    const tapped = card?.tapped ? 'tapped' : '';
    const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
    const power = card?.power ? String(card.power) : '';
    const shortName = getMobileCardShortName(card?.name, 8);
    const imageUrl = getMobileCardImageUrl(card);

    let onclick = '';
    if (idx >= 0 && zoneClass === 'battle') onclick = `onclick="tapMobileCard('battleZone', ${idx})"`;
    if (idx >= 0 && zoneClass === 'mana') onclick = `onclick="tapMobileCard('manaZone', ${idx})"`;

    return `
      <div class="mg-card-chip ${zoneClass} ${civ} ${tapped} ${imageUrl ? 'has-image' : ''}" ${onclick} title="${escapeHtmlMobile(card?.name || '')}">
        ${imageUrl
          ? `<img src="${escapeHtmlMobile(imageUrl)}" alt="${escapeHtmlMobile(card?.name || 'CARD')}" class="mg-card-chip-img" loading="lazy" decoding="async" onerror="handleMobileCardImageError(this)">`
          : `<div class="mg-card-cost">${escapeHtmlMobile(String(cost))}</div>
        <div class="mg-card-name">${escapeHtmlMobile(shortName)}</div>
        <div class="mg-card-power">${escapeHtmlMobile(power)}</div>`}
      </div>
    `;
  };
  
  container.innerHTML = `
    <div class="mg-root">
      
      <!-- ヘッダー -->
      <div class="mg-header ${headerTurnClass}">
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
              <div class="mg-opp-label">バトル (${getZoneCount(opp.battleZone)})</div>
              ${renderOpponentPublicZone(opp.battleZone, 'battle')}
            </div>
            <div class="mg-opp-panel">
              <div class="mg-opp-label">マナ (${getZoneCount(opp.manaZone)})</div>
              ${renderOpponentPublicZone(opp.manaZone, 'mana')}
            </div>
          </div>
          <div class="mg-opp-panel mg-opp-grave">
            <div class="mg-opp-label">墓地 (${getZoneCount(opp.graveyard)})</div>
            ${renderOpponentPublicZone(opp.graveyard, 'grave')}
          </div>
        </div>
      ` : ''}
      
      <!-- メインゲーム画面 -->
      <div class="mg-main">

        <div class="mg-me-wrap">
          <div class="mg-me-title">自分エリア: ${escapeHtmlMobile(myName)}</div>
        </div>

        <!-- シールド -->
        <div class="mg-zone-section shield">
          <div class="mg-zone-title">シールド (${state.shields.length})</div>
          <div class="mg-card-grid center">
            ${state.shields.length ? state.shields.map((s, i) => `
              <div class="mg-card-chip shield ${_mobileSelectedShieldIdx === i ? 'selected' : ''}" onclick="selectMobileShield(${i})" title="${escapeHtmlMobile(s.name || 'シールド')}">
                SH
              </div>
            `).join('') : '<div class="mg-zone-empty">カードなし</div>'}
          </div>
        </div>
        
        <!-- バトルゾーン -->
        <div class="mg-zone-section battle">
          <div class="mg-zone-title">バトルゾーン (${state.battleZone.length})</div>
          <div class="mg-card-grid">
            ${state.battleZone.length ? state.battleZone.map((c, i) => renderChip(c, 'battle', i)).join('') : '<div class="mg-zone-empty">カードなし</div>'}
          </div>
        </div>

        <!-- マナゾーン -->
        <div class="mg-zone-section mana">
          <div class="mg-zone-title">マナゾーン (${state.manaZone.length})</div>
          <div class="mg-card-grid">
            ${state.manaZone.length ? state.manaZone.map((c, i) => renderChip(c, 'mana', i)).join('') : '<div class="mg-zone-empty">カードなし</div>'}
          </div>
        </div>

        <!-- 墓地 -->
        <div class="mg-zone-section grave">
          <div class="mg-zone-title">墓地 (${state.graveyard.length})</div>
          <div class="mg-card-grid clickable" onclick="openMobileGraveyardModal()">
            ${state.graveyard.length ? state.graveyard.slice(-12).map(c => renderChip(c, 'grave')).join('') : '<div class="mg-zone-empty">カードなし</div>'}
            ${state.graveyard.length > 12 ? `<div class="mg-more-chip">+${state.graveyard.length - 12}</div>` : ''}
          </div>
          <div class="mg-zone-hint">タップで墓地一覧</div>
        </div>
        
      </div>
      
      <!-- 手札（固定下部） -->
      <div class="mg-hand-dock">
        <div class="mg-hand-title">手札 (${state.hand.length})</div>
        <div class="mg-hand-row">
          ${state.hand.length ? state.hand.map((c, i) => `
            <div class="mg-card-chip hand ${getMobileCardCivClass(c)} ${getMobileCardImageUrl(c) ? 'has-image' : ''}"
              onclick="openMobileHandActionSheet(${i})"
              title="${escapeHtmlMobile(c.name)}">
              ${getMobileCardImageUrl(c)
                ? `<img src="${escapeHtmlMobile(getMobileCardImageUrl(c))}" alt="${escapeHtmlMobile(c?.name || 'CARD')}" class="mg-card-chip-img" loading="lazy" decoding="async" onerror="handleMobileCardImageError(this)">`
                : `<div class="mg-card-cost">${escapeHtmlMobile(String(Number.isFinite(Number(c?.cost)) ? Number(c.cost) : '-'))}</div>
              <div class="mg-card-name">${escapeHtmlMobile(getMobileCardShortName(c.name, 8))}</div>
              <div class="mg-card-power">${escapeHtmlMobile(c?.power ? String(c.power) : '')}</div>`}
            </div>
          `).join('') : '<div class="mg-zone-empty">カードなし</div>'}
        </div>
      </div>

      <div class="mg-sheet-backdrop ${selectedHandCard ? 'open' : ''}" onclick="closeMobileHandSheet()"></div>
      <div class="mg-hand-sheet ${selectedHandCard ? 'open' : ''}">
        <div class="mg-hand-sheet-title">${selectedHandCard ? escapeHtmlMobile(selectedHandCard.name) : '手札アクション'}</div>
        <div class="mg-hand-sheet-actions">
          <button onclick="playMobileSelectedCard('battle')" class="mg-sheet-btn battle">バトルに出す</button>
          <button onclick="playMobileSelectedCard('mana')" class="mg-sheet-btn mana">マナに置く</button>
          <button onclick="closeMobileHandSheet()" class="mg-sheet-btn cancel">閉じる</button>
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
        <button onclick="drawMobileCard()" class="mg-btn draw ${_mobileNeedDrawGuide ? 'guide' : ''}">ドロー</button>
        <button onclick="turnMobileEnd()" class="mg-btn end">ターン終</button>
        <button onclick="moveMobileToGraveyard('battle')" class="mg-btn battle-grave">戦→墓</button>
        <button onclick="moveMobileToGraveyard('mana')" class="mg-btn mana-grave">マナ→墓</button>
        <button onclick="returnMobileFromGraveyard('hand')" class="mg-btn grave-return">墓→手</button>
        <button onclick="breakMobileShield()" class="mg-btn shield-break">${shieldBreakLabel}</button>
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
  openMobileHandActionSheet(idx);
}

function openMobileHandActionSheet(idx) {
  _mobileSelectedHandIdx = idx;
  renderMobileGame();
}

function closeMobileHandSheet() {
  _mobileSelectedHandIdx = null;
  renderMobileGame();
}

function openMobileGraveyardModal() {
  const state = engineMobile?.getState?.();
  const grave = Array.isArray(state?.graveyard) ? state.graveyard : [];
  if (!grave.length) {
    showMobileToast('墓地にカードがありません', 'warn');
    return;
  }

  let modal = document.getElementById('mobile-graveyard-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mobile-graveyard-modal';
    modal.className = 'dm-grave-modal';
    modal.innerHTML = `
      <div class="dm-grave-backdrop" onclick="closeMobileGraveyardModal()"></div>
      <div class="dm-grave-body mobile">
        <div class="dm-grave-head">
          <div class="dm-grave-title">墓地一覧</div>
          <button class="dm-grave-close" onclick="closeMobileGraveyardModal()">閉じる</button>
        </div>
        <div id="mobile-graveyard-list" class="dm-grave-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const list = document.getElementById('mobile-graveyard-list');
  if (list) {
    list.innerHTML = grave.slice().reverse().map((card, i) => {
      const civ = getMobileCardCivClass(card);
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item ${civ}">
          <div class="dm-grave-item-no">${i + 1}</div>
          <div class="dm-grave-item-main">
            <div class="dm-grave-item-name">${escapeHtmlMobile(card?.name || 'カード')}</div>
            <div class="dm-grave-item-meta">コスト ${escapeHtmlMobile(String(cost))} / パワー ${escapeHtmlMobile(String(power))}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  modal.classList.add('open');
}

function closeMobileGraveyardModal() {
  const modal = document.getElementById('mobile-graveyard-modal');
  if (modal) modal.classList.remove('open');
}

function playMobileSelectedCard(zone) {
  const idx = _mobileSelectedHandIdx;
  if (idx === null) return;
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const card = engineMobile.state.hand[idx];
  if (!card) {
    _mobileSelectedHandIdx = null;
    renderMobileGame();
    return;
  }

  const ok = window.GameController
    ? window.GameController.playCardByHandIndex(engineMobile, idx, zone)
    : engineMobile.playCard(card, zone);
  if (!ok) return;
  _mobileSelectedHandIdx = null;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function tapMobileCard(zone, idx) {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.tapCard(engineMobile, zone, idx)
    : engineMobile.tapCard(zone, idx);
  if (!ok) return;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function selectMobileShield(idx) {
  _mobileSelectedShieldIdx = _mobileSelectedShieldIdx === idx ? null : idx;
  renderMobileGame();
}

function breakMobileShield() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const result = window.GameController
    ? window.GameController.breakShield(engineMobile, _mobileSelectedShieldIdx)
    : { ok: !!engineMobile.breakShield(_mobileSelectedShieldIdx) };
  if (!result.ok) {
    showMobileToast('シールドがありません', 'warn');
    return;
  }

  _mobileSelectedShieldIdx = null;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function drawMobileCard() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.drawCard(engineMobile)
    : engineMobile.drawCard();
  if (!ok) return;
  _mobileNeedDrawGuide = false;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function turnMobileEnd() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.turnEnd(engineMobile, window._ol)
    : (engineMobile.turnEnd(), true);
  if (!ok) return;
  _mobileNeedDrawGuide = !window._ol;
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  if (window._ol) {
    olSendActionMobile('turn_end');
  } else {
    showMobileTurnNotification('次のターンです。まずはドロー');
  }
  renderMobileGame();
}

function moveMobileToGraveyard(fromZone) {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.moveToGraveyard(engineMobile, fromZone)
    : engineMobile.moveToGraveyard(-1, fromZone);
  if (!ok) return;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function returnMobileFromGraveyard(toZone) {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.returnFromGraveyard(engineMobile, toZone || 'hand')
    : engineMobile.returnFromGraveyard(-1, toZone || 'hand');
  if (!ok) return;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function undoMobileGame() {
  if (window._ol) return;
  const ok = window.GameController
    ? window.GameController.undo(engineMobile)
    : engineMobile.undo();
  if (ok) renderMobileGame();
}

function newMobileDeck() {
  const name = String(prompt('デッキ名を入力:') || '').trim();
  if (!name) return;

  const decks = getSavedDecksMobile();
  if (decks[name]) {
    showMobileToast('このデッキは既に存在します', 'warn');
    return;
  }

  decks[name] = [];
  if (window.GameController) {
    window.GameController.saveSavedDecks(decks);
    window.GameController.setDeckEditingState(name, []);
  } else {
    localStorage.setItem('dm_decks', JSON.stringify(decks));
    window._deckEditing = name;
    window._deckCards = [];
  }
  renderMobileDeckList();
}

async function deleteMobileDeck(name) {
  const ok = await askMobileConfirm('削除してよろしいですか？', '削除', 'キャンセル');
  if (!ok) return;

  const deckName = String(name || '').trim();
  if (!deckName) return;

  const account = AuthService.getCurrentAccount();
  const canCloudDelete = !!(account && !account.isGuest && account.pin);
  let cloudDeleteError = '';
  let deletedCloud = false;

  if (canCloudDelete) {
    const result = await NetworkService.deleteDeck(account.username, account.pin, deckName);
    if (result?.ok) {
      deletedCloud = true;
    } else if (result?.error) {
      cloudDeleteError = result.error;
    }
  }

  const decks = getSavedDecksMobile();
  const hadLocalDeck = Object.prototype.hasOwnProperty.call(decks, deckName);
  if (hadLocalDeck) {
    delete decks[deckName];
  }

  if (window.GameController) {
    if (hadLocalDeck) {
      window.GameController.saveSavedDecks(decks);
    }
    if (window._deckEditing === deckName) {
      window.GameController.setDeckEditingState(null, []);
    }
  } else {
    if (hadLocalDeck) {
      localStorage.setItem('dm_decks', JSON.stringify(decks));
    }
    if (window._deckEditing === deckName) {
      window._deckEditing = null;
      window._deckCards = [];
    }
  }

  if (canCloudDelete) {
    const names = await NetworkService.loadServerDecks(account.username, account.pin);
    if (window.AppState) {
      window.AppState.set('_serverDeckNames', names);
    } else {
      window._serverDeckNames = names;
    }
  }

  if (!deletedCloud && !hadLocalDeck) {
    showMobileToast(cloudDeleteError || 'デッキが見つかりませんでした', 'warn');
    renderMobileDeckList();
    return;
  }

  if (cloudDeleteError && hadLocalDeck) {
    showMobileToast(`ローカルから削除しました（クラウド削除失敗: ${cloudDeleteError}）`, 'warn');
  } else {
    showMobileToast('デッキを削除しました', 'ok');
  }
  renderMobileDeckList();
}

/**
 * SP版 デッキ編集画面
 */
function renderMobileDeckEdit() {
  renderMobileDeckList();
}

/**
 * デッキ編集を開く（SP版）
 */
function isMobileCardHydrationNeeded(card) {
  const hasName = !!String(card?.name || '').trim();
  const hasImage = !!getMobileCardImageUrl(card);
  const hasCost = Number.isFinite(Number(card?.cost));
  return !(hasName && hasImage && hasCost);
}

async function hydrateMobileDeckCards(cards) {
  const normalizedCards = Array.isArray(cards)
    ? cards.map(card => NetworkService.normalizeCardData(card))
    : [];

  if (!normalizedCards.length) return null;
  if (!normalizedCards.some(isMobileCardHydrationNeeded)) return null;

  const hydrated = await Promise.all(normalizedCards.map(async (card) => {
    if (!isMobileCardHydrationNeeded(card)) {
      return card;
    }
    const enriched = await NetworkService.enrichCardImage(card);
    return NetworkService.normalizeCardData(enriched);
  }));

  return hydrated;
}

async function openMobileDeck(name) {
  const deckName = String(name || '').trim();
  if (!deckName) {
    clearMobileDeckSelection();
    return;
  }

  try {
    const savedDecks = getSavedDecksMobile();
    let cards = [];

    if (Array.isArray(savedDecks[deckName])) {
      cards = JSON.parse(JSON.stringify(savedDecks[deckName])).map(card => NetworkService.normalizeCardData(card));
    } else {
      const account = AuthService.getCurrentAccount();
      if (account && !account.isGuest && account.pin) {
        const remoteDeck = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
        cards = Array.isArray(remoteDeck)
          ? remoteDeck.map(card => NetworkService.normalizeCardData(card))
          : [];
      }
    }

    const sortedCards = sortMobileDeckCards(cards);
    if (window.GameController) {
      window.GameController.setDeckEditingState(deckName, sortedCards);
    } else {
      window._deckEditing = deckName;
      window._deckCards = sortedCards;
    }
    renderMobileDeckList();

    const hydrateToken = ++_mobileDeckHydrateToken;
    const hydratedCards = await hydrateMobileDeckCards(sortedCards);
    if (!hydratedCards) return;
    if (hydrateToken !== _mobileDeckHydrateToken) return;
    if (window._deckEditing !== deckName) return;

    const hydratedSorted = sortMobileDeckCards(hydratedCards);
    if (window.GameController) {
      window.GameController.setDeckEditingState(deckName, hydratedSorted);
    } else {
      window._deckCards = hydratedSorted;
    }

    const decks = getSavedDecksMobile();
    if (Array.isArray(decks[deckName])) {
      decks[deckName] = hydratedSorted.map(card => NetworkService.normalizeCardData(card));
      if (window.GameController) {
        window.GameController.saveSavedDecks(decks);
      } else {
        localStorage.setItem('dm_decks', JSON.stringify(decks));
      }
    }

    renderMobileDeckList();
  } catch (error) {
    console.error('デッキ読み込みエラー:', error);
    showMobileToast('デッキの読み込みに失敗しました', 'warn');
  }
}

/**
 * カード枚数増加（SP版）
 */
function incrementMobileCardCount(idx) {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    window._deckCards = window.GameController.changeDeckCardCount(window._deckCards, idx, 1, 1, 4);
  } else {
    const card = window._deckCards[idx];
    if (!card) return;
    card.count = (card.count || 1) + 1;
    if (card.count > 4) card.count = 4;
  }
  sortCurrentMobileDeckCards();
  renderMobileDeckList();
}

/**
 * カード枚数減少（SP版）
 */
function decrementMobileCardCount(idx) {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    window._deckCards = window.GameController.changeDeckCardCount(window._deckCards, idx, -1, 1, 4);
  } else {
    const card = window._deckCards[idx];
    if (!card) return;
    card.count = (card.count || 1) - 1;
    if (card.count < 1) {
      window._deckCards.splice(idx, 1);
    }
  }
  sortCurrentMobileDeckCards();
  renderMobileDeckList();
}

/**
 * カード削除（SP版）
 */
function removeMobileCard(idx) {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    window._deckCards = window.GameController.removeDeckCard(window._deckCards, idx);
  } else {
    window._deckCards.splice(idx, 1);
  }
  sortCurrentMobileDeckCards();
  renderMobileDeckList();
}

/**
 * デッキに カード追加（SP版）
 */
async function addToMobileDeck(cardJson) {
  try {
    if (!window._deckEditing) {
      showMobileToast('先に編集するデッキを選択してください', 'warn');
      return;
    }

    const rawCard = JSON.parse(cardJson);
    const card = await NetworkService.enrichCardImage(rawCard);
    const normalized = NetworkService.normalizeCardData(card);
    const normalizedKey = String(normalized.cardId || normalized.id || '');

    const existing = window._deckCards.find(c => String(c.cardId || c.id || '') === normalizedKey);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      if (existing.count > 4) existing.count = 4;

      if (!existing.cardId && normalized.cardId) {
        existing.cardId = normalized.cardId;
      }
      if (!existing.sourceId && normalized.sourceId) {
        existing.sourceId = normalized.sourceId;
      }

      if (!existing.imageUrl && normalized.imageUrl) {
        existing.imageUrl = normalized.imageUrl;
        existing.thumb = normalized.imageUrl;
        existing.img = normalized.imageUrl;
      }
    } else {
      window._deckCards.push({ ...normalized, count: 1 });
    }

    sortCurrentMobileDeckCards();
    renderMobileDeckList();
  } catch (e) {
    console.error('カード追加エラー:', e);
  }
}

/**
 * デッキ保存（SP版）
 */
async function saveMobileDeck() {
  return saveMobileDeckToCloud();
}

async function saveMobileDeckToCloud() {
  if (!window._deckEditing) {
    showMobileToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  const total = window.GameController
    ? window.GameController.countDeckCards(window._deckCards)
    : countMobileDeckCards(window._deckCards);
  if (total <= 0) {
    showMobileToast('デッキが空です', 'warn');
    return;
  }
  if (total > 40) {
    const ok = await askMobileConfirm(`40枚を超えています（現在 ${total} 枚）。保存しますか？`, '保存する', '戻る');
    if (!ok) return;
  }

  const account = AuthService.getCurrentAccount();
  if (!account || account.isGuest || !account.pin) {
    showMobileToast('保存にはPINログインが必要です', 'warn');
    return;
  }

  const deckName = window._deckEditing;
  const deckData = window._deckCards.map(card => NetworkService.normalizeCardData(card));
  if (!deckName) return;

  const result = await NetworkService.saveDeck(account.username, account.pin, deckName, deckData);
  if (result.error) {
    showMobileToast(result.error, 'warn');
    return;
  }

  const decks = getSavedDecksMobile();
  decks[deckName] = deckData;
  if (window.GameController) {
    window.GameController.saveSavedDecks(decks);
  } else {
    localStorage.setItem('dm_decks', JSON.stringify(decks));
  }

  const names = await NetworkService.loadServerDecks(account.username, account.pin);
  if (window.AppState) {
    window.AppState.set('_serverDeckNames', names);
  } else {
    window._serverDeckNames = names;
  }
  showMobileToast('保存しました', 'ok');
  renderMobileDeckList();
}

/**
 * デッキからゲーム開始（SP版）
 */
function playMobileDeckGame() {
  if (!window._deckCards.length) {
    showMobileToast('デッキが空です', 'warn');
    return;
  }
  
  if (window.GameController) {
    window.GameController.initSoloGame(engineMobile, window._deckCards);
  } else {
    engineMobile.initGame(window._deckCards);
  }
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileNeedDrawGuide = true;
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
    showMobileToast('デッキが取得できませんでした', 'warn');
    return;
  }
  const result = await NetworkService.createRoom(name);
  if (result.error) {
    showMobileToast(result.error, 'warn');
    return;
  }
  const room = result.room;
  window._ol = {
    room,
    p: 'p1',
    p1Name: name,
    p2Name: null,
    eventSource: null,
    reconnectAttempt: 0,
    localSeq: 0,
    remoteSeq: 0
  };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  const modal = document.getElementById('mobile-ol-overlay')?.querySelector('.ml-ol-modal');
  if (modal) {
    modal.innerHTML = `
      <h3 class="ml-ol-title">ルーム作成完了</h3>
      <p class="ml-ol-room-code">${room}</p>
      <p class="ml-ol-caption">相手にこのコードを伝えてください。</p>
      <button type="button" onclick="copyMobileRoomCode()" class="ml-ol-btn create">コードをコピー</button>
      <button type="button" onclick="shareMobileRoomCode()" class="ml-ol-btn join">共有する</button>
      <button type="button" onclick="olCancelMobileWait()" class="ml-ol-btn close">キャンセル</button>
    `;
  }

  if (_olReconnectTimerMobile) {
    clearTimeout(_olReconnectTimerMobile);
    _olReconnectTimerMobile = null;
  }

  window._ol.reconnectAttempt = 0;
  showMobileToast(`ルーム ${room} を作成しました`, 'ok');
  olWaitForJoinedMobile();
}

async function copyMobileRoomCode() {
  if (!window._ol?.room) return;
  try {
    await navigator.clipboard.writeText(window._ol.room);
    showMobileToast('ルームコードをコピーしました', 'ok');
  } catch {
    showMobileToast('コピーに失敗しました', 'warn');
  }
}

async function shareMobileRoomCode() {
  if (!window._ol?.room) return;
  const text = `ルームコード: ${window._ol.room}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'DM Solitaire 対戦招待', text });
      showMobileToast('共有しました', 'ok');
      return;
    } catch {
      // fallthrough to copy
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showMobileToast('共有文面をコピーしました', 'ok');
  } catch {
    showMobileToast('共有に失敗しました', 'warn');
  }
}

function olWaitForJoinedMobile() {
  if (!window._ol || window._ol.p !== 'p1') return;

  if ((window._ol.reconnectAttempt || 0) >= 3) {
    showMobileToast('接続に失敗しました', 'warn');
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

  if (window.GameController) {
    window.GameController.clearOnlineSession();
  } else {
    window._ol = null;
    window._olDeckData = null;
  }
  window._olDeckName = null;

  hideMobileOnlineModal();

  renderMobileDeckList();
}

async function olJoinRoomMobile() {
  const deckName = window._olDeckName;
  const roomCodeInput = document.getElementById('mobile-ol-room-code');
  const code = (window.NetworkService && typeof window.NetworkService.normalizeRoomCode === 'function')
    ? window.NetworkService.normalizeRoomCode(roomCodeInput?.value || '')
    : (roomCodeInput?.value || '').trim().toUpperCase().slice(0, 6);
  if (roomCodeInput && code && roomCodeInput.value !== code) {
    roomCodeInput.value = code;
  }
  if (!code || code.length !== 6) {
    showMobileToast('ルームコードは6文字で入力してください', 'warn');
    return;
  }
  const name = (document.getElementById('mobile-ol-player-name').value || 'Player 2').trim().slice(0, 20);
  const deckData = await getMobileDeckDataForOnline(deckName);
  if (!deckData || !deckData.length) {
    showMobileToast('デッキが取得できませんでした', 'warn');
    return;
  }
  const result = await NetworkService.joinRoom(code, name);
  if (result.error) {
    showMobileToast(result.error, 'warn');
    return;
  }
  hideMobileOnlineModal();
  window._ol = {
    room: code,
    p: 'p2',
    p1Name: result.p1_name || 'Player 1',
    p2Name: name,
    eventSource: null,
    reconnectAttempt: 0,
    localSeq: 0,
    remoteSeq: 0
  };
  window._olDeckName = deckName;
  window._olDeckData = deckData;
  showMobileToast(`ルーム ${code} に参加しました`, 'ok');
  startMobileOnlineGame();
}

async function getMobileDeckDataForOnline(deckName) {
  const account = AuthService.getCurrentAccount();
  if (window.GameController) {
    return await window.GameController.resolveDeckData(deckName, account);
  }

  const savedDecks = getSavedDecksMobile();
  if (savedDecks[deckName]) {
    return Array.isArray(savedDecks[deckName]) ? savedDecks[deckName] : null;
  }
  if (account && !account.isGuest && account.pin) {
    return await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
  }
  return null;
}

function startMobileOnlineGame() {
  const deckData = window._olDeckData;
  if (!deckData || !window._ol) return;

  if (window._ol.eventSource) window._ol.eventSource.close();

  if (window.GameController) {
    window.GameController.startOnlineMatch(window._ol.p);
  } else {
    window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30, graveyard: 0 };
    window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
    window._olChatLogMobile = [];
  }
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileNeedDrawGuide = true;
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
    if (!shouldApplyRemotePayloadMobile(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;
    if (data.turn) engineMobile.state.turn = data.turn;
    if (other) window._olOpponent = normalizeMobileOpponentState(other);
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      [...engineMobile.state.battleZone, ...engineMobile.state.manaZone].forEach(card => {
        card.tapped = false;
      });
      _mobileNeedDrawGuide = true;
      showMobileTurnNotification('あなたのターンです！ まずはドロー');
    }

    renderMobileGame();
  });

  es.addEventListener('turn_end', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    if (!shouldApplyRemotePayloadMobile(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (data.turn) engineMobile.state.turn = data.turn;
    if (other) window._olOpponent = normalizeMobileOpponentState(other);
    if (data.active) {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      [...engineMobile.state.battleZone, ...engineMobile.state.manaZone].forEach(card => {
        card.tapped = false;
      });
      _mobileNeedDrawGuide = true;
      showMobileTurnNotification('あなたのターンです！ まずはドロー');
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
      showMobileToast('接続が切れました。ロビーに戻ります', 'warn');
      if (window.GameController) {
        window.GameController.clearOnlineSession();
      } else {
        window._ol = null;
        window._olOpponent = null;
        window._olCurrentPlayer = null;
      }
      renderMobileDeckList();
    }
  };
}

function nextOnlineSeqMobile() {
  if (!window._ol) return 0;

  if (window.GameController?.nextOnlineSeq) {
    return window.GameController.nextOnlineSeq(window._ol);
  }

  window._ol.localSeq = (Number(window._ol.localSeq) || 0) + 1;
  return window._ol.localSeq;
}

function shouldApplyRemotePayloadMobile(payload) {
  if (!window._ol) return false;

  if (window.GameController?.shouldApplyRemotePayload) {
    return window.GameController.shouldApplyRemotePayload(window._ol, payload);
  }

  const seq = Number(payload?.seq || 0);
  const last = Number(window._ol.remoteSeq || 0);
  if (seq <= last) return false;

  window._ol.remoteSeq = seq;
  return true;
}

function olSendActionMobile(actionType) {
  if (window.GameController) {
    window.GameController.sendOnlineAction(engineMobile, actionType);
    return;
  }

  if (!window._ol || !engineMobile) return;
  const s = engineMobile.state;
  const publicState = buildMobilePublicState(s);
  const payload = {
    room: window._ol.room,
    p: window._ol.p,
    type: actionType,
    seq: nextOnlineSeqMobile(),
    turn: s.turn,
    active: actionType === 'turn_end' ? (window._ol.p === 'p1' ? 'p2' : 'p1') : window._ol.p,
    p1: window._ol.p === 'p1' ? publicState : null,
    p2: window._ol.p === 'p2' ? publicState : null
  };
  NetworkService.sendAction(payload);
}
