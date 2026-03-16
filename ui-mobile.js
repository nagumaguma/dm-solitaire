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
const _mobileSearchHydrateCooldownUntil = new Map();
const MOBILE_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS = 45 * 1000;
const MOBILE_SEARCH_HYDRATE_ERROR_COOLDOWN_MS = 8 * 1000;
let _mobileSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };
let _mobileZoneMenuState = null;
let _mobileZoneMenuLongPressTimer = null;
let _mobileZoneLongPressCtx = null;
let _mobileUnderInsertState = null;
let _mobileSkipNextTap = false;
let _mobileDetailCardState = null;
let _mobileDetailRequestToken = 0;
let _mobileDetailAllowAdd = true;
let _mobileRibbonOtherOpen = false;
let _mobileDeckNValue = 3;
let _mobileDeckPeekPrivateCards = [];
let _mobileDeckRevealModalState = {
  mode: 'public',
  destination: 'hand',
  selected: {}
};

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
  const currentSrc = String(img.getAttribute('src') || '').trim();
  const retryCount = Number(img.dataset.imgRetryCount || 0);
  if (currentSrc && retryCount < 2) {
    const baseSrc = String(img.dataset.baseSrc || currentSrc).trim();
    img.dataset.baseSrc = baseSrc;
    img.dataset.imgRetryCount = String(retryCount + 1);
    const sep = baseSrc.includes('?') ? '&' : '?';
    img.src = `${baseSrc}${sep}_imgRetry=${Date.now()}_${retryCount + 1}`;
    return;
  }

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
  if (window.GameController?.getCardCivClass) {
    return window.GameController.getCardCivClass(card);
  }

  const c = String(card?.civilization || card?.civ || '').toLowerCase();
  if (c.includes('fire') || c.includes('火')) return 'fire';
  if (c.includes('water') || c.includes('水')) return 'water';
  if (c.includes('light') || c.includes('光')) return 'light';
  if (c.includes('darkness') || c.includes('dark') || c.includes('闇')) return 'dark';
  if (c.includes('nature') || c.includes('自然')) return 'nature';
  return 'multi';
}

