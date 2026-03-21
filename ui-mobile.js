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
let _mobileDeckSaving = false;
const _mobileSearchHydrateCooldownUntil = new Map();
const MOBILE_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS = 45 * 1000;
const MOBILE_SEARCH_HYDRATE_ERROR_COOLDOWN_MS = 8 * 1000;
let _mobileSearchHydrateToken = null;
let _mobileSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };
let _mobileZoneMenuState = null;
let _mobileZoneMenuLongPressTimer = null;
let _vsOppTargetMobile = false;

function getVsOppEngineMobile() {
  const vs = window._vs;
  if (!vs) return engineMobile;
  return vs.activePlayer === 'p1' ? vs.p2Engine : vs.p1Engine;
}

function _engM() {
  return _mobileZoneMenuState?.targetEngine || engineMobile;
}
let _mobileZoneLongPressCtx = null;
let _mobileUnderInsertState = null;
let _mobileSkipNextTap = false;
let _mobileDetailCardState = null;
let _mobileDetailRequestToken = 0;
let _mobileDetailAllowAdd = true;
let _mobileDetailOnCardChange = null;
let _mobileIllustrationRequestToken = 0;
let _mobileIllustrationOptions = [];
let _mobileRibbonOtherOpen = false;
let _mobileDeckNValue = 3;
let _mobileDeckPeekPrivateCards = [];
let _mobileDeckRevealModalState = {
  mode: 'public',
  destination: 'hand',
  selected: {}
};
let _mobileGameLog = [];
let _handDiscardStateMobile = null;
let _mobileLogOpen = false;

