/**
 * DM Solitaire - Desktop UI
 * PC版レイアウト（3カラム: 検索 | デッキ | ゲーム）
 */

let engine = null;
let _desktopTurnNoticeTimer = null;
let _desktopToastTimer = null;
let _desktopSelectedShieldIdx = null;
let _desktopNeedDrawGuide = false;
let _desktopSearchDebounceTimer = null;
let _desktopSearchController = null;
let _desktopDelegatedEventsBound = false;
let _desktopDeckHydrateToken = 0;
const _desktopSearchHydrateNoImage = new Set();
let _desktopZoneMenuState = null;
let _desktopZoneMenuGlobalBound = false;
let _desktopUnderInsertState = null;
let _desktopDetailCardState = null;
let _desktopDetailRequestToken = 0;
let _desktopDetailAllowAdd = true;
let _desktopSearchState = {
  query: '',
  page: 0,
  items: [],
  hasMore: false,
  loading: false
};

function showDesktopToast(message, type = 'info', timeout = 2200) {
  let el = document.getElementById('desktop-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'desktop-toast';
    el.className = 'dg-toast';
    document.body.appendChild(el);
  }

  el.className = `dg-toast ${type}`;
  el.textContent = String(message || '');
  el.style.opacity = '1';

  if (_desktopToastTimer) clearTimeout(_desktopToastTimer);
  _desktopToastTimer = setTimeout(() => {
    const current = document.getElementById('desktop-toast');
    if (current) current.style.opacity = '0';
  }, timeout);
}