function getMobileCardShortName(name, max = 8) {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function getMobileUnderCardCount(card) {
  if (!card || !Array.isArray(card.underCards) || !card.underCards.length) return 0;
  return card.underCards.reduce((sum, underCard) => sum + 1 + getMobileUnderCardCount(underCard), 0);
}

function renderMobileUnderLayers(count) {
  const layerCount = Math.min(8, Math.max(0, Number(count) || 0));
  if (!layerCount) return '';
  return Array.from({ length: layerCount }).map(() => '<span class="mg-under-layer"></span>').join('');
}

function getMobileCardTypeLabel(type) {
  const normalized = String(type || '').toLowerCase();
  if (!normalized) return '-';
  if (normalized.includes('evolution') || normalized.includes('進化')) return '進化クリーチャー';
  if (normalized.includes('creature') || normalized.includes('クリーチャー')) return 'クリーチャー';
  if (normalized.includes('spell') || normalized.includes('呪文')) return '呪文';
  return String(type || '-');
}

function ensureMobileCardDetailModal() {
  let modal = document.getElementById('mobile-card-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mobile-card-detail-modal';
    modal.className = 'dm-card-detail-modal';
    modal.innerHTML = `
      <div class="dm-card-detail-backdrop" onclick="closeMobileCardDetailModal()"></div>
      <div class="dm-card-detail-body mobile">
        <div class="dm-card-detail-head">
          <div id="mobile-card-detail-title" class="dm-card-detail-title">カード詳細</div>
          <button type="button" class="dm-card-detail-close" onclick="closeMobileCardDetailModal()">×</button>
        </div>
        <div id="mobile-card-detail-content" class="dm-card-detail-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

function closeMobileCardDetailModal() {
  const modal = document.getElementById('mobile-card-detail-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  _mobileDetailRequestToken += 1;
  _mobileDetailCardState = null;
  _mobileDetailAllowAdd = true;
}

function renderMobileCardDetailContent(card, opts = {}) {
  const content = document.getElementById('mobile-card-detail-content');
  const title = document.getElementById('mobile-card-detail-title');
  if (!content || !title) return;
  const allowAdd = opts.allowAdd !== undefined ? !!opts.allowAdd : _mobileDetailAllowAdd;

  if (opts.loading) {
    title.textContent = 'カード詳細';
    content.innerHTML = '<div class="dm-card-detail-loading">カード情報を取得中…</div>';
    return;
  }

  if (opts.error) {
    title.textContent = 'カード詳細';
    content.innerHTML = `<div class="dm-card-detail-error">${escapeHtmlMobile(opts.error)}</div>`;
    return;
  }

  const current = NetworkService.normalizeCardData(card || {});
  const imageUrl = getMobileCardImageUrl(current);
  const civClass = getMobileCardCivClass(current);
  const civLabel = String(current?.civilization || current?.civ || '') || '-';
  const cost = Number.isFinite(Number(current?.cost)) ? Number(current.cost) : '-';
  const typeLabel = getMobileCardTypeLabel(current?.type);
  const power = current?.power ? String(current.power) : '-';
  const sourceId = String(current?.sourceId || current?.id || current?.cardId || '').trim() || '-';
  const bodyText = String(current?.text || '').trim();
  const rowRace = current?.race
    ? `<tr><th>種族</th><td>${escapeHtmlMobile(String(current.race))}</td></tr>`
    : '';

  title.textContent = current?.name || 'カード詳細';
  content.innerHTML = `
    <div class="dm-card-detail-main">
      <div class="dm-card-detail-art-wrap ${imageUrl ? '' : 'placeholder'}">
        ${imageUrl
          ? `<img src="${escapeHtmlMobile(imageUrl)}" alt="${escapeHtmlMobile(current?.name || 'CARD')}" class="dm-card-detail-art" onerror="handleMobileCardImageError(this)">`
          : '<div class="dm-card-detail-art-placeholder">NO IMG</div>'}
      </div>
      <table class="dm-card-detail-table">
        <tr><th>文明</th><td><span class="dm-card-detail-civ ${escapeHtmlMobile(civClass)}">${escapeHtmlMobile(civLabel)}</span></td></tr>
        <tr><th>コスト</th><td>${escapeHtmlMobile(String(cost))}</td></tr>
        <tr><th>種類</th><td>${escapeHtmlMobile(typeLabel)}</td></tr>
        <tr><th>パワー</th><td>${escapeHtmlMobile(power)}</td></tr>
        ${rowRace}
        <tr><th>ID</th><td class="dm-card-detail-id">${escapeHtmlMobile(sourceId)}</td></tr>
      </table>
    </div>
    ${bodyText ? `<div class="dm-card-detail-text">${escapeHtmlMobile(bodyText).replace(/\n/g, '<br>')}</div>` : '<div class="dm-card-detail-text empty">テキスト情報なし</div>'}
    ${allowAdd
      ? `<div class="dm-card-detail-actions">
          <input id="mobile-card-detail-count" type="number" min="1" max="4" value="1" class="dm-card-detail-count" />
          <span class="dm-card-detail-count-label">枚</span>
          <button type="button" class="dm-card-detail-add" onclick="addMobileCardFromDetail()">＋ デッキに追加</button>
        </div>`
      : ''}
  `;
}

async function resolveMobileDetailCard(card) {
  const base = NetworkService.normalizeCardData(card || {});
  const lookup = String(base?.sourceId || base?.id || '').trim();
  if (!lookup || lookup.includes('|')) return base;

  try {
    const detail = await NetworkService.fetchCardDetail(lookup);
    if (!detail) return base;
    const normalizedDetail = NetworkService.normalizeCardData(detail);
    return {
      ...base,
      ...normalizedDetail,
      name: normalizedDetail?.name || base?.name,
      text: normalizedDetail?.text || base?.text,
      imageUrl: getMobileCardImageUrl(normalizedDetail) || getMobileCardImageUrl(base),
      thumb: getMobileCardImageUrl(normalizedDetail) || getMobileCardImageUrl(base),
      img: getMobileCardImageUrl(normalizedDetail) || getMobileCardImageUrl(base)
    };
  } catch {
    return base;
  }
}

async function showMobileCardDetail(cardJson, opts = {}) {
  const allowAdd = opts.allowAdd !== false;
  let raw;
  try {
    raw = typeof cardJson === 'string' ? JSON.parse(cardJson) : cardJson;
  } catch {
    showMobileToast('カード情報の読み込みに失敗しました', 'warn');
    return;
  }

  if (!raw || typeof raw !== 'object') {
    showMobileToast('カード情報の読み込みに失敗しました', 'warn');
    return;
  }

  _mobileDetailAllowAdd = allowAdd;

  const modal = ensureMobileCardDetailModal();
  modal.classList.add('open');
  renderMobileCardDetailContent(null, { loading: true, allowAdd });

  const token = ++_mobileDetailRequestToken;
  const base = NetworkService.normalizeCardData(raw);
  _mobileDetailCardState = base;
  renderMobileCardDetailContent(base, { allowAdd });

  const resolved = await resolveMobileDetailCard(base);
  if (token !== _mobileDetailRequestToken) return;
  _mobileDetailCardState = resolved;
  renderMobileCardDetailContent(resolved, { allowAdd });
}

function openMobileDeckCardDetail(cardJson) {
  const decoded = decodeMobileData(cardJson);
  showMobileCardDetail(decoded, { allowAdd: false });
}

async function addMobileCardFromDetail() {
  if (!_mobileDetailCardState) return;

  const input = document.getElementById('mobile-card-detail-count');
  const requested = Number(input?.value);
  const count = Math.max(1, Math.min(4, Number.isFinite(requested) ? Math.floor(requested) : 1));
  if (input) input.value = String(count);

  const ok = await addToMobileDeck(JSON.stringify(_mobileDetailCardState), count);
  if (ok) {
    closeMobileCardDetailModal();
  }
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
    if (action === 'show-card-detail') {
      showMobileCardDetail(decodeMobileData(target.getAttribute('data-card-json')));
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

    const input = document.getElementById('mobile-input-field');
    const okBtn = document.getElementById('mobile-input-ok');
    const cancelBtn = document.getElementById('mobile-input-cancel');
    const backdrop = modal.querySelector('.dm-confirm-backdrop');

    if (!input || !okBtn || !cancelBtn || !backdrop) {
      resolve(null);
      return;
    }

    input.placeholder = placeholder;
    input.value = '';

    const close = (result) => {
      modal.classList.remove('open');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      input.onkeydown = null;
      resolve(result);
    };

    okBtn.onclick = () => close(input.value.trim() || null);
    cancelBtn.onclick = () => close(null);
    backdrop.onclick = () => close(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(input.value.trim() || null);
      }
      if (e.key === 'Escape') {
        close(null);
      }
    };

    modal.classList.add('open');
    input.focus();
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

function normalizeMobilePublicCard(card) {
  const normalized = NetworkService.normalizeCardData(card);
  const underCards = Array.isArray(card?.underCards)
    ? card.underCards.map((underCard) => normalizeMobilePublicCard(underCard))
    : [];
  normalized.underCards = underCards;
  return normalized;
}

function normalizeMobilePublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => normalizeMobilePublicCard(card));
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
    deckRevealZone: normalizeMobilePublicZone(src.deckRevealZone),
    revealedZone: normalizeMobilePublicZone(src.revealedZone),
    battleZone: normalizeMobilePublicZone(src.battleZone),
    manaZone: normalizeMobilePublicZone(src.manaZone),
    graveyard: normalizeMobilePublicZone(src.graveyard)
  };
}

function serializeMobilePublicCard(card) {
  const name = String(card?.name || card?.nameEn || '').trim();
  const cost = card?.cost ?? '';
  const power = String(card?.power || '').trim();
  const civilization = String(card?.civilization || card?.civ || '').trim();
  const imageUrl = String(card?.imageUrl || card?.img || card?.thumb || '').trim();
  const underCards = Array.isArray(card?.underCards)
    ? card.underCards.map((underCard) => serializeMobilePublicCard(underCard))
    : [];

  return {
    name,
    cost,
    power,
    civilization,
    civ: civilization,
    imageUrl,
    img: imageUrl,
    thumb: imageUrl,
    tapped: !!card?.tapped,
    underCards
  };
}

function serializeMobilePublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => serializeMobilePublicCard(card));
}

function buildMobilePublicState(state) {
  return {
    hand: state.hand.length,
    deck: state.deck.length,
    shields: state.shields.length,
    deckRevealZone: serializeMobilePublicCards(state.deckRevealZone),
    revealedZone: serializeMobilePublicCards(state.revealedZone),
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

function sendMobileOnlineActionLog(message) {
  if (!window._ol) return;

  const room = window._ol.room;
  const player = window._ol.p;
  const msg = String(message || '').trim();
  if (!room || !player || !msg) return;

  NetworkService.sendChat(room, player, msg).catch((err) => {
    console.warn('send mobile online action log error', err);
  });
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

function getMobileZoneLabel(zoneKey) {
  const labels = {
    hand: '手札',
    battleZone: 'バトル',
    manaZone: 'マナ',
    shields: 'シールド',
    revealedZone: '公開中',
    deck: '山札',
    graveyard: '墓地'
  };
  return labels[zoneKey] || zoneKey;
}

function isMobileHiddenCardInfo(sourceZone, sourceCard) {
  if (sourceZone === 'deck') return true;
  if (sourceZone === 'shields') return !sourceCard?.faceUp;
  return false;
}

function getMobileCardZoneActions(sourceZone, sourceCard) {
  const actions = [];
  const move = (label, toZone, position = 'top', red = false) => ({ kind: 'move', label, toZone, position, red });

  if (sourceZone === 'hand') {
    actions.push(
      move('マナゾーンへ', 'manaZone'),
      move('バトルゾーンへ', 'battleZone'),
      move('シールドへ', 'shields'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'sep' },
      move('墓地へ（呪文使用）', 'graveyard', 'top', true),
      { kind: 'sep' },
      { kind: 'under', label: '盤面カードの下へ（対象選択）' }
    );
  } else if (sourceZone === 'battleZone') {
    actions.push(
      { kind: 'tap', label: sourceCard?.tapped ? 'アンタップ' : 'タップ（攻撃）', tapped: !sourceCard?.tapped },
      move('手札へ', 'hand'),
      move('マナゾーンへ', 'manaZone'),
      move('シールドへ', 'shields'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'under', label: '盤面カードの下へ（対象選択）' },
      { kind: 'sep' },
      move('墓地へ', 'graveyard', 'top', true)
    );
  } else if (sourceZone === 'manaZone') {
    actions.push(
      { kind: 'tap', label: sourceCard?.tapped ? 'アンタップ' : 'タップ（マナ使用）', tapped: !sourceCard?.tapped },
      move('手札へ', 'hand'),
      move('バトルゾーンへ', 'battleZone'),
      move('シールドへ', 'shields'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'sep' },
      move('墓地へ', 'graveyard', 'top', true)
    );
  } else if (sourceZone === 'shields') {
    actions.push(
      move('公開中へ（シールドブレイク）', 'revealedZone'),
      move('マナゾーンへ', 'manaZone'),
      move('バトルゾーンへ', 'battleZone'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'sep' },
      move('墓地へ', 'graveyard', 'top', true),
      { kind: 'sep' },
      { kind: 'flip', label: sourceCard?.faceUp ? '裏向きにする' : '表向きにする', faceUp: !sourceCard?.faceUp },
      { kind: 'sep' },
      { kind: 'under', label: '盤面カードの下へ（対象選択）' }
    );
  } else if (sourceZone === 'revealedZone') {
    actions.push(
      move('手札に加える', 'hand'),
      move('バトルゾーンへ（トリガー）', 'battleZone'),
      move('マナゾーンへ（トリガー）', 'manaZone'),
      { kind: 'sep' },
      move('墓地へ（トリガー解決）', 'graveyard', 'top', true)
    );
  } else if (sourceZone === 'graveyard') {
    actions.push(
      move('手札へ', 'hand'),
      move('バトルゾーンへ', 'battleZone'),
      move('マナゾーンへ', 'manaZone'),
      move('シールドへ', 'shields'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom')
    );
  } else if (sourceZone === 'deck') {
    actions.push(
      move('手札へ', 'hand'),
      move('バトルゾーンへ', 'battleZone'),
      move('マナゾーンへ', 'manaZone'),
      move('シールドへ', 'shields'),
      move('墓地へ', 'graveyard', 'top', true),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'sep' },
      { kind: 'deckAll', label: '山札を全部見る' }
    );
  }

  if (actions.length && actions[actions.length - 1].kind === 'sep') {
    actions.pop();
  }
  const canShowDetail = !window._ol || !isMobileHiddenCardInfo(sourceZone, sourceCard);
  if (actions.length && canShowDetail) {
    actions.push({ kind: 'sep' });
  }
  if (canShowDetail) {
    actions.push({ kind: 'detail', label: 'カード詳細' });
  }

  return actions;
}

function ensureMobileCardZoneMenu() {
  let modal = document.getElementById('mobile-card-zone-menu');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'mobile-card-zone-menu';
  modal.className = 'mg-zone-menu-modal';
  modal.innerHTML = `
    <div class="mg-zone-menu-backdrop" onclick="closeMobileCardZoneMenu()"></div>
    <div class="mg-zone-menu-sheet">
      <div id="mobile-zone-menu-head" class="mg-zone-menu-head"></div>
      <div id="mobile-zone-menu-list" class="mg-zone-menu-list"></div>
      <button type="button" class="mg-zone-menu-close" onclick="closeMobileCardZoneMenu()">閉じる</button>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function closeMobileCardZoneMenu() {
  cancelMobileZoneLongPress();
  _mobileZoneMenuState = null;
  _mobileSkipNextTap = false;
  const modal = document.getElementById('mobile-card-zone-menu');
  if (!modal) return;
  modal.classList.remove('open');
}

function moveMobileCardBetweenZones(fromZone, fromIndex, toZone, position = 'top') {
  closeMobileCardZoneMenu();

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const options = { position: position === 'bottom' ? 'bottom' : 'top' };
  const ok = window.GameController
    ? window.GameController.moveCardBetweenZones(engineMobile, fromZone, fromIndex, toZone, options)
    : engineMobile.moveCardBetweenZones(fromZone, fromIndex, toZone, options);
  if (!ok) {
    showMobileToast('カード移動に失敗しました', 'warn');
    return;
  }

  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function resolveMobileRevealedToHand(index) {
  moveMobileCardBetweenZones('revealedZone', Number(index), 'hand', 'top');
}

function useMobileRevealedAsTrigger(index) {
  moveMobileCardBetweenZones('revealedZone', Number(index), 'graveyard', 'top');
}

function setMobileShieldFaceUp(index, faceUp) {
  closeMobileCardZoneMenu();

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const idx = Number(index);
  if (!Number.isInteger(idx)) return;

  const ok = window.GameController?.setShieldFaceUp
    ? window.GameController.setShieldFaceUp(engineMobile, idx, !!faceUp)
    : (typeof engineMobile.setShieldFaceUp === 'function' ? engineMobile.setShieldFaceUp(idx, !!faceUp) : false);
  if (!ok) {
    showMobileToast('シールドの向きを変更できませんでした', 'warn');
    return;
  }

  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function untapAllMobileMana() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController?.untapAllMana
    ? window.GameController.untapAllMana(engineMobile)
    : (typeof engineMobile.untapAllMana === 'function' ? engineMobile.untapAllMana() : false);
  if (!ok) {
    showMobileToast('マナゾーンにアンタップ対象がありません', 'info');
    return;
  }

  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function setMobileCardTapped(zone, idx, tapped) {
  closeMobileCardZoneMenu();

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const cards = engineMobile?.state?.[zone];
  const card = Array.isArray(cards) ? cards[idx] : null;
  if (!card) return;

  const nextTapped = !!tapped;
  const ok = window.GameController?.setCardTapped
    ? window.GameController.setCardTapped(engineMobile, zone, idx, nextTapped)
    : ((!!card.tapped === nextTapped) ? true : engineMobile.tapCard(zone, idx));
  if (!ok) {
    showMobileToast('タップ状態を変更できませんでした', 'warn');
    return;
  }

  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

async function openMobileCardDetailFromZone(sourceZone, sourceIndex) {
  const source = engineMobile?.state?.[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !Number.isInteger(idx) || !source[idx]) {
    showMobileToast('カード情報が見つかりません', 'warn');
    return;
  }

  const card = source[idx];
  const hiddenCardInfo = isMobileHiddenCardInfo(sourceZone, card);
  closeMobileCardZoneMenu();

  if (hiddenCardInfo && window._ol) {
    showMobileToast('オンライン対戦では非公開カードの詳細は確認できません', 'warn');
    return;
  }

  if (hiddenCardInfo && !window._ol) {
    const zoneLabel = getMobileZoneLabel(sourceZone);
    const ok = await askMobileConfirm(`${zoneLabel}の非公開カードを確認しますか？`, '見る', 'キャンセル');
    if (!ok) return;
  }

  showMobileCardDetail(card, { allowAdd: false });
}

function prepareMobileInsertUnder(fromZone, fromIndex) {
  closeMobileCardZoneMenu();

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const idx = Number(fromIndex);
  const source = engineMobile?.state?.[fromZone];
  if (!Array.isArray(source) || !Number.isInteger(idx) || !source[idx]) {
    showMobileToast('重ねるカードが見つかりません', 'warn');
    return;
  }

  _mobileUnderInsertState = { fromZone, fromIndex: idx };
  showMobileToast('重ね先のバトル/マナ/シールドをタップしてください', 'info', 2800);
  renderMobileGame();
}

function insertMobileCardUnderTarget(targetZone, targetIndex) {
  if (!_mobileUnderInsertState) return;
  if (targetZone !== 'battleZone' && targetZone !== 'manaZone' && targetZone !== 'shields') {
    showMobileToast('重ね先はバトル/マナ/シールドのみです', 'warn');
    return;
  }

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const fromZone = _mobileUnderInsertState.fromZone;
  const fromIndex = _mobileUnderInsertState.fromIndex;
  const idx = Number(targetIndex);

  const ok = window.GameController?.insertCardUnderCard
    ? window.GameController.insertCardUnderCard(engineMobile, fromZone, fromIndex, targetZone, idx)
    : (typeof engineMobile.insertCardUnderCard === 'function'
      ? engineMobile.insertCardUnderCard(fromZone, fromIndex, targetZone, idx)
      : false);

  if (!ok) {
    showMobileToast('カードを下に重ねられませんでした', 'warn');
    return;
  }

  _mobileUnderInsertState = null;
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function onMobileBoardCardTap(zone, idx) {
  if (_mobileSkipNextTap) {
    _mobileSkipNextTap = false;
    return;
  }

  if (_mobileUnderInsertState) {
    const sameSource = _mobileUnderInsertState.fromZone === zone
      && _mobileUnderInsertState.fromIndex === idx;
    if (sameSource) {
      _mobileUnderInsertState = null;
      showMobileToast('重ね配置をキャンセルしました', 'info');
      renderMobileGame();
      return;
    }

    insertMobileCardUnderTarget(zone, idx);
    return;
  }

  tapMobileCard(zone, idx);
}

function onMobileShieldCardTap(idx) {
  if (_mobileSkipNextTap) {
    _mobileSkipNextTap = false;
    return;
  }

  if (_mobileUnderInsertState) {
    const sameSource = _mobileUnderInsertState.fromZone === 'shields'
      && _mobileUnderInsertState.fromIndex === idx;
    if (sameSource) {
      _mobileUnderInsertState = null;
      showMobileToast('重ね配置をキャンセルしました', 'info');
      renderMobileGame();
      return;
    }

    insertMobileCardUnderTarget('shields', idx);
    return;
  }

  selectMobileShield(idx);
}

function openMobileCardZoneMenu(event, sourceZone, sourceIndex) {
  cancelMobileZoneLongPress();

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!engineMobile || !engineMobile.state) return;

  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const source = engineMobile.state[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !source.length || !Number.isInteger(idx) || !source[idx]) {
    showMobileToast('移動できるカードがありません', 'warn');
    return;
  }

  const sourceCard = source[idx];
  const actions = getMobileCardZoneActions(sourceZone, sourceCard);
  if (!actions.length) return;

  const modal = ensureMobileCardZoneMenu();
  const head = document.getElementById('mobile-zone-menu-head');
  const list = document.getElementById('mobile-zone-menu-list');
  if (!head || !list) return;

  _mobileZoneMenuState = { sourceZone, sourceIndex: idx };

  list.innerHTML = actions.map((action) => {
    if (action.kind === 'sep') {
      return '<div class="mg-zone-menu-sep" aria-hidden="true"></div>';
    }

    const className = [
      'mg-zone-menu-btn',
      action.kind === 'detail' ? 'detail' : '',
      action.red ? 'red' : ''
    ].filter(Boolean).join(' ');

    if (action.kind === 'tap') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="setMobileCardTapped('${sourceZone}', ${idx}, ${action.tapped ? 'true' : 'false'})">
          ${escapeHtmlMobile(action.label)}
        </button>
      `;
    }

    if (action.kind === 'under') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="prepareMobileInsertUnder('${sourceZone}', ${idx})">
          ${escapeHtmlMobile(action.label)}
        </button>
      `;
    }

    if (action.kind === 'flip') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="setMobileShieldFaceUp(${idx}, ${action.faceUp ? 'true' : 'false'})">
          ${escapeHtmlMobile(action.label)}
        </button>
      `;
    }

    if (action.kind === 'detail') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openMobileCardDetailFromZone('${sourceZone}', ${idx})">
          ${escapeHtmlMobile(action.label)}
        </button>
      `;
    }

    if (action.kind === 'deckAll') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openMobileDeckAllModal()">
          ${escapeHtmlMobile(action.label)}
        </button>
      `;
    }

    return `
      <button
        type="button"
        class="${className}"
        onclick="moveMobileCardBetweenZones('${sourceZone}', ${idx}, '${action.toZone}', '${action.position || 'top'}')">
        ${escapeHtmlMobile(action.label)}
      </button>
    `;
  }).join('');

  head.textContent = `${getMobileZoneLabel(sourceZone)} の操作`;
  modal.classList.add('open');
  if (!event) {
    _mobileSkipNextTap = true;
  }
}

function startMobileZoneLongPress(event, sourceZone, sourceIndex) {
  cancelMobileZoneLongPress();
  const idx = Number(sourceIndex);
  if (!Number.isInteger(idx)) return;

  _mobileZoneLongPressCtx = { sourceZone, sourceIndex: idx };
  _mobileZoneMenuLongPressTimer = setTimeout(() => {
    _mobileZoneMenuLongPressTimer = null;
    const ctx = _mobileZoneLongPressCtx;
    if (!ctx) return;
    _mobileZoneLongPressCtx = null;
    _mobileSkipNextTap = true;
    openMobileCardZoneMenu(null, ctx.sourceZone, ctx.sourceIndex);
  }, 420);
}

function cancelMobileZoneLongPress() {
  if (_mobileZoneMenuLongPressTimer) {
    clearTimeout(_mobileZoneMenuLongPressTimer);
    _mobileZoneMenuLongPressTimer = null;
  }
  _mobileZoneLongPressCtx = null;
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
  closeMobileCardZoneMenu();
  closeMobileDeckRevealModal();
  closeMobileDeckAllModal();
  _mobileUnderInsertState = null;
  _mobileRibbonOtherOpen = false;
  _mobileDeckPeekPrivateCards = [];
  _mobileDeckRevealModalState = {
    mode: 'public',
    destination: _mobileDeckRevealModalState.destination || 'hand',
    selected: {}
  };

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
      const payload = escapeAttrJsMobile(encodeURIComponent(JSON.stringify(card)));
      return `
        <div class="ml-deck-tile ${civClass}" onclick="openMobileDeckCardDetail('${payload}')">
          ${thumb}
          <div class="ml-deck-tile-name">${escapeHtmlMobile(getMobileCardDisplayName(card))}</div>
          <div class="ml-deck-tile-meta">
            <span>コスト ${escapeHtmlMobile(getMobileCardCostLabel(card))}</span>
            <span>${escapeHtmlMobile(String(card.count || 1))}枚</span>
          </div>
          <div class="ml-deck-controls" onclick="event.stopPropagation()">
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

function shouldSkipMobileSearchHydrate(key) {
  if (!key) return false;
  const until = Number(_mobileSearchHydrateCooldownUntil.get(key) || 0);
  if (!until) return false;
  if (Date.now() <= until) return true;
  _mobileSearchHydrateCooldownUntil.delete(key);
  return false;
}

function markMobileSearchHydrateCooldown(key, cooldownMs = MOBILE_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS) {
  if (!key) return;
  const duration = Math.max(0, Number(cooldownMs) || 0);
  _mobileSearchHydrateCooldownUntil.set(key, Date.now() + duration);
}

async function hydrateMobileSearchCards(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) return [];

  const hydrated = await Promise.all(sourceItems.map(async (card) => {
    const normalizedCard = NetworkService.normalizeCardData(card);
    if (getMobileCardImageUrl(normalizedCard)) return normalizedCard;

    const key = getMobileSearchHydrateKey(normalizedCard);
    if (key && shouldSkipMobileSearchHydrate(key)) {
      return normalizedCard;
    }

    try {
      const enriched = await NetworkService.enrichCardImage(normalizedCard, {
        retries: 1,
        retryDelayMs: 300
      });
      const normalized = NetworkService.normalizeCardData(enriched);
      if (getMobileCardImageUrl(normalized)) {
        if (key) _mobileSearchHydrateCooldownUntil.delete(key);
        return normalized;
      }

      if (key) {
        markMobileSearchHydrateCooldown(key, MOBILE_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS);
      }
      return normalized;
    } catch {
      if (key) {
        markMobileSearchHydrateCooldown(key, MOBILE_SEARCH_HYDRATE_ERROR_COOLDOWN_MS);
      }
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
        <div class="ml-search-actions">
          <button type="button" data-mg-action="show-card-detail" data-card-json="${payload}" class="ml-detail-btn">詳細</button>
          <button type="button" data-mg-action="add-card" data-card-json="${payload}" class="ml-add-btn">+追加</button>
        </div>
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
  _mobileUnderInsertState = null;
  _mobileNeedDrawGuide = true;
  _mobileRibbonOtherOpen = false;
  _mobileDeckPeekPrivateCards = [];
  _mobileDeckRevealModalState = {
    mode: 'public',
    destination: _mobileDeckRevealModalState.destination || 'hand',
    selected: {}
  };
  closeMobileCardZoneMenu();
  closeMobileDeckRevealModal();
  closeMobileDeckAllModal();
  renderMobileGame();
}

/**
 * ゲーム画面レンダリング（SP版）
 */
function renderMobileGame() {
  const state = engineMobile.getState();
  const revealedZoneCards = Array.isArray(state.revealedZone) ? state.revealedZone : [];

  if (_mobileUnderInsertState) {
    const sourceCards = state[_mobileUnderInsertState.fromZone];
    if (!Array.isArray(sourceCards) || !sourceCards[_mobileUnderInsertState.fromIndex]) {
      _mobileUnderInsertState = null;
    }
  }

  if (_mobileZoneMenuState) {
    const sourceCards = state[_mobileZoneMenuState.sourceZone];
    if (!Array.isArray(sourceCards) || !sourceCards[_mobileZoneMenuState.sourceIndex]) {
      closeMobileCardZoneMenu();
    }
  }

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
    const underCount = getMobileUnderCardCount(card);
    const sourceZone = zoneClass === 'battle'
      ? 'battleZone'
      : (zoneClass === 'mana'
        ? 'manaZone'
        : (zoneClass === 'grave'
          ? 'graveyard'
          : (zoneClass === 'revealed' ? 'revealedZone' : '')));
    const canMenu = idx >= 0 && !!sourceZone;
    const isOwnBoardCard = idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isUnderSource = !!_mobileUnderInsertState
      && _mobileUnderInsertState.fromZone === sourceZone
      && _mobileUnderInsertState.fromIndex === idx;

    const chipClasses = [
      'mg-card-chip',
      zoneClass,
      civ,
      tapped,
      imageUrl ? 'has-image' : '',
      underCount > 0 ? 'has-under' : '',
      _mobileUnderInsertState && isOwnBoardCard ? 'stack-target' : '',
      isUnderSource ? 'under-source' : ''
    ].filter(Boolean).join(' ');

    const onclick = isOwnBoardCard ? `onclick="onMobileBoardCardTap('${sourceZone}', ${idx})"` : '';
    const menuAttrs = canMenu
      ? `oncontextmenu="openMobileCardZoneMenu(event, '${sourceZone}', ${idx})"
        ontouchstart="startMobileZoneLongPress(event, '${sourceZone}', ${idx})"
        ontouchend="cancelMobileZoneLongPress()"
        ontouchmove="cancelMobileZoneLongPress()"
        ontouchcancel="cancelMobileZoneLongPress()"`
      : '';

    return `
      <div class="${chipClasses}" ${onclick} ${menuAttrs} title="${escapeHtmlMobile(card?.name || '')}">
        ${underCount > 0 ? `<div class="mg-under-stack" aria-hidden="true">${renderMobileUnderLayers(underCount)}</div><div class="mg-under-count">+${underCount}</div>` : ''}
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
        ターン ${state.turn} |
        <span
          class="mg-deck-count"
          oncontextmenu="openMobileCardZoneMenu(event, 'deck', ${Math.max(0, state.deck.length - 1)})"
          ontouchstart="startMobileZoneLongPress(event, 'deck', ${Math.max(0, state.deck.length - 1)})"
          ontouchend="cancelMobileZoneLongPress()"
          ontouchmove="cancelMobileZoneLongPress()"
          ontouchcancel="cancelMobileZoneLongPress()"
          title="長押しで山札トップ操作">デッキ: ${state.deck.length}</span>
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
              <div class="mg-opp-label">公開中 (${getZoneCount(opp.revealedZone)})</div>
              ${renderOpponentPublicZone(opp.revealedZone, 'revealed')}
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
          ${_mobileUnderInsertState ? '<div class="mg-zone-hint">重ね先を選択中: バトル/マナ/シールドをタップ</div>' : ''}
        </div>

        <!-- シールド -->
        <div class="mg-zone-section shield">
          <div class="mg-zone-title">シールド (${state.shields.length})</div>
          <div class="mg-card-grid center">
            ${state.shields.length ? state.shields.map((s, i) => {
              const civ = getMobileCardCivClass(s);
              const imageUrl = getMobileCardImageUrl(s);
              const shortName = getMobileCardShortName(s?.name || '', 8);
              const underCount = getMobileUnderCardCount(s);
              return `
                <div class="mg-card-chip shield ${civ} ${s?.faceUp ? 'faceup' : ''} ${imageUrl && s?.faceUp ? 'has-image' : ''} ${underCount > 0 ? 'has-under' : ''} ${_mobileSelectedShieldIdx === i ? 'selected' : ''} ${_mobileUnderInsertState ? 'stack-target' : ''}"
                  onclick="onMobileShieldCardTap(${i})"
                  oncontextmenu="openMobileCardZoneMenu(event, 'shields', ${i})"
                  ontouchstart="startMobileZoneLongPress(event, 'shields', ${i})"
                  ontouchend="cancelMobileZoneLongPress()"
                  ontouchmove="cancelMobileZoneLongPress()"
                  ontouchcancel="cancelMobileZoneLongPress()"
                  title="${escapeHtmlMobile(s?.faceUp ? (s.name || 'シールド') : 'シールド')}">
                  ${underCount > 0 ? `<div class="mg-under-stack" aria-hidden="true">${renderMobileUnderLayers(underCount)}</div><div class="mg-under-count">+${underCount}</div>` : ''}
                  ${s?.faceUp
                    ? (imageUrl
                      ? `<img src="${escapeHtmlMobile(imageUrl)}" alt="${escapeHtmlMobile(s.name || 'SHIELD')}" class="mg-card-chip-img" loading="lazy" decoding="async" onerror="handleMobileCardImageError(this)">`
                      : `<div class="mg-card-name">${escapeHtmlMobile(shortName || 'SH')}</div>`)
                    : 'SH'}
                </div>
              `;
            }).join('') : '<div class="mg-zone-empty">カードなし</div>'}
          </div>
        </div>

        <div class="mg-zone-section revealed">
          <div class="mg-zone-title">公開中 (S・トリガー判定) (${revealedZoneCards.length})</div>
          <div class="mg-revealed-grid">
            ${revealedZoneCards.length ? revealedZoneCards.map((c, i) => `
              <div class="mg-revealed-item">
                ${renderChip(c, 'revealed', i)}
                <div class="mg-revealed-actions">
                  <button type="button" class="mg-revealed-btn hand" onclick="resolveMobileRevealedToHand(${i})">手札に加える</button>
                  <button type="button" class="mg-revealed-btn trigger" onclick="useMobileRevealedAsTrigger(${i})">トリガー使用</button>
                </div>
              </div>
            `).join('') : '<div class="mg-zone-empty">公開カードなし</div>'}
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
            ${state.graveyard.length
              ? (() => {
                const visible = state.graveyard.slice(-12);
                const startIndex = state.graveyard.length - visible.length;
                return visible.map((c, i) => renderChip(c, 'grave', startIndex + i)).join('');
              })()
              : '<div class="mg-zone-empty">カードなし</div>'}
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
              oncontextmenu="openMobileCardZoneMenu(event, 'hand', ${i})"
              ontouchstart="startMobileZoneLongPress(event, 'hand', ${i})"
              ontouchend="cancelMobileZoneLongPress()"
              ontouchmove="cancelMobileZoneLongPress()"
              ontouchcancel="cancelMobileZoneLongPress()"
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
      
      <!-- 折りたたみリボン -->
      <div class="mg-ribbon">
        <div class="mg-ribbon-main">
          <button onclick="drawMobileCard()" class="mg-btn mg-ribbon-btn draw ${_mobileNeedDrawGuide ? 'guide' : ''}">ドロー</button>
          <button onclick="turnMobileEnd()" class="mg-btn mg-ribbon-btn end">ターンエンド</button>
          <button onclick="toggleMobileRibbonOther()" class="mg-btn mg-ribbon-btn other">その他 ${_mobileRibbonOtherOpen ? '▲' : '▼'}</button>
        </div>
        <div class="mg-ribbon-extra ${_mobileRibbonOtherOpen ? 'open' : ''}">
          <div class="mg-ribbon-extra-grid">
            <button onclick="moveMobileDeckTopTo('manaZone')" class="mg-btn mg-ribbon-btn deck-mana">トップ→マナ</button>
            <button onclick="moveMobileDeckTopTo('graveyard')" class="mg-btn mg-ribbon-btn deck-grave">トップ→墓地</button>
            <button onclick="moveMobileDeckTopTo('shields')" class="mg-btn mg-ribbon-btn deck-shield">トップ→シールド</button>
            <button onclick="untapAllMobileMana()" class="mg-btn mg-ribbon-btn mana-untap">マナ全アンタップ</button>
          </div>
          <div class="mg-ribbon-n-control">
            <span class="mg-ribbon-n-label">n</span>
            <input
              type="number"
              id="mobile-deck-n-input"
              class="mg-ribbon-n-input"
              min="1"
              max="40"
              value="${_mobileDeckNValue}"
              oninput="setMobileDeckNValue(this.value)">
          </div>
          <div class="mg-ribbon-extra-grid">
            <button onclick="drawMobileDeckCardsToPublic()" class="mg-btn mg-ribbon-btn deck-reveal">山札からn枚表向き</button>
            <button onclick="drawMobileDeckCardsToPrivate()" class="mg-btn mg-ribbon-btn deck-peek">山札からn枚見る</button>
            <button onclick="openMobileDeckAllModal()" class="mg-btn mg-ribbon-btn deck-all">山札を全部見る</button>
            <button onclick="breakMobileShield()" class="mg-btn mg-ribbon-btn shield-break">${shieldBreakLabel}</button>
            <button onclick="returnMobileFromGraveyard('hand')" class="mg-btn mg-ribbon-btn grave-return">墓地→手札</button>
            ${!window._ol ? '<button onclick="undoMobileGame()" class="mg-btn mg-ribbon-btn undo">やり直し</button>' : ''}
            <button onclick="renderMobileDeckList()" class="mg-btn mg-ribbon-btn back">戻る</button>
          </div>
        </div>
      </div>
      
    </div>
  `;

  if (ol) {
    renderMobileChatMessages();
  }
  renderMobileDeckRevealModal();
  renderMobileDeckAllModal();
}

function playMobileCard(idx) {
  openMobileHandActionSheet(idx);
}

function openMobileHandActionSheet(idx) {
  if (_mobileSkipNextTap) {
    _mobileSkipNextTap = false;
    return;
  }

  closeMobileCardZoneMenu();
  _mobileSelectedHandIdx = idx;
  renderMobileGame();
}

function closeMobileHandSheet() {
  _mobileSelectedHandIdx = null;
  renderMobileGame();
}

function openMobileGraveyardModal() {
  if (_mobileSkipNextTap) {
    _mobileSkipNextTap = false;
    return;
  }

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

function toggleMobileRibbonOther() {
  _mobileRibbonOtherOpen = !_mobileRibbonOtherOpen;
  renderMobileGame();
}

function moveMobileDeckTopTo(toZone) {
  const deck = engineMobile?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showMobileToast('山札がありません', 'warn');
    return;
  }

  moveMobileCardBetweenZones('deck', deck.length - 1, toZone, 'top');
}

function setMobileDeckNValue(rawValue) {
  const parsed = Math.floor(Number(rawValue));
  const next = Number.isFinite(parsed) ? parsed : _mobileDeckNValue;
  _mobileDeckNValue = Math.max(1, Math.min(40, next));

  const input = document.getElementById('mobile-deck-n-input');
  if (input && Number(input.value) !== _mobileDeckNValue) {
    input.value = String(_mobileDeckNValue);
  }
}

function getMobileDeckN() {
  const input = document.getElementById('mobile-deck-n-input');
  if (input) {
    setMobileDeckNValue(input.value);
  }
  return _mobileDeckNValue;
}

function getMobileDeckRevealCards(mode = 'public') {
  if (mode === 'peek') return _mobileDeckPeekPrivateCards;
  if (!engineMobile?.state) return [];
  if (!Array.isArray(engineMobile.state.deckRevealZone)) {
    engineMobile.state.deckRevealZone = [];
  }
  return engineMobile.state.deckRevealZone;
}

function getMobileDeckRevealDestinationOptions() {
  return [
    { value: 'hand', label: '手札' },
    { value: 'battleZone', label: 'バトルゾーン' },
    { value: 'manaZone', label: 'マナゾーン' },
    { value: 'shields', label: 'シールド' },
    { value: 'graveyard', label: '墓地' },
    { value: 'deck:top', label: '山札トップ' },
    { value: 'deck:bottom', label: '山札ボトム' }
  ];
}

function ensureMobileDeckRevealModal() {
  let modal = document.getElementById('mobile-deck-reveal-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'mobile-deck-reveal-modal';
  modal.className = 'dm-reveal-modal';
  modal.innerHTML = `
    <div class="dm-reveal-backdrop" onclick="closeMobileDeckRevealModal()"></div>
    <div class="dm-reveal-body">
      <div class="dm-reveal-head">
        <div id="mobile-deck-reveal-title" class="dm-reveal-title">表向き公開 0枚</div>
        <button type="button" class="dm-reveal-close" onclick="closeMobileDeckRevealModal()">閉じる</button>
      </div>
      <div id="mobile-deck-reveal-list" class="dm-reveal-list"></div>
      <div id="mobile-deck-reveal-controls" class="dm-reveal-controls">
        <label id="mobile-deck-reveal-check-wrap" class="dm-reveal-check-all">
          <input type="checkbox" id="mobile-deck-reveal-all" onchange="toggleMobileDeckRevealSelectAll(this.checked)">
          全選択
        </label>
        <select id="mobile-deck-reveal-dest" class="dm-reveal-select" onchange="setMobileDeckRevealDestination(this.value)"></select>
        <button type="button" id="mobile-deck-reveal-move" class="dm-reveal-move" onclick="moveSelectedMobileDeckRevealCards()">移動</button>
        <button type="button" id="mobile-deck-reveal-return" class="dm-reveal-return" onclick="returnAllMobileDeckRevealCards()">全部デッキに戻す</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openMobileDeckRevealModal(mode = 'public') {
  const cards = getMobileDeckRevealCards(mode);
  if (!Array.isArray(cards) || !cards.length) {
    showMobileToast('処理中のカードがありません', 'info');
    return;
  }

  if (_mobileDeckRevealModalState.mode !== mode) {
    _mobileDeckRevealModalState = {
      mode,
      destination: _mobileDeckRevealModalState.destination || 'hand',
      selected: {}
    };
  }

  closeMobileDeckAllModal();
  const modal = ensureMobileDeckRevealModal();
  modal.classList.add('open');
  renderMobileDeckRevealModal();
}

function closeMobileDeckRevealModal() {
  const modal = document.getElementById('mobile-deck-reveal-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function setMobileDeckRevealDestination(value) {
  const options = getMobileDeckRevealDestinationOptions();
  const safe = options.find((opt) => opt.value === value)?.value || 'hand';
  _mobileDeckRevealModalState.destination = safe;
}

function setMobileDeckRevealCardSelected(index, checked) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;

  if (checked) {
    _mobileDeckRevealModalState.selected[idx] = true;
  } else {
    delete _mobileDeckRevealModalState.selected[idx];
  }
}

function toggleMobileDeckRevealCard(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;
  const currently = !!_mobileDeckRevealModalState.selected[idx];
  setMobileDeckRevealCardSelected(idx, !currently);
  renderMobileDeckRevealModal();
}

function toggleMobileDeckRevealSelectAll(checked) {
  const cards = getMobileDeckRevealCards(_mobileDeckRevealModalState.mode);
  const next = {};
  if (checked) {
    cards.forEach((_, idx) => {
      next[idx] = true;
    });
  }
  _mobileDeckRevealModalState.selected = next;
  renderMobileDeckRevealModal();
}

function parseMobileDeckRevealDestination(value) {
  const normalized = String(value || 'hand');
  if (normalized === 'deck:bottom') {
    return { toZone: 'deck', position: 'bottom' };
  }
  if (normalized === 'deck:top') {
    return { toZone: 'deck', position: 'top' };
  }
  return { toZone: normalized, position: 'top' };
}

function moveMobilePublicDeckRevealCard(index, toZone, position = 'top') {
  if (!Number.isInteger(index) || index < 0) return false;
  if (!engineMobile) return false;

  return window.GameController?.moveCardBetweenZones
    ? window.GameController.moveCardBetweenZones(engineMobile, 'deckRevealZone', index, toZone, { position })
    : engineMobile.moveCardBetweenZones('deckRevealZone', index, toZone, { position });
}

function applyMobileDetachedCardToZone(card, toZone, position = 'top') {
  if (!card || !engineMobile?.state) return false;

  if (toZone === 'deck') {
    if (!Array.isArray(engineMobile.state.deck)) return false;
    if (card.faceUp !== undefined) delete card.faceUp;
    if (position === 'bottom') {
      engineMobile.state.deck.unshift(card);
    } else {
      engineMobile.state.deck.push(card);
    }
    return true;
  }

  const target = engineMobile.state[toZone];
  if (!Array.isArray(target)) return false;

  if (toZone === 'shields') {
    card.faceUp = false;
    card.tapped = false;
  } else {
    if (card.faceUp !== undefined) delete card.faceUp;
    if (toZone === 'hand' || toZone === 'battleZone' || toZone === 'manaZone' || toZone === 'deckRevealZone' || toZone === 'revealedZone') {
      card.tapped = false;
    }
  }

  target.push(card);
  return true;
}

function renderMobileDeckRevealModal() {
  const modal = document.getElementById('mobile-deck-reveal-modal');
  if (!modal || !modal.classList.contains('open')) return;

  const mode = _mobileDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getMobileDeckRevealCards(mode);
  if (!cards.length) {
    closeMobileDeckRevealModal();
    return;
  }

  const titleEl = document.getElementById('mobile-deck-reveal-title');
  const listEl = document.getElementById('mobile-deck-reveal-list');
  const controlsEl = document.getElementById('mobile-deck-reveal-controls');
  const checkWrapEl = document.getElementById('mobile-deck-reveal-check-wrap');
  const destinationEl = document.getElementById('mobile-deck-reveal-dest');
  const moveBtnEl = document.getElementById('mobile-deck-reveal-move');
  const returnBtnEl = document.getElementById('mobile-deck-reveal-return');
  const allEl = document.getElementById('mobile-deck-reveal-all');
  if (!titleEl || !listEl || !controlsEl || !checkWrapEl || !destinationEl || !moveBtnEl || !returnBtnEl || !allEl) return;

  const modeLabel = mode === 'peek' ? '確認中' : '表向き公開';
  titleEl.textContent = `${modeLabel} ${cards.length}枚（自分デッキから）`;
  controlsEl.style.display = 'flex';

  const options = getMobileDeckRevealDestinationOptions();
  destinationEl.innerHTML = options.map((option) => `
    <option value="${option.value}" ${_mobileDeckRevealModalState.destination === option.value ? 'selected' : ''}>${option.label}</option>
  `).join('');

  const selected = _mobileDeckRevealModalState.selected;
  const quickButtons = [
    { value: 'hand', label: '手札', className: 'hand' },
    { value: 'battleZone', label: 'BZ', className: 'battle' },
    { value: 'manaZone', label: 'マナ', className: 'mana' },
    { value: 'shields', label: '盾', className: 'shield' },
    { value: 'graveyard', label: '墓地', className: 'grave' },
    { value: 'deck:top', label: '上', className: 'deck' },
    { value: 'deck:bottom', label: '下', className: 'deck' }
  ];

  listEl.innerHTML = cards.map((card, index) => {
    const thumb = renderMobileCardThumb(card, 'dm-reveal-thumb');
    const positionLabel = index === 0 ? 'トップ' : `${index + 1}枚目`;
    const payload = escapeHtmlMobile(getMobileCardDisplayName(card));
    const checked = !!selected[index];
    const quickHtml = quickButtons.map((btn) => `
      <button
        type="button"
        class="dm-reveal-quick-btn ${btn.className}"
        onclick="event.stopPropagation(); moveSingleMobileDeckRevealCard(${index}, '${btn.value}')">
        ${btn.label}
      </button>
    `).join('');

    return `
      <div class="dm-reveal-card ${checked ? 'selected' : ''}" onclick="toggleMobileDeckRevealCard(${index})" title="${payload}">
        <input
          type="checkbox"
          class="dm-reveal-cb"
          ${checked ? 'checked' : ''}
          onclick="event.stopPropagation()"
          onchange="setMobileDeckRevealCardSelected(${index}, this.checked); renderMobileDeckRevealModal();">
        <div class="dm-reveal-art">${thumb}</div>
        <div class="dm-reveal-pos">${positionLabel}</div>
        <div class="dm-reveal-name">${payload}</div>
        <div class="dm-reveal-quick">${quickHtml}</div>
      </div>
    `;
  }).join('');

  const selectedCount = cards.reduce((count, _, idx) => count + (selected[idx] ? 1 : 0), 0);
  allEl.checked = cards.length > 0 && selectedCount === cards.length;
}

function moveSingleMobileDeckRevealCard(index, destinationValue) {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const mode = _mobileDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getMobileDeckRevealCards(mode);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;

  const destination = parseMobileDeckRevealDestination(destinationValue);
  let ok = false;

  if (mode === 'public') {
    ok = moveMobilePublicDeckRevealCard(idx, destination.toZone, destination.position);
    if (ok && window._ol) {
      olSendActionMobile('state');
    }
  } else {
    const card = _mobileDeckPeekPrivateCards[idx];
    if (!card) return;
    if (typeof engineMobile?._saveState === 'function') {
      engineMobile._saveState();
    }
    _mobileDeckPeekPrivateCards.splice(idx, 1);
    ok = applyMobileDetachedCardToZone(card, destination.toZone, destination.position);
  }

  if (!ok) {
    showMobileToast('カード移動に失敗しました', 'warn');
    return;
  }

  _mobileDeckRevealModalState.selected = {};
  renderMobileGame();
  renderMobileDeckRevealModal();

  if (!getMobileDeckRevealCards(mode).length) {
    closeMobileDeckRevealModal();
  }
}

function drawMobileDeckCardsToPublic() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const publicCards = getMobileDeckRevealCards('public');
  if (publicCards.length) {
    openMobileDeckRevealModal('public');
    return;
  }

  if (_mobileDeckPeekPrivateCards.length) {
    showMobileToast('確認中のカードを先に処理してください', 'warn');
    openMobileDeckRevealModal('peek');
    return;
  }

  const n = getMobileDeckN();
  const moved = typeof engineMobile?.extractDeckTopCards === 'function'
    ? engineMobile.extractDeckTopCards(n, 'deckRevealZone', { faceUp: true })
    : [];
  if (!moved.length) {
    showMobileToast('山札がありません', 'warn');
    return;
  }

  _mobileDeckRevealModalState = {
    mode: 'public',
    destination: _mobileDeckRevealModalState.destination || 'hand',
    selected: {}
  };

  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
  openMobileDeckRevealModal('public');
}

function drawMobileDeckCardsToPrivate() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  if (_mobileDeckPeekPrivateCards.length) {
    openMobileDeckRevealModal('peek');
    return;
  }

  const publicCards = getMobileDeckRevealCards('public');
  if (publicCards.length) {
    showMobileToast('表向き公開中のカードを先に処理してください', 'warn');
    openMobileDeckRevealModal('public');
    return;
  }

  const n = getMobileDeckN();
  const moved = typeof engineMobile?.extractDeckTopCards === 'function'
    ? engineMobile.extractDeckTopCards(n)
    : [];
  if (!moved.length) {
    showMobileToast('山札がありません', 'warn');
    return;
  }

  _mobileDeckPeekPrivateCards = moved;
  _mobileDeckRevealModalState = {
    mode: 'peek',
    destination: _mobileDeckRevealModalState.destination || 'hand',
    selected: {}
  };

  if (window._ol) {
    sendMobileOnlineActionLog(`【操作ログ】山札から${moved.length}枚を確認しました`);
  }

  renderMobileGame();
  openMobileDeckRevealModal('peek');
}

function moveSelectedMobileDeckRevealCards() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const mode = _mobileDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getMobileDeckRevealCards(mode);
  if (!cards.length) {
    closeMobileDeckRevealModal();
    return;
  }

  const selectedIndices = Object.keys(_mobileDeckRevealModalState.selected)
    .map((key) => Number(key))
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < cards.length)
    .sort((a, b) => b - a);

  if (!selectedIndices.length) {
    showMobileToast('カードを選択してください', 'warn');
    return;
  }

  const destination = parseMobileDeckRevealDestination(_mobileDeckRevealModalState.destination);
  let movedCount = 0;

  if (mode === 'public') {
    selectedIndices.forEach((idx) => {
      const ok = moveMobilePublicDeckRevealCard(idx, destination.toZone, destination.position);
      if (ok) movedCount += 1;
    });
    if (movedCount && window._ol) {
      olSendActionMobile('state');
    }
  } else {
    if (typeof engineMobile?._saveState === 'function') {
      engineMobile._saveState();
    }

    selectedIndices.forEach((idx) => {
      const card = _mobileDeckPeekPrivateCards[idx];
      if (!card) return;
      _mobileDeckPeekPrivateCards.splice(idx, 1);
      if (applyMobileDetachedCardToZone(card, destination.toZone, destination.position)) {
        movedCount += 1;
      }
    });
  }

  _mobileDeckRevealModalState.selected = {};
  renderMobileGame();
  renderMobileDeckRevealModal();

  if (!movedCount) {
    showMobileToast('カード移動に失敗しました', 'warn');
    return;
  }

  const rest = getMobileDeckRevealCards(mode).length;
  if (!rest) {
    closeMobileDeckRevealModal();
  }
}

function returnAllMobileDeckRevealCards() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const mode = _mobileDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getMobileDeckRevealCards(mode);
  if (!cards.length) {
    closeMobileDeckRevealModal();
    return;
  }

  let movedCount = 0;
  if (mode === 'public') {
    for (let idx = cards.length - 1; idx >= 0; idx -= 1) {
      const ok = moveMobilePublicDeckRevealCard(idx, 'deck', 'top');
      if (ok) movedCount += 1;
    }
    if (movedCount && window._ol) {
      olSendActionMobile('state');
    }
  } else {
    if (typeof engineMobile?._saveState === 'function') {
      engineMobile._saveState();
    }

    for (let idx = _mobileDeckPeekPrivateCards.length - 1; idx >= 0; idx -= 1) {
      const card = _mobileDeckPeekPrivateCards[idx];
      if (!card) continue;
      _mobileDeckPeekPrivateCards.splice(idx, 1);
      if (applyMobileDetachedCardToZone(card, 'deck', 'top')) {
        movedCount += 1;
      }
    }
  }

  _mobileDeckRevealModalState.selected = {};
  renderMobileGame();
  closeMobileDeckRevealModal();

  if (!movedCount) {
    showMobileToast('デッキに戻せるカードがありません', 'warn');
  }
}

function getMobileDeckAllCardsForView() {
  const deck = Array.isArray(engineMobile?.state?.deck) ? engineMobile.state.deck : [];
  // 山札トップ（末尾）を左上に表示するため反転する
  return deck.slice().reverse();
}

function ensureMobileDeckAllModal() {
  let modal = document.getElementById('mobile-deckall-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'mobile-deckall-modal';
  modal.className = 'dm-deckall-modal';
  modal.innerHTML = `
    <div class="dm-deckall-backdrop" onclick="closeMobileDeckAllModal()"></div>
    <div class="dm-deckall-body">
      <div class="dm-deckall-head">
        <div class="dm-deckall-head-left">
          <button type="button" class="dm-deckall-shuffle" onclick="shuffleMobileDeckAndClose()">シャッフルして閉じる</button>
          <div id="mobile-deckall-title" class="dm-deckall-title">山札一覧</div>
        </div>
        <button type="button" class="dm-deckall-close" onclick="closeMobileDeckAllModal()">閉じる</button>
      </div>
      <div id="mobile-deckall-list" class="dm-deckall-list"></div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openMobileDeckAllModal() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const deck = engineMobile?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showMobileToast('山札がありません', 'warn');
    return;
  }

  closeMobileCardZoneMenu();
  closeMobileDeckRevealModal();
  _mobileSelectedHandIdx = null;

  const modal = ensureMobileDeckAllModal();
  modal.classList.add('open');
  renderMobileDeckAllModal();

  if (window._ol) {
    sendMobileOnlineActionLog(`【操作ログ】山札を全部確認しました（${deck.length}枚）`);
  }
}

function closeMobileDeckAllModal() {
  const modal = document.getElementById('mobile-deckall-modal');
  if (modal) modal.classList.remove('open');
}

function renderMobileDeckAllModal() {
  const modal = document.getElementById('mobile-deckall-modal');
  if (!modal || !modal.classList.contains('open')) return;

  const titleEl = document.getElementById('mobile-deckall-title');
  const listEl = document.getElementById('mobile-deckall-list');
  if (!titleEl || !listEl) return;

  const cards = getMobileDeckAllCardsForView();
  titleEl.textContent = `山札一覧 ${cards.length}枚（左上がトップ）`;

  if (!cards.length) {
    listEl.innerHTML = '<div class="dm-deckall-empty">山札がありません</div>';
    return;
  }

  listEl.innerHTML = cards.map((card, index) => {
    const thumb = renderMobileCardThumb(card, 'dm-deckall-thumb');
    const name = escapeHtmlMobile(getMobileCardDisplayName(card));
    return `
      <div class="dm-deckall-card" title="${name}">
        <div class="dm-deckall-no">${index + 1}</div>
        <div class="dm-deckall-art">${thumb}</div>
        <div class="dm-deckall-name">${name}</div>
      </div>
    `;
  }).join('');
}

function shuffleMobileDeckAndClose() {
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }

  const deck = engineMobile?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showMobileToast('山札がありません', 'warn');
    closeMobileDeckAllModal();
    return;
  }

  const ok = window.GameController?.shuffleDeck
    ? window.GameController.shuffleDeck(engineMobile)
    : (typeof engineMobile?.shuffleDeck === 'function' ? engineMobile.shuffleDeck() : false);
  if (!ok) {
    showMobileToast('山札をシャッフルできませんでした', 'warn');
    return;
  }

  closeMobileDeckAllModal();
  if (window._ol) {
    olSendActionMobile('state');
    sendMobileOnlineActionLog('【操作ログ】山札をシャッフルして非公開に戻しました');
  }
  showMobileToast('山札をシャッフルしました', 'ok');
  renderMobileGame();
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
  if (_mobileSkipNextTap) {
    _mobileSkipNextTap = false;
    return;
  }

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
  showMobileToast('公開中に移動しました。手札に加えるか、トリガー使用を選んでください', 'info', 2800);
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

  const publicPending = getMobileDeckRevealCards('public').length > 0;
  if (_mobileDeckPeekPrivateCards.length || publicPending) {
    showMobileToast('公開/確認中のカードを先に処理してください', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.undo(engineMobile)
    : engineMobile.undo();
  if (ok) renderMobileGame();
}

async function newMobileDeck() {
  const name = String(await askMobileInput('デッキ名を入力') || '').trim();
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
    const enriched = await NetworkService.enrichCardImage(card, {
      retries: 1,
      retryDelayMs: 300
    });
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
async function addToMobileDeck(cardJson, addCount = 1) {
  try {
    if (!window._deckEditing) {
      showMobileToast('先に編集するデッキを選択してください', 'warn');
      return false;
    }

    const rawCard = typeof cardJson === 'string' ? JSON.parse(cardJson) : cardJson;
    const card = await NetworkService.enrichCardImage(rawCard, {
      retries: 2,
      retryDelayMs: 350
    });
    const normalized = NetworkService.normalizeCardData(card);
    const normalizedKey = String(normalized.cardId || normalized.id || '');
    const count = Math.max(1, Math.min(4, Number.isFinite(Number(addCount)) ? Math.floor(Number(addCount)) : 1));

    const existing = window._deckCards.find(c => String(c.cardId || c.id || '') === normalizedKey);
    if (existing) {
      existing.count = (existing.count || 1) + count;
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
      window._deckCards.push({ ...normalized, count });
    }

    sortCurrentMobileDeckCards();
    renderMobileDeckList();
    return true;
  } catch (e) {
    console.error('カード追加エラー:', e);
    return false;
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

  if (typeof NetworkService.clearDeckCache === 'function') {
    NetworkService.clearDeckCache(deckName);
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
    window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deckRevealZone: 0, revealedZone: 0, deck: 30, graveyard: 0 };
    window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
    window._olChatLogMobile = [];
  }
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileUnderInsertState = null;
  _mobileNeedDrawGuide = true;
  _mobileRibbonOtherOpen = false;
  _mobileDeckPeekPrivateCards = [];
  _mobileDeckRevealModalState = {
    mode: 'public',
    destination: _mobileDeckRevealModalState.destination || 'hand',
    selected: {}
  };
  _mobileChatOpen = false;
  closeMobileCardZoneMenu();
  closeMobileDeckRevealModal();
  closeMobileDeckAllModal();
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

  window._ol.remoteSeq = 0;

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
    if (data.turn !== undefined && data.turn !== null) {
      if (typeof engineMobile.syncTurn === 'function') {
        engineMobile.syncTurn(data.turn);
      }
    }
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

    if (data.turn !== undefined && data.turn !== null) {
      if (typeof engineMobile.syncTurn === 'function') {
        engineMobile.syncTurn(data.turn);
      }
    }
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