function escapeHtmlMobile(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** onclick 等のシングルクォート文字列用（デッキ名に ' や " が含まれると壊れるのを防ぐ） */
function escapeAttrJsMobile(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
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

function renderMobileUnderPeekLayers(card) {
  const under = Array.isArray(card?.underCards) ? card.underCards : [];
  if (!under.length) return '';
  const layers = under.slice(0, 3).map((uc, i) => {
    return `<div class="mg-under-peek-layer" style="left:-${(i + 1) * 5}px"></div>`;
  }).join('');
  const overflow = under.length > 3
    ? `<div class="mg-under-overflow">+${under.length - 3}</div>`
    : '';
  return layers + overflow;
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
  closeMobileIllustrationModal();
  _mobileDetailRequestToken += 1;
  _mobileDetailCardState = null;
  _mobileDetailAllowAdd = true;
  _mobileDetailOnCardChange = null;
  _mobileIllustrationOptions = [];
}

function mergeMobileCardIllustration(baseCard, nextCard) {
  const merged = {
    ...(baseCard || {}),
    ...(nextCard || {})
  };

  const imageUrl = getMobileCardImageUrl(nextCard) || getMobileCardImageUrl(baseCard);
  if (imageUrl) {
    merged.imageUrl = imageUrl;
    merged.thumb = imageUrl;
    merged.img = imageUrl;
    merged.selectedImageUrl = imageUrl;
  }

  const selectedArtId = String(nextCard?.selectedArtId || baseCard?.selectedArtId || '').trim();
  if (selectedArtId) {
    merged.selectedArtId = selectedArtId;
  }

  return merged;
}

function ensureMobileIllustrationModal() {
  let modal = document.getElementById('mobile-illustration-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mobile-illustration-modal';
    modal.className = 'dm-art-picker-modal';
    modal.innerHTML = `
      <div class="dm-art-picker-backdrop" onclick="closeMobileIllustrationModal()"></div>
      <div class="dm-art-picker-body mobile">
        <div class="dm-art-picker-head">
          <div class="dm-art-picker-title">イラスト変更</div>
          <button type="button" class="dm-art-picker-close" onclick="closeMobileIllustrationModal()">×</button>
        </div>
        <div id="mobile-illustration-content" class="dm-art-picker-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

function closeMobileIllustrationModal() {
  const modal = document.getElementById('mobile-illustration-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  _mobileIllustrationRequestToken += 1;
}

function handleMobileIllustrationImageError(img) {
  if (!img) return;

  const currentSrc = String(img.getAttribute('src') || '').trim();
  const retryCount = Number(img.dataset.imgRetryCount || 0);
  if (currentSrc && retryCount < 1) {
    const baseSrc = String(img.dataset.baseSrc || currentSrc).trim();
    img.dataset.baseSrc = baseSrc;
    img.dataset.imgRetryCount = String(retryCount + 1);
    const sep = baseSrc.includes('?') ? '&' : '?';
    img.src = `${baseSrc}${sep}_artRetry=${Date.now()}_${retryCount + 1}`;
    return;
  }

  const tile = img.closest('.dm-art-picker-item');
  if (tile) {
    tile.remove();
  }

  const grid = document.querySelector('#mobile-illustration-content .dm-art-picker-grid');
  if (grid && !grid.querySelector('.dm-art-picker-item')) {
    const content = document.getElementById('mobile-illustration-content');
    if (content) {
      content.innerHTML = '<div class="dm-art-picker-empty">表示できるイラストが見つかりませんでした。</div>';
    }
  }
}

function renderMobileIllustrationContent(opts = {}) {
  const content = document.getElementById('mobile-illustration-content');
  if (!content) return;

  if (opts.loading) {
    content.innerHTML = '<div class="dm-art-picker-loading">イラスト一覧を取得中…</div>';
    return;
  }

  if (opts.error) {
    content.innerHTML = `<div class="dm-art-picker-error">${escapeHtmlMobile(opts.error)}</div>`;
    return;
  }

  const selectedArtId = String(opts.selectedArtId || '').trim();
  const selectedImage = String(opts.selectedImage || '').trim();
  const options = Array.isArray(opts.options) ? opts.options : [];
  if (!options.length) {
    content.innerHTML = '<div class="dm-art-picker-empty">選択できるイラストが見つかりませんでした。</div>';
    return;
  }

  content.innerHTML = `
    <div class="dm-art-picker-grid">
      ${options.map((option, idx) => {
        const imageUrl = getMobileCardImageUrl(option);
        const artId = String(option?.artId || '').trim();
        const isSelected = selectedArtId
          ? artId === selectedArtId
          : (!!selectedImage && imageUrl === selectedImage);
        const label = String(option?.label || option?.name || `イラスト ${idx + 1}`).trim();

        return `
          <button
            type="button"
            class="dm-art-picker-item ${isSelected ? 'selected' : ''}"
            onclick="applyMobileIllustrationFromPicker(${idx})">
            ${imageUrl
              ? `<img src="${escapeHtmlMobile(imageUrl)}" alt="${escapeHtmlMobile(label)}" class="dm-art-picker-thumb" onerror="handleMobileIllustrationImageError(this)">`
              : '<div class="dm-art-picker-thumb placeholder">NO IMG</div>'}
            <div class="dm-art-picker-label">${escapeHtmlMobile(label)}</div>
          </button>
        `;
      }).join('')}
    </div>
  `;
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
    <div class="dm-card-detail-sub-actions">
      <button type="button" class="dm-card-detail-illustration-btn" onclick="openMobileIllustrationPicker()">イラスト変更</button>
    </div>
    ${allowAdd
      ? `<div class="dm-card-detail-actions">
          <input id="mobile-card-detail-count" type="number" min="1" max="4" value="1" class="dm-card-detail-count" />
          <span class="dm-card-detail-count-label">枚</span>
          <button type="button" class="dm-card-detail-add" onclick="addMobileCardFromDetail()">＋ デッキに追加</button>
        </div>`
      : ''}
  `;
}

async function openMobileIllustrationPicker() {
  if (!_mobileDetailCardState) return;

  const modal = ensureMobileIllustrationModal();
  modal.classList.add('open');
  renderMobileIllustrationContent({ loading: true });

  const token = ++_mobileIllustrationRequestToken;
  try {
    const result = await NetworkService.fetchCardIllustrations(_mobileDetailCardState, {
      timeoutMs: 45000
    });
    if (token !== _mobileIllustrationRequestToken) return;

    const options = Array.isArray(result?.options) ? result.options : [];
    _mobileIllustrationOptions = options;
    renderMobileIllustrationContent({
      options,
      selectedArtId: String(_mobileDetailCardState?.selectedArtId || '').trim(),
      selectedImage: getMobileCardImageUrl(_mobileDetailCardState)
    });
  } catch (error) {
    if (token !== _mobileIllustrationRequestToken) return;
    console.error('mobile illustration picker error:', error);
    _mobileIllustrationOptions = [];
    renderMobileIllustrationContent({ error: 'イラスト一覧を取得できませんでした。' });
  }
}

function applyMobileIllustrationFromPicker(index) {
  if (!_mobileDetailCardState) return;

  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;

  const option = _mobileIllustrationOptions[idx];
  if (!option) return;

  const updated = NetworkService.applyCardIllustration(_mobileDetailCardState, option);
  _mobileDetailCardState = updated;
  renderMobileCardDetailContent(updated, { allowAdd: _mobileDetailAllowAdd });

  if (typeof _mobileDetailOnCardChange === 'function') {
    try {
      _mobileDetailOnCardChange(updated);
    } catch (error) {
      console.warn('detail onCardChange error (mobile):', error);
    }
  }

  closeMobileIllustrationModal();
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
  _mobileDetailOnCardChange = typeof opts.onCardChange === 'function' ? opts.onCardChange : null;
  _mobileIllustrationOptions = [];
  closeMobileIllustrationModal();

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
  let raw = decoded;
  try {
    raw = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
  } catch {
    raw = decoded;
  }

  const base = NetworkService.normalizeCardData(raw || {});
  const targetKey = String(base?.cardId || base?.id || '').trim();

  showMobileCardDetail(base, {
    allowAdd: false,
    onCardChange: (nextCard) => {
      if (!targetKey) return;
      const cards = Array.isArray(window._deckCards) ? window._deckCards : [];
      const idx = cards.findIndex((item) => String(item?.cardId || item?.id || '') === targetKey);
      if (idx < 0) return;

      const current = cards[idx] || {};
      const merged = mergeMobileCardIllustration(current, nextCard);
      merged.count = Number(current?.count) || 1;
      cards[idx] = merged;
      window._deckCards = cards;

      sortCurrentMobileDeckCards();
      renderMobileDeckList();
    }
  });
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

function onMobileSearchInput() {
  if (_mobileSearchDebounceTimer) clearTimeout(_mobileSearchDebounceTimer);
  _mobileSearchDebounceTimer = setTimeout(() => {
    const el = document.getElementById('mobile-search-input');
    if (el === null) return;
    mobileSearchCards(el.value);
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

function appendMobileGameLog(msg) {
  const turn = engineMobile?.state?.turn ?? '?';
  _mobileGameLog.push(`T${turn}: ${String(msg || '')}`);
  if (_mobileGameLog.length > 15) _mobileGameLog.shift();
}

function askMobileNumber(label = 'N枚', defaultValue = 3, min = 1, max = 40) {
  return new Promise((resolve) => {
    let modal = document.getElementById('mobile-number-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mobile-number-modal';
      modal.className = 'dm-confirm-modal';
      modal.innerHTML = `
        <div class="dm-confirm-backdrop"></div>
        <div class="dm-confirm-body mobile">
          <div id="mobile-number-label" class="dm-confirm-message"></div>
          <input id="mobile-number-field" class="dm-input-field" type="number" min="1" max="40" autocomplete="off"
            style="text-align:center; font-size:1.5rem; font-weight:700; letter-spacing:0.05em;">
          <div class="dm-confirm-actions">
            <button id="mobile-number-ok" class="dm-confirm-btn ok">決定</button>
            <button id="mobile-number-cancel" class="dm-confirm-btn cancel">キャンセル</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const labelEl = document.getElementById('mobile-number-label');
    const input = document.getElementById('mobile-number-field');
    const okBtn = document.getElementById('mobile-number-ok');
    const cancelBtn = document.getElementById('mobile-number-cancel');
    const backdrop = modal.querySelector('.dm-confirm-backdrop');

    if (!input || !okBtn || !cancelBtn || !backdrop) { resolve(null); return; }

    if (labelEl) labelEl.textContent = label;
    input.min = String(min);
    input.max = String(max);
    input.value = String(defaultValue);

    const close = (result) => {
      modal.classList.remove('open');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      input.onkeydown = null;
      resolve(result);
    };

    const confirm = () => {
      const v = Math.floor(Number(input.value));
      if (!Number.isFinite(v) || v < min || v > max) { input.select(); return; }
      close(v);
    };

    okBtn.onclick = confirm;
    cancelBtn.onclick = () => close(null);
    backdrop.onclick = () => close(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') close(null);
    };

    modal.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

function toggleMobileGameLog() {
  _mobileLogOpen = !_mobileLogOpen;
  const el = document.getElementById('mgLogOverlay');
  if (el) el.classList.toggle('open', _mobileLogOpen);
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
  const myName = window._ol.p === 'p1' ? (window._ol.p1Name || 'Player 1') : (window._ol.p2Name || 'Player 2');
  appendMobileChatMessage(myName, msg, window._ol.p);
  const ok = await NetworkService.sendChat(window._ol.room, window._ol.p, msg);
  if (!ok) {
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
    if (Array.isArray(sourceCard?.underCards) && sourceCard.underCards.length > 0) {
      actions.push({ kind: 'sep' });
      actions.push({ kind: 'viewUnder', label: `下のカードを見る (${sourceCard.underCards.length}枚)` });
    }
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
    if (Array.isArray(sourceCard?.underCards) && sourceCard.underCards.length > 0) {
      actions.push({ kind: 'sep' });
      actions.push({ kind: 'viewUnder', label: `下のカードを見る (${sourceCard.underCards.length}枚)` });
    }
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

function openMobileVsOppZoneMenu(event, zone, idx) {
  _vsOppTargetMobile = true;
  openMobileCardZoneMenu(event, zone, idx);
}

function startMobileVsOppLongPress(event, zone, idx) {
  _vsOppTargetMobile = true;
  startMobileZoneLongPress(event, zone, idx);
}

function onMobileVsOppBoardCardTap(zone, idx) {
  const vs = window._vs;
  if (!vs) return;
  const saved = _mobileZoneMenuState;
  _mobileZoneMenuState = { sourceZone: zone, sourceIndex: idx, targetEngine: getVsOppEngineMobile() };
  tapMobileCard(zone, idx);
  if (_mobileZoneMenuState) _mobileZoneMenuState = saved;
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
    ? window.GameController.moveCardBetweenZones(_engM(), fromZone, fromIndex, toZone, options)
    : _engM().moveCardBetweenZones(fromZone, fromIndex, toZone, options);
  if (!ok) {
    showMobileToast('カード移動に失敗しました', 'warn');
    return;
  }

  const fromLabel = getMobileZoneLabel(fromZone);
  const toLabel = getMobileZoneLabel(toZone);
  appendMobileGameLog(`${fromLabel} → ${toLabel}`);
  if (window._ol) olSendActionMobile('state');
  if (window._vs) _vsRefreshOpponentViewMobile();
  renderMobileGame();
}

function resolveMobileRevealedToHand(index) {
  const idx = Number(index);
  const zone = engineMobile?.state?.revealedZone;
  if (!Array.isArray(zone) || !zone[idx]) {
    showMobileToast('対象カードが見つかりません', 'warn');
    return;
  }
  moveMobileCardBetweenZones('revealedZone', idx, 'hand', 'top');
}

function useMobileRevealedAsTrigger(index) {
  const idx = Number(index);
  const zone = engineMobile?.state?.revealedZone;
  if (!Array.isArray(zone) || !zone[idx]) {
    showMobileToast('対象カードが見つかりません', 'warn');
    return;
  }
  moveMobileCardBetweenZones('revealedZone', idx, 'graveyard', 'top');
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

  const cards = _engM()?.state?.[zone];
  const card = Array.isArray(cards) ? cards[idx] : null;
  if (!card) return;

  const nextTapped = !!tapped;
  const ok = window.GameController?.setCardTapped
    ? window.GameController.setCardTapped(_engM(), zone, idx, nextTapped)
    : ((!!card.tapped === nextTapped) ? true : _engM().tapCard(zone, idx));
  if (!ok) {
    showMobileToast('タップ状態を変更できませんでした', 'warn');
    return;
  }

  if (window._ol) olSendActionMobile('state');
  if (window._vs) _vsRefreshOpponentViewMobile();
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

  const zoneKey = sourceZone;
  const zoneIdx = idx;
  showMobileCardDetail(card, {
    allowAdd: false,
    onCardChange: (nextCard) => {
      const zoneCards = engineMobile?.state?.[zoneKey];
      if (!Array.isArray(zoneCards) || !zoneCards[zoneIdx]) return;

      const current = zoneCards[zoneIdx];
      zoneCards[zoneIdx] = mergeMobileCardIllustration(current, nextCard);

      if (window._ol) olSendActionMobile('state');
      renderMobileGame();
    }
  });
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

function openMobileHandDiscardMenu() {
  if (!window._ol) return;
  if (!canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }
  const opp = window._olOpponent;
  if (!opp || (opp.hand || 0) <= 0) {
    showMobileToast('相手の手札がありません', 'warn');
    return;
  }
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  _handDiscardStateMobile = { mode: 'selecting' };
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.add('mobile');
  document.getElementById('dmHandDiscardTitle').textContent = 'ハンデス';
  document.getElementById('dmHandDiscardContent').innerHTML = `
    <div class="dm-hd-mode-btns">
      <button class="dm-hd-btn" onclick="startHandRevealMobile()">手札を見て選ぶ</button>
      <button class="dm-hd-btn" onclick="startRandomDiscardMobile()">ランダムに1枚</button>
    </div>
  `;
  el.classList.add('open');
}

function startHandRevealMobile() {
  closeHandDiscardModal();
  _handDiscardStateMobile = { mode: 'waiting' };
  sendHandActionMobile('hand_reveal_request', {});
  showMobileToast('相手の手札データを要求しました...', 'info');
}

function startRandomDiscardMobile() {
  closeHandDiscardModal();
  sendHandActionMobile('discard_random', {});
  showMobileToast('ランダム捨て要求を送信しました', 'info');
}

function openMobileHandSelectModal(cards) {
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  _handDiscardStateMobile = { mode: 'selecting_card', cards };
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.add('mobile');
  document.getElementById('dmHandDiscardTitle').textContent = `相手の手札 (${cards.length}枚) - 捨てるカードを選択`;
  const getCiv = (card) => {
    const c = String(card?.civ || '').toLowerCase();
    if (c.includes('fire') || c.includes('火')) return 'fire';
    if (c.includes('water') || c.includes('水')) return 'water';
    if (c.includes('light') || c.includes('光')) return 'light';
    if (c.includes('darkness') || c.includes('dark') || c.includes('闇')) return 'dark';
    if (c.includes('nature') || c.includes('自然')) return 'nature';
    return 'multi';
  };
  document.getElementById('dmHandDiscardContent').innerHTML = `
    <div class="dm-hd-card-list">
      ${cards.map((c, i) => `
        <div class="dm-hd-card ${getCiv(c)}" onclick="selectHandCardMobile(${i})">
          ${c.imgUrl
            ? `<img src="${escapeHtmlMobile(c.imgUrl)}" alt="${escapeHtmlMobile(c.name || 'CARD')}" class="dm-hd-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="dm-hd-card-text"${c.imgUrl ? ' style="display:none"' : ''}>
            <div class="dm-hd-card-cost">${escapeHtmlMobile(String(c.cost ?? '-'))}</div>
            <div class="dm-hd-card-name">${escapeHtmlMobile(c.name || 'CARD')}</div>
            ${c.power ? `<div class="dm-hd-card-power">P${escapeHtmlMobile(String(c.power))}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="text-align:center;margin-top:8px">
      <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">キャンセル</button>
    </div>
  `;
  el.classList.add('open');
}

function selectHandCardMobile(index) {
  if (!_handDiscardStateMobile?.cards) return;
  const card = _handDiscardStateMobile.cards[index];
  if (!card) return;
  closeHandDiscardModal();
  sendHandActionMobile('discard_select', { cardName: card.name });
  showMobileToast(`「${card.name}」を捨てるよう要求しました`, 'info');
}

function openMobileDiscardConfirmModal(cardName, isRandom) {
  const hand = engineMobile?.state?.hand || [];
  if (!hand.length) {
    showMobileToast('手札がありません', 'warn');
    return;
  }
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.add('mobile');
  let targetIndex = -1;
  let displayName = '';
  if (isRandom) {
    targetIndex = Math.floor(Math.random() * hand.length);
    displayName = hand[targetIndex]?.name || 'CARD';
    document.getElementById('dmHandDiscardTitle').textContent = 'ランダム捨て要求';
    document.getElementById('dmHandDiscardContent').innerHTML = `
      <div class="dm-hd-confirm-msg">相手からランダムに1枚捨てるよう要求されています。</div>
      <div class="dm-hd-confirm-card">${escapeHtmlMobile(displayName)}</div>
      <div class="dm-hd-confirm-btns">
        <button class="dm-hd-btn ok" onclick="executeMobileDiscard(${targetIndex})">承認して捨てる</button>
        <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">却下</button>
      </div>
    `;
  } else {
    targetIndex = hand.findIndex(c => c?.name === cardName);
    if (targetIndex === -1) {
      showMobileToast(`「${cardName}」は手札にありません`, 'warn');
      return;
    }
    displayName = cardName;
    document.getElementById('dmHandDiscardTitle').textContent = '捨て要求';
    document.getElementById('dmHandDiscardContent').innerHTML = `
      <div class="dm-hd-confirm-msg">相手から次のカードを捨てるよう要求されています。</div>
      <div class="dm-hd-confirm-card">${escapeHtmlMobile(displayName)}</div>
      <div class="dm-hd-confirm-btns">
        <button class="dm-hd-btn ok" onclick="executeMobileDiscard(${targetIndex})">承認して捨てる</button>
        <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">却下</button>
      </div>
    `;
  }
  _handDiscardStateMobile = { mode: 'confirm', targetIndex };
  el.classList.add('open');
}

function executeMobileDiscard(index) {
  closeHandDiscardModal();
  const hand = engineMobile?.state?.hand;
  if (!Array.isArray(hand) || index < 0 || index >= hand.length) {
    showMobileToast('対象カードが見つかりません', 'warn');
    return;
  }
  if (typeof engineMobile._saveState === 'function') engineMobile._saveState();
  const removed = hand.splice(index, 1);
  if (!removed.length) return;
  const card = removed[0];
  if (!engineMobile.state.graveyard) engineMobile.state.graveyard = [];
  engineMobile.state.graveyard.unshift(card);
  showMobileToast(`「${card?.name || 'CARD'}」を墓地に送りました`, 'info');
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function openMobileUnderCardsModal(zone, idx) {
  closeMobileCardZoneMenu();
  window._underModalState = { zone: zone, idx: idx, isMobile: true };
  if (typeof renderUnderCardsModal === 'function') renderUnderCardsModal();
  const bodyEl = document.getElementById('dmUnderBody');
  if (bodyEl) bodyEl.classList.add('mobile');
  const el = document.getElementById('dmUnderModal');
  if (el) el.classList.add('open');
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

  const targetEngine = _vsOppTargetMobile ? getVsOppEngineMobile() : null;
  _vsOppTargetMobile = false;
  const activeEng = targetEngine || engineMobile;

  const source = activeEng.state[sourceZone];
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

  _mobileZoneMenuState = { sourceZone, sourceIndex: idx, targetEngine };

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

    if (action.kind === 'viewUnder') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openMobileUnderCardsModal('${sourceZone}', ${idx}); closeMobileCardZoneMenu()">
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
  if (screen.orientation && typeof screen.orientation.unlock === 'function') {
    try { screen.orientation.unlock(); } catch(e) {}
  }
  closeMobileCardZoneMenu();
  closeMobileDeckRevealModal();
  closeMobileDeckAllModal();
  _mobileUnderInsertState = null;
  if (window._vs) { window._vs = null; window._olOpponent = null; }
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
  const canBulkCloudRestore = !!(account && !account.isGuest && account.pin && localDeckNames.length > 0);
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

      const thumb = renderMobileCardThumb(card, 'ml-deck-thumb');
      const payload = escapeAttrJsMobile(encodeURIComponent(JSON.stringify(card)));
      return `
        <div class="ml-deck-tile" onclick="openMobileDeckCardDetail('${payload}')">
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
          <button type="button" onclick="restoreAllMobileLocalDecksToCloud()" ${canBulkCloudRestore ? '' : 'disabled'} class="ml-top-btn save ${canBulkCloudRestore ? '' : 'disabled'}">復元</button>
          <button type="button" onclick="playMobileDeckGame()" ${canPlaySelectedDeck ? '' : 'disabled'} class="ml-top-btn play ${canPlaySelectedDeck ? '' : 'disabled'}">一人回し</button>
          <button type="button" onclick="openMobileVsSetup()" ${canPlaySelectedDeck ? '' : 'disabled'} class="ml-top-btn play ${canPlaySelectedDeck ? '' : 'disabled'}">疑似対戦</button>
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
            oninput="onMobileSearchInput()">
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
      const normalizedItems = pageItems.map(c => NetworkService.normalizeCardData(c));
      // 非同期処理中にキーワードが変わっていたら破棄
      if (_mobileSearchState.query !== keyword) return;
      _mobileSearchState.page = 1;
      _mobileSearchState.items = normalizedItems;
      _mobileSearchState.hasMore = pageItems.length >= 20;
    } finally {
      if (_mobileSearchState.query === keyword) {
        _mobileSearchState.loading = false;
      }
    }

    renderMobileSearchResults();
    _kickMobileSearchHydrate(keyword, _mobileSearchState.items);
    return;
  }

  if (!_mobileSearchController) {
    _mobileSearchController = window.GameController.createSearchController({
      searchFn: (kw, page) => NetworkService.searchCards(kw, page),
      pageSize: 20
    });
  }

  if (!_mobileSearchController) return;

  const container = document.getElementById('mobile-search-results');
  if (!container) return;

  const keyword = String(q || '').trim();
  if (!keyword) {
    _mobileSearchState = { query: '', page: 0, items: [], hasMore: false, loading: false };
    container.innerHTML = '';
    return;
  }

  // ローディング表示（即時フィードバック）
  _mobileSearchState = { ..._mobileSearchState, query: keyword, loading: true };
  renderMobileSearchResults();

  _mobileSearchState = await _mobileSearchController.search(q);

  if (!_mobileSearchState.query) {
    container.innerHTML = '';
    return;
  }

  renderMobileSearchResults();
  _kickMobileSearchHydrate(keyword, _mobileSearchState.items);
}

async function mobileSearchMore() {
  if (!window.GameController) {
    if (!_mobileSearchState.query || _mobileSearchState.loading || !_mobileSearchState.hasMore) return;
    const queryAtStart = _mobileSearchState.query;
    _mobileSearchState.loading = true;
    const nextPage = _mobileSearchState.page + 1;
    try {
      const results = await NetworkService.searchCards(queryAtStart, nextPage);
      const pageItems = Array.isArray(results) ? results.slice(0, 20) : [];
      const normalizedItems = pageItems.map(c => NetworkService.normalizeCardData(c));
      // 非同期処理中にキーワードが変わっていたら破棄
      if (_mobileSearchState.query !== queryAtStart) return;
      _mobileSearchState.page = nextPage;
      _mobileSearchState.items = [..._mobileSearchState.items, ...normalizedItems];
      _mobileSearchState.hasMore = pageItems.length >= 20;
    } finally {
      if (_mobileSearchState.query === queryAtStart) _mobileSearchState.loading = false;
    }
    renderMobileSearchResults();
    _kickMobileSearchHydrate(queryAtStart, _mobileSearchState.items);
    return;
  }

  if (!_mobileSearchController || !_mobileSearchState.query || _mobileSearchState.loading || !_mobileSearchState.hasMore) return;

  _mobileSearchState = await _mobileSearchController.searchMore();

  renderMobileSearchResults();
  _kickMobileSearchHydrate(_mobileSearchState.query, _mobileSearchState.items);
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

/**
 * 検索結果のサムネイルをバックグラウンドで取得し、DOMを逐次更新する（2フェーズ描画）。
 * @param {string} keyword 起動時のキーワード（変わったらキャンセル）
 * @param {Array} items hydrate対象カード一覧
 */
async function _kickMobileSearchHydrate(keyword, items) {
  const token = {};
  _mobileSearchHydrateToken = token;

  const sourceItems = Array.isArray(items) ? items : [];
  const needHydration = sourceItems.filter(card => {
    if (getMobileCardImageUrl(card)) return false;
    const key = getMobileSearchHydrateKey(card);
    return !shouldSkipMobileSearchHydrate(key);
  });

  const BATCH = 5;
  for (let i = 0; i < needHydration.length; i += BATCH) {
    if (_mobileSearchHydrateToken !== token) return;
    if (_mobileSearchState.query !== keyword) return;
    const batch = needHydration.slice(i, i + BATCH);
    await Promise.all(batch.map(async (card) => {
      const key = getMobileSearchHydrateKey(card);
      try {
        const enriched = await NetworkService.enrichCardImage(card, { retries: 1, retryDelayMs: 300 });
        const normalized = NetworkService.normalizeCardData(enriched);
        const url = getMobileCardImageUrl(normalized);
        if (url) {
          if (key) _mobileSearchHydrateCooldownUntil.delete(key);
          try { _patchMobileSearchCardImage(key, url); } catch { /* DOM再描画済みは無視 */ }
        } else {
          if (key) markMobileSearchHydrateCooldown(key, MOBILE_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS);
        }
      } catch {
        if (key) markMobileSearchHydrateCooldown(key, MOBILE_SEARCH_HYDRATE_ERROR_COOLDOWN_MS);
      }
    }));
  }
}

function _patchMobileSearchCardImage(hydrateKey, imageUrl) {
  if (!hydrateKey || !imageUrl) return;
  const container = document.getElementById('mobile-search-results');
  if (!container) return;
  const item = container.querySelector(`[data-hydrate-id="${CSS.escape(hydrateKey)}"]`);
  if (!item) return;
  const existing = item.querySelector('.ml-search-thumb');
  if (!existing) return;
  try {
    if (existing.tagName === 'DIV') {
      // placeholder → img に差し替え
      const parent = existing.parentNode;
      if (!parent) return;
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = existing.textContent || '';
      img.className = 'ml-search-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = function() { handleMobileCardImageError(this); };
      parent.replaceChild(img, existing);
    } else if (existing.tagName === 'IMG') {
      existing.src = imageUrl;
    }
  } catch {
    // DOM再描画済みの場合はスキップ
  }
}

function renderMobileSearchResults() {
  const container = document.getElementById('mobile-search-results');
  if (!container) return;

  if (_mobileSearchState.loading) {
    container.innerHTML = '<div class="ml-search-empty">検索中...</div>';
    return;
  }

  const cards = _mobileSearchState.items || [];
  if (!cards.length) {
    container.innerHTML = '<div class="ml-search-empty">検索結果なし</div>';
    return;
  }

  const rows = cards.map(card => {
    const payload = encodeURIComponent(JSON.stringify(card));
    const cost = getMobileCardCostLabel(card);
    const cardName = getMobileCardDisplayName(card);
    const thumb = renderMobileCardThumb(card);
    const hydrateKey = getMobileSearchHydrateKey(card);
    return `
      <div class="ml-search-item"${hydrateKey ? ` data-hydrate-id="${escapeHtmlMobile(hydrateKey)}"` : ''}>
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
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('landscape').catch(() => {});
  }
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
  const vs = window._vs;
  const olEff = ol || (vs ? { p: vs.activePlayer, p1Name: `P1 (${vs.p1DeckName})`, p2Name: `P2 (${vs.p2DeckName})` } : null);
  const opp = window._olOpponent || {};
  const myNum = olEff ? (olEff.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = ol ? (window._olCurrentPlayer && window._olCurrentPlayer === myNum) : !!vs;
  const headerTurnClass = olEff ? (isMyTurn ? 'mine-turn' : 'opponent-turn') : 'solo-turn';
  const myName = olEff ? (olEff.p === 'p1' ? (olEff.p1Name || 'Player 1') : (olEff.p2Name || 'Player 2')) : '自分';
  const oppName = olEff ? (olEff.p === 'p1' ? (olEff.p2Name || 'Player 2') : (olEff.p1Name || 'Player 1')) : '相手';
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

  const renderChip = (card, zoneClass, idx = -1, extra = '') => {
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
    const isVsOpp = extra === 'vs-opp';
    const canMenu = idx >= 0 && !!sourceZone;
    const isOwnBoardCard = !isVsOpp && idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isVsOppBoardCard = isVsOpp && idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isUnderSource = !!_mobileUnderInsertState
      && _mobileUnderInsertState.fromZone === sourceZone
      && _mobileUnderInsertState.fromIndex === idx;

    const chipClasses = [
      'mg-card-chip',
      zoneClass,
      tapped,
      isVsOpp ? 'opponent' : '',
      imageUrl ? 'has-image' : '',
      underCount > 0 ? 'has-under' : '',
      _mobileUnderInsertState && isOwnBoardCard ? 'stack-target' : '',
      isUnderSource ? 'under-source' : ''
    ].filter(Boolean).join(' ');

    const onclick = isOwnBoardCard
      ? `onclick="onMobileBoardCardTap('${sourceZone}', ${idx})"`
      : (isVsOppBoardCard ? `onclick="onMobileVsOppBoardCardTap('${sourceZone}', ${idx})"` : '');
    const menuAttrs = canMenu
      ? (isVsOpp
        ? `oncontextmenu="openMobileVsOppZoneMenu(event, '${sourceZone}', ${idx})"
          ontouchstart="startMobileVsOppLongPress(event, '${sourceZone}', ${idx})"
          ontouchend="cancelMobileZoneLongPress()"
          ontouchmove="cancelMobileZoneLongPress()"
          ontouchcancel="cancelMobileZoneLongPress()"`
        : `oncontextmenu="openMobileCardZoneMenu(event, '${sourceZone}', ${idx})"
          ontouchstart="startMobileZoneLongPress(event, '${sourceZone}', ${idx})"
          ontouchend="cancelMobileZoneLongPress()"
          ontouchmove="cancelMobileZoneLongPress()"
          ontouchcancel="cancelMobileZoneLongPress()"`)
      : '';

    const directUnderCount = Array.isArray(card?.underCards) ? Math.min(card.underCards.length, 3) : 0;
    const tapBtnHtml = isOwnBoardCard
      ? `<button class="mg-tap-btn" ontouchstart="event.stopPropagation()" ontouchend="event.stopPropagation(); tapMobileCard('${sourceZone}', ${idx})" onclick="event.stopPropagation(); tapMobileCard('${sourceZone}', ${idx})" title="タップ/アンタップ">↻</button>`
      : isVsOppBoardCard
        ? `<button class="mg-tap-btn" ontouchstart="event.stopPropagation()" ontouchend="event.stopPropagation(); onMobileVsOppBoardCardTap('${sourceZone}', ${idx})" onclick="event.stopPropagation(); onMobileVsOppBoardCardTap('${sourceZone}', ${idx})" title="タップ/アンタップ">↻</button>`
        : '';
    return `
      <div class="${chipClasses}" ${onclick} ${menuAttrs} title="${escapeHtmlMobile(card?.name || '')}"${directUnderCount > 0 ? ` style="margin-left:${directUnderCount * 5}px"` : ''}>
        ${underCount > 0 ? renderMobileUnderPeekLayers(card) : ''}
        ${imageUrl
          ? `<img src="${escapeHtmlMobile(imageUrl)}" alt="${escapeHtmlMobile(card?.name || 'CARD')}" class="mg-card-chip-img" loading="lazy" decoding="async" onerror="handleMobileCardImageError(this)">`
          : `<div class="mg-card-cost">${escapeHtmlMobile(String(cost))}</div>
        <div class="mg-card-name">${escapeHtmlMobile(shortName)}</div>
        <div class="mg-card-power">${escapeHtmlMobile(power)}</div>`}
        ${tapBtnHtml}
      </div>
    `;
  };
  
  // Build HTML sections
  const myNum2 = olEff?.p === 'p1' ? 1 : 2;
  const isMyTurnLS = !olEff || (vs ? true : window._olCurrentPlayer === myNum2);

  const oppHandCount = opp.hand || 0;
  const oppHandHTML = olEff
    ? (vs
        ? (opp.handCards || []).map((c, i) => renderChip(c, 'hand', i, 'vs-opp')).join('')
        : Array.from({length: Math.min(oppHandCount, 20)}).map(() =>
            `<div class="mg-card-chip back"></div>`
          ).join('') + (oppHandCount > 20 ? `<span style="color:#ccc;font-size:0.55rem">+${oppHandCount-20}</span>` : ''))
    : '';

  const oppShields = typeof opp.shields === 'number' ? opp.shields : (Array.isArray(opp.shields) ? opp.shields.length : 0);
  const oppShieldHTML = olEff
    ? Array.from({length: oppShields}).map(() => `<div class="mg-card-chip shield back"></div>`).join('')
    : '';

  const oppBZArr = Array.isArray(opp.battleZone) ? opp.battleZone : [];
  const oppManaArr = Array.isArray(opp.manaZone) ? opp.manaZone : [];
  const oppBZHTML = olEff ? oppBZArr.map((c, i) => renderChip(c, 'battle', vs ? i : -1, vs ? 'vs-opp' : '')).join('') : '';
  const oppManaHTML = olEff ? oppManaArr.map((c, i) => renderChip(c, 'mana', vs ? i : -1, vs ? 'vs-opp' : '')).join('') : '';
  const oppDeckCount = typeof opp.deck === 'number' ? opp.deck : '?';
  const oppGraveCount = typeof opp.graveyard === 'number' ? opp.graveyard : (Array.isArray(opp.graveyard) ? opp.graveyard.length : 0);

  const myBZHTML = state.battleZone.map((c, i) => renderChip(c, 'battle', i)).join('');
  const myManaHTML = state.manaZone.map((c, i) => renderChip(c, 'mana', i)).join('');
  const myShieldHTML = state.shields.map((s, i) => {
    const sel = _mobileSelectedShieldIdx === i ? 'selected' : '';
    return renderChip(s, `shield ${sel}`, i);
  }).join('');

  // Hand grouping with stacking
  const handGroups = [];
  const handSeen = {};
  state.hand.forEach((c, i) => {
    const key = String(c?.name || `idx_${i}`);
    if (handSeen[key] !== undefined) { handGroups[handSeen[key]].count++; }
    else { handSeen[key] = handGroups.length; handGroups.push({ card: c, firstIdx: i, count: 1 }); }
  });
  const myHandHTML = handGroups.map(({ card: c, firstIdx: i, count }) => {
    const layerCount = Math.min(count - 1, 4);
    const layers = count > 1 ? Array.from({length: layerCount}).map((_, li) =>
      `<div class="mg-hand-stack-layer" style="left:-${(li+1)*5}px"></div>`).join('') : '';
    const directUnder = Array.isArray(c?.underCards) ? Math.min(c.underCards.length, 3) : 0;
    const ml = ((count > 1 ? layerCount : 0) + directUnder) * 5;
    const imgUrl = getMobileCardImageUrl(c);
    return `<div class="mg-card-chip hand ${count > 1 ? 'stacked' : ''}"
      ${ml > 0 ? `style="margin-left:${ml}px"` : ''}
      onclick="openMobileHandActionSheet(${i})"
      oncontextmenu="openMobileCardZoneMenu(event,'hand',${i})"
      ontouchstart="startMobileZoneLongPress(event,'hand',${i})"
      ontouchend="cancelMobileZoneLongPress()"
      ontouchmove="cancelMobileZoneLongPress()"
      ontouchcancel="cancelMobileZoneLongPress()"
      title="${escapeHtmlMobile(c?.name||'')}">
      ${layers}
      ${count > 1 ? `<div class="mg-hand-stack-count">x${count}</div>` : ''}
      ${renderMobileUnderPeekLayers(c)}
      ${imgUrl
        ? `<img src="${escapeHtmlMobile(imgUrl)}" alt="${escapeHtmlMobile(c?.name||'')}" class="mg-card-chip-img" loading="lazy" decoding="async" onerror="handleMobileCardImageError(this)">`
        : `<div class="mg-card-cost">${escapeHtmlMobile(String(Number.isFinite(Number(c?.cost)) ? c.cost : '-'))}</div>
           <div class="mg-card-name">${escapeHtmlMobile(getMobileCardShortName(c?.name, 8))}</div>
           <div class="mg-card-power">${escapeHtmlMobile(c?.power ? String(c.power) : '')}</div>`}
    </div>`;
  }).join('');

  const hasRevealed = state.revealedZone.length > 0;
  const revealedHTML = state.revealedZone.map((c, i) => `
    <div class="mg-ls-revealed-wrap">
      ${renderChip(c, 'revealed', i)}
      <div style="display:flex;gap:1px;margin-top:1px">
        <button class="mg-ls-rev-act" onclick="moveMobileCardBetweenZones('revealedZone',${i},'hand','top')">手</button>
        <button class="mg-ls-rev-act" onclick="moveMobileCardBetweenZones('revealedZone',${i},'battleZone','top')">BZ</button>
        <button class="mg-ls-rev-act red" onclick="moveMobileCardBetweenZones('revealedZone',${i},'graveyard','top')">墓</button>
      </div>
    </div>`).join('');

  const deckTopActions = `oncontextmenu="openMobileCardZoneMenu(event,'deck',0)"
    ontouchstart="startMobileZoneLongPress(event,'deck',0)"
    ontouchend="cancelMobileZoneLongPress()"
    ontouchmove="cancelMobileZoneLongPress()"
    ontouchcancel="cancelMobileZoneLongPress()"`;

  const oppRows = olEff ? `
    <div class="mg-ls-row opp-hand">
      <div class="mg-ls-zone-cards">${oppHandHTML}</div>
    </div>
    <div class="mg-ls-row opp-mana">
      <div class="mg-ls-zone-cards">${oppManaHTML}</div>
      <div class="mg-ls-pile opp-grave">
        <span class="mg-ls-pile-cnt">${oppGraveCount}</span>
      </div>
    </div>
    <div class="mg-ls-row opp-shield">
      <div class="mg-ls-zone-cards">${oppShieldHTML}</div>
      <div class="mg-ls-pile opp-deck">
        <span class="mg-ls-pile-cnt">${oppDeckCount}</span>
      </div>
    </div>
    <div class="mg-ls-row opp-bz">
      <div class="mg-ls-zone-cards">${oppBZHTML}</div>
    </div>
    <div class="mg-ls-sep"></div>
  ` : '';

  const ribbonExtra = _mobileRibbonOtherOpen ? `
    <div class="mg-ribbon-extra">
      <button class="mg-rbn-btn" onclick="moveMobileDeckTopTo('manaZone')">トップ→マナ</button>
      <button class="mg-rbn-btn" onclick="moveMobileDeckTopTo('graveyard')">トップ→墓地</button>
      <button class="mg-rbn-btn" onclick="moveMobileDeckTopTo('shields')">トップ→シールド</button>
      <button class="mg-rbn-btn" onclick="untapAllMobileMana()">マナ全アンタップ</button>
      <button class="mg-rbn-btn" onclick="drawMobileDeckCardsToPublic()">N枚表向き</button>
      <button class="mg-rbn-btn" onclick="drawMobileDeckCardsToPrivate()">N枚見る</button>
      <button class="mg-rbn-btn" onclick="openMobileDeckAllModal()">山札全部見る</button>
      <button class="mg-rbn-btn" onclick="breakMobileShield()">シールド破壊${_mobileSelectedShieldIdx !== null ? ` (${_mobileSelectedShieldIdx + 1})` : ''}</button>
      <button class="mg-rbn-btn" onclick="returnMobileFromGraveyard('hand')">墓地→手札</button>
      ${window._ol ? `<button class="mg-rbn-btn" onclick="openMobileHandDiscardMenu()">ハンデス</button>` : ''}
      ${!window._ol && !vs ? `<button class="mg-rbn-btn" onclick="undoMobileGame()">やり直し</button>` : ''}
      <button class="mg-rbn-btn" onclick="renderMobileDeckList()">戻る</button>
    </div>
  ` : '';

  const zoneMenuOpen = _mobileZoneMenuState !== null;

  // Hand sheet content
  const selCard = _mobileSelectedHandIdx !== null ? state.hand[_mobileSelectedHandIdx] : null;
  const handSheetContent = selCard ? `
    <div class="mg-sheet-title">${escapeHtmlMobile(selCard?.name || 'CARD')}</div>
    <div class="mg-sheet-btns">
      <button class="mg-sheet-btn battle" onclick="playMobileSelectedCard('battle')">BZへ出す</button>
      <button class="mg-sheet-btn mana" onclick="playMobileSelectedCard('mana')">マナに置く</button>
      <button class="mg-sheet-btn shield" onclick="playMobileHandCardTo('shields','top')">シールドへ</button>
      <button class="mg-sheet-btn deck" onclick="playMobileHandCardTo('deck','top')">デッキトップへ</button>
      <button class="mg-sheet-btn deck" onclick="playMobileHandCardTo('deck','bottom')">デッキボトムへ</button>
      <button class="mg-sheet-btn grave" onclick="playMobileHandCardTo('graveyard','top')">墓地へ</button>
      <button class="mg-sheet-btn detail" onclick="openMobileHandCardDetail()">カード詳細</button>
      <button class="mg-sheet-btn close" onclick="closeMobileHandSheet()">閉じる</button>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="mg-root ls-active">
      <div class="mg-portrait-warn">端末を横向きにしてください</div>

      <div class="mg-ls-board">
        ${oppRows}
        <div class="mg-ls-row my-bz">
          <div class="mg-ls-zone-cards">${myBZHTML}</div>
        </div>
        ${hasRevealed ? `<div class="mg-ls-row my-revealed"><div class="mg-ls-zone-cards">${revealedHTML}</div></div>` : ''}
        <div class="mg-ls-row my-shield">
          <div class="mg-ls-zone-cards">${myShieldHTML}</div>
          <div class="mg-ls-pile deck" ${deckTopActions}>
            <span class="mg-ls-pile-cnt">${state.deck.length}</span>
          </div>
        </div>
        <div class="mg-ls-row my-mana">
          <div class="mg-ls-zone-cards">${myManaHTML}</div>
          <div class="mg-ls-pile grave" onclick="openMobileGraveyardModal()">
            <span class="mg-ls-pile-cnt">${state.graveyard.length}</span>
          </div>
        </div>
        <div class="mg-ls-row my-hand">
          <div class="mg-ls-zone-cards">${myHandHTML}</div>
        </div>
      </div>

      <div class="mg-ribbon">
        <div class="mg-ribbon-main">
          <button class="mg-rbn-btn ${_mobileNeedDrawGuide ? 'guide' : ''}" onclick="drawMobileCard()">ドロー</button>
          <button class="mg-rbn-btn end" onclick="turnMobileEnd()">ターンエンド</button>
          ${olEff ? `<span class="mg-turn-badge ${isMyTurnLS ? 'mine' : 'opp'}">${isMyTurnLS ? '自分のターン' : '相手のターン'}</span>` : ''}
          <button class="mg-rbn-btn" onclick="toggleMobileRibbonOther()">${_mobileRibbonOtherOpen ? '▲' : '▼ その他'}</button>
          <button class="mg-rbn-btn log" onclick="toggleMobileGameLog()">ログ</button>
        </div>
        ${ribbonExtra}
      </div>

      <div class="mg-log-overlay" id="mgLogOverlay">
        ${_mobileGameLog.slice().reverse().map(e => `<div class="mg-log-entry">${escapeHtmlMobile(e)}</div>`).join('')}
      </div>

      <div class="mg-zone-menu-modal ${zoneMenuOpen ? 'open' : ''}" id="mgZoneMenuModal">
        <div class="mg-zone-menu-backdrop" onclick="closeMobileCardZoneMenu()"></div>
        <div class="mg-zone-menu-sheet" id="mgZoneMenuSheet"></div>
      </div>

      <div class="mg-sheet-backdrop ${_mobileSelectedHandIdx !== null ? 'open' : ''}" onclick="closeMobileHandSheet()"></div>
      <div class="mg-hand-sheet ${_mobileSelectedHandIdx !== null ? 'open' : ''}" id="mgHandSheet">
        ${handSheetContent}
      </div>

      ${window._ol ? `
      <div class="mg-chat-wrap">
        <button class="mg-chat-toggle" onclick="toggleMobileChatPanel()">${_mobileChatOpen ? '✕' : 'チャット'}</button>
        <div class="mg-chat-panel ${_mobileChatOpen ? 'open' : ''}">
          <div class="mg-chat-log" id="mgChatLog">
            ${(window._olChatLogMobile || []).map(m =>
              `<div class="mg-chat-msg ${m.p === window._ol?.p ? 'mine' : (m.p === 'sys' ? 'sys' : 'opp')}">
                <span class="mg-chat-name">${escapeHtmlMobile(m.name)}</span>
                <span class="mg-chat-text">${escapeHtmlMobile(m.msg)}</span>
              </div>`
            ).join('')}
          </div>
          <div class="mg-chat-input-row">
            <input id="mgChatInput" class="mg-chat-input" type="text" placeholder="メッセージ..." maxlength="100">
            <button class="mg-chat-send" onclick="sendMobileChat()">送信</button>
          </div>
        </div>
      </div>
      ` : ''}
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
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item">
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

async function drawMobileDeckCardsToPublic() {
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

  const n = await askMobileNumber('何枚表向きにする？', _mobileDeckNValue, 1, 40);
  if (n === null) return;
  _mobileDeckNValue = n;

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

  appendMobileGameLog(`山札から${moved.length}枚表向き公開`);
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
  openMobileDeckRevealModal('public');
}

async function drawMobileDeckCardsToPrivate() {
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

  const n = await askMobileNumber('何枚確認する？', _mobileDeckNValue, 1, 40);
  if (n === null) return;
  _mobileDeckNValue = n;

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

function playMobileHandCardTo(toZone, position = 'top') {
  const idx = _mobileSelectedHandIdx;
  if (idx === null) return;
  if (window._ol && !canActMobileOnline()) {
    showMobileToast('相手のターンです', 'warn');
    return;
  }
  _mobileSelectedHandIdx = null;
  moveMobileCardBetweenZones('hand', idx, toZone, position);
}

function openMobileHandCardDetail() {
  const idx = _mobileSelectedHandIdx;
  if (idx === null) return;
  closeMobileHandSheet();
  openMobileCardDetailFromZone('hand', idx);
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
    ? window.GameController.tapCard(_engM(), zone, idx)
    : _engM().tapCard(zone, idx);
  if (!ok) return;
  if (window._ol) olSendActionMobile('state');
  if (window._vs) _vsRefreshOpponentViewMobile();
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
  appendMobileGameLog('シールドブレイク');
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
  appendMobileGameLog('ドロー');
  if (window._ol) olSendActionMobile('state');
  renderMobileGame();
}

function turnMobileEnd() {
  if (window._vs) {
    _vsTurnEndMobile();
    return;
  }
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
  appendMobileGameLog('ターン終了');
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
    if (Array.isArray(names)) {
      if (window.AppState) {
        window.AppState.set('_serverDeckNames', names);
      } else {
        window._serverDeckNames = names;
      }
    } else {
      showMobileToast('クラウド一覧の更新に失敗しました（ローカル表示は維持）', 'warn');
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

    const account = AuthService.getCurrentAccount();
    if (account && !account.isGuest && account.pin) {
      // ログイン中はクラウドを優先、失敗時にローカルへフォールバック
      const remoteDeck = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
      if (Array.isArray(remoteDeck) && remoteDeck.length > 0) {
        cards = remoteDeck.map(card => NetworkService.normalizeCardData(card));
      } else if (Array.isArray(savedDecks[deckName])) {
        cards = JSON.parse(JSON.stringify(savedDecks[deckName])).map(card => NetworkService.normalizeCardData(card));
      }
    } else if (Array.isArray(savedDecks[deckName])) {
      cards = JSON.parse(JSON.stringify(savedDecks[deckName])).map(card => NetworkService.normalizeCardData(card));
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

async function restoreAllMobileLocalDecksToCloud() {
  const account = AuthService.getCurrentAccount();
  if (!account || account.isGuest || !account.pin) {
    showMobileToast('復元にはPINログインが必要です', 'warn');
    return;
  }

  const savedDecks = getSavedDecksMobile();
  const deckNames = Object.keys(savedDecks).filter((name) => Array.isArray(savedDecks[name]));
  if (!deckNames.length) {
    showMobileToast('ローカル復元できるデッキがありません', 'warn');
    return;
  }

  const ok = await askMobileConfirm(
    `ローカル ${deckNames.length} 件をクラウドへ復元しますか？`,
    '復元する',
    '戻る'
  );
  if (!ok) return;

  let success = 0;
  let failed = 0;

  for (const deckName of deckNames) {
    const cards = savedDecks[deckName];
    const normalized = Array.isArray(cards)
      ? cards.map((card) => NetworkService.normalizeCardData(card))
      : [];

    const result = await NetworkService.saveDeck(account.username, account.pin, deckName, normalized);
    if (!result || result.error) {
      failed += 1;
      console.warn('[deck-mobile] restore failed:', deckName, result && result.error ? result.error : 'unknown');
      continue;
    }

    if (typeof NetworkService.clearDeckCache === 'function') {
      NetworkService.clearDeckCache(deckName, account.username);
    }
    success += 1;
  }

  const names = await NetworkService.loadServerDecks(account.username, account.pin);
  if (Array.isArray(names)) {
    if (window.AppState) {
      window.AppState.set('_serverDeckNames', names);
    } else {
      window._serverDeckNames = names;
    }
  }

  if (failed > 0) {
    showMobileToast(`クラウド復元: 成功${success}件 / 失敗${failed}件`, 'warn');
  } else {
    showMobileToast(`クラウド復元完了（${success}件）`, 'ok');
  }
  renderMobileDeckList();
}

async function saveMobileDeckToCloud() {
  if (_mobileDeckSaving) return;
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

  _mobileDeckSaving = true;
  try {
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
    if (Array.isArray(names)) {
      if (window.AppState) {
        window.AppState.set('_serverDeckNames', names);
      } else {
        window._serverDeckNames = names;
      }
    } else {
      showMobileToast('クラウド一覧の更新に失敗しました（ローカル保存のみ反映）', 'warn');
    }
    showMobileToast('保存しました', 'ok');
    renderMobileDeckList();
  } finally {
    _mobileDeckSaving = false;
  }
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

// ─── VSモード（疑似対戦・SP版）────────────────────────────────────────────

async function openMobileVsSetup() {
  const p1DeckName = window._deckEditing;
  if (!p1DeckName || !window._deckCards.length) {
    showMobileToast('先にデッキを選択してください', 'warn');
    return;
  }
  const savedDecks = getSavedDecksMobile();
  const localNames = Object.keys(savedDecks);
  const cloudNames = Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [];
  const allNames = Array.from(new Set([...localNames, ...cloudNames]))
    .sort((a, b) => String(a).localeCompare(String(b), 'ja'));

  const optionsHtml = allNames.map(n =>
    `<option value="${escapeHtmlMobile(n)}">${escapeHtmlMobile(n)}</option>`
  ).join('');

  let modal = document.getElementById('mobile-vs-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mobile-vs-modal';
    modal.className = 'dm-confirm-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="dm-confirm-backdrop"></div>
    <div class="dm-confirm-body">
      <div class="dm-confirm-message">
        <div style="font-weight:700;margin-bottom:10px">疑似対戦モード設定</div>
        <div style="font-size:0.85rem;margin-bottom:6px">P1 デッキ: <strong>${escapeHtmlMobile(p1DeckName)}</strong></div>
        <div style="font-size:0.85rem;margin-bottom:4px">P2 デッキを選択:</div>
        <select id="mobile-vs-p2-select" style="width:100%;margin-bottom:10px;padding:6px;font-size:0.9rem">
          <option value="">-- 選択 --</option>
          ${optionsHtml}
        </select>
      </div>
      <div class="dm-confirm-actions">
        <button id="mobile-vs-start" class="dm-confirm-btn ok">ゲーム開始</button>
        <button id="mobile-vs-cancel" class="dm-confirm-btn cancel">キャンセル</button>
      </div>
    </div>
  `;
  modal.classList.add('open');

  return new Promise((resolve) => {
    const close = (val) => { modal.classList.remove('open'); resolve(val); };
    document.getElementById('mobile-vs-start').onclick = () => {
      const p2 = document.getElementById('mobile-vs-p2-select').value.trim();
      if (!p2) { showMobileToast('P2 のデッキを選択してください', 'warn'); return; }
      close(p2);
    };
    document.getElementById('mobile-vs-cancel').onclick = () => close(null);
    modal.querySelector('.dm-confirm-backdrop').onclick = () => close(null);
  }).then((p2DeckName) => {
    if (p2DeckName) startMobileVsGame(p1DeckName, p2DeckName);
  });
}

async function startMobileVsGame(p1DeckName, p2DeckName) {
  const account = AuthService.getCurrentAccount();
  const resolveDeck = async (name) => {
    if (window.GameController?.resolveDeckData) {
      const d = await window.GameController.resolveDeckData(name, account);
      if (d && d.length) return d;
    }
    const saved = getSavedDecksMobile();
    if (saved[name] && saved[name].length) return saved[name];
    if (account && !account.isGuest && account.pin) {
      return await NetworkService.fetchServerDeck(account.username, account.pin, name).catch(() => null);
    }
    return null;
  };

  const [p1Data, p2Data] = await Promise.all([resolveDeck(p1DeckName), resolveDeck(p2DeckName)]);
  if (!p1Data?.length) { showMobileToast(`P1「${p1DeckName}」を取得できませんでした`, 'warn'); return; }
  if (!p2Data?.length) { showMobileToast(`P2「${p2DeckName}」を取得できませんでした`, 'warn'); return; }

  const p1Engine = new GameEngine();
  const p2Engine = new GameEngine();
  if (window.GameController) {
    window.GameController.initSoloGame(p1Engine, p1Data);
    window.GameController.initSoloGame(p2Engine, p2Data);
  } else {
    p1Engine.initGame(p1Data);
    p2Engine.initGame(p2Data);
  }

  const firstPlayer = Math.random() < 0.5 ? 'p1' : 'p2';
  window._vs = { p1Engine, p2Engine, activePlayer: firstPlayer, p1DeckName, p2DeckName };
  window._ol = null;
  window._olOpponent = null;
  window._olCurrentPlayer = null;

  engineMobile = firstPlayer === 'p1' ? p1Engine : p2Engine;
  _vsRefreshOpponentViewMobile();

  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileUnderInsertState = null;
  _mobileDeckPeekPrivateCards = [];
  _mobileNeedDrawGuide = true;
  renderMobileGame();
  const who = firstPlayer === 'p1' ? `P1 (${p1DeckName})` : `P2 (${p2DeckName})`;
  showMobileTurnNotification(`疑似対戦: ${who} が先手です。まずはドロー`);
}

function _vsRefreshOpponentViewMobile() {
  const vs = window._vs;
  if (!vs) return;
  const inactive = vs.activePlayer === 'p1' ? vs.p2Engine : vs.p1Engine;
  const s = inactive.getState();
  window._olOpponent = {
    hand: s.hand.length,
    handCards: s.hand,
    deck: s.deck.length,
    shields: s.shields.length,
    battleZone: (s.battleZone || []).map(c => ({ name: c?.name, cost: c?.cost, power: c?.power, tapped: c?.tapped })),
    manaZone: (s.manaZone || []).map(c => ({ name: c?.name, cost: c?.cost, tapped: c?.tapped })),
    graveyard: s.graveyard.length
  };
}

function _vsTurnEndMobile() {
  const vs = window._vs;
  if (!vs) return;
  if (window.GameController) {
    window.GameController.turnEnd(engineMobile, null);
  } else {
    engineMobile.turnEnd();
  }
  vs.activePlayer = vs.activePlayer === 'p1' ? 'p2' : 'p1';
  engineMobile = vs.activePlayer === 'p1' ? vs.p1Engine : vs.p2Engine;
  _mobileSelectedShieldIdx = null;
  _mobileSelectedHandIdx = null;
  _mobileUnderInsertState = null;
  _mobileDeckPeekPrivateCards = [];
  _mobileNeedDrawGuide = true;
  _vsRefreshOpponentViewMobile();
  const who = vs.activePlayer === 'p1' ? `P1 (${vs.p1DeckName})` : `P2 (${vs.p2DeckName})`;
  showMobileTurnNotification(`疑似対戦: ${who} のターンです。まずはドロー`);
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

    let data; try { data = JSON.parse(e.data); } catch { return; }
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
    // p1 のみ先攻をランダム決定。p2 は最初の opponent_state で active を受け取る。
    if (window._ol.p === 'p1') {
      window._olCurrentPlayer = Math.random() < 0.5 ? 1 : 2;
    } else {
      window._olCurrentPlayer = 1; // p2 は暫定値。相手の state 受信時に上書きされる。
    }
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
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('landscape').catch(() => {});
  }
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
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (!shouldApplyRemotePayloadMobile(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;
    if (Number.isFinite(data.turn) && data.turn > 0) {
      if (typeof engineMobile.syncTurn === 'function') {
        engineMobile.syncTurn(data.turn);
      }
    }
    if (other) window._olOpponent = normalizeMobileOpponentState(other);
    if (data.active === 'p1' || data.active === 'p2') window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;

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
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (!shouldApplyRemotePayloadMobile(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (Number.isFinite(data.turn) && data.turn > 0) {
      if (typeof engineMobile.syncTurn === 'function') {
        engineMobile.syncTurn(data.turn);
      }
    }
    if (other) window._olOpponent = normalizeMobileOpponentState(other);
    if (data.active === 'p1' || data.active === 'p2') {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn && engineMobile && engineMobile.state) {
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
    let data; try { data = JSON.parse(e.data); } catch { return; }
    appendMobileChatMessage(data.name || 'Player', data.msg || '', data.p || '');
  });

  es.addEventListener('hand_reveal_request', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    const cards = (engineMobile?.state?.hand || []).map(c => ({
      name: c?.name || '',
      civ: String(c?.civilization || c?.civ || ''),
      cost: c?.cost,
      power: c?.power || '',
      imgUrl: (typeof getMobileCardImageUrl === 'function' ? getMobileCardImageUrl(c) : '') || ''
    }));
    sendHandActionMobile('hand_data', { cards });
    showMobileToast('相手があなたの手札を確認しています...', 'info');
  });

  es.addEventListener('hand_data', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    const cards = Array.isArray(data.cards) ? data.cards : [];
    openMobileHandSelectModal(cards);
  });

  es.addEventListener('discard_select', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    openMobileDiscardConfirmModal(data.cardName || '', false);
  });

  es.addEventListener('discard_random', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    openMobileDiscardConfirmModal('', true);
  });

  es.onerror = () => {
    es.close();
    if (!window._ol || window._ol.room !== room) return;

    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    if (window._ol.reconnectAttempt < 3) {
      if (_olReconnectTimerMobile) clearTimeout(_olReconnectTimerMobile);
      _olReconnectTimerMobile = setTimeout(olStartEventListenerMobile, Math.pow(2, window._ol.reconnectAttempt) * 1000);
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
  if (seq < last) return false;

  window._ol.remoteSeq = seq;
  return true;
}

function sendHandActionMobile(type, extra) {
  if (!window._ol || !engineMobile) return;
  const payload = Object.assign({
    room: window._ol.room,
    p: window._ol.p,
    type: type,
    seq: nextOnlineSeqMobile()
  }, extra || {});
  NetworkService.sendAction(payload);
}

function olSendActionMobile(actionType) {
  if (window.GameController) {
    window.GameController.sendOnlineAction(engineMobile, actionType);
    return;
  }

  if (!window._ol || !engineMobile) return;
  const s = engineMobile.state;
  const publicState = buildMobilePublicState(s);
  let activePlayer;
  if (actionType === 'turn_end') {
    activePlayer = window._ol.p === 'p1' ? 'p2' : 'p1';
  } else {
    // state 送信時は _olCurrentPlayer ベースで active を決定（先攻ランダム対応）
    activePlayer = window._olCurrentPlayer === 1 ? 'p1' : 'p2';
  }
  const payload = {
    room: window._ol.room,
    p: window._ol.p,
    type: actionType,
    seq: nextOnlineSeqMobile(),
    turn: s.turn,
    active: activePlayer,
    p1: window._ol.p === 'p1' ? publicState : null,
    p2: window._ol.p === 'p2' ? publicState : null
  };
  NetworkService.sendAction(payload);
}