function askDesktopConfirm(message, confirmLabel = 'OK', cancelLabel = 'キャンセル') {
  return new Promise((resolve) => {
    let modal = document.getElementById('desktop-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'desktop-confirm-modal';
      modal.className = 'dm-confirm-modal';
      modal.innerHTML = `
        <div class="dm-confirm-backdrop"></div>
        <div class="dm-confirm-body">
          <div id="desktop-confirm-message" class="dm-confirm-message"></div>
          <div class="dm-confirm-actions">
            <button id="desktop-confirm-ok" class="dm-confirm-btn ok">OK</button>
            <button id="desktop-confirm-cancel" class="dm-confirm-btn cancel">キャンセル</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const msg = document.getElementById('desktop-confirm-message');
    const okBtn = document.getElementById('desktop-confirm-ok');
    const cancelBtn = document.getElementById('desktop-confirm-cancel');
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

function onDesktopSearchInput(query) {
  if (_desktopSearchDebounceTimer) clearTimeout(_desktopSearchDebounceTimer);
  _desktopSearchDebounceTimer = setTimeout(() => {
    desktopSearchCards(query);
  }, 280);
}

function decodeDesktopData(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function bindDesktopDelegatedEvents() {
  if (_desktopDelegatedEventsBound) return;

  const root = document.getElementById('app-desktop');
  if (!root) return;

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-dg-action]');
    if (!target || !root.contains(target)) return;

    const action = target.getAttribute('data-dg-action');
    const encodedDeck = target.getAttribute('data-deck');
    const deckName = decodeDesktopData(encodedDeck);

    if (action === 'open-deck') {
      openDesktopDeck(deckName);
      return;
    }
    if (action === 'start-game') {
      startDesktopGame(deckName);
      return;
    }
    if (action === 'open-online') {
      openDesktopOnlineWithDeck(deckName);
      return;
    }
    if (action === 'delete-deck') {
      deleteDesktopDeck(deckName);
      return;
    }
    if (action === 'add-card') {
      addToDesktopDeck(decodeDesktopData(target.getAttribute('data-card-json')));
      return;
    }
    if (action === 'show-card-detail') {
      showDesktopCardDetail(decodeDesktopData(target.getAttribute('data-card-json')));
      return;
    }
    if (action === 'inc-card') {
      incrementDesktopCardCount(Number(target.getAttribute('data-idx')));
      return;
    }
    if (action === 'dec-card') {
      decrementDesktopCardCount(Number(target.getAttribute('data-idx')));
      return;
    }
    if (action === 'remove-card') {
      removeDesktopCard(Number(target.getAttribute('data-idx')));
    }
  });

  _desktopDelegatedEventsBound = true;
}

function getDesktopDeckCivs(cards) {
  if (!Array.isArray(cards)) return [];
  const set = new Set();
  cards.forEach((card) => {
    const civ = getDesktopCardCivClass(card);
    if (civ) set.add(civ);
  });
  return Array.from(set);
}

function renderDesktopDeckCivDots(cards) {
  const civs = getDesktopDeckCivs(cards);
  if (!civs.length) return '<span class="dl-civ-dot none">-</span>';
  return civs.map(civ => `<span class="dl-civ-dot ${escapeHtml(civ)}"></span>`).join('');
}

function getDeckCardTotal(cards) {
  return Array.isArray(cards)
    ? cards.reduce((sum, c) => sum + (c.count || 1), 0)
    : 0;
}

function getDesktopCardDisplayName(card) {
  const name = String(card?.name || card?.nameEn || card?.cardName || '').trim();
  if (name) return name;

  const sourceId = String(card?.sourceId || card?.id || '').trim();
  if (sourceId) return `ID:${sourceId}`;

  const cardId = String(card?.cardId || '').trim();
  return cardId || '名称不明';
}

function getDesktopCardCostValue(card) {
  const n = Number(card?.cost);
  return Number.isFinite(n) ? n : 999;
}

function getDesktopCardCostLabel(card) {
  const cost = getDesktopCardCostValue(card);
  return cost === 999 ? '-' : String(cost);
}

function sortDesktopDeckCards(cards) {
  const next = Array.isArray(cards) ? [...cards] : [];
  next.sort((a, b) => {
    const costDiff = getDesktopCardCostValue(a) - getDesktopCardCostValue(b);
    if (costDiff !== 0) return costDiff;

    const countDiff = (Number(b?.count) || 1) - (Number(a?.count) || 1);
    if (countDiff !== 0) return countDiff;

    return getDesktopCardDisplayName(a).localeCompare(getDesktopCardDisplayName(b), 'ja');
  });
  return next;
}

function sortCurrentDesktopDeckCards() {
  const sorted = sortDesktopDeckCards(window._deckCards || []);
  window._deckCards = sorted;
  return sorted;
}

function getDesktopUserLabel(account) {
  if (!account) return '';
  if (account.isGuest) return `ゲスト (${account.username || 'Guest'})`;
  return account.username || '';
}

function getDesktopCardCivClass(card) {
  const raw = String(card?.civilization || card?.civ || '').toLowerCase();
  if (raw.includes('fire') || raw.includes('火')) return 'fire';
  if (raw.includes('water') || raw.includes('水')) return 'water';
  if (raw.includes('light') || raw.includes('光')) return 'light';
  if (raw.includes('dark') || raw.includes('闇')) return 'dark';
  if (raw.includes('nature') || raw.includes('自然')) return 'nature';
  return raw ? 'multi' : 'multi';
}

function getDesktopCardShortName(name, limit = 8) {
  const n = String(name || '');
  return n.length > limit ? `${n.slice(0, limit)}…` : n;
}

function getDesktopUnderCardCount(card) {
  if (!card || !Array.isArray(card.underCards) || !card.underCards.length) return 0;
  return card.underCards.reduce((sum, underCard) => sum + 1 + getDesktopUnderCardCount(underCard), 0);
}

function renderDesktopUnderLayers(count) {
  const layerCount = Math.min(8, Math.max(0, Number(count) || 0));
  if (!layerCount) return '';
  return Array.from({ length: layerCount }).map(() => '<span class="dg-under-layer"></span>').join('');
}

function getDesktopCardTypeLabel(type) {
  const normalized = String(type || '').toLowerCase();
  if (!normalized) return '-';
  if (normalized.includes('evolution') || normalized.includes('進化')) return '進化クリーチャー';
  if (normalized.includes('creature') || normalized.includes('クリーチャー')) return 'クリーチャー';
  if (normalized.includes('spell') || normalized.includes('呪文')) return '呪文';
  return String(type || '-');
}

function ensureDesktopCardDetailModal() {
  let modal = document.getElementById('desktop-card-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-card-detail-modal';
    modal.className = 'dm-card-detail-modal';
    modal.innerHTML = `
      <div class="dm-card-detail-backdrop" onclick="closeDesktopCardDetailModal()"></div>
      <div class="dm-card-detail-body">
        <div class="dm-card-detail-head">
          <div id="desktop-card-detail-title" class="dm-card-detail-title">カード詳細</div>
          <button type="button" class="dm-card-detail-close" onclick="closeDesktopCardDetailModal()">×</button>
        </div>
        <div id="desktop-card-detail-content" class="dm-card-detail-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

function closeDesktopCardDetailModal() {
  const modal = document.getElementById('desktop-card-detail-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  _desktopDetailRequestToken += 1;
  _desktopDetailCardState = null;
  _desktopDetailAllowAdd = true;
}

function renderDesktopCardDetailContent(card, opts = {}) {
  const content = document.getElementById('desktop-card-detail-content');
  const title = document.getElementById('desktop-card-detail-title');
  if (!content || !title) return;
  const allowAdd = opts.allowAdd !== undefined ? !!opts.allowAdd : _desktopDetailAllowAdd;

  if (opts.loading) {
    title.textContent = 'カード詳細';
    content.innerHTML = '<div class="dm-card-detail-loading">カード情報を取得中…</div>';
    return;
  }

  if (opts.error) {
    title.textContent = 'カード詳細';
    content.innerHTML = `<div class="dm-card-detail-error">${escapeHtml(opts.error)}</div>`;
    return;
  }

  const current = NetworkService.normalizeCardData(card || {});
  const imageUrl = getDesktopCardImageUrl(current);
  const civClass = getDesktopCardCivClass(current);
  const civLabel = getCivLabel(civClass) || '-';
  const cost = Number.isFinite(Number(current?.cost)) ? Number(current.cost) : '-';
  const typeLabel = getDesktopCardTypeLabel(current?.type);
  const power = current?.power ? String(current.power) : '-';
  const sourceId = String(current?.sourceId || current?.id || current?.cardId || '').trim() || '-';
  const bodyText = String(current?.text || '').trim();
  const rowRace = current?.race
    ? `<tr><th>種族</th><td>${escapeHtml(String(current.race))}</td></tr>`
    : '';

  title.textContent = current?.name || 'カード詳細';
  content.innerHTML = `
    <div class="dm-card-detail-main">
      <div class="dm-card-detail-art-wrap ${imageUrl ? '' : 'placeholder'}">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(current?.name || 'CARD')}" class="dm-card-detail-art" onerror="handleDesktopCardImageError(this)">`
          : '<div class="dm-card-detail-art-placeholder">NO IMG</div>'}
      </div>
      <table class="dm-card-detail-table">
        <tr><th>文明</th><td><span class="dm-card-detail-civ ${escapeHtml(civClass)}">${escapeHtml(civLabel)}</span></td></tr>
        <tr><th>コスト</th><td>${escapeHtml(String(cost))}</td></tr>
        <tr><th>種類</th><td>${escapeHtml(typeLabel)}</td></tr>
        <tr><th>パワー</th><td>${escapeHtml(power)}</td></tr>
        ${rowRace}
        <tr><th>ID</th><td class="dm-card-detail-id">${escapeHtml(sourceId)}</td></tr>
      </table>
    </div>
    ${bodyText ? `<div class="dm-card-detail-text">${escapeHtml(bodyText).replace(/\n/g, '<br>')}</div>` : '<div class="dm-card-detail-text empty">テキスト情報なし</div>'}
    ${allowAdd
      ? `<div class="dm-card-detail-actions">
          <input id="desktop-card-detail-count" type="number" min="1" max="4" value="1" class="dm-card-detail-count" />
          <span class="dm-card-detail-count-label">枚</span>
          <button type="button" class="dm-card-detail-add" onclick="addDesktopCardFromDetail()">＋ デッキに追加</button>
        </div>`
      : ''}
  `;
}

async function resolveDesktopDetailCard(card) {
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
      imageUrl: getDesktopCardImageUrl(normalizedDetail) || getDesktopCardImageUrl(base),
      thumb: getDesktopCardImageUrl(normalizedDetail) || getDesktopCardImageUrl(base),
      img: getDesktopCardImageUrl(normalizedDetail) || getDesktopCardImageUrl(base)
    };
  } catch {
    return base;
  }
}

async function showDesktopCardDetail(cardJson, opts = {}) {
  const allowAdd = opts.allowAdd !== false;
  let raw;
  try {
    raw = typeof cardJson === 'string' ? JSON.parse(cardJson) : cardJson;
  } catch {
    showDesktopToast('カード情報の読み込みに失敗しました', 'warn');
    return;
  }

  if (!raw || typeof raw !== 'object') {
    showDesktopToast('カード情報の読み込みに失敗しました', 'warn');
    return;
  }

  _desktopDetailAllowAdd = allowAdd;

  const modal = ensureDesktopCardDetailModal();
  modal.classList.add('open');
  renderDesktopCardDetailContent(null, { loading: true, allowAdd });

  const token = ++_desktopDetailRequestToken;
  const base = NetworkService.normalizeCardData(raw);
  _desktopDetailCardState = base;
  renderDesktopCardDetailContent(base, { allowAdd });

  const resolved = await resolveDesktopDetailCard(base);
  if (token !== _desktopDetailRequestToken) return;
  _desktopDetailCardState = resolved;
  renderDesktopCardDetailContent(resolved, { allowAdd });
}

function openDesktopDeckCardDetail(cardJson) {
  const decoded = decodeDesktopData(cardJson);
  showDesktopCardDetail(decoded, { allowAdd: false });
}

async function addDesktopCardFromDetail() {
  if (!_desktopDetailCardState) return;

  const input = document.getElementById('desktop-card-detail-count');
  const requested = Number(input?.value);
  const count = Math.max(1, Math.min(4, Number.isFinite(requested) ? Math.floor(requested) : 1));
  if (input) input.value = String(count);

  const ok = await addToDesktopDeck(JSON.stringify(_desktopDetailCardState), count);
  if (ok) {
    closeDesktopCardDetailModal();
  }
}

function renderDesktopSearchResults() {
  const container = document.getElementById('desktop-search-results');
  if (!container) return;

  const itemsHtml = _desktopSearchState.items.map(card => {
    const civClass = getDesktopCardCivClass(card);
    const cost = Number.isFinite(Number(card.cost)) ? Number(card.cost) : '-';
    const power = card.power ? String(card.power) : '-';
    const civLabel = getCivLabel(civClass);
    const payload = encodeURIComponent(JSON.stringify(card));
    const thumb = renderDesktopCardThumb(card);

    return `
      <div class="dl-search-item">
        <div class="dl-search-top">
          ${thumb}
          <div class="dl-search-main">
            <div class="dl-search-name">${escapeHtml(card.name)}</div>
            <div class="dl-search-meta">
              <span class="dl-badge cost">${escapeHtml(String(cost))}</span>
              <span class="dl-badge civ ${civClass}">${escapeHtml(civLabel)}</span>
              <span class="dl-badge power">${escapeHtml(power)}</span>
            </div>
            <div class="dl-search-text">${escapeHtml(card.text || '')}</div>
          </div>
        </div>
        <div class="dl-search-actions">
          <button type="button" data-dg-action="show-card-detail" data-card-json="${payload}" class="dl-detail-btn">詳細</button>
          <button type="button" data-dg-action="add-card" data-card-json="${payload}" class="dl-add-btn">+追加</button>
        </div>
      </div>
    `;
  }).join('');

  const moreHtml = _desktopSearchState.hasMore
    ? `<button class="dl-more-btn" onclick="desktopSearchMore()">もっと見る</button>`
    : '';

  container.innerHTML = `${itemsHtml}${moreHtml}`;
}

function getDesktopSearchHydrateKey(card) {
  const raw = String(card?.sourceId || card?.id || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('src:') ? raw.slice(4) : raw;
  if (!normalized || normalized.includes('|')) return '';
  return normalized;
}

async function hydrateDesktopSearchCards(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) return [];

  const hydrated = await Promise.all(sourceItems.map(async (card) => {
    const normalizedCard = NetworkService.normalizeCardData(card);
    if (getDesktopCardImageUrl(normalizedCard)) return normalizedCard;

    const key = getDesktopSearchHydrateKey(normalizedCard);
    if (key && _desktopSearchHydrateNoImage.has(key)) {
      return normalizedCard;
    }

    try {
      const enriched = await NetworkService.enrichCardImage(normalizedCard);
      const normalized = NetworkService.normalizeCardData(enriched);
      if (!getDesktopCardImageUrl(normalized) && key) {
        _desktopSearchHydrateNoImage.add(key);
      }
      return normalized;
    } catch {
      if (key) _desktopSearchHydrateNoImage.add(key);
      return normalizedCard;
    }
  }));

  return hydrated;
}

async function desktopSearchMore() {
  if (_desktopSearchState.loading || !_desktopSearchState.hasMore) return;
  await desktopSearchCards(_desktopSearchState.query, true);
}

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

function getDesktopCardImageUrl(card) {
  return String(
    card?.imageUrl
    || card?.img
    || card?.thumb
    || ''
  ).trim();
}

function renderDesktopCardThumb(card, className = 'dl-search-thumb') {
  const url = getDesktopCardImageUrl(card);
  const alt = escapeHtml(getDesktopCardDisplayName(card));

  if (!url) {
    return `<div class="${className} placeholder">NO IMG</div>`;
  }

  return `
    <img
      src="${escapeHtml(url)}"
      alt="${alt}"
      class="${className}"
      loading="lazy"
      decoding="async"
      onerror="handleDesktopCardImageError(this)">
  `;
}

function handleDesktopCardImageError(img) {
  if (!img) return;
  img.onerror = null;
  img.outerHTML = `<div class="${img.className} placeholder">NO IMG</div>`;
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

function normalizeDesktopPublicCard(card) {
  const normalized = NetworkService.normalizeCardData(card);
  const underCards = Array.isArray(card?.underCards)
    ? card.underCards.map((underCard) => normalizeDesktopPublicCard(underCard))
    : [];
  normalized.underCards = underCards;
  return normalized;
}

function normalizeDesktopPublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => normalizeDesktopPublicCard(card));
}

function normalizeDesktopPublicZone(zone) {
  if (Array.isArray(zone)) return normalizeDesktopPublicCards(zone);
  return Math.max(0, Number(zone) || 0);
}

function normalizeDesktopOpponentState(rawState) {
  const src = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    hand: Math.max(0, Number(src.hand) || 0),
    deck: Math.max(0, Number(src.deck) || 0),
    shields: Math.max(0, Number(src.shields) || 0),
    battleZone: normalizeDesktopPublicZone(src.battleZone),
    manaZone: normalizeDesktopPublicZone(src.manaZone),
    graveyard: normalizeDesktopPublicZone(src.graveyard)
  };
}

function serializeDesktopPublicCard(card) {
  const name = String(card?.name || card?.nameEn || '').trim();
  const cost = card?.cost ?? '';
  const power = String(card?.power || '').trim();
  const civilization = String(card?.civilization || card?.civ || '').trim();
  const imageUrl = String(card?.imageUrl || card?.img || card?.thumb || '').trim();
  const underCards = Array.isArray(card?.underCards)
    ? card.underCards.map((underCard) => serializeDesktopPublicCard(underCard))
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

function serializeDesktopPublicCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => serializeDesktopPublicCard(card));
}

function buildDesktopPublicState(state) {
  return {
    hand: state.hand.length,
    deck: state.deck.length,
    shields: state.shields.length,
    battleZone: serializeDesktopPublicCards(state.battleZone),
    manaZone: serializeDesktopPublicCards(state.manaZone),
    graveyard: serializeDesktopPublicCards(state.graveyard)
  };
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
 * PC版UI初期化
 */
function initDesktopUI() {
  engine = new GameEngine();
  if (window.GameController) {
    _desktopSearchController = window.GameController.createSearchController({
      searchFn: (keyword, page) => NetworkService.searchCards(keyword, page),
      transformPage: (items) => hydrateDesktopSearchCards(items),
      pageSize: 20
    });
  }
  renderDesktopDeckList();
  bindDesktopDelegatedEvents();
}

/**
 * 3カラムレイアウトのデッキ一覧画面
 */
function renderDesktopDeckList() {
  closeDesktopCardZoneMenu();
  closeDesktopHandPicker();
  _desktopUnderInsertState = null;

  const container = document.getElementById('app-desktop');
  const savedDecks = getSavedDecks();
  const localDeckNames = Object.keys(savedDecks);
  const account = AuthService.getCurrentAccount();
  const editingState = window.GameController
    ? window.GameController.getDeckEditingState()
    : { deckName: window._deckEditing, cards: window._deckCards };
  let deckName = editingState.deckName;
  let cards = Array.isArray(editingState.cards) ? editingState.cards : [];

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

  const orderedCards = sortDesktopDeckCards(cards);
  if (deckName) {
    window._deckCards = orderedCards;
  }

  const canCloudSave = !!(account && !account.isGuest && account.pin);
  const hasDeckSelected = !!deckName;
  const canSaveSelectedDeck = hasDeckSelected && canCloudSave;

  const cardCount = getDeckCardTotal(orderedCards);
  const uniqueCount = orderedCards.length;

  const nameListHtml = orderedCards.length
    ? orderedCards.map((c, i) => {
      const payload = escapeAttrJs(encodeURIComponent(JSON.stringify(c)));
      return `
      <div class="dl-edit-card dl-name-row">
        <div class="dl-edit-card-main" onclick="openDesktopDeckCardDetail('${payload}')">
          <div class="dl-edit-card-name">${escapeHtml(getDesktopCardDisplayName(c))}</div>
          <div class="dl-edit-card-text">コスト ${escapeHtml(getDesktopCardCostLabel(c))} / ${escapeHtml(String(c.count || 1))}枚</div>
        </div>
        <div class="dl-count-controls">
          <button type="button" data-dg-action="dec-card" data-idx="${i}" class="dl-count-btn minus">-</button>
          <span class="dl-count-num">${c.count || 1}</span>
          <button type="button" data-dg-action="inc-card" data-idx="${i}" class="dl-count-btn plus">+</button>
          <button type="button" data-dg-action="remove-card" data-idx="${i}" class="dl-count-btn delete">削除</button>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="dl-empty-editor">カードがありません。左から検索して追加できます。</div>';

  const expandedCards = [];
  orderedCards.forEach((card) => {
    const copies = Math.max(1, Number(card?.count) || 1);
    for (let i = 0; i < copies; i++) {
      expandedCards.push({ card, copyIndex: i + 1, copies });
    }
  });

  const gridHtml = expandedCards.length
    ? expandedCards.map(({ card, copyIndex, copies }) => {
      const cost = getDesktopCardCostLabel(card);
      const civClass = getDesktopCardCivClass(card);
      const thumb = renderDesktopCardThumb(card, 'dl-grid-thumb');
      const payload = escapeAttrJs(encodeURIComponent(JSON.stringify(card)));
      return `
        <div class="dl-grid-card ${civClass}" title="${escapeHtml(getDesktopCardDisplayName(card))}" onclick="openDesktopDeckCardDetail('${payload}')">
          ${thumb}
          <div class="dl-grid-meta">
            <span class="dl-grid-cost">${escapeHtml(String(cost))}</span>
            ${copies > 1 ? `<span class="dl-grid-copy">${copyIndex}/${copies}</span>` : ''}
          </div>
        </div>
      `;
    }).join('')
    : '<div class="dl-empty-editor">選択中デッキのカード画像がここに並びます。</div>';

  const deckOptionsHtml = mergedDeckNames.length
    ? mergedDeckNames.map((name) => `
      <option value="${escapeHtml(name)}" ${deckName === name ? 'selected' : ''}>${escapeHtml(name)}</option>
    `).join('')
    : '<option value="">デッキがありません</option>';
  
  container.innerHTML = `
    <div class="dl-root dl-root-unified">
      <div class="dl-panel dl-search-panel">
        <h3 class="dl-heading">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." value="${escapeHtml(_desktopSearchState.query || '')}"
          class="dl-input"
          onkeyup="onDesktopSearchInput(this.value)">
        <div id="desktop-search-results" class="dl-stack dl-stack-tight"></div>
      </div>

      <div class="dl-panel dl-list-panel">
        <div class="dl-focus-head compact">
          <div class="dl-focus-copy">
            <h2 class="dl-focus-title">リスト</h2>
          </div>
          <div class="dl-name-summary">
            <span>合計 ${cardCount}枚</span>
            <span>ユニーク ${uniqueCount}</span>
          </div>
        </div>

        <div id="desktop-name-list" class="dl-stack dl-stack-tight dl-editor-card-list">
          ${hasDeckSelected ? nameListHtml : '<div class="dl-empty-editor">右パネルでデッキを選択するとカード名リストが表示されます。</div>'}
        </div>
      </div>

      <div class="dl-panel dl-editor-panel">
        <div class="dl-focus-head compact">
          <div class="dl-focus-copy">
            <h2 class="dl-focus-title">デッキ管理</h2>
          </div>
          <div class="dl-inline-actions">
            <button type="button" onclick="renderDesktopOnlineLobby()" class="dl-mini-btn dl-mini-btn-online">オンライン対戦</button>
            <button type="button" onclick="logout()" class="dl-mini-btn dl-mini-btn-ghost">ログアウト</button>
          </div>
        </div>

        <div class="dl-editor-tools">
          <select id="desktop-deck-select" class="dl-input dl-select" onchange="onDesktopDeckSelectChange(this.value)">
            <option value="">デッキを選択</option>
            <option value="__new__">＋新規デッキ作成</option>
            ${deckOptionsHtml}
          </select>
          <button onclick="deleteSelectedDesktopDeck()" ${hasDeckSelected ? '' : 'disabled'} class="dl-main-btn">削除</button>
          <button onclick="saveDesktopDeck()" ${canSaveSelectedDeck ? '' : 'disabled'} class="dl-main-btn ${canSaveSelectedDeck ? '' : 'disabled'}">保存</button>
          <button onclick="playDesktopDeckGame()" ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'} class="dl-main-btn ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'}">一人回し</button>
        </div>

        ${deckName ? `
          <div class="dl-edit-summary">
            <div class="dl-edit-title">${escapeHtml(deckName)}</div>
            <div class="dl-edit-stats">
              <div>カード枚数: <strong>${cardCount}</strong> / 40</div>
              <div>ユニーク: <strong>${uniqueCount}</strong></div>
            </div>
          </div>

          <div class="dl-card-grid-wrap">
            <h3 class="dl-heading">カード画像プレビュー</h3>
            <div id="desktop-card-grid" class="dl-card-grid">
              ${gridHtml}
            </div>
          </div>
        ` : `
          <div class="dl-edit-summary">
            <div class="dl-edit-title">デッキ管理</div>
            <div class="dl-edit-stats">デッキを選択すると、ここにカード画像プレビューを大きく表示します。</div>
          </div>
          <div class="dl-empty-editor">まずは左のリストから編集するデッキを選択してください。</div>
        `}
      </div>
    </div>
  `;

  if (_desktopSearchState.query) {
    renderDesktopSearchResults();
  }
}

/**
 * デッキ一覧を更新
 */
function updateDesktopDeckList() {
  renderDesktopDeckList();
}

function onDesktopDeckSelectChange(name) {
  const deckName = String(name || '').trim();
  if (deckName === '__new__') {
    newDesktopDeck();
    return;
  }
  if (!deckName) {
    clearDesktopDeckSelection();
    return;
  }
  openDesktopDeck(deckName);
}

function deleteSelectedDesktopDeck() {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }
  deleteDesktopDeck(window._deckEditing);
}

function openSelectedDesktopDeckOnline() {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }
  openDesktopOnlineWithDeck(window._deckEditing);
}

function clearDesktopDeckSelection() {
  if (window.GameController) {
    window.GameController.setDeckEditingState(null, []);
  } else {
    window._deckEditing = null;
    window._deckCards = [];
  }
  renderDesktopDeckList();
}

/**
 * カード検索（PC版）
 */
async function desktopSearchCards(q, append = false) {
  if (!window.GameController) {
    const keyword = String(q || '').trim();
    if (!keyword) {
      _desktopSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };
      const resultsEl = document.getElementById('desktop-search-results');
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    if (!append && keyword !== _desktopSearchState.query) {
      _desktopSearchState = { query: keyword, page: 0, items: [], hasMore: false, loading: false };
    }
    if (_desktopSearchState.loading) return;

    _desktopSearchState.loading = true;
    const nextPage = append ? _desktopSearchState.page + 1 : 1;
    try {
      const results = await NetworkService.searchCards(keyword, nextPage);
      const pageItems = Array.isArray(results) ? results.slice(0, 20) : [];
      const hydratedItems = await hydrateDesktopSearchCards(pageItems);
      _desktopSearchState.query = keyword;
      _desktopSearchState.page = nextPage;
      _desktopSearchState.items = append
        ? [..._desktopSearchState.items, ...hydratedItems]
        : hydratedItems;
      _desktopSearchState.hasMore = pageItems.length >= 20;
    } finally {
      _desktopSearchState.loading = false;
    }

    renderDesktopSearchResults();
    return;
  }

  if (!_desktopSearchController) {
    _desktopSearchController = window.GameController.createSearchController({
      searchFn: (keyword, page) => NetworkService.searchCards(keyword, page),
      transformPage: (items) => hydrateDesktopSearchCards(items),
      pageSize: 20
    });
  }

  _desktopSearchState = append
    ? await _desktopSearchController.searchMore()
    : await _desktopSearchController.search(q);

  if (!_desktopSearchState.query) {
    const resultsEl = document.getElementById('desktop-search-results');
    if (resultsEl) resultsEl.innerHTML = '';
    return;
  }

  renderDesktopSearchResults();
}

/**
 * ゲーム開始（PC版）
 */
async function startDesktopGame(deckName) {
  const account = AuthService.getCurrentAccount();
  let deckData = window.GameController
    ? await window.GameController.resolveDeckData(deckName, account)
    : null;

  if (!deckData) {
    const savedDecks = getSavedDecks();
    if (savedDecks[deckName]) {
      deckData = savedDecks[deckName];
    } else if (account && !account.isGuest && account.pin) {
      deckData = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
    }
  }
  
  if (!deckData || !deckData.length) {
    showDesktopToast('デッキが取得できませんでした', 'warn');
    return;
  }
  
  if (window.GameController) {
    window.GameController.initSoloGame(engine, deckData);
  } else {
    engine.initGame(deckData);
    window._ol = null;
    window._olOpponent = null;
  }
  _desktopSelectedShieldIdx = null;
  _desktopUnderInsertState = null;
  _desktopNeedDrawGuide = true;
  renderDesktopGame();
}

/**
 * ゲーム画面レンダリング（PC版）
 */
function renderDesktopGame() {
  closeDesktopCardZoneMenu();
  closeDesktopHandPicker();
  const state = engine.getState();

  if (_desktopUnderInsertState) {
    const sourceCards = state[_desktopUnderInsertState.fromZone];
    if (!Array.isArray(sourceCards) || !sourceCards[_desktopUnderInsertState.fromIndex]) {
      _desktopUnderInsertState = null;
    }
  }

  if (_desktopSelectedShieldIdx !== null && _desktopSelectedShieldIdx >= state.shields.length) {
    _desktopSelectedShieldIdx = null;
  }
  const container = document.getElementById('app-desktop');
  const ol = window._ol;
  const opp = window._olOpponent || {};
  const myNum = ol ? (ol.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = ol && window._olCurrentPlayer && window._olCurrentPlayer === myNum;
  const headerTurnClass = ol ? (isMyTurn ? 'mine-turn' : 'opponent-turn') : 'solo-turn';
  const myName = ol ? (ol.p === 'p1' ? (ol.p1Name || 'Player 1') : (ol.p2Name || 'Player 2')) : '自分';
  const oppName = ol ? (ol.p === 'p1' ? (ol.p2Name || 'Player 2') : (ol.p1Name || 'Player 1')) : '相手';
  const shieldBreakLabel = _desktopSelectedShieldIdx === null
    ? 'シールド破壊'
    : `シールド破壊 (${_desktopSelectedShieldIdx + 1})`;

  const getZoneCount = (zone) => Array.isArray(zone) ? zone.length : Math.max(0, Number(zone) || 0);

  const renderOpponentPublicZone = (zone, zoneClass) => {
    if (!Array.isArray(zone)) {
      return renderDesktopBackCards(getZoneCount(zone));
    }

    if (!zone.length) {
      return '<div class="dg-back-empty">0</div>';
    }

    const visibleLimit = zoneClass === 'grave' ? 10 : 12;
    const visibleCards = zoneClass === 'grave' ? zone.slice(-visibleLimit) : zone.slice(0, visibleLimit);
    const chips = visibleCards.map((card) => renderChip(card, zoneClass, -1, 'opponent')).join('');
    const rest = zone.length > visibleCards.length
      ? `<div class="dg-more-chip">+${zone.length - visibleCards.length}</div>`
      : '';

    return `<div class="dg-back-cards">${chips}${rest}</div>`;
  };

  const renderChip = (card, zoneClass, idx = -1, extra = '') => {
    const civ = getDesktopCardCivClass(card);
    const tapped = card?.tapped ? 'tapped' : '';
    const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
    const power = card?.power ? String(card.power) : '';
    const shortName = getDesktopCardShortName(card?.name || '', 8);
    const imageUrl = getDesktopCardImageUrl(card);
    const underCount = getDesktopUnderCardCount(card);
    const sourceZone = zoneClass === 'battle'
      ? 'battleZone'
      : (zoneClass === 'mana'
        ? 'manaZone'
        : (zoneClass === 'grave' ? 'graveyard' : ''));
    const isOpponentCard = String(extra || '').includes('opponent');
    const isOwnBoardCard = !isOpponentCard && idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isUnderSource = !!_desktopUnderInsertState
      && _desktopUnderInsertState.fromZone === sourceZone
      && _desktopUnderInsertState.fromIndex === idx;

    const chipClasses = [
      'dg-card-chip',
      zoneClass,
      civ,
      tapped,
      extra,
      imageUrl ? 'has-image' : '',
      underCount > 0 ? 'has-under' : '',
      _desktopUnderInsertState && isOwnBoardCard ? 'stack-target' : '',
      isUnderSource ? 'under-source' : ''
    ].filter(Boolean).join(' ');

    const onClickAttr = isOwnBoardCard
      ? `onclick="onDesktopBoardCardClick('${sourceZone}', ${idx})"`
      : '';
    const contextMenuAttr = (!isOpponentCard && idx >= 0 && sourceZone)
      ? `oncontextmenu="openDesktopCardZoneMenu(event, '${sourceZone}', ${idx})"`
      : '';

    return `
      <div class="${chipClasses}"
        title="${escapeHtml(card?.name || '')}"
        onmouseenter="showDesktopCardPreview(event, -1, '${escapeAttrJs(JSON.stringify(card))}')"
        onmouseleave="hideDesktopCardPreview()"
        ${onClickAttr}
        ${contextMenuAttr}
        data-zone="${sourceZone}"
        data-index="${idx}">
        ${underCount > 0 ? `<div class="dg-under-stack" aria-hidden="true">${renderDesktopUnderLayers(underCount)}</div><div class="dg-under-count">+${underCount}</div>` : ''}
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card?.name || 'CARD')}" class="dg-card-chip-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
          : `<div class="dg-card-cost">${escapeHtml(String(cost))}</div>
        <div class="dg-card-name">${escapeHtml(shortName)}</div>
        <div class="dg-card-power">${escapeHtml(power)}</div>`}
      </div>
    `;
  };

  const deckTopIndex = Math.max(0, state.deck.length - 1);
  const graveTopIndex = Math.max(0, state.graveyard.length - 1);
  const deckTopCard = state.deck.length ? state.deck[state.deck.length - 1] : null;
  const graveTopCard = state.graveyard.length ? state.graveyard[state.graveyard.length - 1] : null;
  const deckTopImage = getDesktopCardImageUrl(deckTopCard);
  const graveTopImage = getDesktopCardImageUrl(graveTopCard);

  container.innerHTML = `
    <div class="dg-full-root">
      <div class="dg-full-header ${headerTurnClass}">
        <div class="dg-full-head-meta">
          <div class="dg-turn-pill">ターン <b>${state.turn}</b> | 手札 <b>${state.hand.length}</b> | マナ <b>${state.manaZone.length}</b></div>
          ${ol ? `<div class="dg-full-state ${isMyTurn ? 'mine' : 'opponent'}">${isMyTurn ? 'あなたのターン' : '相手のターン'}</div>` : '<div class="dg-full-state solo">一人回し</div>'}
          ${ol ? `<div class="dg-full-match">${escapeHtml(ol.p1Name)} vs ${ol.p2Name ? escapeHtml(ol.p2Name) : '待機中'}</div>` : '<div class="dg-full-match">一人回しモード</div>'}
        </div>
        <div class="dg-full-head-actions">
          <button onclick="drawDesktopCard()" class="dg-btn draw ${_desktopNeedDrawGuide ? 'guide' : ''}">ドロー</button>
          <button onclick="turnDesktopEnd()" class="dg-btn end">ターン終了（相手にパス）</button>
          <button onclick="moveDesktopDeckTopTo('manaZone')" class="dg-btn deck-mana">トップ→マナ</button>
          <button onclick="moveDesktopDeckTopTo('graveyard')" class="dg-btn deck-grave">トップ→墓地</button>
          <button onclick="moveDesktopDeckTopTo('shields')" class="dg-btn deck-shield">トップ→シールド</button>
          <button onclick="moveDesktopToGraveyard('battle')" class="dg-btn battle-grave">戦→墓地</button>
          <button onclick="moveDesktopToGraveyard('mana')" class="dg-btn mana-grave">マナ→墓地</button>
          <button onclick="returnDesktopFromGraveyard('hand')" class="dg-btn grave-return">墓地→手札</button>
          <button onclick="breakDesktopShield()" class="dg-btn shield-break">${shieldBreakLabel}</button>
          ${!window._ol ? `<button onclick="undoDesktopGame()" class="dg-btn undo">やり直し</button>` : ''}
          <button onclick="renderDesktopDeckList()" class="dg-btn back">戻る</button>
        </div>
      </div>

      <div class="dg-full-body ${ol ? 'online' : 'solo'}">
        <div class="dg-full-board">
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
                <div class="dg-opp-label">バトル (${getZoneCount(opp.battleZone)})</div>
                ${renderOpponentPublicZone(opp.battleZone, 'battle')}
              </div>
              <div class="dg-opp-panel">
                <div class="dg-opp-label">マナ (${getZoneCount(opp.manaZone)})</div>
                ${renderOpponentPublicZone(opp.manaZone, 'mana')}
              </div>
            </div>
            <div class="dg-opp-panel dg-opp-grave">
              <div class="dg-opp-label">墓地 (${getZoneCount(opp.graveyard)})</div>
              ${renderOpponentPublicZone(opp.graveyard, 'grave')}
            </div>
          </div>` : ''}

          <div class="dg-me-wrap">
            <div class="dg-me-title">自分エリア: ${escapeHtml(myName)}</div>
            <div class="dg-pile-row">
              <button
                type="button"
                class="dg-pile-btn deck ${deckTopImage ? 'has-image' : ''}"
                onclick="openDesktopDeckTopMenu(event)"
                oncontextmenu="openDesktopDeckTopMenu(event)"
                title="山札トップの操作">
                <span class="dg-pile-label">山札</span>
                ${deckTopImage
                  ? `<img src="${escapeHtml(deckTopImage)}" alt="山札トップ" class="dg-pile-thumb" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
                  : '<span class="dg-pile-empty">空</span>'}
                <span class="dg-pile-count">${state.deck.length}</span>
              </button>

              <button
                type="button"
                class="dg-pile-btn grave ${graveTopImage ? 'has-image' : ''}"
                onclick="openDesktopGraveyardModal()"
                ${state.graveyard.length ? `oncontextmenu="openDesktopCardZoneMenu(event, 'graveyard', ${graveTopIndex})"` : ''}
                title="墓地を表示">
                <span class="dg-pile-label">墓地</span>
                ${graveTopImage
                  ? `<img src="${escapeHtml(graveTopImage)}" alt="墓地トップ" class="dg-pile-thumb" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
                  : '<span class="dg-pile-empty">空</span>'}
                <span class="dg-pile-count">${state.graveyard.length}</span>
              </button>
            </div>
            ${_desktopUnderInsertState ? '<div class="dg-zone-hint">重ね先を選択中: バトル/マナのカードをクリック</div>' : ''}
          </div>

          <div class="dg-section">
            <strong class="dg-zone-title">手札 (${state.hand.length})</strong>
            <div id="desktop-hand-zone" class="dg-hand-zone">
              ${state.hand.length ? state.hand.map((c, i) => {
                const civ = getDesktopCardCivClass(c);
                const cost = Number.isFinite(Number(c?.cost)) ? Number(c.cost) : '-';
                const power = c?.power ? String(c.power) : '';
                const imageUrl = getDesktopCardImageUrl(c);
                return `
                  <div class="dg-card-chip hand ${civ} ${imageUrl ? 'has-image' : ''}" draggable="true"
                    onclick="selectDesktopHandCard(${i}, event)"
                    oncontextmenu="openDesktopCardZoneMenu(event, 'hand', ${i})"
                    onmouseenter="showDesktopCardPreview(event, ${i})"
                    onmouseleave="hideDesktopCardPreview()"
                    ondragstart="dragDesktopCard(event, ${i})"
                    ondragend="dragDesktopCardEnd()"
                    title="${escapeHtml(c.name)}">
                    ${imageUrl
                      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.name || 'CARD')}" class="dg-card-chip-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
                      : `<div class="dg-card-cost">${escapeHtml(String(cost))}</div>
                    <div class="dg-card-name">${escapeHtml(getDesktopCardShortName(c.name, 8))}</div>
                    <div class="dg-card-power">${escapeHtml(power)}</div>`}
                  </div>
                `;
              }).join('') : '<div class="dg-zone-empty">カードなし</div>'}
            </div>
            <div id="desktop-card-preview" class="dg-preview">
              <div id="desktop-preview-content"></div>
            </div>
          </div>

          <div class="dg-section">
            <strong class="dg-zone-title">バトル (${state.battleZone.length})</strong>
            <div id="desktop-battle-zone" ondrop="dropDesktopCard(event, 'battle')" ondragover="dragDesktopOver(event)" class="dg-play-zone battle">
              ${state.battleZone.length ? state.battleZone.map((c, i) => renderChip(c, 'battle', i)).join('') : '<div class="dg-zone-empty">カードなし</div>'}
            </div>
          </div>

          <div class="dg-section">
            <strong class="dg-zone-title">マナ (${state.manaZone.length})</strong>
            <div id="desktop-mana-zone" ondrop="dropDesktopCard(event, 'mana')" ondragover="dragDesktopOver(event)" class="dg-play-zone mana">
              ${state.manaZone.length ? state.manaZone.map((c, i) => renderChip(c, 'mana', i)).join('') : '<div class="dg-zone-empty">カードなし</div>'}
            </div>
          </div>

          <div class="dg-section">
            <strong class="dg-zone-title">シールド (${state.shields.length})</strong>
            <div class="dg-shield-zone">
              ${state.shields.length ? state.shields.map((c, i) => `
                <div class="dg-card-chip shield ${_desktopSelectedShieldIdx === i ? 'selected' : ''}"
                  onclick="selectDesktopShield(${i})"
                  oncontextmenu="openDesktopCardZoneMenu(event, 'shields', ${i})"
                  title="${escapeHtml(c.name || 'シールド')}">
                  SH
                </div>
              `).join('') : '<div class="dg-zone-empty">カードなし</div>'}
            </div>
          </div>
        </div>

        ${ol ? `
          <div class="dg-full-chat">
            <div class="dg-chat-title">チャット</div>
            <div id="desktop-chat-messages" class="dg-chat-messages"></div>
            <div class="dg-chat-input-row">
              <input id="desktop-chat-input" type="text" maxlength="200" placeholder="メッセージを入力" onkeydown="onDesktopChatKeyDown(event)" class="dg-chat-input">
              <button onclick="sendDesktopChat()" class="dg-chat-send">送信</button>
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  if (ol) renderDesktopChatMessages();
}

function selectDesktopHandCard(idx, event) {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const index = Number(idx);
  const hand = engine?.state?.hand;
  if (!Array.isArray(hand) || !Number.isInteger(index) || !hand[index]) return;

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  closeDesktopCardZoneMenu();
  closeDesktopHandPicker();

  const picker = document.createElement('div');
  picker.id = 'desktop-hand-picker';
  picker.className = 'dg-hand-picker';
  picker.innerHTML = `
    <button type="button" onclick="playDesktopCard(${index}, 'battle')">バトルゾーンへ</button>
    <button type="button" onclick="playDesktopCard(${index}, 'mana')">マナゾーンへ</button>
    <button type="button" class="cancel" onclick="closeDesktopHandPicker()">キャンセル</button>
  `;

  document.body.appendChild(picker);

  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const pickerRect = picker.getBoundingClientRect();
  const rawLeft = rect ? rect.left : (window.innerWidth / 2 - pickerRect.width / 2);
  const rawTop = rect ? (rect.bottom + 6) : (window.innerHeight / 2 - pickerRect.height / 2);
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - pickerRect.width - 8));
  const top = Math.max(8, Math.min(rawTop, window.innerHeight - pickerRect.height - 8));

  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;

  setTimeout(() => {
    document.addEventListener('click', closeDesktopHandPicker, { once: true });
  }, 0);
}

function closeDesktopHandPicker() {
  const picker = document.getElementById('desktop-hand-picker');
  if (picker) picker.remove();
}

function onDesktopBoardCardClick(zone, idx) {
  if (_desktopUnderInsertState) {
    const sameSource = _desktopUnderInsertState.fromZone === zone
      && _desktopUnderInsertState.fromIndex === idx;
    if (sameSource) {
      _desktopUnderInsertState = null;
      showDesktopToast('重ね配置をキャンセルしました', 'info');
      renderDesktopGame();
      return;
    }

    insertDesktopCardUnderTarget(zone, idx);
    return;
  }

  tapDesktopCard(zone, idx);
}

function setDesktopCardTapped(zone, idx, tapped) {
  closeDesktopCardZoneMenu();

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const cards = engine?.state?.[zone];
  const card = Array.isArray(cards) ? cards[idx] : null;
  if (!card) return;

  const nextTapped = !!tapped;
  const ok = window.GameController?.setCardTapped
    ? window.GameController.setCardTapped(engine, zone, idx, nextTapped)
    : ((!!card.tapped === nextTapped) ? true : engine.tapCard(zone, idx));
  if (!ok) {
    showDesktopToast('タップ状態を変更できませんでした', 'warn');
    return;
  }

  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function prepareDesktopInsertUnder(fromZone, fromIndex) {
  closeDesktopCardZoneMenu();

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const idx = Number(fromIndex);
  const source = engine?.state?.[fromZone];
  if (!Array.isArray(source) || !Number.isInteger(idx) || !source[idx]) {
    showDesktopToast('重ねるカードが見つかりません', 'warn');
    return;
  }

  _desktopUnderInsertState = { fromZone, fromIndex: idx };
  showDesktopToast('重ね先の盤面カードをクリックしてください', 'info', 2600);
  renderDesktopGame();
}

function insertDesktopCardUnderTarget(targetZone, targetIndex) {
  if (!_desktopUnderInsertState) return;
  if (targetZone !== 'battleZone' && targetZone !== 'manaZone') {
    showDesktopToast('重ね先はバトル/マナのみです', 'warn');
    return;
  }

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const fromZone = _desktopUnderInsertState.fromZone;
  const fromIndex = _desktopUnderInsertState.fromIndex;
  const idx = Number(targetIndex);

  const ok = window.GameController?.insertCardUnderCard
    ? window.GameController.insertCardUnderCard(engine, fromZone, fromIndex, targetZone, idx)
    : (typeof engine.insertCardUnderCard === 'function'
      ? engine.insertCardUnderCard(fromZone, fromIndex, targetZone, idx)
      : false);

  if (!ok) {
    showDesktopToast('カードを下に重ねられませんでした', 'warn');
    return;
  }

  _desktopUnderInsertState = null;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function tapDesktopCard(zone, idx) {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.tapCard(engine, zone, idx)
    : engine.tapCard(zone, idx);
  if (!ok) return;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function selectDesktopShield(idx) {
  _desktopSelectedShieldIdx = (_desktopSelectedShieldIdx === idx) ? null : idx;
  renderDesktopGame();
}

function breakDesktopShield() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const result = window.GameController
    ? window.GameController.breakShield(engine, _desktopSelectedShieldIdx)
    : { ok: !!engine.breakShield(_desktopSelectedShieldIdx) };
  if (!result.ok) {
    showDesktopToast('シールドがありません', 'warn');
    return;
  }

  _desktopSelectedShieldIdx = null;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function canActDesktopOnline() {
  if (window.GameController) {
    return window.GameController.canActOnline(window._ol, window._olCurrentPlayer);
  }
  if (!window._ol) return true;
  if (!window._olCurrentPlayer) return false;
  const me = window._ol.p === 'p1' ? 1 : 2;
  return window._olCurrentPlayer === me;
}

function getDesktopZoneLabel(zoneKey) {
  const labels = {
    hand: '手札',
    battleZone: 'バトル',
    manaZone: 'マナ',
    shields: 'シールド',
    deck: '山札',
    graveyard: '墓地'
  };
  return labels[zoneKey] || zoneKey;
}

function getDesktopCardZoneActions(sourceZone, sourceCard) {
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
      move('墓地へ', 'graveyard', 'top', true),
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
      move('手札へ（シールドブレイク）', 'hand'),
      move('マナゾーンへ', 'manaZone'),
      move('バトルゾーンへ', 'battleZone'),
      move('山札トップへ', 'deck', 'top'),
      move('山札ボトムへ', 'deck', 'bottom'),
      { kind: 'sep' },
      move('墓地へ', 'graveyard', 'top', true),
      { kind: 'sep' },
      { kind: 'under', label: '盤面カードの下へ（対象選択）' }
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
      move('山札ボトムへ', 'deck', 'bottom')
    );
  }

  if (actions.length && actions[actions.length - 1].kind === 'sep') {
    actions.pop();
  }
  if (actions.length) {
    actions.push({ kind: 'sep' });
  }
  actions.push({ kind: 'detail', label: 'カード詳細' });

  return actions;
}

function ensureDesktopCardZoneMenu() {
  let menu = document.getElementById('desktop-card-zone-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'desktop-card-zone-menu';
    menu.className = 'dg-zone-menu';
    document.body.appendChild(menu);
  }

  if (!_desktopZoneMenuGlobalBound) {
    document.addEventListener('click', (event) => {
      const node = document.getElementById('desktop-card-zone-menu');
      if (!node || !node.classList.contains('open')) return;
      if (node.contains(event.target)) return;
      closeDesktopCardZoneMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDesktopCardZoneMenu();
        if (_desktopUnderInsertState) {
          _desktopUnderInsertState = null;
          renderDesktopGame();
        }
      }
    });

    window.addEventListener('resize', closeDesktopCardZoneMenu);
    window.addEventListener('scroll', closeDesktopCardZoneMenu, true);
    _desktopZoneMenuGlobalBound = true;
  }

  return menu;
}

function closeDesktopCardZoneMenu() {
  _desktopZoneMenuState = null;
  const menu = document.getElementById('desktop-card-zone-menu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.innerHTML = '';
}

function moveDesktopCardBetweenZones(fromZone, fromIndex, toZone, position = 'top') {
  closeDesktopCardZoneMenu();

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const options = { position: position === 'bottom' ? 'bottom' : 'top' };
  const ok = window.GameController
    ? window.GameController.moveCardBetweenZones(engine, fromZone, fromIndex, toZone, options)
    : engine.moveCardBetweenZones(fromZone, fromIndex, toZone, options);

  if (!ok) {
    showDesktopToast('カード移動に失敗しました', 'warn');
    return;
  }

  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function moveDesktopDeckTopTo(toZone) {
  const deck = engine?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showDesktopToast('山札がありません', 'warn');
    return;
  }

  moveDesktopCardBetweenZones('deck', deck.length - 1, toZone, 'top');
}

function openDesktopDeckTopMenu(event) {
  const deck = engine?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showDesktopToast('山札がありません', 'warn');
    return;
  }

  openDesktopCardZoneMenu(event, 'deck', deck.length - 1);
}

function openDesktopCardDetailFromZone(sourceZone, sourceIndex) {
  const source = engine?.state?.[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !Number.isInteger(idx) || !source[idx]) {
    showDesktopToast('カード情報が見つかりません', 'warn');
    return;
  }

  closeDesktopCardZoneMenu();
  showDesktopCardDetail(source[idx], { allowAdd: false });
}

function openDesktopCardZoneMenu(event, sourceZone, sourceIndex) {
  event.preventDefault();
  event.stopPropagation();
  closeDesktopHandPicker();

  if (!engine || !engine.state) return;

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const source = engine.state[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !source.length || !Number.isInteger(idx) || !source[idx]) {
    showDesktopToast('移動できるカードがありません', 'warn');
    return;
  }

  const sourceCard = source[idx];
  const actions = getDesktopCardZoneActions(sourceZone, sourceCard);
  if (!actions.length) return;

  const menu = ensureDesktopCardZoneMenu();
  _desktopZoneMenuState = { sourceZone, sourceIndex: idx };

  const actionHtml = actions.map((action) => {
    if (action.kind === 'sep') {
      return '<div class="dg-zone-menu-sep" aria-hidden="true"></div>';
    }

    const className = [
      'dg-zone-menu-btn',
      action.kind === 'detail' ? 'detail' : '',
      action.red ? 'red' : ''
    ].filter(Boolean).join(' ');

    if (action.kind === 'tap') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="setDesktopCardTapped('${sourceZone}', ${idx}, ${action.tapped ? 'true' : 'false'})">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'under') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="prepareDesktopInsertUnder('${sourceZone}', ${idx})">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'detail') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openDesktopCardDetailFromZone('${sourceZone}', ${idx})">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    return `
      <button
        type="button"
        class="${className}"
        onclick="moveDesktopCardBetweenZones('${sourceZone}', ${idx}, '${action.toZone}', '${action.position || 'top'}')">
        ${escapeHtml(action.label)}
      </button>
    `;
  }).join('');

  menu.innerHTML = `
    <div class="dg-zone-menu-head">${escapeHtml(getDesktopZoneLabel(sourceZone))} の操作</div>
    <div class="dg-zone-menu-list">
      ${actionHtml}
    </div>
  `;
  menu.classList.add('open');
  menu.style.left = `${event.pageX}px`;
  menu.style.top = `${event.pageY}px`;

  requestAnimationFrame(() => {
    if (!menu.classList.contains('open')) return;
    const rect = menu.getBoundingClientRect();
    let left = event.pageX;
    let top = event.pageY;

    if (rect.right > window.innerWidth - 8) {
      left = Math.max(8, window.scrollX + window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top = Math.max(8, window.scrollY + window.innerHeight - rect.height - 8);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
}

function playDesktopCard(idx, zone) {
  closeDesktopHandPicker();

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.playCardByHandIndex(engine, idx, zone)
    : engine.playCard(engine.state.hand[idx], zone);
  if (!ok) return;
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
    showDesktopToast('相手のターンです', 'warn');
    return;
  }
  
  const ok = window.GameController
    ? window.GameController.playCardByHandIndex(engine, _currentDragIdx, zone)
    : engine.playCard(engine.state.hand[_currentDragIdx], zone);
  if (ok) {
    if (window._ol) olSendActionDesktop('state');
    renderDesktopGame();
  }
  
  _currentDragIdx = null;
}

function drawDesktopCard() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.drawCard(engine)
    : engine.drawCard();
  if (!ok) return;
  _desktopNeedDrawGuide = false;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function turnDesktopEnd() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.turnEnd(engine, window._ol)
    : (engine.turnEnd(), true);
  if (!ok) return;
  _desktopNeedDrawGuide = !window._ol;
  _desktopSelectedShieldIdx = null;
  if (window._ol) {
    olSendActionDesktop('turn_end');
  } else {
    showDesktopTurnNotification('次のターンです。まずはドロー');
  }
  renderDesktopGame();
}

function moveDesktopToGraveyard(fromZone) {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.moveToGraveyard(engine, fromZone)
    : engine.moveToGraveyard(-1, fromZone);
  if (!ok) return;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function returnDesktopFromGraveyard(toZone) {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController
    ? window.GameController.returnFromGraveyard(engine, toZone || 'hand')
    : engine.returnFromGraveyard(-1, toZone || 'hand');
  if (!ok) return;
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function undoDesktopGame() {
  if (window._ol) return;
  const ok = window.GameController
    ? window.GameController.undo(engine)
    : engine.undo();
  if (ok) renderDesktopGame();
}

function openDesktopGraveyardModal() {
  const state = engine?.getState?.();
  const grave = Array.isArray(state?.graveyard) ? state.graveyard : [];
  if (!grave.length) {
    showDesktopToast('墓地にカードがありません', 'warn');
    return;
  }

  let modal = document.getElementById('desktop-graveyard-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-graveyard-modal';
    modal.className = 'dm-grave-modal';
    modal.innerHTML = `
      <div class="dm-grave-backdrop" onclick="closeDesktopGraveyardModal()"></div>
      <div class="dm-grave-body">
        <div class="dm-grave-head">
          <div class="dm-grave-title">墓地一覧</div>
          <button class="dm-grave-close" onclick="closeDesktopGraveyardModal()">閉じる</button>
        </div>
        <div id="desktop-graveyard-list" class="dm-grave-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const list = document.getElementById('desktop-graveyard-list');
  if (list) {
    list.innerHTML = grave.slice().reverse().map((card, i) => {
      const civ = getDesktopCardCivClass(card);
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item ${civ}">
          <div class="dm-grave-item-no">${i + 1}</div>
          <div class="dm-grave-item-main">
            <div class="dm-grave-item-name">${escapeHtml(card?.name || 'カード')}</div>
            <div class="dm-grave-item-meta">コスト ${escapeHtml(String(cost))} / パワー ${escapeHtml(String(power))}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  modal.classList.add('open');
}

function closeDesktopGraveyardModal() {
  const modal = document.getElementById('desktop-graveyard-modal');
  if (modal) modal.classList.remove('open');
}

function newDesktopDeck() {
  const name = prompt('デッキ名を入力:');
  if (!name) return;
  
  const decks = getSavedDecks();
  if (decks[name]) {
    showDesktopToast('このデッキは既に存在します', 'warn');
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
  renderDesktopDeckList();
}

async function deleteDesktopDeck(name) {
  const ok = await askDesktopConfirm('削除してよろしいですか？', '削除', 'キャンセル');
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

  const decks = getSavedDecks();
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
    showDesktopToast(cloudDeleteError || 'デッキが見つかりませんでした', 'warn');
    renderDesktopDeckList();
    return;
  }

  if (cloudDeleteError && hadLocalDeck) {
    showDesktopToast(`ローカルから削除しました（クラウド削除失敗: ${cloudDeleteError}）`, 'warn');
  } else {
    showDesktopToast('デッキを削除しました', 'ok');
  }
  renderDesktopDeckList();
}

/**
 * PC版 デッキ編集画面
 */
function renderDesktopDeckEdit() {
  renderDesktopDeckList();
}

/**
 * デッキ編集を開く
 */
function isDesktopCardHydrationNeeded(card) {
  const hasName = !!String(card?.name || '').trim();
  const hasImage = !!getDesktopCardImageUrl(card);
  const hasCost = Number.isFinite(Number(card?.cost));
  return !(hasName && hasImage && hasCost);
}

async function hydrateDesktopDeckCards(cards) {
  const normalizedCards = Array.isArray(cards)
    ? cards.map(card => NetworkService.normalizeCardData(card))
    : [];

  if (!normalizedCards.length) return null;
  if (!normalizedCards.some(isDesktopCardHydrationNeeded)) return null;

  const hydrated = await Promise.all(normalizedCards.map(async (card) => {
    if (!isDesktopCardHydrationNeeded(card)) {
      return card;
    }
    const enriched = await NetworkService.enrichCardImage(card);
    return NetworkService.normalizeCardData(enriched);
  }));

  return hydrated;
}

async function openDesktopDeck(name) {
  const deckName = String(name || '').trim();
  if (!deckName) {
    clearDesktopDeckSelection();
    return;
  }

  try {
    const savedDecks = getSavedDecks();
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

    const sortedCards = sortDesktopDeckCards(cards);
    if (window.GameController) {
      window.GameController.setDeckEditingState(deckName, sortedCards);
    } else {
      window._deckEditing = deckName;
      window._deckCards = sortedCards;
    }
    renderDesktopDeckList();

    const hydrateToken = ++_desktopDeckHydrateToken;
    const hydratedCards = await hydrateDesktopDeckCards(sortedCards);
    if (!hydratedCards) return;
    if (hydrateToken !== _desktopDeckHydrateToken) return;
    if (window._deckEditing !== deckName) return;

    const hydratedSorted = sortDesktopDeckCards(hydratedCards);
    if (window.GameController) {
      window.GameController.setDeckEditingState(deckName, hydratedSorted);
    } else {
      window._deckCards = hydratedSorted;
    }

    const decks = getSavedDecks();
    if (Array.isArray(decks[deckName])) {
      decks[deckName] = hydratedSorted.map(card => NetworkService.normalizeCardData(card));
      if (window.GameController) {
        window.GameController.saveSavedDecks(decks);
      } else {
        localStorage.setItem('dm_decks', JSON.stringify(decks));
      }
    }

    renderDesktopDeckList();
  } catch (error) {
    console.error('デッキ読み込みエラー:', error);
    showDesktopToast('デッキの読み込みに失敗しました', 'warn');
  }
}

/**
 * カード枚数増加
 */
function incrementDesktopCardCount(idx) {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    const next = window.GameController.changeDeckCardCount(window._deckCards, idx, 1, 1, 4);
    window._deckCards = next;
  } else {
    const card = window._deckCards[idx];
    if (!card) return;
    card.count = (card.count || 1) + 1;
    if (card.count > 4) card.count = 4;
  }
  sortCurrentDesktopDeckCards();
  renderDesktopDeckList();
}

/**
 * カード枚数減少
 */
function decrementDesktopCardCount(idx) {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    const next = window.GameController.changeDeckCardCount(window._deckCards, idx, -1, 1, 4);
    window._deckCards = next;
  } else {
    const card = window._deckCards[idx];
    if (!card) return;
    card.count = (card.count || 1) - 1;
    if (card.count < 1) {
      window._deckCards.splice(idx, 1);
    }
  }
  sortCurrentDesktopDeckCards();
  renderDesktopDeckList();
}

/**
 * カード削除
 */
function removeDesktopCard(idx) {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  if (window.GameController) {
    window._deckCards = window.GameController.removeDeckCard(window._deckCards, idx);
  } else {
    window._deckCards.splice(idx, 1);
  }
  sortCurrentDesktopDeckCards();
  renderDesktopDeckList();
}

/**
 * デッキに カード追加
 */
async function addToDesktopDeck(cardJson, addCount = 1) {
  try {
    if (!window._deckEditing) {
      showDesktopToast('先に編集するデッキを選択してください', 'warn');
      return false;
    }

    const rawCard = typeof cardJson === 'string' ? JSON.parse(cardJson) : cardJson;
    const card = await NetworkService.enrichCardImage(rawCard);
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

    sortCurrentDesktopDeckCards();
    renderDesktopDeckList();
    return true;
  } catch (e) {
    console.error('カード追加エラー:', e);
    return false;
  }
}

/**
 * デッキ保存
 */
async function saveDesktopDeck() {
  return saveDesktopDeckToCloud();
}

async function saveDesktopDeckToCloud() {
  if (!window._deckEditing) {
    showDesktopToast('先に編集するデッキを選択してください', 'warn');
    return;
  }

  const total = window.GameController
    ? window.GameController.countDeckCards(window._deckCards)
    : getDeckCardTotal(window._deckCards);
  if (total === 0) {
    showDesktopToast('カードが入っていません', 'warn');
    return;
  }
  if (total > 40) {
    const ok = await askDesktopConfirm(`デッキが${total}枚です（推奨40枚）。このまま保存しますか？`, '保存する', '戻る');
    if (!ok) return;
  }

  const account = AuthService.getCurrentAccount();
  if (!account || account.isGuest || !account.pin) {
    showDesktopToast('保存にはPINログインが必要です', 'warn');
    return;
  }

  const deckName = window._deckEditing;
  const deckData = window._deckCards.map(card => NetworkService.normalizeCardData(card));
  if (!deckName) return;

  const result = await NetworkService.saveDeck(account.username, account.pin, deckName, deckData);
  if (result.error) {
    showDesktopToast(result.error, 'warn');
    return;
  }

  const decks = getSavedDecks();
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
  showDesktopToast('保存しました', 'ok');
  renderDesktopDeckList();
}

/**
 * デッキからゲーム開始
 */
function playDesktopDeckGame() {
  if (!window._deckCards.length) {
    showDesktopToast('デッキが空です', 'warn');
    return;
  }
  
  if (window.GameController) {
    window.GameController.initSoloGame(engine, window._deckCards);
  } else {
    engine.initGame(window._deckCards);
  }
  _desktopNeedDrawGuide = true;
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
    if (window.GameController) {
      window.GameController.clearOnlineSession();
    } else {
      window._ol = null;
      window._olDeckData = null;
    }
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
  const normalizedRoomCode = (window.NetworkService && typeof window.NetworkService.normalizeRoomCode === 'function')
    ? window.NetworkService.normalizeRoomCode(codeInput?.value || '')
    : (codeInput?.value || '').trim().toUpperCase().slice(0, 6);
  return {
    playerName: (nameInput?.value || 'Player').trim().slice(0, 20),
    deckName: (deckSelect?.value || '').trim(),
    roomCode: normalizedRoomCode
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

  if (window.GameController) {
    window.GameController.clearOnlineSession();
  } else {
    window._ol = null;
    window._olDeckData = null;
    window._olOpponent = null;
    window._olCurrentPlayer = null;
  }

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
  window._ol = {
    room,
    p: 'p1',
    p1Name: playerName || 'Player 1',
    p2Name: null,
    eventSource: null,
    reconnectAttempt: 0,
    localSeq: 0,
    remoteSeq: 0
  };
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
  const roomInput = document.getElementById('desktop-online-room-code');
  if (roomInput && roomCode && roomInput.value !== roomCode) {
    roomInput.value = roomCode;
  }

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
    reconnectAttempt: 0,
    localSeq: 0,
    remoteSeq: 0
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
  const account = AuthService.getCurrentAccount();
  if (window.GameController) {
    return await window.GameController.resolveDeckData(deckName, account);
  }

  const savedDecks = getSavedDecks();
  if (savedDecks[deckName]) {
    return Array.isArray(savedDecks[deckName]) ? savedDecks[deckName] : null;
  }
  if (account && !account.isGuest && account.pin) {
    return await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
  }
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

  if (window.GameController) {
    window.GameController.startOnlineMatch(window._ol.p);
  } else {
    window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deck: 30, graveyard: 0 };
    window._olCurrentPlayer = window._ol.p === 'p1' ? 1 : 2;
    window._olChatLogDesktop = [];
  }
  _desktopSelectedShieldIdx = null;
  _desktopUnderInsertState = null;
  _desktopNeedDrawGuide = true;
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
    if (!shouldApplyRemotePayloadDesktop(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (data.turn) engine.state.turn = data.turn;
    if (other) window._olOpponent = normalizeDesktopOpponentState(other);
    if (data.active) window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      [...engine.state.battleZone, ...engine.state.manaZone].forEach(card => {
        card.tapped = false;
      });
      _desktopNeedDrawGuide = true;
      showDesktopTurnNotification('あなたのターンです！ まずはドロー');
    }

    renderDesktopGame();
  });

  es.addEventListener('turn_end', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = 0;
    const data = JSON.parse(e.data);
    if (!shouldApplyRemotePayloadDesktop(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (data.turn) engine.state.turn = data.turn;
    if (other) window._olOpponent = normalizeDesktopOpponentState(other);
    if (data.active) {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn) {
      [...engine.state.battleZone, ...engine.state.manaZone].forEach(card => {
        card.tapped = false;
      });
      _desktopNeedDrawGuide = true;
      showDesktopTurnNotification('あなたのターンです！ まずはドロー');
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
      showDesktopToast('接続が切れました。ロビーに戻ります', 'warn');
      if (window.GameController) {
        window.GameController.clearOnlineSession();
      } else {
        window._ol = null;
        window._olOpponent = null;
        window._olCurrentPlayer = null;
      }
      renderDesktopDeckList();
    }
  };
}

function nextOnlineSeqDesktop() {
  if (!window._ol) return 0;

  if (window.GameController?.nextOnlineSeq) {
    return window.GameController.nextOnlineSeq(window._ol);
  }

  window._ol.localSeq = (Number(window._ol.localSeq) || 0) + 1;
  return window._ol.localSeq;
}

function shouldApplyRemotePayloadDesktop(payload) {
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

function olSendActionDesktop(actionType) {
  if (window.GameController) {
    window.GameController.sendOnlineAction(engine, actionType);
    return;
  }

  if (!window._ol || !engine) return;
  const s = engine.state;
  const publicState = buildDesktopPublicState(s);
  const payload = {
    room: window._ol.room,
    p: window._ol.p,
    type: actionType,
    seq: nextOnlineSeqDesktop(),
    turn: s.turn,
    active: actionType === 'turn_end' ? (window._ol.p === 'p1' ? 'p2' : 'p1') : window._ol.p,
    p1: window._ol.p === 'p1' ? publicState : null,
    p2: window._ol.p === 'p2' ? publicState : null
  };
  NetworkService.sendAction(payload);
}
