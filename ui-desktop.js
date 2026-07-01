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
let _desktopSearchRequestToken = 0;
let _desktopDelegatedEventsBound = false;
let _desktopDeckHydrateToken = 0;
let _desktopDeckSaving = false;
const _desktopSearchHydrateCooldownUntil = new Map();
const DESKTOP_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS = 45 * 1000;
const DESKTOP_SEARCH_HYDRATE_ERROR_COOLDOWN_MS = 8 * 1000;
let _desktopZoneMenuState = null;
let _desktopZoneMenuGlobalBound = false;
let _vsOppTarget = false;
// 相手カードの確認・操作（オンライン）: 次に開くゾーンメニューを「相手への遠隔操作(opp_op)」にする
let _oppRemoteTarget = false;
// オンラインで相手から取り寄せた公開ゾーンのカード配列（メニューのソースに使う）
let _desktopOppPeekCards = null;

// ── ゲームログ（対戦画面の右パネルに流す） ──────────────────────────────
let _desktopGameLog = [];
// ログ先頭に付ける操作プレイヤー（P1/P2）。一人回しは付けない。
function _desktopLogPlayer() {
  if (window._vs?.activePlayer) return window._vs.activePlayer === 'p1' ? 'P1' : 'P2';
  if (window._ol?.p) return window._ol.p === 'p1' ? 'P1' : 'P2';
  return '';
}
function appendDesktopGameLog(msg) {
  const text = String(msg || '').trim();
  if (!text) return;
  const who = _desktopLogPlayer();
  _desktopGameLog.push(`${who ? who + ' ' : ''}${text}`);
  if (_desktopGameLog.length > 60) _desktopGameLog.shift();
}
function clearDesktopGameLog() {
  _desktopGameLog = [];
}

// ── 超次元/GR パイルの中身モーダル ─────────────────────────────────────
let _desktopExModalZone = null;
function openDesktopExPileModal(zoneKey) {
  if (!['hyperZone', 'grZone', 'specialZone'].includes(zoneKey)) return;
  _desktopExModalZone = zoneKey;
  renderDesktopExPileModal();
}
function closeDesktopExPileModal() {
  _desktopExModalZone = null;
  const modal = document.getElementById('desktop-ex-modal');
  if (modal) modal.classList.remove('open');
}
function moveDesktopExCard(idx, toZone, position) {
  const zoneKey = _desktopExModalZone;
  if (!zoneKey) return;
  moveDesktopCardBetweenZones(zoneKey, Number(idx), toZone, position || 'top');
  if (Array.isArray(engine?.state?.[zoneKey]) && engine.state[zoneKey].length) {
    renderDesktopExPileModal();
  } else {
    closeDesktopExPileModal();
  }
}
function renderDesktopExPileModal() {
  const zoneKey = _desktopExModalZone;
  if (!zoneKey) return;
  const cards = Array.isArray(engine?.state?.[zoneKey]) ? engine.state[zoneKey] : [];
  if (!cards.length) { closeDesktopExPileModal(); return; }

  let modal = document.getElementById('desktop-ex-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-ex-modal';
    modal.className = 'dm-grave-modal';
    modal.innerHTML = `
      <div class="dm-grave-backdrop" onclick="closeDesktopExPileModal()"></div>
      <div class="dm-grave-body">
        <div class="dm-grave-head">
          <div class="dm-grave-title" id="desktop-ex-title"></div>
          <button class="dm-grave-close" onclick="closeDesktopExPileModal()">閉じる</button>
        </div>
        <div id="desktop-ex-list" class="dm-grave-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const titleEl = document.getElementById('desktop-ex-title');
  if (titleEl) titleEl.textContent = `${getDesktopZoneLabel(zoneKey)} (${cards.length})`;

  const list = document.getElementById('desktop-ex-list');
  if (list) {
    list.innerHTML = cards.map((card, i) => {
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item">
          <div class="dm-grave-item-no">${i + 1}</div>
          <div class="dm-grave-item-main">
            <div class="dm-grave-item-name">${escapeHtml(card?.name || 'カード')}</div>
            <div class="dm-grave-item-meta">コスト ${escapeHtml(String(cost))} / パワー ${escapeHtml(String(power))}</div>
          </div>
          <div class="dm-ex-item-actions">
            <button class="dm-ex-act" onclick="moveDesktopExCard(${i}, 'battleZone')">バトル</button>
            <button class="dm-ex-act" onclick="moveDesktopExCard(${i}, 'hand')">手札</button>
            <button class="dm-ex-act" onclick="moveDesktopExCard(${i}, 'manaZone')">マナ</button>
            <button class="dm-ex-act red" onclick="moveDesktopExCard(${i}, 'graveyard')">墓地</button>
          </div>
        </div>
      `;
    }).join('');
  }
  modal.classList.add('open');
}

function getVsOppEngine() {
  const vs = window._vs;
  if (!vs) return engine;
  return vs.activePlayer === 'p1' ? vs.p2Engine : vs.p1Engine;
}

function _eng() {
  return _desktopZoneMenuState?.targetEngine || engine;
}
let _desktopUnderInsertState = null;
let _handDiscardStateDesktop = null;
let _desktopDetailCardState = null;
let _desktopDetailRequestToken = 0;
let _desktopDetailAllowAdd = true;
let _desktopDetailOnCardChange = null;
let _desktopIllustrationRequestToken = 0;
let _desktopIllustrationOptions = [];
let _desktopDeckPeekPrivateCards = [];
let _desktopDeckRevealModalState = {
  mode: 'public',
  destination: 'hand',
  selected: {}
};
let _desktopOpponentDeckRevealSignature = '';
let _desktopDeckNValue = 3;
const DESKTOP_SEARCH_PAGE_SIZE = 12;
let _desktopSearchState = {
  query: '',
  page: 0,
  items: [],
  total: 0,
  hasMore: false,
  loading: false,
  error: null
};
let _desktopSearchServerState = {
  query: '',
  total: 0,
  serverPageSize: 0,
  error: null,
  pages: new Map()
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

    const input = document.getElementById('desktop-input-field');
    const okBtn = document.getElementById('desktop-input-ok');
    const cancelBtn = document.getElementById('desktop-input-cancel');
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

function onDesktopSearchInput() {
  if (_desktopSearchDebounceTimer) clearTimeout(_desktopSearchDebounceTimer);
  _desktopSearchDebounceTimer = setTimeout(() => {
    const el = document.getElementById('desktop-search-input');
    if (el === null) return;
    desktopSearchCards(el.value);
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
  if (window.GameController?.getCardCivClass) {
    return window.GameController.getCardCivClass(card);
  }

  const raw = String(card?.civilization || card?.civ || '').toLowerCase();
  if (raw.includes('fire') || raw.includes('火')) return 'fire';
  if (raw.includes('water') || raw.includes('水')) return 'water';
  if (raw.includes('light') || raw.includes('光')) return 'light';
  if (raw.includes('darkness') || raw.includes('dark') || raw.includes('闇')) return 'dark';
  if (raw.includes('nature') || raw.includes('自然')) return 'nature';
  return 'multi';
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

function renderDesktopUnderPeekLayers(card) {
  const under = Array.isArray(card?.underCards) ? card.underCards : [];
  if (!under.length) return '';
  const layers = under.slice(0, 3).map((uc, i) => {
    return `<div class="dg-under-peek-layer" style="left:-${(i + 1) * 5}px"></div>`;
  }).join('');
  const overflow = under.length > 3
    ? `<div class="dg-under-overflow">+${under.length - 3}</div>`
    : '';
  return layers + overflow;
}

function getDesktopCardTypeLabel(type, isTwinpact = false) {
  if (isTwinpact) return 'ツインパクト';
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
  closeDesktopIllustrationModal();
  _desktopDetailRequestToken += 1;
  _desktopDetailCardState = null;
  _desktopDetailAllowAdd = true;
  _desktopDetailOnCardChange = null;
  _desktopIllustrationOptions = [];
}

function mergeDesktopCardIllustration(baseCard, nextCard) {
  const merged = {
    ...(baseCard || {}),
    ...(nextCard || {})
  };

  const imageUrl = getDesktopCardImageUrl(nextCard) || getDesktopCardImageUrl(baseCard);
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

function ensureDesktopIllustrationModal() {
  let modal = document.getElementById('desktop-illustration-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-illustration-modal';
    modal.className = 'dm-art-picker-modal';
    modal.innerHTML = `
      <div class="dm-art-picker-backdrop" onclick="closeDesktopIllustrationModal()"></div>
      <div class="dm-art-picker-body">
        <div class="dm-art-picker-head">
          <div class="dm-art-picker-title">イラスト変更</div>
          <button type="button" class="dm-art-picker-close" onclick="closeDesktopIllustrationModal()">×</button>
        </div>
        <div id="desktop-illustration-content" class="dm-art-picker-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

function closeDesktopIllustrationModal() {
  const modal = document.getElementById('desktop-illustration-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  _desktopIllustrationRequestToken += 1;
}

function handleDesktopIllustrationImageError(img) {
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

  const grid = document.querySelector('#desktop-illustration-content .dm-art-picker-grid');
  if (grid && !grid.querySelector('.dm-art-picker-item')) {
    const content = document.getElementById('desktop-illustration-content');
    if (content) {
      content.innerHTML = '<div class="dm-art-picker-empty">表示できるイラストが見つかりませんでした。</div>';
    }
  }
}

function renderDesktopIllustrationContent(opts = {}) {
  const content = document.getElementById('desktop-illustration-content');
  if (!content) return;

  if (opts.loading) {
    content.innerHTML = '<div class="dm-art-picker-loading">イラスト一覧を取得中…</div>';
    return;
  }

  if (opts.error) {
    content.innerHTML = `<div class="dm-art-picker-error">${escapeHtml(opts.error)}</div>`;
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
        const imageUrl = getDesktopCardImageUrl(option);
        const artId = String(option?.artId || '').trim();
        const isSelected = selectedArtId
          ? artId === selectedArtId
          : (!!selectedImage && imageUrl === selectedImage);
        const label = String(option?.label || option?.name || `イラスト ${idx + 1}`).trim();

        return `
          <button
            type="button"
            class="dm-art-picker-item ${isSelected ? 'selected' : ''}"
            onclick="applyDesktopIllustrationFromPicker(${idx})">
            ${imageUrl
              ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(label)}" class="dm-art-picker-thumb" onerror="handleDesktopIllustrationImageError(this)">`
              : '<div class="dm-art-picker-thumb placeholder">NO IMG</div>'}
            <div class="dm-art-picker-label">${escapeHtml(label)}</div>
          </button>
        `;
      }).join('')}
    </div>
  `;
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
  const isTwinpact = !!current?.twinpact;
  const typeLabel = getDesktopCardTypeLabel(current?.type, isTwinpact);
  const power = current?.power ? String(current.power) : '-';
  const sourceId = String(current?.sourceId || current?.id || current?.cardId || '').trim() || '-';
  const bodyText = String(current?.text || '').trim();
  const rowRace = current?.race
    ? `<tr><th>種族</th><td>${escapeHtml(String(current.race))}</td></tr>`
    : '';

  // ツインパクト呪文半部
  const spellSection = isTwinpact && current.spellName ? (() => {
    const spellCost = Number.isFinite(Number(current.spellCost)) ? Number(current.spellCost) : '-';
    const spellText = String(current.spellText || '').trim();
    return `
      <div class="dm-card-detail-twinpact-divider">――― 呪文 ―――</div>
      <table class="dm-card-detail-table">
        <tr><th>呪文名</th><td>${escapeHtml(String(current.spellName))}</td></tr>
        <tr><th>コスト</th><td>${escapeHtml(String(spellCost))}</td></tr>
      </table>
      ${spellText ? `<div class="dm-card-detail-text">${escapeHtml(spellText).replace(/\n/g, '<br>')}</div>` : ''}
    `;
  })() : '';

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
    ${spellSection}
    <div class="dm-card-detail-sub-actions">
      <button type="button" class="dm-card-detail-illustration-btn" onclick="openDesktopIllustrationPicker()">イラスト変更</button>
    </div>
    ${allowAdd
      ? `<div class="dm-card-detail-actions">
          <input id="desktop-card-detail-count" type="number" min="1" max="4" value="1" class="dm-card-detail-count" />
          <span class="dm-card-detail-count-label">枚</span>
          <button type="button" class="dm-card-detail-add" onclick="addDesktopCardFromDetail()">＋ デッキに追加</button>
        </div>`
      : ''}
  `;
}

async function openDesktopIllustrationPicker() {
  if (!_desktopDetailCardState) return;

  const modal = ensureDesktopIllustrationModal();
  modal.classList.add('open');
  renderDesktopIllustrationContent({ loading: true });

  const token = ++_desktopIllustrationRequestToken;
  try {
    const result = await NetworkService.fetchCardIllustrations(_desktopDetailCardState, {
      timeoutMs: 45000
    });
    if (token !== _desktopIllustrationRequestToken) return;

    const options = Array.isArray(result?.options) ? result.options : [];
    _desktopIllustrationOptions = options;
    renderDesktopIllustrationContent({
      options,
      selectedArtId: String(_desktopDetailCardState?.selectedArtId || '').trim(),
      selectedImage: getDesktopCardImageUrl(_desktopDetailCardState)
    });
  } catch (error) {
    if (token !== _desktopIllustrationRequestToken) return;
    console.error('desktop illustration picker error:', error);
    _desktopIllustrationOptions = [];
    renderDesktopIllustrationContent({ error: 'イラスト一覧を取得できませんでした。' });
  }
}

function applyDesktopIllustrationFromPicker(index) {
  if (!_desktopDetailCardState) return;

  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;

  const option = _desktopIllustrationOptions[idx];
  if (!option) return;

  const updated = NetworkService.applyCardIllustration(_desktopDetailCardState, option);
  _desktopDetailCardState = updated;
  renderDesktopCardDetailContent(updated, { allowAdd: _desktopDetailAllowAdd });

  if (typeof _desktopDetailOnCardChange === 'function') {
    try {
      _desktopDetailOnCardChange(updated);
    } catch (error) {
      console.warn('detail onCardChange error (desktop):', error);
    }
  }

  closeDesktopIllustrationModal();
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
  _desktopDetailOnCardChange = typeof opts.onCardChange === 'function' ? opts.onCardChange : null;
  _desktopIllustrationOptions = [];
  closeDesktopIllustrationModal();

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
  let raw = decoded;
  try {
    raw = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
  } catch {
    raw = decoded;
  }

  const base = NetworkService.normalizeCardData(raw || {});
  const targetKey = String(base?.cardId || base?.id || '').trim();

  showDesktopCardDetail(base, {
    allowAdd: false,
    onCardChange: (nextCard) => {
      if (!targetKey) return;
      const cards = Array.isArray(window._deckCards) ? window._deckCards : [];
      const idx = cards.findIndex((item) => String(item?.cardId || item?.id || '') === targetKey);
      if (idx < 0) return;

      const current = cards[idx] || {};
      const merged = mergeDesktopCardIllustration(current, nextCard);
      merged.count = Number(current?.count) || 1;
      cards[idx] = merged;
      window._deckCards = cards;

      sortCurrentDesktopDeckCards();
      renderDesktopDeckList();
    }
  });
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

  const keyword = String(_desktopSearchState.query || '').trim();
  if (!keyword) {
    container.innerHTML = '';
    return;
  }

  const page = Math.max(1, Number(_desktopSearchState.page) || 1);
  const items = Array.isArray(_desktopSearchState.items) ? _desktopSearchState.items : [];
  const total = Number(_desktopSearchState.total);
  const hasTotal = Number.isFinite(total) && total > 0;
  const totalPages = hasTotal
    ? Math.max(1, Math.ceil(total / DESKTOP_SEARCH_PAGE_SIZE))
    : null;
  const searchError = _desktopSearchState.error;
  const emptyLabel = searchError
    ? `API未接続: ${searchError.base || (typeof NetworkService !== 'undefined' && NetworkService.getApiBase ? NetworkService.getApiBase() : '')} の検索に失敗しました。`
    : (_desktopSearchState.loading ? '検索中...' : '該当カードが見つかりません。');

  const gridHtml = items.length
    ? `
      <div class="dl-search-grid">
        ${items.map(card => {
          const payload = encodeURIComponent(JSON.stringify(card));
          const thumb = renderDesktopCardThumb(card, 'dl-search-card-image');
          const name = getDesktopCardDisplayName(card);
          const sourceId = String(card?.sourceId || card?.id || '').trim();
          const metaParts = [
            `Cost ${getDesktopCardCostLabel(card)}`,
            String(card?.civilization || card?.civ || '').trim(),
            String(card?.type || '').trim(),
            sourceId ? `ID ${sourceId}` : '',
            String(card?.source || '').trim()
          ].filter(Boolean);
          const label = `${name} / ${metaParts.join(' / ')}`;
          const safeLabel = escapeHtml(label);
          return `
            <button
              type="button"
              class="dl-search-tile"
              data-dg-action="show-card-detail"
              data-card-json="${payload}"
              title="${safeLabel}"
              aria-label="${safeLabel}">
              <div class="dl-search-thumb-wrap">${thumb}</div>
              <div class="dl-search-tile-body">
                <div class="dl-search-tile-name">${escapeHtml(name)}</div>
                <div class="dl-search-tile-meta">${escapeHtml(metaParts.join(' / '))}</div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `
    : `<div class="dl-search-empty">${escapeHtml(emptyLabel)}</div>`;

  const loadingLabel = _desktopSearchState.loading ? ' | 読み込み中' : '';
  const prevDisabled = _desktopSearchState.loading || page <= 1 ? 'disabled' : '';
  const nextBlockedByTotal = totalPages !== null ? page >= totalPages : false;
  const nextDisabled = _desktopSearchState.loading || nextBlockedByTotal || !_desktopSearchState.hasMore ? 'disabled' : '';
  const totalPagesLabel = totalPages !== null ? String(totalPages) : '?';
  const totalLabel = hasTotal ? ` (${total}件)` : '';

  container.innerHTML = `
    ${gridHtml}
    <div class="dl-search-pagination">
      <button type="button" class="dl-page-btn" onclick="desktopSearchPrevPage()" ${prevDisabled}>前へ</button>
      <span class="dl-search-page-indicator">${page} / ${totalPagesLabel}${totalLabel}${loadingLabel}</span>
      <button type="button" class="dl-page-btn" onclick="desktopSearchNextPage()" ${nextDisabled}>次へ</button>
    </div>
  `;
}

function getDesktopSearchHydrateKey(card) {
  const raw = String(card?.sourceId || card?.id || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('src:') ? raw.slice(4) : raw;
  if (!normalized || normalized.includes('|')) return '';
  return normalized;
}

function shouldSkipDesktopSearchHydrate(key) {
  if (!key) return false;
  const until = Number(_desktopSearchHydrateCooldownUntil.get(key) || 0);
  if (!until) return false;
  if (Date.now() <= until) return true;
  _desktopSearchHydrateCooldownUntil.delete(key);
  return false;
}

function markDesktopSearchHydrateCooldown(key, cooldownMs = DESKTOP_SEARCH_HYDRATE_NO_IMAGE_COOLDOWN_MS) {
  if (!key) return;
  const duration = Math.max(0, Number(cooldownMs) || 0);
  _desktopSearchHydrateCooldownUntil.set(key, Date.now() + duration);
}

async function hydrateDesktopSearchCards(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  return sourceItems.map(card => (
    typeof NetworkService.normalizeSearchResultCard === 'function'
      ? NetworkService.normalizeSearchResultCard(card)
      : NetworkService.normalizeCardData({ ...card, imageUrl: '', thumb: '', img: '', selectedImageUrl: '' })
  ));
}

function resetDesktopSearchServerState(query = '') {
  _desktopSearchServerState = {
    query,
    total: 0,
    serverPageSize: 0,
    error: null,
    pages: new Map()
  };
}

async function fetchDesktopServerSearchPage(query, page, token) {
  if (_desktopSearchServerState.query !== query) {
    resetDesktopSearchServerState(query);
  }

  if (!_desktopSearchServerState.error && _desktopSearchServerState.pages.has(page)) {
    return _desktopSearchServerState.pages.get(page) || [];
  }

  const result = await NetworkService.searchCardsWithMeta(query, page);
  if (token !== _desktopSearchRequestToken) return [];
  if (result?.error) {
    _desktopSearchServerState.error = result;
    _desktopSearchServerState.pages.set(page, []);
    return [];
  }
  _desktopSearchServerState.error = null;

  const cards = Array.isArray(result?.cards) ? result.cards : [];
  const hydrated = await hydrateDesktopSearchCards(cards);
  if (token !== _desktopSearchRequestToken) return [];

  const total = Number(result?.total);
  if (Number.isFinite(total) && total >= 0) {
    _desktopSearchServerState.total = total;
  }

  if (!_desktopSearchServerState.serverPageSize) {
    _desktopSearchServerState.serverPageSize = Math.max(1, cards.length || hydrated.length || DESKTOP_SEARCH_PAGE_SIZE);
  }

  _desktopSearchServerState.pages.set(page, hydrated);
  return hydrated;
}

async function resolveDesktopSearchUiPage(query, uiPage, token) {
  if (_desktopSearchServerState.query !== query) {
    resetDesktopSearchServerState(query);
  }

  await fetchDesktopServerSearchPage(query, 1, token);
  if (token !== _desktopSearchRequestToken) return null;

  const serverPageSize = Math.max(
    1,
    Number(_desktopSearchServerState.serverPageSize)
      || Number((_desktopSearchServerState.pages.get(1) || []).length)
      || DESKTOP_SEARCH_PAGE_SIZE
  );
  _desktopSearchServerState.serverPageSize = serverPageSize;

  const startIndex = (uiPage - 1) * DESKTOP_SEARCH_PAGE_SIZE;
  const endExclusive = startIndex + DESKTOP_SEARCH_PAGE_SIZE;
  const startServerPage = Math.floor(startIndex / serverPageSize) + 1;
  const endServerPage = Math.floor(Math.max(startIndex, endExclusive - 1) / serverPageSize) + 1;

  for (let p = startServerPage; p <= endServerPage; p += 1) {
    await fetchDesktopServerSearchPage(query, p, token);
    if (token !== _desktopSearchRequestToken) return null;
  }

  const merged = [];
  for (let p = startServerPage; p <= endServerPage; p += 1) {
    const chunk = _desktopSearchServerState.pages.get(p);
    if (Array.isArray(chunk) && chunk.length) {
      merged.push(...chunk);
    }
  }

  const startOffset = startIndex - ((startServerPage - 1) * serverPageSize);
  const items = merged.slice(startOffset, startOffset + DESKTOP_SEARCH_PAGE_SIZE);
  const total = Number(_desktopSearchServerState.total);
  const hasTotal = Number.isFinite(total) && total > 0;
  const safeTotal = hasTotal ? total : 0;
  const hasMore = hasTotal
    ? endExclusive < safeTotal
    : items.length >= DESKTOP_SEARCH_PAGE_SIZE;

  return {
    items,
    total: safeTotal,
    hasMore,
    error: _desktopSearchServerState.error || null
  };
}

async function desktopSearchMore() {
  await desktopSearchNextPage();
}

async function desktopSearchPrevPage() {
  if (_desktopSearchState.loading) return;
  const keyword = String(_desktopSearchState.query || '').trim();
  if (!keyword) return;

  const currentPage = Math.max(1, Number(_desktopSearchState.page) || 1);
  if (currentPage <= 1) return;

  await desktopSearchCards(keyword, currentPage - 1);
}

async function desktopSearchNextPage() {
  if (_desktopSearchState.loading || !_desktopSearchState.hasMore) return;

  const keyword = String(_desktopSearchState.query || '').trim();
  if (!keyword) return;

  const currentPage = Math.max(1, Number(_desktopSearchState.page) || 1);
  await desktopSearchCards(keyword, currentPage + 1);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** onclick 等のシングルクォート文字列用（デッキ名に ' や " が含まれると壊れるのを防ぐ） */
function escapeAttrJs(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
    deckRevealZone: normalizeDesktopPublicZone(src.deckRevealZone),
    revealedZone: normalizeDesktopPublicZone(src.revealedZone),
    hyperZone: normalizeDesktopPublicZone(src.hyperZone),
    grZone: normalizeDesktopPublicZone(src.grZone),
    specialZone: normalizeDesktopPublicZone(src.specialZone),
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
    faceUp: !!card?.faceUp,
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
    deckRevealZone: serializeDesktopPublicCards(state.deckRevealZone),
    // Hide in-progress break (opponent must not see the broken card itself) and keep
    // GR non-public (count only, like the deck) — must match GameController.buildPublicState.
    revealedZone: serializeDesktopPublicCards((state.revealedZone || []).filter((c) => !c || !c._breaking)),
    hyperZone: serializeDesktopPublicCards(state.hyperZone),
    grZone: (state.grZone || []).length,
    specialZone: serializeDesktopPublicCards(state.specialZone),
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
    const system = entry.p === 'sys' || String(entry.name || '').toUpperCase() === 'SYSTEM';
    const mine = entry.p && window._ol && entry.p === window._ol.p;
    const roleClass = system ? 'system' : (mine ? 'mine' : 'other');
    const displayName = system ? 'SYSTEM' : (entry.name || 'LOG');
    return `
      <div class="dg-chat-item ${roleClass}">
        <div class="dg-chat-name">${escapeHtml(displayName)}</div>
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

function getDesktopOnlinePlayerName(player = window._ol?.p) {
  if (!window._ol) return 'LOG';
  return player === 'p1'
    ? (window._ol.p1Name || 'Player 1')
    : (window._ol.p2Name || 'Player 2');
}

async function sendDesktopChat() {
  appendDesktopChatMessage('SYSTEM', 'チャット送信は廃止しました。操作ログのみ表示します。', 'sys');
}

function sendDesktopOnlineActionLog(message) {
  if (!window._ol) return;

  const room = window._ol.room;
  const player = window._ol.p;
  const msg = String(message || '').trim();
  if (!room || !player || !msg) return;

  appendDesktopChatMessage(getDesktopOnlinePlayerName(player), msg, player);

  NetworkService.sendChat(room, player, msg)
    .then((ok) => {
      if (!ok) {
        appendDesktopChatMessage('SYSTEM', '操作ログの送信に失敗しました。', 'sys');
      }
    })
    .catch((err) => {
      console.warn('send online action log error', err);
      appendDesktopChatMessage('SYSTEM', '操作ログの送信に失敗しました。', 'sys');
    });
}

function onDesktopChatKeyDown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  sendDesktopChat();
}

/** Normal deck management ignores localStorage dm_decks. */
function getSavedDecks() {
  return {};
}

function getLocalSavedDecksForMigration() {
  if (window.GameController?.getLocalSavedDecks) {
    return window.GameController.getLocalSavedDecks();
  }
  try {
    const raw = localStorage.getItem('dm_decks');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('dm_decks parse error', e);
    return {};
  }
}

function hasLocalDecksForMigration() {
  return Object.values(getLocalSavedDecksForMigration()).some(Array.isArray);
}

/**
 * PC版UI初期化
 */
function initDesktopUI() {
  engine = new GameEngine();
  renderDesktopDeckList();
  bindDesktopDelegatedEvents();
}

/**
 * 3カラムレイアウトのデッキ一覧画面
 */
function renderDesktopDeckList() {
  closeDesktopCardZoneMenu();
  closeDesktopHandPicker();
  closeDesktopDeckRevealModal();
  closeDesktopDeckAllModal();
  _desktopUnderInsertState = null;
  _desktopDeckPeekPrivateCards = [];
  _desktopOpponentDeckRevealSignature = '';
  if (window._vs) { window._vs = null; window._olOpponent = null; }

  const container = document.getElementById('app-desktop');
  const account = AuthService.getCurrentAccount();
  const hasLocalMigrationDecks = hasLocalDecksForMigration();
  const editingState = window.GameController
    ? window.GameController.getDeckEditingState()
    : { deckName: window._deckEditing, cards: window._deckCards };
  let deckName = editingState.deckName;
  let cards = Array.isArray(editingState.cards) ? editingState.cards : [];

  const cloudDeckNames = Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [];
  const visibleDeckNames = cloudDeckNames.slice().sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  const currentEditingDeckName = String(deckName || '').trim();
  if (currentEditingDeckName && !visibleDeckNames.includes(currentEditingDeckName)) {
    visibleDeckNames.unshift(currentEditingDeckName);
  }

  if (deckName && !visibleDeckNames.includes(deckName)) {
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
  const canBulkCloudRestore = canCloudSave && hasLocalMigrationDecks;

  const cardCount = getDeckCardTotal(orderedCards);

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
      const thumb = renderDesktopCardThumb(card, 'dl-grid-thumb');
      const payload = escapeAttrJs(encodeURIComponent(JSON.stringify(card)));
      return `
        <div class="dl-grid-card" title="${escapeHtml(getDesktopCardDisplayName(card))}" onclick="openDesktopDeckCardDetail('${payload}')">
          ${thumb}
          <div class="dl-grid-meta">
            <span class="dl-grid-cost">${escapeHtml(String(cost))}</span>
            ${copies > 1 ? `<span class="dl-grid-copy">${copyIndex}/${copies}</span>` : ''}
          </div>
        </div>
      `;
    }).join('')
    : '<div class="dl-empty-editor">選択中デッキのカード画像がここに並びます。</div>';

  const deckOptionsHtml = visibleDeckNames.length
    ? visibleDeckNames.map((name) => `
      <option value="${escapeHtml(name)}" ${deckName === name ? 'selected' : ''}>${escapeHtml(name)}</option>
    `).join('')
    : '<option value="">デッキがありません</option>';
  
  container.innerHTML = `
    <div class="dl-root dl-root-unified">
      <div class="dl-panel dl-search-panel">
        <h3 class="dl-heading">カード検索</h3>
        <input type="text" id="desktop-search-input" placeholder="カード名..." value="${escapeHtml(_desktopSearchState.query || '')}"
          class="dl-input"
          oninput="onDesktopSearchInput()">
        <div id="desktop-search-results" class="dl-stack dl-stack-tight"></div>
      </div>

      <div class="dl-panel dl-list-panel">
        <div class="dl-focus-head compact">
          <div class="dl-focus-copy">
            <h2 class="dl-focus-title">リスト</h2>
          </div>
          <div class="dl-name-summary">
            <span>合計 ${cardCount}枚</span>
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
          <button onclick="restoreAllDesktopLocalDecksToCloud()" ${canBulkCloudRestore ? '' : 'disabled'} class="dl-main-btn ${canBulkCloudRestore ? '' : 'disabled'}">ローカル一括復元</button>
          <button onclick="playDesktopDeckGame()" ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'} class="dl-main-btn ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'}">一人回し</button>
          <button onclick="openDesktopVsSetup()" ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'} class="dl-main-btn ${hasDeckSelected && cardCount > 0 ? '' : 'disabled'}">疑似対戦</button>
        </div>

        ${deckName ? `
          <div class="dl-edit-summary">
            <div class="dl-edit-title">${escapeHtml(deckName)}</div>
            <div class="dl-edit-stats">
              <div>カード枚数: <strong>${cardCount}</strong> / 40</div>
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
async function desktopSearchCards(q, page = 1) {
  const keyword = String(q || '').trim();
  if (!keyword) {
    _desktopSearchRequestToken += 1;
    resetDesktopSearchServerState('');
    _desktopSearchState = { query: '', page: 0, items: [], total: 0, hasMore: false, loading: false, error: null };
    const resultsEl = document.getElementById('desktop-search-results');
    if (resultsEl) resultsEl.innerHTML = '';
    return;
  }

  const nextPage = Math.max(1, Number(page) || 1);
  const token = ++_desktopSearchRequestToken;
  if (_desktopSearchServerState.query !== keyword) {
    resetDesktopSearchServerState(keyword);
  }

  _desktopSearchState = {
    query: keyword,
    page: nextPage,
    items: [],
    total: Number(_desktopSearchState.total) || 0,
    hasMore: false,
    loading: true,
    error: null
  };
  renderDesktopSearchResults();

  try {
    const resolved = await resolveDesktopSearchUiPage(keyword, nextPage, token);
    if (!resolved) return;

    if (token !== _desktopSearchRequestToken) return;

    _desktopSearchState = {
      query: keyword,
      page: nextPage,
      items: resolved.items,
      total: resolved.total,
      hasMore: resolved.hasMore,
      loading: false,
      error: resolved.error || null
    };
  } catch (error) {
    if (token !== _desktopSearchRequestToken) return;
    console.warn('desktop search failed', error);
    _desktopSearchState = {
      query: keyword,
      page: nextPage,
      items: [],
      total: 0,
      hasMore: false,
      loading: false,
      error: {
        error: 'search_failed',
        message: error?.message || 'search failed',
        base: typeof NetworkService !== 'undefined' && NetworkService.getApiBase ? NetworkService.getApiBase() : ''
      }
    };
  }

  if (token !== _desktopSearchRequestToken) return;
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

  if (!deckData && account && !account.isGuest && account.pin) {
    deckData = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
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
  clearDesktopGameLog();
  _desktopDeckPeekPrivateCards = [];
  _desktopDeckRevealModalState = {
    mode: 'public',
    destination: _desktopDeckRevealModalState.destination || 'hand',
    selected: {}
  };
  _desktopOpponentDeckRevealSignature = '';
  closeDesktopDeckRevealModal();
  closeDesktopDeckAllModal();
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
  const revealedZoneCards = Array.isArray(state.revealedZone) ? state.revealedZone : [];
  const deckRevealZoneCards = Array.isArray(state.deckRevealZone) ? state.deckRevealZone : [];

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
  const vs = window._vs;
  const olEff = ol || (vs ? { p: vs.activePlayer, p1Name: `P1 (${vs.p1DeckName})`, p2Name: `P2 (${vs.p2DeckName})` } : null);
  const opp = window._olOpponent || {};
  const myNum = olEff ? (olEff.p === 'p1' ? 1 : 2) : 1;
  const isMyTurn = vs ? true : (ol && window._olCurrentPlayer && window._olCurrentPlayer === myNum);
  const headerTurnClass = olEff ? (isMyTurn ? 'mine-turn' : 'opponent-turn') : 'solo-turn';
  const myName = olEff ? (olEff.p === 'p1' ? (olEff.p1Name || 'P1') : (olEff.p2Name || 'P2')) : '自分';
  const oppName = olEff ? (olEff.p === 'p1' ? (olEff.p2Name || 'P2') : (olEff.p1Name || 'P1')) : '相手';
  const backAction = ol ? 'desktopOnlineBackToDeckList()' : 'renderDesktopDeckList()';
  const shieldBreakLabel = _desktopSelectedShieldIdx === null ? 'シールド破壊' : `シールド破壊 (${_desktopSelectedShieldIdx + 1})`;

  const onlineStatusText = '';
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
    // grave は slice(-n) で index がずれるため操作対象にしない（-1）。battle/mana は slice(0,n) なので実 index。
    const chips = visibleCards.map((card, i) => renderChip(card, zoneClass, zoneClass === 'grave' ? -1 : i, vs ? 'vs-opp' : 'opponent')).join('');
    const rest = zone.length > visibleCards.length
      ? `<div class="dg-more-chip">+${zone.length - visibleCards.length}</div>`
      : '';

    return `<div class="dg-back-cards">${chips}${rest}</div>`;
  };

  const renderChip = (card, zoneClass, idx = -1, extra = '') => {
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
        : (zoneClass === 'grave'
          ? 'graveyard'
          : (zoneClass === 'revealed'
            ? 'revealedZone'
            : (zoneClass === 'hyper'
              ? 'hyperZone'
              : (zoneClass === 'gr'
                ? 'grZone'
                : (zoneClass === 'special' ? 'specialZone' : ''))))));
    const isOpponentCard = String(extra || '').includes('opponent');
    const isVsOpp = extra === 'vs-opp';
    const isOwnBoardCard = !isOpponentCard && !isVsOpp && idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isVsOppBoardCard = isVsOpp && idx >= 0 && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const isUnderSource = !!_desktopUnderInsertState
      && _desktopUnderInsertState.fromZone === sourceZone
      && _desktopUnderInsertState.fromIndex === idx;

    const chipClasses = [
      'dg-card-chip',
      zoneClass,
      tapped,
      isVsOpp ? 'opponent' : extra,
      imageUrl ? 'has-image' : '',
      underCount > 0 ? 'has-under' : '',
      _desktopUnderInsertState && isOwnBoardCard ? 'stack-target' : '',
      isUnderSource ? 'under-source' : ''
    ].filter(Boolean).join(' ');

    // オンラインの相手 公開カード(バトル/マナ)は左クリックで相手操作メニュー
    const isOnlineOppBoard = isOpponentCard && !isVsOpp && idx >= 0
      && (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const onClickAttr = isOwnBoardCard
      ? `onclick="onDesktopBoardCardClick(event, '${sourceZone}', ${idx})"`
      : (isVsOppBoardCard ? `onclick="onDesktopVsOppBoardCardClick('${sourceZone}', ${idx})"`
        : (isOnlineOppBoard ? `onclick="onDesktopOppPublicCard(event, '${sourceZone}', ${idx})"` : ''));
    const _ctxIsTap = (sourceZone === 'battleZone' || sourceZone === 'manaZone');
    const contextMenuAttr = (!isOpponentCard && idx >= 0 && sourceZone)
      ? (isVsOpp
        ? `oncontextmenu="openDesktopVsOppZoneMenu(event, '${sourceZone}', ${idx})"`
        : (_ctxIsTap
          ? `oncontextmenu="onDesktopBoardCardContext(event, '${sourceZone}', ${idx})"`
          : `oncontextmenu="openDesktopCardZoneMenu(event, '${sourceZone}', ${idx})"`))
      : '';

    const directUnderCount = Array.isArray(card?.underCards) ? Math.min(card.underCards.length, 3) : 0;
    const tapBtnHtml = isOwnBoardCard
      ? `<button class="dg-tap-btn" onclick="event.stopPropagation(); tapDesktopCard('${sourceZone}', ${idx})" title="タップ/アンタップ">↻</button>`
      : isVsOppBoardCard
        ? `<button class="dg-tap-btn" onclick="event.stopPropagation(); onDesktopVsOppBoardCardClick('${sourceZone}', ${idx})" title="タップ/アンタップ">↻</button>`
        : '';
    return `
      <div class="${chipClasses}"
        title="${escapeHtml(card?.name || '')}"
        ${onClickAttr}
        ${contextMenuAttr}
        data-zone="${sourceZone}"
        data-index="${idx}"
        ${directUnderCount > 0 ? `style="margin-left:${directUnderCount * 5}px"` : ''}>
        ${underCount > 0 ? renderDesktopUnderPeekLayers(card) : ''}
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card?.name || 'CARD')}" class="dg-card-chip-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
          : `<div class="dg-card-cost">${escapeHtml(String(cost))}</div>
        <div class="dg-card-name">${escapeHtml(shortName)}</div>
        <div class="dg-card-power">${escapeHtml(power)}</div>`}
        ${tapBtnHtml}
      </div>
    `;
  };

  const renderPublicPreviewChip = (card) => {
    const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
    const power = card?.power ? String(card.power) : '';
    const shortName = getDesktopCardShortName(card?.name || '', 8);
    const imageUrl = getDesktopCardImageUrl(card);
    return `
      <div class="dg-card-chip revealed ${imageUrl ? 'has-image' : ''}" title="${escapeHtml(card?.name || '')}">
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
  const hasDeckCard = state.deck.length > 0;
  const graveTopCard = state.graveyard.length ? state.graveyard[state.graveyard.length - 1] : null;
  const graveTopImage = getDesktopCardImageUrl(graveTopCard);

  container.innerHTML = `
    <div class="dg-full-root dg-v2${!olEff ? ' dg-v2-solo' : ''}">
      <div class="dg-v2-header ${headerTurnClass}">
        <div class="dg-v2-head-left">
          <div class="dg-turn-pill">T<b>${state.turn}</b> 手<b>${state.hand.length}</b> マナ<b>${state.manaZone.length}</b></div>
          ${vs ? `<div class="dg-full-state mine">VS: ${escapeHtml(vs.activePlayer === 'p1' ? `P1 (${vs.p1DeckName})` : `P2 (${vs.p2DeckName})`)} のターン</div>` : ol ? `<div class="dg-full-state ${isMyTurn ? 'mine' : 'opponent'}">${isMyTurn ? 'あなたのターン' : '相手のターン'}</div>` : '<div class="dg-full-state solo">一人回し</div>'}}
          ${olEff ? `<span class="dg-v2-match">${escapeHtml(myName)} vs ${escapeHtml(oppName)}</span>` : ''}
          ${onlineStatusText ? `<span class="dg-v2-match">${escapeHtml(onlineStatusText)}</span>` : ''}
        </div>
                <div class="dg-v2-head-actions">
          <button onclick="turnDesktopEnd()" class="dg-btn end">ターン終了</button>
          ${!window._ol ? `<button onclick="undoDesktopGame()" class="dg-btn undo">やり直し</button>` : ''}
          <button onclick="${backAction}" class="dg-btn back">戻る</button>
        </div>
      </div>

      <div class="dg-v2-body">
        <div class="dg-v2-board">
          ${_desktopUnderInsertState ? '<div class="dg-v2-hint">重ね先を選択: バトル/マナ/シールドのカードをクリック</div>' : ''}

          ${olEff ? `
          <div class="dg-v2-row opp-hand">
            <span class="dg-v2-label">手札<br><b>${Number(opp.hand ?? 0)}</b></span>
            <div class="dg-v2-cards dg-opp-clickable" onclick="onDesktopOppRevealZone(event, 'hand')" title="クリックで相手の手札を表向きにして確認・操作">
              ${vs
                ? (opp.handCards || []).map((c, i) => renderChip(c, 'hand', i, 'vs-opp')).join('')
                : renderDesktopBackCards(Number(opp.hand ?? 0))}
            </div>
            <button type="button" class="dg-v2-pile-btn ex" onclick="openDesktopOppExView('hyperZone')" title="相手の超次元ゾーン（公開）">
              <span class="dg-v2-pile-name">超次元</span>
              <span class="dg-v2-pile-cnt">${getZoneCount(opp.hyperZone)}</span>
            </button>
            <button type="button" class="dg-v2-pile-btn ex" onclick="onDesktopOppRevealZone(event, 'grZone')" title="クリックで相手のGRを表向きにして確認・操作">
              <span class="dg-v2-pile-name">GR</span>
              <span class="dg-v2-pile-cnt">${getZoneCount(opp.grZone)}</span>
            </button>
          </div>

          <div class="dg-v2-row opp-mana">
            <span class="dg-v2-label">マナ<br><b>${getZoneCount(opp.manaZone)}</b></span>
            <div class="dg-v2-cards">
              ${renderOpponentPublicZone(opp.manaZone, 'mana')}
            </div>
            <div class="dg-v2-pile-btn grave" style="pointer-events:none">
              <span class="dg-v2-pile-name">墓地</span>
              <span class="dg-v2-pile-cnt">${getZoneCount(opp.graveyard ?? 0)}</span>
            </div>
          </div>

          <div class="dg-v2-row opp-shield">
            <span class="dg-v2-label">シールド<br><b>${Number(opp.shields ?? 0)}</b></span>
            <div class="dg-v2-cards dg-opp-clickable" onclick="onDesktopOppRevealZone(event, 'shields')" title="クリックで相手のシールドを表向きにして確認・操作">
              ${renderDesktopBackCards(Number(opp.shields ?? 0), 'shield')}
            </div>
            <button type="button" class="dg-v2-pile-btn deck" onclick="onDesktopOppRevealZone(event, 'deck')" title="クリックで相手の山札を表向きにして確認・操作">
              <span class="dg-v2-pile-name">山札</span>
              <span class="dg-v2-pile-cnt">${getZoneCount(opp.deck ?? 0)}</span>
            </button>
          </div>

          <div class="dg-v2-row opp-battle">
            <span class="dg-v2-label">バトル<br><b>${getZoneCount(opp.battleZone)}</b></span>
            <div class="dg-v2-cards">
              ${renderOpponentPublicZone(opp.battleZone, 'battle')}
            </div>
          </div>


          <div class="dg-v2-sep"></div>
          ` : ''}

          <div class="dg-v2-row my-battle">
            <span class="dg-v2-label">バトル<br><b>${state.battleZone.length}</b></span>
            <div id="desktop-battle-zone" class="dg-v2-cards" ondrop="dropDesktopCard(event, 'battle')" ondragover="dragDesktopOver(event)">
              ${state.battleZone.length ? state.battleZone.map((c, i) => renderChip(c, 'battle', i)).join('') : '<div class="dg-zone-empty">空</div>'}
            </div>
          </div>

          <div class="dg-v2-row my-shield">
            <span class="dg-v2-label">シールド<br><b>${state.shields.length}</b></span>
            <div class="dg-v2-cards">
              ${state.shields.length ? state.shields.map((c, i) => {
                const imageUrl = getDesktopCardImageUrl(c);
                const shortName = getDesktopCardShortName(c?.name || '', 9);
                const underCount = getDesktopUnderCardCount(c);
                return `
                  <div class="dg-card-chip shield ${c?.faceUp ? 'faceup' : ''} ${imageUrl && c?.faceUp ? 'has-image' : ''} ${underCount > 0 ? 'has-under' : ''} ${_desktopSelectedShieldIdx === i ? 'selected' : ''} ${_desktopUnderInsertState ? 'stack-target' : ''}"
                    onclick="onDesktopShieldCardClick(event, ${i})"
                    oncontextmenu="onDesktopShieldContext(event, ${i})"
                    title="${escapeHtml(c?.faceUp ? (c.name || 'シールド') : 'シールド')}"
                    data-zone="shields" data-index="${i}">
                    ${underCount > 0 ? `<div class="dg-under-stack" aria-hidden="true">${renderDesktopUnderLayers(underCount)}</div><div class="dg-under-count">+${underCount}</div>` : ''}
                    ${c?.faceUp
                      ? (imageUrl
                        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.name || 'SHIELD')}" class="dg-card-chip-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
                        : `<div class="dg-card-name">${escapeHtml(shortName || 'SH')}</div>`)
                      : ''}
                  </div>
                `;
              }).join('') : '<div class="dg-zone-empty">空</div>'}
            </div>
            <button type="button" class="dg-v2-pile-btn deck"
              onclick="openDesktopDeckTopMenu(event)" oncontextmenu="onDesktopDeckContext(event)" title="山札">
              <span class="dg-v2-pile-name">山札</span>
              <span class="dg-v2-pile-cnt">${state.deck.length}</span>
            </button>
          </div>

          <div class="dg-v2-row my-mana">
            <span class="dg-v2-label">マナ<br><b>${state.manaZone.length}</b></span>
            <div id="desktop-mana-zone" class="dg-v2-cards" ondrop="dropDesktopCard(event, 'mana')" ondragover="dragDesktopOver(event)">
              ${state.manaZone.length ? state.manaZone.map((c, i) => renderChip(c, 'mana', i)).join('') : '<div class="dg-zone-empty">空</div>'}
            </div>
            <button type="button" class="dg-v2-pile-btn grave ${graveTopImage ? 'has-image' : ''}"
              onclick="openDesktopGraveyardModal()"
              ${state.graveyard.length ? `oncontextmenu="onDesktopGraveContext(event)"` : ''}
              title="墓地">
              ${graveTopImage ? `<img src="${escapeHtml(graveTopImage)}" alt="墓地トップ" class="dg-v2-pile-thumb" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">` : ''}
              <span class="dg-v2-pile-name">墓地</span>
              <span class="dg-v2-pile-cnt">${state.graveyard.length}</span>
            </button>
          </div>


          <div class="dg-v2-row my-hand">
            <span class="dg-v2-label">手札<br><b>${state.hand.length}</b></span>
            <div id="desktop-hand-zone" class="dg-v2-cards">
              ${state.hand.length ? state.hand.map((c, i) => {
                const cost = Number.isFinite(Number(c?.cost)) ? Number(c.cost) : '-';
                const power = c?.power ? String(c.power) : '';
                const imageUrl = getDesktopCardImageUrl(c);
                return `
                  <div class="dg-card-chip hand ${imageUrl ? 'has-image' : ''}" draggable="true"
                    onclick="openDesktopCardZoneMenu(event, 'hand', ${i})"
                    oncontextmenu="openDesktopCardZoneMenu(event, 'hand', ${i})"
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
              }).join('') : '<div class="dg-zone-empty">空</div>'}
            </div>
            <button type="button" class="dg-v2-pile-btn ex" onclick="openDesktopExPileModal('hyperZone')" title="超次元ゾーン">
              <span class="dg-v2-pile-name">超次元</span>
              <span class="dg-v2-pile-cnt">${state.hyperZone.length}</span>
            </button>
            <button type="button" class="dg-v2-pile-btn ex" onclick="openDesktopExPileModal('grZone')" title="GRデッキ">
              <span class="dg-v2-pile-name">GR</span>
              <span class="dg-v2-pile-cnt">${state.grZone.length}</span>
            </button>
          </div>

          ${revealedZoneCards.length ? `
          <div class="dg-v2-row my-revealed">
            <span class="dg-v2-label">公開<br><b>${revealedZoneCards.length}</b></span>
            <div class="dg-v2-cards">
              ${revealedZoneCards.map((c, i) => `
                <div class="dg-revealed-item">
                  ${renderChip(c, 'revealed', i)}
                  <div class="dg-revealed-actions">
                    <button type="button" class="dg-revealed-btn hand" onclick="resolveDesktopRevealedToHand(${i})">手札へ</button>
                    <button type="button" class="dg-revealed-btn trigger" onclick="useDesktopRevealedAsTrigger(${i})">トリガー</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          ${deckRevealZoneCards.length ? `
          <div class="dg-v2-row my-revealed">
            <span class="dg-v2-label">山札公開<br><b>${deckRevealZoneCards.length}</b></span>
            <div class="dg-v2-cards">
              ${deckRevealZoneCards.map((c) => `
                <div class="dg-revealed-item">
                  ${renderPublicPreviewChip(c)}
                  <div class="dg-revealed-actions">
                    <button type="button" class="dg-revealed-btn hand" onclick="openDesktopDeckRevealModal('public')">処理</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        </div>

                <div class="dg-v2-chat">
          <div class="dg-side-log">
            <div class="dg-chat-title">ログ</div>
            <div class="dg-side-log-list" id="desktop-game-log">
              ${_desktopGameLog.length ? _desktopGameLog.slice().reverse().map(e => `<div class="dg-side-log-entry">${escapeHtml(e)}</div>`).join('') : '<div class="dg-side-log-empty">—</div>'}
            </div>
          </div>
          ${ol && !vs ? `
          <div class="dg-side-chat">
            <div class="dg-chat-title">チャット</div>
            <div id="desktop-chat-messages" class="dg-chat-messages"></div>
          </div>
          ` : ''}
        </div>
      </div>

    </div>
  `;

  if (ol) renderDesktopChatMessages();
  renderDesktopDeckRevealModal();
  renderDesktopDeckAllModal();
  if (_desktopBreakOpen) renderDesktopBreakModal();
}

function closeDesktopHandPicker() {
  const picker = document.getElementById('desktop-hand-picker');
  if (picker) picker.remove();
}

function openDesktopOppExView(zoneKey) {
  const opp = window._olOpponent || {};
  const cards = Array.isArray(opp[zoneKey]) ? opp[zoneKey] : [];
  const label = zoneKey === 'hyperZone' ? '相手の超次元ゾーン' : getDesktopZoneLabel(zoneKey);
  if (!cards.length) { showDesktopToast(`${label}は空です`, 'info'); return; }
  let modal = document.getElementById('desktop-oppex-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-oppex-modal';
    modal.className = 'dm-grave-modal';
    modal.innerHTML = `
      <div class="dm-grave-backdrop" onclick="closeDesktopOppExView()"></div>
      <div class="dm-grave-body">
        <div class="dm-grave-head">
          <div class="dm-grave-title" id="desktop-oppex-title"></div>
          <button class="dm-grave-close" onclick="closeDesktopOppExView()">閉じる</button>
        </div>
        <div id="desktop-oppex-list" class="dm-grave-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const t = document.getElementById('desktop-oppex-title');
  if (t) t.textContent = `${label} (${cards.length})`;
  const list = document.getElementById('desktop-oppex-list');
  if (list) {
    list.innerHTML = cards.map((card, i) => {
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item">
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
function closeDesktopOppExView() {
  const modal = document.getElementById('desktop-oppex-modal');
  if (modal) modal.classList.remove('open');
}

function onDesktopBoardCardContext(event, zone, idx) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  tapDesktopCard(zone, idx);
}
function onDesktopShieldContext(event, idx) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  breakDesktopShieldToModal(idx);
}
function onDesktopDeckContext(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  drawDesktopCard();
}
function onDesktopGraveContext(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  openDesktopGraveyardModal();
}

// ── シールド ブレイクモーダル ───────────────────────────────────────────
let _desktopBreakOpen = false;
function breakDesktopShieldToModal(shieldIndex) {
  if (window._ol && !canActDesktopOnline()) { showDesktopToast('相手のターンです', 'warn'); return; }
  closeDesktopCardZoneMenu();
  const idx = Number(shieldIndex);
  const shields = engine?.state?.shields;
  if (!Array.isArray(shields) || !shields[idx]) { showDesktopToast('シールドがありません', 'warn'); return; }
  const res = window.GameController
    ? window.GameController.breakShield(engine, idx)
    : { ok: !!engine.breakShield(idx), card: (engine.state.revealedZone || []).slice(-1)[0] || null };
  if (!res || !res.ok) { showDesktopToast('シールドをブレイクできません', 'warn'); return; }
  const rz = engine.state.revealedZone || [];
  const card = res.card || rz[rz.length - 1];
  if (card) { card._breaking = true; card._originZone = 'shields'; }
  _desktopBreakOpen = true;
  _desktopSelectedShieldIdx = null;
  appendDesktopGameLog('シールドをブレイク');
  if (window._ol) {
    sendDesktopOnlineActionLog('【システム】相手がシールドをブレイク中');
    olSendActionDesktop('state');
  }
  renderDesktopGame();
}
function closeDesktopBreakModal() {
  _desktopBreakOpen = false;
  const modal = document.getElementById('desktop-break-modal');
  if (modal) modal.classList.remove('open');
}
function getDesktopBreakingCards() {
  const rz = engine?.state?.revealedZone;
  if (!Array.isArray(rz)) return [];
  const out = [];
  rz.forEach((c, i) => { if (c && c._breaking) out.push({ card: c, index: i }); });
  return out;
}
function resolveDesktopBreakAll(toZone) {
  let guard = 0;
  while (guard++ < 60) {
    const b = getDesktopBreakingCards();
    if (!b.length) break;
    const { index, card } = b[0];
    if (card) {
      delete card._breaking;
      if (toZone === 'shields') { card.faceUp = false; card.tapped = false; }
    }
    moveDesktopCardBetweenZones('revealedZone', index, toZone, 'top');
  }
  closeDesktopBreakModal();
  renderDesktopGame();
}
function ensureDesktopBreakModal() {
  let modal = document.getElementById('desktop-break-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'desktop-break-modal';
  modal.className = 'dm-break-modal';
  modal.innerHTML = `
    <div class="dm-break-backdrop"></div>
    <div class="dm-break-body">
      <div class="dm-break-head">ブレイクしたシールド</div>
      <div id="desktop-break-cards" class="dm-break-cards"></div>
      <div class="dm-break-foot">
        <button class="dm-break-btn back" onclick="resolveDesktopBreakAll('shields')">もとに戻す</button>
        <button class="dm-break-btn hand" onclick="resolveDesktopBreakAll('hand')">手札に加える</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}
function renderDesktopBreakModal() {
  const breaking = getDesktopBreakingCards();
  if (!breaking.length) { closeDesktopBreakModal(); return; }
  const modal = ensureDesktopBreakModal();
  const wrap = document.getElementById('desktop-break-cards');
  if (wrap) {
    wrap.innerHTML = breaking.map(({ card, index }) => {
      const imageUrl = getDesktopCardImageUrl(card);
      const name = escapeHtml(card?.name || 'カード');
      return `
        <div class="dm-break-card" onclick="openDesktopCardZoneMenu(event, 'revealedZone', ${index})" oncontextmenu="openDesktopCardZoneMenu(event, 'revealedZone', ${index})" title="${name}">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" class="dm-break-card-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
            : `<div class="dm-break-card-name">${name}</div>`}
        </div>
      `;
    }).join('');
  }
  modal.classList.add('open');
}

function onDesktopBoardCardClick(event, zone, idx) {
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

  openDesktopCardZoneMenu(event, zone, idx);
}

function onDesktopShieldCardClick(event, idx) {
  if (_desktopUnderInsertState) {
    const sameSource = _desktopUnderInsertState.fromZone === 'shields'
      && _desktopUnderInsertState.fromIndex === idx;
    if (sameSource) {
      _desktopUnderInsertState = null;
      showDesktopToast('重ね配置をキャンセルしました', 'info');
      renderDesktopGame();
      return;
    }

    insertDesktopCardUnderTarget('shields', idx);
    return;
  }

  openDesktopCardZoneMenu(event, 'shields', idx);
}

function setDesktopCardTapped(zone, idx, tapped) {
  const _ms = _desktopZoneMenuState;
  const _oppRemote = !!_ms?.oppRemote;
  const _eng2 = _ms?.targetEngine || engine;
  const _isOppEng = _eng2 !== engine;
  closeDesktopCardZoneMenu();

  if (_oppRemote && window._ol) {
    sendDesktopOppOp({ op: 'tap', zone, index: Number(idx), tapped: !!tapped }, zone, null);
    return;
  }
  if (window._ol && !_isOppEng && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const cards = _eng2?.state?.[zone];
  const card = Array.isArray(cards) ? cards[idx] : null;
  if (!card) return;

  const nextTapped = !!tapped;
  const ok = window.GameController?.setCardTapped
    ? window.GameController.setCardTapped(_eng2, zone, idx, nextTapped)
    : ((!!card.tapped === nextTapped) ? true : _eng2.tapCard(zone, idx));
  if (!ok) {
    showDesktopToast('タップ状態を変更できませんでした', 'warn');
    return;
  }

  if (window._ol && !_isOppEng) olSendActionDesktop('state');
  if (window._vs) { _vsRefreshOpponentView(); if (_isOppEng) closeDesktopOppRevealModal(); }
  renderDesktopGame();
}

function openDesktopVsHandDiscardMenu() {
  const oppEngine = getVsOppEngine();
  const hand = oppEngine?.state?.hand;
  if (!Array.isArray(hand) || !hand.length) {
    showDesktopToast('相手の手札がありません', 'warn');
    return;
  }
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.remove('mobile');
  document.getElementById('dmHandDiscardTitle').textContent = 'ハンデス（疑似対戦）';
  const getCiv = (card) => {
    const c = String(card?.civ || card?.civilization || '').toLowerCase();
    if (c.includes('fire') || c.includes('火')) return 'fire';
    if (c.includes('water') || c.includes('水')) return 'water';
    if (c.includes('light') || c.includes('光')) return 'light';
    if (c.includes('darkness') || c.includes('dark') || c.includes('闇')) return 'dark';
    if (c.includes('nature') || c.includes('自然')) return 'nature';
    return 'multi';
  };
  document.getElementById('dmHandDiscardContent').innerHTML = `
    <div class="dm-hd-card-list">
      ${hand.map((c, i) => `
        <div class="dm-hd-card ${getCiv(c)}" onclick="executeDesktopVsDiscard(${i})">
          <div class="dm-hd-card-name">${escapeHtml(c?.name || 'CARD')}</div>
          <div class="dm-hd-card-cost">コスト: ${c?.cost ?? '-'}</div>
        </div>
      `).join('')}
    </div>
    <div style="text-align:center;margin-top:8px">
      <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">キャンセル</button>
    </div>
  `;
  el.classList.add('open');
}

function executeDesktopVsDiscard(index) {
  closeHandDiscardModal();
  const oppEngine = getVsOppEngine();
  const hand = oppEngine?.state?.hand;
  if (!Array.isArray(hand) || index < 0 || index >= hand.length) {
    showDesktopToast('対象カードが見つかりません', 'warn');
    return;
  }
  if (typeof oppEngine._saveState === 'function') oppEngine._saveState();
  const removed = hand.splice(index, 1);
  if (!removed.length) return;
  const card = removed[0];
  if (!oppEngine.state.graveyard) oppEngine.state.graveyard = [];
  oppEngine.state.graveyard.unshift(card);
  showDesktopToast(`「${card?.name || 'CARD'}」を墓地に送りました`, 'info', 2000);
  _vsRefreshOpponentView();
  renderDesktopGame();
}

function openDesktopHandDiscardMenu() {
  if (window._vs) {
    openDesktopVsHandDiscardMenu();
    return;
  }
  if (!window._ol) return;
  if (!canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }
  const opp = window._olOpponent;
  if (!opp || (opp.hand || 0) <= 0) {
    showDesktopToast('相手の手札がありません', 'warn');
    return;
  }
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  _handDiscardStateDesktop = { mode: 'selecting' };
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.remove('mobile');
  document.getElementById('dmHandDiscardTitle').textContent = 'ハンデス';
  document.getElementById('dmHandDiscardContent').innerHTML = `
    <div class="dm-hd-mode-btns">
      <button class="dm-hd-btn" onclick="startHandRevealDesktop()">手札を見て選ぶ</button>
      <button class="dm-hd-btn" onclick="startRandomDiscardDesktop()">ランダムに1枚</button>
    </div>
  `;
  el.classList.add('open');
}

function startHandRevealDesktop() {
  closeHandDiscardModal();
  _handDiscardStateDesktop = { mode: 'waiting' };
  sendHandActionDesktop('hand_reveal_request', {});
  showDesktopToast('相手の手札データを要求しました...', 'info', 2000);
}

function startRandomDiscardDesktop() {
  closeHandDiscardModal();
  sendHandActionDesktop('discard_random', {});
  showDesktopToast('ランダム捨て要求を送信しました', 'info', 2000);
}

function openDesktopHandSelectModal(cards) {
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  _handDiscardStateDesktop = { mode: 'selecting_card', cards };
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
        <div class="dm-hd-card ${getCiv(c)}" onclick="selectHandCardDesktop(${i})">
          ${c.imgUrl
            ? `<img src="${escapeHtml(c.imgUrl)}" alt="${escapeHtml(c.name || 'CARD')}" class="dm-hd-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="dm-hd-card-text"${c.imgUrl ? ' style="display:none"' : ''}>
            <div class="dm-hd-card-cost">${escapeHtml(String(c.cost ?? '-'))}</div>
            <div class="dm-hd-card-name">${escapeHtml(c.name || 'CARD')}</div>
            ${c.power ? `<div class="dm-hd-card-power">P${escapeHtml(String(c.power))}</div>` : ''}
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

function selectHandCardDesktop(index) {
  if (!_handDiscardStateDesktop?.cards) return;
  const card = _handDiscardStateDesktop.cards[index];
  if (!card) return;
  closeHandDiscardModal();
  sendHandActionDesktop('discard_select', { cardName: card.name });
  showDesktopToast(`「${card.name}」を捨てるよう要求しました`, 'info', 2500);
}

function openDesktopDiscardConfirmModal(cardName, isRandom) {
  const hand = engine?.state?.hand || [];
  if (!hand.length) {
    showDesktopToast('手札がありません', 'warn');
    return;
  }
  const el = document.getElementById('dmHandDiscardModal');
  if (!el) return;
  const bodyEl = document.getElementById('dmHandDiscardBody');
  if (bodyEl) bodyEl.classList.remove('mobile');
  let targetIndex = -1;
  let displayName = '';
  if (isRandom) {
    targetIndex = Math.floor(Math.random() * hand.length);
    displayName = hand[targetIndex]?.name || 'CARD';
    document.getElementById('dmHandDiscardTitle').textContent = 'ランダム捨て要求';
    document.getElementById('dmHandDiscardContent').innerHTML = `
      <div class="dm-hd-confirm-msg">相手からランダムに1枚捨てるよう要求されています。</div>
      <div class="dm-hd-confirm-card">${escapeHtml(displayName)}</div>
      <div class="dm-hd-confirm-btns">
        <button class="dm-hd-btn ok" onclick="executeDesktopDiscard(${targetIndex})">承認して捨てる</button>
        <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">却下</button>
      </div>
    `;
  } else {
    targetIndex = hand.findIndex(c => c?.name === cardName);
    if (targetIndex === -1) {
      showDesktopToast(`「${cardName}」は手札にありません`, 'warn');
      return;
    }
    displayName = cardName;
    document.getElementById('dmHandDiscardTitle').textContent = '捨て要求';
    document.getElementById('dmHandDiscardContent').innerHTML = `
      <div class="dm-hd-confirm-msg">相手から次のカードを捨てるよう要求されています。</div>
      <div class="dm-hd-confirm-card">${escapeHtml(displayName)}</div>
      <div class="dm-hd-confirm-btns">
        <button class="dm-hd-btn ok" onclick="executeDesktopDiscard(${targetIndex})">承認して捨てる</button>
        <button class="dm-hd-cancel" onclick="closeHandDiscardModal()">却下</button>
      </div>
    `;
  }
  _handDiscardStateDesktop = { mode: 'confirm', targetIndex };
  el.classList.add('open');
}

function executeDesktopDiscard(index) {
  closeHandDiscardModal();
  const hand = engine?.state?.hand;
  if (!Array.isArray(hand) || index < 0 || index >= hand.length) {
    showDesktopToast('対象カードが見つかりません', 'warn');
    return;
  }
  if (typeof engine._saveState === 'function') engine._saveState();
  const removed = hand.splice(index, 1);
  if (!removed.length) return;
  const card = removed[0];
  if (!engine.state.graveyard) engine.state.graveyard = [];
  engine.state.graveyard.unshift(card);
  showDesktopToast(`「${card?.name || 'CARD'}」を墓地に送りました`, 'info', 2000);
  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
}

function openDesktopUnderCardsModal(zone, idx) {
  closeDesktopCardZoneMenu();
  window._underModalState = { zone, idx, isMobile: false };
  if (typeof renderUnderCardsModal === 'function') renderUnderCardsModal();
  const bodyEl = document.getElementById('dmUnderBody');
  if (bodyEl) bodyEl.classList.remove('mobile');
  const el = document.getElementById('dmUnderModal');
  if (el) el.classList.add('open');
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
  showDesktopToast('重ね先のバトル/マナ/シールドをクリックしてください', 'info', 2800);
  renderDesktopGame();
}

function insertDesktopCardUnderTarget(targetZone, targetIndex) {
  if (!_desktopUnderInsertState) return;
  if (targetZone !== 'battleZone' && targetZone !== 'manaZone' && targetZone !== 'shields') {
    showDesktopToast('重ね先はバトル/マナ/シールドのみです', 'warn');
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
    ? window.GameController.tapCard(_eng(), zone, idx)
    : _eng().tapCard(zone, idx);
  if (!ok) return;
  if (window._ol) olSendActionDesktop('state');
  if (window._vs) _vsRefreshOpponentView();
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
  appendDesktopGameLog('シールドをブレイク');
  showDesktopToast('公開中に移動しました。手札に加えるか、トリガー使用を選んでください', 'info', 2800);
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
    hand: '\u624b\u672d',
    battle: '\u30d0\u30c8\u30eb\u30be\u30fc\u30f3',
    battleZone: '\u30d0\u30c8\u30eb\u30be\u30fc\u30f3',
    mana: '\u30de\u30ca\u30be\u30fc\u30f3',
    manaZone: '\u30de\u30ca\u30be\u30fc\u30f3',
    shields: '\u30b7\u30fc\u30eb\u30c9',
    revealedZone: '\u516c\u958b\u30be\u30fc\u30f3',
    deckRevealZone: '\u5c71\u672d\u516c\u958b\u30be\u30fc\u30f3',
    deck: '\u5c71\u672d',
    graveyard: '\u5893\u5730',
    hyperZone: '\u8d85\u6b21\u5143\u30be\u30fc\u30f3',
    grZone: '\u8d85GR\u30be\u30fc\u30f3',
    specialZone: '\u7279\u6b8a\u30be\u30fc\u30f3'
  };
  return labels[zoneKey] || zoneKey;
}

function isDesktopHiddenCardInfo(sourceZone, sourceCard) {
  if (sourceZone === 'deck') return true;
  if (sourceZone === 'shields') return !sourceCard?.faceUp;
  return false;
}

function getDesktopCardZoneActions(sourceZone, sourceCard) {
  const actions = [];
  const move = (label, toZone, position = 'top', red = false) => ({ kind: 'move', label, toZone, position, red });
  const sep = () => {
    if (actions.length && actions[actions.length - 1].kind !== 'sep') actions.push({ kind: 'sep' });
  };
  const addExternalTargets = () => {
    actions.push(
      move('超次元ゾーンへ', 'hyperZone'),
      move('GRゾーンへ', 'grZone')
    );
  };
  const addUnderControls = () => {
    actions.push({ kind: 'under', label: '\u3053\u306e\u30ab\u30fc\u30c9\u3092\u4e0b\u306b\u7f6e\u304f\uff08\u9032\u5316\u5143/\u5c01\u5370/\u4e0b\u6577\u304d\uff09' });
    if (Array.isArray(sourceCard?.underCards) && sourceCard.underCards.length > 0) {
      actions.push({ kind: 'viewUnder', label: `\u4e0b\u306e\u30ab\u30fc\u30c9\u3092\u898b\u308b/\u5916\u3059 (${sourceCard.underCards.length}\u679a)` });
    }
  };

  if (sourceZone === 'hand') {
    actions.push(
      move('\u624b\u672d \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u624b\u672d \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u624b\u672d \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u624b\u672d \u2192 \u30b7\u30fc\u30eb\u30c9\u8ffd\u52a0', 'shields'),
      move('\u624b\u672d \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u624b\u672d \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
    sep();
    actions.push({ kind: 'detail', label: 'カード詳細' });
    addUnderControls();
  } else if (sourceZone === 'battleZone') {
    actions.push(
      { kind: 'tap', label: sourceCard?.tapped ? '\u30a2\u30f3\u30bf\u30c3\u30d7\u3059\u308b' : '\u30bf\u30c3\u30d7\u3059\u308b', tapped: !sourceCard?.tapped },
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u624b\u672d', 'hand'),
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u30b7\u30fc\u30eb\u30c9', 'shields'),
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u30d0\u30c8\u30eb\u30be\u30fc\u30f3 \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
    sep();
    addUnderControls();
  } else if (sourceZone === 'manaZone') {
    actions.push(
      { kind: 'tap', label: sourceCard?.tapped ? '\u30a2\u30f3\u30bf\u30c3\u30d7\u3059\u308b' : '\u30bf\u30c3\u30d7\u3059\u308b\uff08\u30de\u30ca\u4f7f\u7528\uff09', tapped: !sourceCard?.tapped },
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u624b\u672d', 'hand'),
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u30b7\u30fc\u30eb\u30c9', 'shields'),
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u30de\u30ca\u30be\u30fc\u30f3 \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
    sep();
    addUnderControls();
  } else if (sourceZone === 'shields') {
    actions.push(
      { kind: 'break', label: 'ブレイク' },
      { kind: 'flip', label: sourceCard?.faceUp ? '\u88cf\u5411\u304d\u306b\u623b\u3059' : '\u8868\u5411\u304d\u306b\u3059\u308b/\u78ba\u8a8d\u6e08\u307f\u306b\u3059\u308b', faceUp: !sourceCard?.faceUp },
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u624b\u672d', 'hand'),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u516c\u958b\u30be\u30fc\u30f3\uff08\u30d6\u30ec\u30a4\u30af\uff09', 'revealedZone'),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u30b7\u30fc\u30eb\u30c9 \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
    sep();
    addUnderControls();
  } else if (sourceZone === 'revealedZone' || sourceZone === 'deckRevealZone') {
    actions.push(
      move('\u516c\u958b\u4e2d \u2192 \u624b\u672d', 'hand'),
      move('\u516c\u958b\u4e2d \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u516c\u958b\u4e2d \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u516c\u958b\u4e2d \u2192 \u30b7\u30fc\u30eb\u30c9', 'shields'),
      move('\u516c\u958b\u4e2d \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u516c\u958b\u4e2d \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u516c\u958b\u4e2d \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
  } else if (sourceZone === 'graveyard') {
    actions.push(
      move('\u5893\u5730 \u2192 \u624b\u672d', 'hand'),
      move('\u5893\u5730 \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u5893\u5730 \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u5893\u5730 \u2192 \u30b7\u30fc\u30eb\u30c9', 'shields'),
      move('\u5893\u5730 \u2192 \u5c71\u672d\u4e0a', 'deck', 'top'),
      move('\u5893\u5730 \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom')
    );
  } else if (sourceZone === 'deck') {
    actions.push(
      move('\u5c71\u672d\u4e0a \u2192 \u624b\u672d', 'hand'),
      move('\u5c71\u672d\u4e0a \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3', 'battleZone'),
      move('\u5c71\u672d\u4e0a \u2192 \u30de\u30ca\u30be\u30fc\u30f3', 'manaZone'),
      move('\u5c71\u672d\u4e0a \u2192 \u30b7\u30fc\u30eb\u30c9', 'shields'),
      move('\u5c71\u672d\u4e0a \u2192 \u5893\u5730', 'graveyard', 'top', true),
      move('\u5c71\u672d\u4e0a \u2192 \u5c71\u672d\u4e0b', 'deck', 'bottom'),
      { kind: 'deckAll', label: '\u5c71\u672d\u3092\u5168\u90e8\u898b\u308b/\u9806\u756a\u78ba\u8a8d' }
    );
  } else if (['hyperZone', 'grZone', 'specialZone'].includes(sourceZone)) {
    actions.push(
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3`, 'battleZone'),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u624b\u672d`, 'hand'),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u30de\u30ca\u30be\u30fc\u30f3`, 'manaZone'),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u5893\u5730`, 'graveyard', 'top', true),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u30b7\u30fc\u30eb\u30c9`, 'shields'),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u5c71\u672d\u4e0a`, 'deck', 'top'),
      move(`${getDesktopZoneLabel(sourceZone)} \u2192 \u5c71\u672d\u4e0b`, 'deck', 'bottom')
    );
  }

  if (!['hyperZone', 'grZone', 'specialZone'].includes(sourceZone)) {
    sep();
    addExternalTargets();
  }

  while (actions.length && actions[actions.length - 1].kind === 'sep') actions.pop();

  const canShowDetail = !window._ol || !isDesktopHiddenCardInfo(sourceZone, sourceCard);
  if (actions.length && canShowDetail) actions.push({ kind: 'sep' });
  if (canShowDetail) actions.push({ kind: 'detail', label: '\u30ab\u30fc\u30c9\u8a73\u7d30' });

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
  // メニュー状態は close で消えるので先に捕捉（相手操作の対象判定に使う）
  const _ms = _desktopZoneMenuState;
  const _oppRemote = !!_ms?.oppRemote;
  const _eng2 = _ms?.targetEngine || engine;
  const _isOppEng = _eng2 !== engine;
  closeDesktopCardZoneMenu();

  const options = { position: position === 'bottom' ? 'bottom' : 'top' };
  const toLabelLog = toZone === 'deck'
    ? `${getDesktopZoneLabel(toZone)}${options.position === 'bottom' ? '下' : '上'}`
    : getDesktopZoneLabel(toZone);

  // オンライン: 相手カードの操作は相手端末へ送って適用させる
  if (_oppRemote && window._ol) {
    sendDesktopOppOp({ op: 'move', fromZone, fromIndex: Number(fromIndex), toZone, position: options.position }, fromZone, toLabelLog);
    return;
  }

  // 自分のカードのみターン制限（疑似対戦の相手エンジン操作は常に可）
  if (window._ol && !_isOppEng && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const movedCard = _eng2?.state?.[fromZone]?.[Number(fromIndex)];
  const movedName = movedCard?.name || 'カード';
  // 公開ゾーンに入るカードには「元いたゾーン」を覚えさせ、出る時のログ表示に使う
  // （例: ブレイクで シールド→公開ゾーン になったカードは、戻す/手札に入れる時に「シールド」と出す）
  if (toZone === 'revealedZone' && movedCard) movedCard._originZone = fromZone;
  const fromLabel = (fromZone === 'revealedZone' && movedCard?._originZone)
    ? getDesktopZoneLabel(movedCard._originZone)
    : getDesktopZoneLabel(fromZone);
  const ok = window.GameController
    ? window.GameController.moveCardBetweenZones(_eng2, fromZone, fromIndex, toZone, options)
    : _eng2.moveCardBetweenZones(fromZone, fromIndex, toZone, options);

  if (!ok) {
    showDesktopToast('カード移動に失敗しました', 'warn');
    return;
  }

  // 公開ゾーンから出たら元ゾーン情報は用済み
  if (fromZone === 'revealedZone' && movedCard) delete movedCard._originZone;

  appendDesktopGameLog(`${_isOppEng ? '相手 ' : ''}${movedName} : ${fromLabel}→${toLabelLog}`);
  if (window._ol && !_isOppEng) {
    sendDesktopOnlineActionLog(`【操作ログ】${fromLabel} → ${toLabelLog}`);
    olSendActionDesktop('state');
  }
  if (window._vs) { _vsRefreshOpponentView(); if (_isOppEng) closeDesktopOppRevealModal(); }
  renderDesktopGame();
}

function resolveDesktopRevealedToHand(index) {
  moveDesktopCardBetweenZones('revealedZone', Number(index), 'hand', 'top');
}

function useDesktopRevealedAsTrigger(index) {
  moveDesktopCardBetweenZones('revealedZone', Number(index), 'graveyard', 'top');
}

function setDesktopShieldFaceUp(index, faceUp) {
  const _ms = _desktopZoneMenuState;
  const _oppRemote = !!_ms?.oppRemote;
  const _eng2 = _ms?.targetEngine || engine;
  const _isOppEng = _eng2 !== engine;
  closeDesktopCardZoneMenu();

  if (_oppRemote && window._ol) {
    sendDesktopOppOp({ op: 'flip', index: Number(index), faceUp: !!faceUp }, 'shields', null);
    return;
  }
  if (window._ol && !_isOppEng && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const idx = Number(index);
  if (!Number.isInteger(idx)) return;

  const ok = window.GameController?.setShieldFaceUp
    ? window.GameController.setShieldFaceUp(_eng2, idx, !!faceUp)
    : (typeof _eng2.setShieldFaceUp === 'function' ? _eng2.setShieldFaceUp(idx, !!faceUp) : false);
  if (!ok) {
    showDesktopToast('シールドの向きを変更できませんでした', 'warn');
    return;
  }

  if (window._ol && !_isOppEng) olSendActionDesktop('state');
  if (window._vs) { _vsRefreshOpponentView(); if (_isOppEng) closeDesktopOppRevealModal(); }
  renderDesktopGame();
}

function untapAllDesktopMana() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const ok = window.GameController?.untapAllMana
    ? window.GameController.untapAllMana(engine)
    : (typeof engine.untapAllMana === 'function' ? engine.untapAllMana() : false);
  if (!ok) {
    showDesktopToast('マナゾーンにアンタップ対象がありません', 'info');
    return;
  }

  appendDesktopGameLog('マナを全アンタップ');
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

async function openDesktopCardDetailFromZone(sourceZone, sourceIndex) {
  const source = engine?.state?.[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !Number.isInteger(idx) || !source[idx]) {
    showDesktopToast('カード情報が見つかりません', 'warn');
    return;
  }

  const card = source[idx];
  const hiddenCardInfo = isDesktopHiddenCardInfo(sourceZone, card);
  closeDesktopCardZoneMenu();

  if (hiddenCardInfo && window._ol) {
    showDesktopToast('オンライン対戦では非公開カードの詳細は確認できません', 'warn');
    return;
  }

  if (hiddenCardInfo && !window._ol) {
    const zoneLabel = getDesktopZoneLabel(sourceZone);
    const ok = await askDesktopConfirm(`${zoneLabel}の非公開カードを確認しますか？`, '見る', 'キャンセル');
    if (!ok) return;
  }

  const zoneKey = sourceZone;
  const zoneIdx = idx;
  showDesktopCardDetail(card, {
    allowAdd: false,
    onCardChange: (nextCard) => {
      const zoneCards = engine?.state?.[zoneKey];
      if (!Array.isArray(zoneCards) || !zoneCards[zoneIdx]) return;

      const current = zoneCards[zoneIdx];
      zoneCards[zoneIdx] = mergeDesktopCardIllustration(current, nextCard);

      if (window._ol) olSendActionDesktop('state');
      renderDesktopGame();
    }
  });
}

function openDesktopCardZoneMenu(event, sourceZone, sourceIndex) {
  event.preventDefault();
  event.stopPropagation();
  closeDesktopHandPicker();

  if (!engine || !engine.state) return;

  const oppRemote = _oppRemoteTarget;
  _oppRemoteTarget = false;
  const targetEngine = _vsOppTarget ? getVsOppEngine() : null;
  _vsOppTarget = false;
  const isOpp = !!targetEngine || oppRemote;

  // 相手カードの操作は相手のターン中でも許可（身内用）。自分のカードは従来どおりターン制限。
  if (window._ol && !isOpp && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const activeEng = targetEngine || engine;
  const source = oppRemote ? (_desktopOppPeekCards || []) : activeEng.state[sourceZone];
  const idx = Number(sourceIndex);
  if (!Array.isArray(source) || !source.length || !Number.isInteger(idx) || !source[idx]) {
    showDesktopToast('移動できるカードがありません', 'warn');
    return;
  }

  const sourceCard = source[idx];
  const actions = isOpp ? getDesktopOppCardActions(sourceZone, sourceCard) : getDesktopCardZoneActions(sourceZone, sourceCard);
  if (!actions.length) return;

  const menu = ensureDesktopCardZoneMenu();
  _desktopZoneMenuState = { sourceZone, sourceIndex: idx, targetEngine, oppRemote, oppCards: oppRemote ? source : null };

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

    if (action.kind === 'viewUnder') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openDesktopUnderCardsModal('${sourceZone}', ${idx})">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'flip') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="setDesktopShieldFaceUp(${idx}, ${action.faceUp ? 'true' : 'false'})">
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

    if (action.kind === 'break') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="closeDesktopCardZoneMenu(); breakDesktopShieldToModal(${idx})">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'deckAll') {
      return `
        <button
          type="button"
          class="${className}"
          onclick="openDesktopDeckAllModal()">
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
    <div class="dg-zone-menu-head">${isOpp ? '相手の' : ''}${escapeHtml(getDesktopZoneLabel(sourceZone))} の操作</div>
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

function openDesktopVsOppZoneMenu(event, zone, idx) {
  _vsOppTarget = true;
  openDesktopCardZoneMenu(event, zone, idx);
}

function onDesktopVsOppBoardCardClick(zone, idx) {
  const vs = window._vs;
  if (!vs) return;
  const saved = _desktopZoneMenuState;
  _desktopZoneMenuState = { sourceZone: zone, sourceIndex: idx, targetEngine: getVsOppEngine() };
  tapDesktopCard(zone, idx);
  if (_desktopZoneMenuState) _desktopZoneMenuState = saved;
}

/* ───────────────────────────────────────────────────────────────────────
   相手カードの確認・操作（身内用 / 不正対策なし・操作はログに流れる）
   - 疑似対戦(_vs): 相手エンジンが手元にあるので直接操作（targetEngine 機構を流用）
   - オンライン(_ol): 非公開ゾーンは peek_request で相手から取り寄せ、操作は opp_op を相手へ送って適用させる
   非公開ゾーン(手札/シールド/山札/GR)＝確認ダイアログ→公開一覧→操作。公開ゾーン(バトル/マナ)＝直接操作。
   ─────────────────────────────────────────────────────────────────────── */
let _desktopOppRevealState = null; // { zone, mode:'vs'|'online', cards }

// はい/いいえ 確認ダイアログ
function _confirmDesktop(message, onYes) {
  let modal = document.getElementById('desktop-confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-confirm-modal';
    modal.className = 'dm-confirm-modal';
    modal.innerHTML = `
      <div class="dm-confirm-backdrop"></div>
      <div class="dm-confirm-body">
        <div class="dm-confirm-msg" id="desktop-confirm-msg"></div>
        <div class="dm-confirm-foot">
          <button class="dm-confirm-btn no" id="desktop-confirm-no">いいえ</button>
          <button class="dm-confirm-btn yes" id="desktop-confirm-yes">はい</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('desktop-confirm-msg').textContent = message;
  const close = () => modal.classList.remove('open');
  modal.querySelector('.dm-confirm-backdrop').onclick = close;
  document.getElementById('desktop-confirm-no').onclick = close;
  document.getElementById('desktop-confirm-yes').onclick = () => { close(); onYes(); };
  modal.classList.add('open');
}

// 非公開ゾーン（手札/シールド/山札/GR）を触ったとき → 確認 → 公開
function onDesktopOppRevealZone(event, zone) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const reveal = () => {
    if (window._vs) {
      const cards = (getVsOppEngine()?.state?.[zone]) || [];
      if (!cards.length) { showDesktopToast('相手のカードがありません', 'warn'); return; }
      openDesktopOppRevealModal(zone);
    } else if (window._ol) {
      _desktopOppRevealState = { zone, mode: 'online', cards: [] };
      sendHandActionDesktop('peek_request', { zone });
      sendDesktopOnlineActionLog(`【システム】相手があなたの${getDesktopZoneLabel(zone)}を表向きで確認中`);
      appendDesktopGameLog(`相手の${getDesktopZoneLabel(zone)}を確認`);
      showDesktopToast('相手のカードを取得中...', 'info', 1500);
    }
  };
  _confirmDesktop(`相手の${getDesktopZoneLabel(zone)}を表向きにして確認しますか？`, reveal);
}

// 公開ゾーン（相手のバトル/マナ）のカードを触ったとき → 直接 操作メニュー
function onDesktopOppPublicCard(event, zone, idx) {
  if (window._vs) { openDesktopVsOppZoneMenu(event, zone, idx); return; }
  if (window._ol) {
    const cards = window._olOpponent?.[zone];
    if (!Array.isArray(cards) || !cards[Number(idx)]) { showDesktopToast('カードが見つかりません', 'warn'); return; }
    openDesktopOppRemoteZoneMenu(event, zone, Number(idx), cards);
  }
}

function closeDesktopOppRevealModal() {
  _desktopOppRevealState = null;
  const modal = document.getElementById('desktop-opp-reveal-modal');
  if (modal) modal.classList.remove('open');
}

function openDesktopOppRevealModal(zone, cardsOverride) {
  const mode = window._vs ? 'vs' : 'online';
  let cards;
  if (mode === 'vs') {
    cards = (getVsOppEngine()?.state?.[zone]) || [];
  } else {
    cards = Array.isArray(cardsOverride) ? cardsOverride : [];
    _desktopOppPeekCards = cards;
  }
  _desktopOppRevealState = { zone, mode, cards };
  if (!cards.length) { showDesktopToast('相手のカードがありません', 'warn'); closeDesktopOppRevealModal(); return; }

  let modal = document.getElementById('desktop-opp-reveal-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-opp-reveal-modal';
    modal.className = 'dm-grave-modal';
    modal.innerHTML = `
      <div class="dm-grave-backdrop" onclick="closeDesktopOppRevealModal()"></div>
      <div class="dm-grave-body">
        <div class="dm-grave-head">
          <div class="dm-grave-title" id="desktop-opp-reveal-title"></div>
          <button class="dm-grave-close" onclick="closeDesktopOppRevealModal()">閉じる</button>
        </div>
        <div class="dm-grave-note">カードをクリックで操作（相手領域・操作はログに残ります）</div>
        <div id="desktop-opp-reveal-list" class="dm-grave-list"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const titleEl = document.getElementById('desktop-opp-reveal-title');
  if (titleEl) titleEl.textContent = `相手の${getDesktopZoneLabel(zone)} (${cards.length})`;
  const list = document.getElementById('desktop-opp-reveal-list');
  if (list) {
    list.innerHTML = cards.map((card, i) => {
      const imageUrl = getDesktopCardImageUrl(card);
      const name = escapeHtml(card?.name || 'カード');
      return `
        <div class="dm-grave-item dm-opp-reveal-item" onclick="onDesktopOppRevealCardClick(event, ${i})" title="${name}">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" class="dm-opp-reveal-img" loading="lazy" decoding="async" onerror="handleDesktopCardImageError(this)">`
            : `<div class="dm-grave-item-main"><div class="dm-grave-item-name">${name}</div></div>`}
        </div>`;
    }).join('');
  }
  modal.classList.add('open');
}

function onDesktopOppRevealCardClick(event, idx) {
  const st = _desktopOppRevealState;
  if (!st) return;
  if (st.mode === 'vs') {
    closeDesktopOppRevealModal();
    openDesktopVsOppZoneMenu(event, st.zone, Number(idx));
  } else {
    openDesktopOppRemoteZoneMenu(event, st.zone, Number(idx), st.cards);
  }
}

// オンライン: 相手カード用の操作メニューを開く（dispatch は opp_op 送信になる）
function openDesktopOppRemoteZoneMenu(event, zone, idx, cards) {
  _oppRemoteTarget = true;
  _desktopOppPeekCards = Array.isArray(cards) ? cards : [];
  openDesktopCardZoneMenu(event, zone, Number(idx));
}

// 相手カード用の操作リスト（移動＋タップ＋シールド表裏のみ。break/deckAll/重ねは対象外）
function getDesktopOppCardActions(sourceZone, sourceCard) {
  const actions = [];
  const move = (label, toZone, position = 'top', red = false) => ({ kind: 'move', label, toZone, position, red });
  const zones = [
    ['battleZone', 'バトルゾーン'], ['manaZone', 'マナゾーン'], ['hand', '手札'],
    ['graveyard', '墓地'], ['shields', 'シールド'], ['hyperZone', '超次元'], ['grZone', 'GR']
  ];
  if (sourceZone === 'shields') {
    actions.push({ kind: 'flip', label: sourceCard?.faceUp ? '裏向きに戻す' : '表向きにする', faceUp: !sourceCard?.faceUp });
  }
  if (sourceZone === 'battleZone' || sourceZone === 'manaZone') {
    actions.push({ kind: 'tap', label: sourceCard?.tapped ? 'アンタップする' : 'タップする', tapped: !sourceCard?.tapped });
  }
  const label = getDesktopZoneLabel(sourceZone);
  zones.forEach(([z, zl]) => {
    if (z === sourceZone) return;
    actions.push(move(`${label} → ${zl}`, z, 'top', z === 'graveyard'));
  });
  actions.push(move(`${label} → 山札上`, 'deck', 'top'));
  actions.push(move(`${label} → 山札下`, 'deck', 'bottom'));
  return actions;
}

// オンライン: 相手への遠隔操作を送る
function sendDesktopOppOp(payload, fromZone, toLabelLog) {
  if (!window._ol) return;
  sendHandActionDesktop('opp_op', payload);
  const label = toLabelLog
    ? `${getDesktopZoneLabel(fromZone)}→${toLabelLog}`
    : (payload.op === 'tap' ? 'タップ切替' : payload.op === 'flip' ? '表裏切替' : '操作');
  appendDesktopGameLog(`相手の${getDesktopZoneLabel(fromZone)}を操作: ${label}`);
  closeDesktopOppRevealModal();
  showDesktopToast('相手に操作を送信しました', 'info', 1200);
}

// 送信用にカードを最小シリアライズ
function _desktopPeekCardData(c) {
  return {
    name: c?.name || '',
    civ: String(c?.civilization || c?.civ || ''),
    cost: c?.cost,
    power: c?.power || '',
    tapped: !!c?.tapped,
    faceUp: c?.faceUp !== false,
    imageUrl: (typeof getDesktopCardImageUrl === 'function' ? getDesktopCardImageUrl(c) : '') || ''
  };
}

// オンライン: 相手から届いた opp_op を自分のエンジンへ適用（ターン制限は無視＝身内用）し、結果を再ブロードキャスト
function applyDesktopIncomingOppOp(data) {
  if (!engine || !engine.state) return;
  const op = String(data?.op || '');
  let changed = false;
  if (op === 'move') {
    const fromZone = String(data.fromZone || '');
    const toZone = String(data.toZone || '');
    const fromIndex = Number(data.fromIndex);
    const position = data.position === 'bottom' ? 'bottom' : 'top';
    const ok = window.GameController
      ? window.GameController.moveCardBetweenZones(engine, fromZone, fromIndex, toZone, { position })
      : engine.moveCardBetweenZones(fromZone, fromIndex, toZone, { position });
    changed = !!ok;
    if (ok) appendDesktopGameLog(`相手があなたの${getDesktopZoneLabel(fromZone)}→${getDesktopZoneLabel(toZone)}を操作`);
  } else if (op === 'tap') {
    const zone = String(data.zone || '');
    const index = Number(data.index);
    const ok = window.GameController?.setCardTapped
      ? window.GameController.setCardTapped(engine, zone, index, !!data.tapped)
      : (engine.tapCard ? engine.tapCard(zone, index) : false);
    changed = !!ok;
    if (ok) appendDesktopGameLog(`相手があなたの${getDesktopZoneLabel(zone)}を${data.tapped ? 'タップ' : 'アンタップ'}`);
  } else if (op === 'flip') {
    const index = Number(data.index);
    const ok = window.GameController?.setShieldFaceUp
      ? window.GameController.setShieldFaceUp(engine, index, !!data.faceUp)
      : (engine.setShieldFaceUp ? engine.setShieldFaceUp(index, !!data.faceUp) : false);
    changed = !!ok;
    if (ok) appendDesktopGameLog(`相手があなたのシールドを${data.faceUp ? '表向き' : '裏向き'}に`);
  }
  if (changed) {
    olSendActionDesktop('state');
    renderDesktopGame();
  }
}

function playDesktopCard(idx, zone) {
  closeDesktopHandPicker();

  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const playedName = engine?.state?.hand?.[idx]?.name || 'カード';
  const ok = window.GameController
    ? window.GameController.playCardByHandIndex(engine, idx, zone)
    : engine.playCard(engine.state.hand[idx], zone);
  if (!ok) return;
  appendDesktopGameLog(`${playedName} を${getDesktopZoneLabel(zone)}へ`);
  if (window._ol) {
    sendDesktopOnlineActionLog(`【操作ログ】${getDesktopZoneLabel('hand')} → ${getDesktopZoneLabel(zone)}`);
    olSendActionDesktop('state');
  }
  renderDesktopGame();
}

let _currentDragIdx = null;

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
    if (window._ol) {
      sendDesktopOnlineActionLog(`【操作ログ】${getDesktopZoneLabel('hand')} → ${getDesktopZoneLabel(zone)}`);
      olSendActionDesktop('state');
    }
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
  appendDesktopGameLog('ドロー');
  if (window._ol) {
    sendDesktopOnlineActionLog('【操作ログ】ドローしました');
    olSendActionDesktop('state');
  }
  renderDesktopGame();
}

function turnDesktopEnd() {
  if (window._vs) {
    _vsTurnEndDesktop();
    return;
  }
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
  appendDesktopGameLog('— ターン終了 —');
  if (window._ol) {
    sendDesktopOnlineActionLog('【システム】ターンを終了しました');
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

  const publicPending = getDesktopDeckRevealCards('public').length > 0;
  if (_desktopDeckPeekPrivateCards.length || publicPending) {
    showDesktopToast('公開/確認中のカードを先に処理してください', 'warn');
    return;
  }

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
      const cost = Number.isFinite(Number(card?.cost)) ? Number(card.cost) : '-';
      const power = card?.power ? String(card.power) : '-';
      return `
        <div class="dm-grave-item">
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

function getDesktopDeckAllCardsForView() {
  const deck = Array.isArray(engine?.state?.deck) ? engine.state.deck : [];
  // 山札トップ（末尾）を左上に表示するため反転する
  return deck.slice().reverse();
}

function ensureDesktopDeckAllModal() {
  let modal = document.getElementById('desktop-deckall-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'desktop-deckall-modal';
  modal.className = 'dm-deckall-modal';
  modal.innerHTML = `
    <div class="dm-deckall-backdrop" onclick="closeDesktopDeckAllModal()"></div>
    <div class="dm-deckall-body">
      <div class="dm-deckall-head">
        <div class="dm-deckall-head-left">
          <button type="button" class="dm-deckall-shuffle" onclick="shuffleDesktopDeckAndClose()">シャッフルして閉じる</button>
          <div id="desktop-deckall-title" class="dm-deckall-title">山札一覧</div>
        </div>
        <button type="button" class="dm-deckall-close" onclick="closeDesktopDeckAllModal()">閉じる</button>
      </div>
      <div id="desktop-deckall-list" class="dm-deckall-list"></div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openDesktopDeckAllModal() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const deck = engine?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showDesktopToast('山札がありません', 'warn');
    return;
  }

  closeDesktopCardZoneMenu();
  closeDesktopDeckRevealModal();

  const modal = ensureDesktopDeckAllModal();
  modal.classList.add('open');
  renderDesktopDeckAllModal();

  if (window._ol) {
    sendDesktopOnlineActionLog(`【操作ログ】山札を全部確認しました（${deck.length}枚）`);
  }
}

function closeDesktopDeckAllModal() {
  const modal = document.getElementById('desktop-deckall-modal');
  if (modal) modal.classList.remove('open');
}

function renderDesktopDeckAllModal() {
  const modal = document.getElementById('desktop-deckall-modal');
  if (!modal || !modal.classList.contains('open')) return;

  const titleEl = document.getElementById('desktop-deckall-title');
  const listEl = document.getElementById('desktop-deckall-list');
  if (!titleEl || !listEl) return;

  const cards = getDesktopDeckAllCardsForView();
  titleEl.textContent = `山札一覧 ${cards.length}枚（左上がトップ）`;

  if (!cards.length) {
    listEl.innerHTML = '<div class="dm-deckall-empty">山札がありません</div>';
    return;
  }

  const _deckLen = (engine?.state?.deck?.length) || cards.length;
  listEl.innerHTML = cards.map((card, index) => {
    const _realIdx = _deckLen - 1 - index;
    const thumb = renderDesktopCardThumb(card, 'dm-deckall-thumb');
    const name = escapeHtml(getDesktopCardDisplayName(card));
    return `
      <div class="dm-deckall-card" onclick="openDesktopCardZoneMenu(event, 'deck', ${_realIdx})" oncontextmenu="openDesktopCardZoneMenu(event, 'deck', ${_realIdx})" title="${name}">
        <div class="dm-deckall-no">${index + 1}</div>
        <div class="dm-deckall-art">${thumb}</div>
        <div class="dm-deckall-name">${name}</div>
      </div>
    `;
  }).join('');
}

function shuffleDesktopDeckAndClose() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const deck = engine?.state?.deck;
  if (!Array.isArray(deck) || deck.length === 0) {
    showDesktopToast('山札がありません', 'warn');
    closeDesktopDeckAllModal();
    return;
  }

  const ok = window.GameController?.shuffleDeck
    ? window.GameController.shuffleDeck(engine)
    : (typeof engine?.shuffleDeck === 'function' ? engine.shuffleDeck() : false);
  if (!ok) {
    showDesktopToast('山札をシャッフルできませんでした', 'warn');
    return;
  }

  closeDesktopDeckAllModal();
  if (window._ol) {
    olSendActionDesktop('state');
    sendDesktopOnlineActionLog('【操作ログ】山札をシャッフルして非公開に戻しました');
  }
  showDesktopToast('山札をシャッフルしました', 'ok');
  renderDesktopGame();
}

function setDesktopDeckNValue(rawValue) {
  const parsed = Math.floor(Number(rawValue));
  const next = Number.isFinite(parsed) ? parsed : _desktopDeckNValue;
  _desktopDeckNValue = Math.max(1, Math.min(40, next));

  const input = document.getElementById('desktop-deck-n-input');
  if (input && Number(input.value) !== _desktopDeckNValue) {
    input.value = String(_desktopDeckNValue);
  }
}

function getDesktopDeckN() {
  const input = document.getElementById('desktop-deck-n-input');
  if (input) {
    setDesktopDeckNValue(input.value);
  }
  return _desktopDeckNValue;
}

function getDesktopDeckRevealCards(mode = 'public') {
  if (mode === 'peek') return _desktopDeckPeekPrivateCards;
  if (mode === 'opponent') {
    return Array.isArray(window._olOpponent?.deckRevealZone)
      ? window._olOpponent.deckRevealZone
      : [];
  }
  if (!engine?.state) return [];
  if (!Array.isArray(engine.state.deckRevealZone)) {
    engine.state.deckRevealZone = [];
  }
  return engine.state.deckRevealZone;
}

function getDesktopDeckRevealSignature(cards) {
  if (!Array.isArray(cards) || !cards.length) return '';
  return cards.map((card, idx) => {
    const name = String(card?.name || card?.nameEn || '').trim();
    const cost = String(card?.cost ?? '').trim();
    const power = String(card?.power || '').trim();
    const image = String(card?.imageUrl || card?.img || card?.thumb || '').trim();
    return `${idx}:${name}|${cost}|${power}|${image}`;
  }).join('||');
}

function maybeAutoOpenDesktopOpponentDeckRevealModal() {
  if (!window._ol) return;

  const opponentCards = getDesktopDeckRevealCards('opponent');
  const signature = getDesktopDeckRevealSignature(opponentCards);

  if (!signature) {
    _desktopOpponentDeckRevealSignature = '';
    if (_desktopDeckRevealModalState.mode === 'opponent') {
      closeDesktopDeckRevealModal();
    }
    return;
  }

  if (signature === _desktopOpponentDeckRevealSignature) return;
  _desktopOpponentDeckRevealSignature = signature;
  openDesktopDeckRevealModal('opponent');
}

function getDesktopDeckRevealDestinationOptions() {
  return [
    { value: 'hand', label: '\u624b\u672d' },
    { value: 'battleZone', label: '\u30d0\u30c8\u30eb\u30be\u30fc\u30f3' },
    { value: 'manaZone', label: '\u30de\u30ca\u30be\u30fc\u30f3' },
    { value: 'shields', label: '\u30b7\u30fc\u30eb\u30c9' },
    { value: 'graveyard', label: '\u5893\u5730' },
    { value: 'deck:top', label: '\u5c71\u672d\u4e0a' },
    { value: 'deck:bottom', label: '\u5c71\u672d\u4e0b' },
    { value: 'hyperZone', label: '\u8d85\u6b21\u5143\u30be\u30fc\u30f3' },
    { value: 'grZone', label: '\u8d85GR\u30be\u30fc\u30f3' },
    { value: 'specialZone', label: '\u7279\u6b8a\u30be\u30fc\u30f3' }
  ];
}

function ensureDesktopDeckRevealModal() {
  let modal = document.getElementById('desktop-deck-reveal-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'desktop-deck-reveal-modal';
  modal.className = 'dm-reveal-modal';
  modal.innerHTML = `
    <div class="dm-reveal-backdrop" onclick="closeDesktopDeckRevealModal()"></div>
    <div class="dm-reveal-body">
      <div class="dm-reveal-head">
        <div id="desktop-deck-reveal-title" class="dm-reveal-title">表向き公開 0枚</div>
        <button type="button" class="dm-reveal-close" onclick="closeDesktopDeckRevealModal()">閉じる</button>
      </div>
      <div id="desktop-deck-reveal-list" class="dm-reveal-list"></div>
      <div id="desktop-deck-reveal-controls" class="dm-reveal-controls">
        <label id="desktop-deck-reveal-check-wrap" class="dm-reveal-check-all">
          <input type="checkbox" id="desktop-deck-reveal-all" onchange="toggleDesktopDeckRevealSelectAll(this.checked)">
          全選択
        </label>
        <select id="desktop-deck-reveal-dest" class="dm-reveal-select" onchange="setDesktopDeckRevealDestination(this.value)"></select>
        <button type="button" id="desktop-deck-reveal-move" class="dm-reveal-move" onclick="moveSelectedDesktopDeckRevealCards()">移動</button>
        <button type="button" id="desktop-deck-reveal-return" class="dm-reveal-return" onclick="returnAllDesktopDeckRevealCards()">全部デッキに戻す</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openDesktopDeckRevealModal(mode = 'public') {
  const cards = getDesktopDeckRevealCards(mode);
  if (!Array.isArray(cards) || !cards.length) {
    showDesktopToast('処理中のカードがありません', 'info');
    return;
  }

  if (_desktopDeckRevealModalState.mode !== mode) {
    _desktopDeckRevealModalState = {
      mode,
      destination: _desktopDeckRevealModalState.destination || 'hand',
      selected: {}
    };
  }

  const modal = ensureDesktopDeckRevealModal();
  modal.classList.add('open');
  renderDesktopDeckRevealModal();
}

function closeDesktopDeckRevealModal() {
  const modal = document.getElementById('desktop-deck-reveal-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function setDesktopDeckRevealDestination(value) {
  const options = getDesktopDeckRevealDestinationOptions();
  const safe = options.find((opt) => opt.value === value)?.value || 'hand';
  _desktopDeckRevealModalState.destination = safe;
}

function setDesktopDeckRevealCardSelected(index, checked) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;

  if (checked) {
    _desktopDeckRevealModalState.selected[idx] = true;
  } else {
    delete _desktopDeckRevealModalState.selected[idx];
  }
}

function toggleDesktopDeckRevealCard(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return;
  const currently = !!_desktopDeckRevealModalState.selected[idx];
  setDesktopDeckRevealCardSelected(idx, !currently);
  renderDesktopDeckRevealModal();
}

function toggleDesktopDeckRevealSelectAll(checked) {
  const cards = getDesktopDeckRevealCards(_desktopDeckRevealModalState.mode);
  const next = {};
  if (checked) {
    cards.forEach((_, idx) => {
      next[idx] = true;
    });
  }
  _desktopDeckRevealModalState.selected = next;
  renderDesktopDeckRevealModal();
}

function parseDesktopDeckRevealDestination(value) {
  const normalized = String(value || 'hand');
  if (normalized === 'deck:bottom') {
    return { toZone: 'deck', position: 'bottom' };
  }
  if (normalized === 'deck:top') {
    return { toZone: 'deck', position: 'top' };
  }
  return { toZone: normalized, position: 'top' };
}

function moveDesktopPublicDeckRevealCard(index, toZone, position = 'top') {
  if (!Number.isInteger(index) || index < 0) return false;
  if (!engine) return false;

  return window.GameController?.moveCardBetweenZones
    ? window.GameController.moveCardBetweenZones(engine, 'deckRevealZone', index, toZone, { position })
    : engine.moveCardBetweenZones('deckRevealZone', index, toZone, { position });
}

function applyDesktopDetachedCardToZone(card, toZone, position = 'top') {
  if (!card || !engine?.state) return false;

  if (toZone === 'deck') {
    if (!Array.isArray(engine.state.deck)) return false;
    if (card.faceUp !== undefined) delete card.faceUp;
    if (position === 'bottom') {
      engine.state.deck.unshift(card);
    } else {
      engine.state.deck.push(card);
    }
    return true;
  }

  const target = engine.state[toZone];
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

function renderDesktopDeckRevealModal() {
  const modal = document.getElementById('desktop-deck-reveal-modal');
  if (!modal || !modal.classList.contains('open')) return;

  const rawMode = String(_desktopDeckRevealModalState.mode || 'public');
  const mode = rawMode === 'peek' ? 'peek' : (rawMode === 'opponent' ? 'opponent' : 'public');
  const cards = getDesktopDeckRevealCards(mode);
  if (!cards.length) {
    closeDesktopDeckRevealModal();
    return;
  }

  const titleEl = document.getElementById('desktop-deck-reveal-title');
  const listEl = document.getElementById('desktop-deck-reveal-list');
  const controlsEl = document.getElementById('desktop-deck-reveal-controls');
  const checkWrapEl = document.getElementById('desktop-deck-reveal-check-wrap');
  const destinationEl = document.getElementById('desktop-deck-reveal-dest');
  const moveBtnEl = document.getElementById('desktop-deck-reveal-move');
  const returnBtnEl = document.getElementById('desktop-deck-reveal-return');
  const allEl = document.getElementById('desktop-deck-reveal-all');
  if (!titleEl || !listEl || !controlsEl || !checkWrapEl || !destinationEl || !moveBtnEl || !returnBtnEl || !allEl) return;

  const isOpponentMode = mode === 'opponent';
  const modeLabel = isOpponentMode ? '相手の表向き公開' : (mode === 'peek' ? '確認中' : '表向き公開');
  const ownerLabel = isOpponentMode ? '相手デッキから' : '自分デッキから';
  titleEl.textContent = `${modeLabel} ${cards.length}枚（${ownerLabel}）`;

  controlsEl.style.display = isOpponentMode ? 'none' : 'flex';

  const options = getDesktopDeckRevealDestinationOptions();
  destinationEl.innerHTML = options.map((option) => `
    <option value="${option.value}" ${_desktopDeckRevealModalState.destination === option.value ? 'selected' : ''}>${option.label}</option>
  `).join('');

  const selected = _desktopDeckRevealModalState.selected;
  const quickButtons = [
    { value: 'hand', label: '\u624b\u672d', className: 'hand' },
    { value: 'battleZone', label: 'BZ', className: 'battle' },
    { value: 'manaZone', label: '\u30de\u30ca', className: 'mana' },
    { value: 'shields', label: '\u76fe', className: 'shield' },
    { value: 'graveyard', label: '\u5893\u5730', className: 'grave' },
    { value: 'deck:top', label: '\u5c71\u4e0a', className: 'deck' },
    { value: 'deck:bottom', label: '\u5c71\u4e0b', className: 'deck' },
    { value: 'hyperZone', label: '\u8d85\u6b21\u5143', className: 'deck' },
    { value: 'grZone', label: 'GR', className: 'deck' },
    { value: 'specialZone', label: '\u7279\u6b8a', className: 'deck' }
  ];

  listEl.innerHTML = cards.map((card, index) => {
    const thumb = renderDesktopCardThumb(card, 'dm-reveal-thumb');
    const positionLabel = index === 0 ? 'トップ' : `${index + 1}枚目`;
    const payload = escapeHtml(getDesktopCardDisplayName(card));

    if (isOpponentMode) {
      return `
        <div class="dm-reveal-card readonly" title="${payload}">
          <div class="dm-reveal-art">${thumb}</div>
          <div class="dm-reveal-pos">${positionLabel}</div>
          <div class="dm-reveal-name">${payload}</div>
        </div>
      `;
    }

    const checked = !!selected[index];
    const quickHtml = quickButtons.map((btn) => `
      <button
        type="button"
        class="dm-reveal-quick-btn ${btn.className}"
        onclick="event.stopPropagation(); moveSingleDesktopDeckRevealCard(${index}, '${btn.value}')">
        ${btn.label}
      </button>
    `).join('');

    return `
      <div class="dm-reveal-card ${checked ? 'selected' : ''}" onclick="toggleDesktopDeckRevealCard(${index})" title="${payload}">
        <input
          type="checkbox"
          class="dm-reveal-cb"
          ${checked ? 'checked' : ''}
          onclick="event.stopPropagation()"
          onchange="setDesktopDeckRevealCardSelected(${index}, this.checked); renderDesktopDeckRevealModal();">
        <div class="dm-reveal-art">${thumb}</div>
        <div class="dm-reveal-pos">${positionLabel}</div>
        <div class="dm-reveal-name">${payload}</div>
        <div class="dm-reveal-quick">${quickHtml}</div>
      </div>
    `;
  }).join('');

  if (isOpponentMode) {
    return;
  }

  const selectedCount = cards.reduce((count, _, idx) => count + (selected[idx] ? 1 : 0), 0);
  allEl.checked = cards.length > 0 && selectedCount === cards.length;
}

function moveSingleDesktopDeckRevealCard(index, destinationValue) {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const mode = _desktopDeckRevealModalState.mode === 'peek'
    ? 'peek'
    : (_desktopDeckRevealModalState.mode === 'opponent' ? 'opponent' : 'public');
  if (mode === 'opponent') return;

  const cards = getDesktopDeckRevealCards(mode);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;

  const destination = parseDesktopDeckRevealDestination(destinationValue);
  let ok = false;

  if (mode === 'public') {
    ok = moveDesktopPublicDeckRevealCard(idx, destination.toZone, destination.position);
    if (ok && window._ol) {
      olSendActionDesktop('state');
    }
  } else {
    const card = _desktopDeckPeekPrivateCards[idx];
    if (!card) return;
    if (typeof engine?._saveState === 'function') {
      engine._saveState();
    }
    _desktopDeckPeekPrivateCards.splice(idx, 1);
    ok = applyDesktopDetachedCardToZone(card, destination.toZone, destination.position);
  }

  if (!ok) {
    showDesktopToast('カード移動に失敗しました', 'warn');
    return;
  }

  _desktopDeckRevealModalState.selected = {};
  renderDesktopGame();
  renderDesktopDeckRevealModal();

  if (!getDesktopDeckRevealCards(mode).length) {
    closeDesktopDeckRevealModal();
  }
}

function drawDesktopDeckCardsToPublic() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const publicCards = getDesktopDeckRevealCards('public');
  if (publicCards.length) {
    openDesktopDeckRevealModal('public');
    return;
  }

  if (_desktopDeckPeekPrivateCards.length) {
    showDesktopToast('確認中のカードを先に処理してください', 'warn');
    openDesktopDeckRevealModal('peek');
    return;
  }

  const n = getDesktopDeckN();
  const moved = typeof engine?.extractDeckTopCards === 'function'
    ? engine.extractDeckTopCards(n, 'deckRevealZone', { faceUp: true })
    : [];
  if (!moved.length) {
    showDesktopToast('山札がありません', 'warn');
    return;
  }

  _desktopDeckRevealModalState = {
    mode: 'public',
    destination: _desktopDeckRevealModalState.destination || 'hand',
    selected: {}
  };

  if (window._ol) olSendActionDesktop('state');
  renderDesktopGame();
  openDesktopDeckRevealModal('public');
}

function drawDesktopDeckCardsToPrivate() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  if (_desktopDeckPeekPrivateCards.length) {
    openDesktopDeckRevealModal('peek');
    return;
  }

  const publicCards = getDesktopDeckRevealCards('public');
  if (publicCards.length) {
    showDesktopToast('表向き公開中のカードを先に処理してください', 'warn');
    openDesktopDeckRevealModal('public');
    return;
  }

  const n = getDesktopDeckN();
  const moved = typeof engine?.extractDeckTopCards === 'function'
    ? engine.extractDeckTopCards(n)
    : [];
  if (!moved.length) {
    showDesktopToast('山札がありません', 'warn');
    return;
  }

  _desktopDeckPeekPrivateCards = moved;
  _desktopDeckRevealModalState = {
    mode: 'peek',
    destination: _desktopDeckRevealModalState.destination || 'hand',
    selected: {}
  };

  if (window._ol) {
    sendDesktopOnlineActionLog(`【操作ログ】山札から${moved.length}枚を確認しました`);
  }

  renderDesktopGame();
  openDesktopDeckRevealModal('peek');
}

function moveSelectedDesktopDeckRevealCards() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const mode = _desktopDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getDesktopDeckRevealCards(mode);
  if (!cards.length) {
    closeDesktopDeckRevealModal();
    return;
  }

  const selectedIndices = Object.keys(_desktopDeckRevealModalState.selected)
    .map((key) => Number(key))
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < cards.length)
    .sort((a, b) => b - a);

  if (!selectedIndices.length) {
    showDesktopToast('カードを選択してください', 'warn');
    return;
  }

  const destination = parseDesktopDeckRevealDestination(_desktopDeckRevealModalState.destination);
  let movedCount = 0;

  if (mode === 'public') {
    selectedIndices.forEach((idx) => {
      const ok = moveDesktopPublicDeckRevealCard(idx, destination.toZone, destination.position);
      if (ok) movedCount += 1;
    });
    if (movedCount && window._ol) {
      olSendActionDesktop('state');
    }
  } else {
    if (typeof engine?._saveState === 'function') {
      engine._saveState();
    }

    selectedIndices.forEach((idx) => {
      const card = _desktopDeckPeekPrivateCards[idx];
      if (!card) return;
      _desktopDeckPeekPrivateCards.splice(idx, 1);
      if (applyDesktopDetachedCardToZone(card, destination.toZone, destination.position)) {
        movedCount += 1;
      }
    });
  }

  _desktopDeckRevealModalState.selected = {};
  renderDesktopGame();
  renderDesktopDeckRevealModal();

  if (!movedCount) {
    showDesktopToast('カード移動に失敗しました', 'warn');
    return;
  }

  const rest = getDesktopDeckRevealCards(mode).length;
  if (!rest) {
    closeDesktopDeckRevealModal();
  }
}

function returnAllDesktopDeckRevealCards() {
  if (window._ol && !canActDesktopOnline()) {
    showDesktopToast('相手のターンです', 'warn');
    return;
  }

  const mode = _desktopDeckRevealModalState.mode === 'peek' ? 'peek' : 'public';
  const cards = getDesktopDeckRevealCards(mode);
  if (!cards.length) {
    closeDesktopDeckRevealModal();
    return;
  }

  let movedCount = 0;
  if (mode === 'public') {
    for (let idx = cards.length - 1; idx >= 0; idx -= 1) {
      const ok = moveDesktopPublicDeckRevealCard(idx, 'deck', 'top');
      if (ok) movedCount += 1;
    }
    if (movedCount && window._ol) {
      olSendActionDesktop('state');
    }
  } else {
    if (typeof engine?._saveState === 'function') {
      engine._saveState();
    }

    for (let idx = _desktopDeckPeekPrivateCards.length - 1; idx >= 0; idx -= 1) {
      const card = _desktopDeckPeekPrivateCards[idx];
      if (!card) continue;
      _desktopDeckPeekPrivateCards.splice(idx, 1);
      if (applyDesktopDetachedCardToZone(card, 'deck', 'top')) {
        movedCount += 1;
      }
    }
  }

  _desktopDeckRevealModalState.selected = {};
  renderDesktopGame();
  closeDesktopDeckRevealModal();

  if (!movedCount) {
    showDesktopToast('デッキに戻せるカードがありません', 'warn');
  }
}

async function newDesktopDeck() {
  const name = String(await askDesktopInput('デッキ名を入力') || '').trim();
  if (!name) return;
  
  if (window.GameController) {
    window.GameController.setDeckEditingState(name, []);
  } else {
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
  if (!account || account.isGuest || !account.pin) {
    showDesktopToast('PIN login is required for cloud deck deletion', 'warn');
    return;
  }

  const result = await NetworkService.deleteDeck(account.username, account.pin, deckName);
  if (!result?.ok) {
    showDesktopToast(result?.error || 'Failed to delete cloud deck', 'warn');
    return;
  }

  if (window.GameController) {
    window.GameController.setDeckEditingState(null, []);
  } else {
    window._deckEditing = null;
    window._deckCards = [];
  }

  const names = await NetworkService.loadServerDecks(account.username, account.pin);
  if (Array.isArray(names)) {
    if (window.AppState) {
      window.AppState.set('_serverDeckNames', names);
    } else {
      window._serverDeckNames = names;
    }
  } else {
    showDesktopToast('Failed to refresh cloud deck list', 'warn');
  }

  showDesktopToast('Cloud deck deleted', 'ok');
  renderDesktopDeckList();
}

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
    const enriched = await NetworkService.enrichCardImage(card, {
      retries: 1,
      retryDelayMs: 300
    });
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

  const account = AuthService.getCurrentAccount();
  if (!account || account.isGuest || !account.pin) {
    showDesktopToast('Log in to use cloud decks', 'warn');
    clearDesktopDeckSelection();
    return;
  }

  try {
    const remoteDeck = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
    if (!Array.isArray(remoteDeck)) {
      showDesktopToast('API unavailable; cloud deck could not be loaded', 'warn');
      clearDesktopDeckSelection();
      return;
    }

    const sortedCards = sortDesktopDeckCards(remoteDeck.map(card => NetworkService.normalizeCardData(card)));
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

    renderDesktopDeckList();
  } catch (error) {
    console.error('deck load error:', error);
    showDesktopToast('API unavailable; cloud deck could not be loaded', 'warn');
  }
}

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
    const hasUserSelectedImage = !!String(rawCard?.selectedImageUrl || rawCard?.selectedArtId || '').trim();
    const suppressUnsafeSearchImage = !hasUserSelectedImage
      && String(rawCard?.imageStatus || '').includes('suppressed-unsafe');
    const card = await NetworkService.enrichCardImage(rawCard, {
      retries: 2,
      retryDelayMs: 350,
      allowNameFallback: !suppressUnsafeSearchImage,
      suppressImage: suppressUnsafeSearchImage
    });
    const normalized = NetworkService.normalizeCardData(card);
    const normalizedKey = String(normalized.cardId || normalized.id || '');
    const count = Math.max(1, Math.min(4, Number.isFinite(Number(addCount)) ? Math.floor(Number(addCount)) : 1));

    if (!normalizedKey) {
      // cardId が解決できない場合は重複判定をスキップして末尾追加
      window._deckCards.push({ ...normalized, count });
      sortCurrentDesktopDeckCards();
      renderDesktopDeckList();
      return true;
    }

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

async function restoreAllDesktopLocalDecksToCloud() {
  const account = AuthService.getCurrentAccount();
  if (!account || account.isGuest || !account.pin) {
    showDesktopToast('復元にはPINログインが必要です', 'warn');
    return;
  }

  const savedDecks = getLocalSavedDecksForMigration();
  const deckNames = Object.keys(savedDecks).filter((name) => Array.isArray(savedDecks[name]));
  if (!deckNames.length) {
    showDesktopToast('ローカル復元できるデッキがありません', 'warn');
    return;
  }

  const ok = await askDesktopConfirm(
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
      console.warn('[deck] restore failed:', deckName, result && result.error ? result.error : 'unknown');
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
    showDesktopToast(`クラウド復元: 成功${success}件 / 失敗${failed}件`, 'warn');
  } else {
    showDesktopToast(`クラウド復元完了（${success}件）`, 'ok');
  }
  if (success > 0 && failed === 0) {
    const clearLocal = await askDesktopConfirm(
      'Remove migrated local dm_decks now?',
      'Remove',
      'Keep'
    );
    if (clearLocal) {
      try {
        localStorage.removeItem('dm_decks');
        showDesktopToast('Local decks removed', 'ok');
      } catch (error) {
        console.warn('dm_decks cleanup failed', error);
        showDesktopToast('Failed to delete cloud deck', 'warn');
      }
    }
  }
  renderDesktopDeckList();
}

async function saveDesktopDeckToCloud() {
  if (_desktopDeckSaving) return;
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

  _desktopDeckSaving = true;
  try {
    const result = await NetworkService.saveDeck(account.username, account.pin, deckName, deckData);
    if (result.error) {
      showDesktopToast(result.error, 'warn');
      return;
    }

    if (typeof NetworkService.clearDeckCache === 'function') {
      NetworkService.clearDeckCache(deckName);
    }

    const names = await NetworkService.loadServerDecks(account.username, account.pin);
    if (Array.isArray(names)) {
      if (window.AppState) {
        window.AppState.set('_serverDeckNames', names);
      } else {
        window._serverDeckNames = names;
      }
    } else {
      showDesktopToast('クラウド一覧の更新に失敗しました（ローカル保存のみ反映）', 'warn');
    }
    showDesktopToast('保存しました', 'ok');
    renderDesktopDeckList();
  } finally {
    _desktopDeckSaving = false;
  }
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

// ─── VSモード（疑似対戦）────────────────────────────────────────────

async function openDesktopVsSetup() {
  const p1DeckName = window._deckEditing;
  if (!p1DeckName || !window._deckCards.length) {
    showDesktopToast('先にデッキを選択してください', 'warn');
    return;
  }
  const account = AuthService.getCurrentAccount();
  const allNames = (Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [])
    .slice()
    .sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  if ((!account || account.isGuest || !account.pin) && !allNames.includes(p1DeckName)) {
    allNames.unshift(p1DeckName);
  }

  const optionsHtml = allNames.map(n =>
    `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`
  ).join('');

  let modal = document.getElementById('desktop-vs-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desktop-vs-modal';
    modal.className = 'dm-confirm-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="dm-confirm-backdrop"></div>
    <div class="dm-confirm-body">
      <div class="dm-confirm-message">
        <div style="font-weight:700;margin-bottom:10px">疑似対戦モード設定</div>
        <div style="font-size:0.85rem;margin-bottom:6px">P1 デッキ:  <strong>${escapeHtml(p1DeckName)}</strong></div>
        <div style="font-size:0.85rem;margin-bottom:4px">P2 デッキを選択:</div>
        <select id="vs-p2-deck-select" class="dl-input dl-select" style="width:100%;margin-bottom:10px">
          <option value="">-- 選択 --</option>
          ${optionsHtml}
        </select>
      </div>
      <div class="dm-confirm-actions">
        <button id="vs-modal-start" class="dm-confirm-btn ok">ゲーム開始</button>
        <button id="vs-modal-cancel" class="dm-confirm-btn cancel">キャンセル</button>
      </div>
    </div>
  `;
  modal.classList.add('open');

  return new Promise((resolve) => {
    const close = (val) => { modal.classList.remove('open'); resolve(val); };
    document.getElementById('vs-modal-start').onclick = () => {
      const p2 = document.getElementById('vs-p2-deck-select').value.trim();
      if (!p2) { showDesktopToast('P2 のデッキを選択してください', 'warn'); return; }
      close(p2);
    };
    document.getElementById('vs-modal-cancel').onclick = () => close(null);
    modal.querySelector('.dm-confirm-backdrop').onclick = () => close(null);
  }).then((p2DeckName) => {
    if (p2DeckName) startDesktopVsGame(p1DeckName, p2DeckName);
  });
}

async function startDesktopVsGame(p1DeckName, p2DeckName) {
  const account = AuthService.getCurrentAccount();
  const resolveDeck = async (name) => {
    if (window.GameController?.resolveDeckData) {
      const d = await window.GameController.resolveDeckData(name, account);
      if (d && d.length) return d;
    }
    if (account && !account.isGuest && account.pin) {
      return await NetworkService.fetchServerDeck(account.username, account.pin, name).catch(() => null);
    }
    return null;
  };

  const [p1Data, p2Data] = await Promise.all([resolveDeck(p1DeckName), resolveDeck(p2DeckName)]);
  if (!p1Data?.length) { showDesktopToast(`P1「${p1DeckName}」を取得できませんでした`, 'warn'); return; }
  if (!p2Data?.length) { showDesktopToast(`P2「${p2DeckName}」を取得できませんでした`, 'warn'); return; }

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

  engine = firstPlayer === 'p1' ? p1Engine : p2Engine;
  _vsRefreshOpponentView();

  _desktopSelectedShieldIdx = null;
  _desktopUnderInsertState = null;
  _desktopDeckPeekPrivateCards = [];
  _desktopNeedDrawGuide = true;
  renderDesktopGame();
  const who = firstPlayer === 'p1' ? `P1 (${p1DeckName})` : `P2 (${p2DeckName})`;
  showDesktopTurnNotification(`疑似対戦: ${who} が先手です。まずはドロー`);
}

function _vsRefreshOpponentView() {
  const vs = window._vs;
  if (!vs) return;
  const inactive = vs.activePlayer === 'p1' ? vs.p2Engine : vs.p1Engine;
  const s = inactive.getState();
  window._olOpponent = { ...buildDesktopPublicState(s), handCards: s.hand };
}

function _vsTurnEndDesktop() {
  const vs = window._vs;
  if (!vs) return;
  if (window.GameController) {
    window.GameController.turnEnd(engine, null);
  } else {
    engine.turnEnd();
  }
  vs.activePlayer = vs.activePlayer === 'p1' ? 'p2' : 'p1';
  engine = vs.activePlayer === 'p1' ? vs.p1Engine : vs.p2Engine;
  _desktopSelectedShieldIdx = null;
  _desktopUnderInsertState = null;
  _desktopDeckPeekPrivateCards = [];
  _desktopNeedDrawGuide = true;
  _vsRefreshOpponentView();
  const who = vs.activePlayer === 'p1' ? `P1 (${vs.p1DeckName})` : `P2 (${vs.p2DeckName})`;
  showDesktopTurnNotification(`疑似対戦: ${who} のターンです。まずはドロー`);
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

  if (window.GameController) {
    window.GameController.clearOnlineSession();
  } else {
    window._ol = null;
    window._olDeckData = null;
    window._olOpponent = null;
    window._olCurrentPlayer = null;
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
  const normalizedRoomCode = (typeof NetworkService !== 'undefined' && typeof NetworkService.normalizeRoomCode === 'function')
    ? NetworkService.normalizeRoomCode(codeInput?.value || '')
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
      showDesktopToast(`ルームID: ${room}`, 'info', 6000);
      if (!silent) desktopOnlineUpdateStatus(`ルームID: ${room} をメモしてください。`);
    }
  } catch (err) {
    console.warn('clipboard write failed', err);
    showDesktopToast(`ルームID: ${room}`, 'info', 6000);
    if (!silent) desktopOnlineUpdateStatus(`ルームID: ${room} をメモしてください。`);
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
      let data; try { data = JSON.parse(e.data); } catch { return; }
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
      if (window._ol.reconnectAttempt < 3) {
        const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
        desktopOnlineUpdateStatus(`接続を再試行中… (${window._ol.reconnectAttempt}/3)`);
        if (_olReconnectTimerDesktop) clearTimeout(_olReconnectTimerDesktop);
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
  const cloudNames = Array.isArray(window._serverDeckNames) ? window._serverDeckNames : [];

  const deckOptions = cloudNames.map(name => ({ label: `Cloud: ${name}`, value: name }));

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
    window._olOpponent = { hand: 5, battleZone: 0, manaZone: 0, shields: 5, deckRevealZone: 0, revealedZone: 0, hyperZone: 0, grZone: 0, specialZone: 0, deck: 30, graveyard: 0 };
    // p1 のみ先攻をランダム決定。p2 は最初の opponent_state で active を受け取る。
    if (window._ol.p === 'p1') {
      window._olCurrentPlayer = Math.random() < 0.5 ? 1 : 2;
    } else {
      window._olCurrentPlayer = 1; // p2 は暫定値。相手の state 受信時に上書きされる。
    }
    window._olChatLogDesktop = [];
  }
  _desktopSelectedShieldIdx = null;
  _desktopUnderInsertState = null;
  clearDesktopGameLog();
  _desktopDeckPeekPrivateCards = [];
  _desktopDeckRevealModalState = {
    mode: 'public',
    destination: _desktopDeckRevealModalState.destination || 'hand',
    selected: {}
  };
  _desktopOpponentDeckRevealSignature = '';
  closeDesktopDeckRevealModal();
  closeDesktopDeckAllModal();
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

  window._ol.remoteSeq = 0;
  _desktopOpponentDeckRevealSignature = null;

  const room = window._ol.room;
  const player = window._ol.p;
  const es = NetworkService.createEventSource(room, player);
  window._ol.eventSource = es;

  es.addEventListener('opponent_state', (e) => {
    if (!window._ol || window._ol.room !== room) return;

    window._ol.connectionStatus = 'connected';
    window._ol.lastSeenAt = Date.now();
    window._ol.reconnectAttempt = 0;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (!shouldApplyRemotePayloadDesktop(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (Number.isFinite(data.turn) && data.turn > 0) {
      if (typeof engine.syncTurn === 'function') {
        engine.syncTurn(data.turn);
      }
    }
    if (other) window._olOpponent = normalizeDesktopOpponentState(other);
    maybeAutoOpenDesktopOpponentDeckRevealModal();
    if (data.active === 'p1' || data.active === 'p2') window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;

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

    window._ol.connectionStatus = 'connected';
    window._ol.lastSeenAt = Date.now();
    window._ol.reconnectAttempt = 0;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (!shouldApplyRemotePayloadDesktop(data)) return;
    const other = window._ol.p === 'p1' ? data.p2 : data.p1;
    const myNum = window._ol.p === 'p1' ? 1 : 2;
    const wasMyTurn = window._olCurrentPlayer === myNum;

    if (Number.isFinite(data.turn) && data.turn > 0) {
      if (typeof engine.syncTurn === 'function') {
        engine.syncTurn(data.turn);
      }
    }
    if (other) window._olOpponent = normalizeDesktopOpponentState(other);
    maybeAutoOpenDesktopOpponentDeckRevealModal();
    if (data.active === 'p1' || data.active === 'p2') {
      window._olCurrentPlayer = data.active === 'p1' ? 1 : 2;
    }

    const isMyTurn = window._olCurrentPlayer === myNum;
    if (!wasMyTurn && isMyTurn && engine && engine.state) {
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

    window._ol.connectionStatus = 'connected';
    window._ol.lastSeenAt = Date.now();
    window._ol.reconnectAttempt = 0;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    appendDesktopChatMessage(data.name || 'Player', data.msg || '', data.p || '');
  });

  es.addEventListener('hand_reveal_request', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    const cards = (engine?.state?.hand || []).map(c => ({
      name: c?.name || '',
      civ: String(c?.civilization || c?.civ || ''),
      cost: c?.cost,
      power: c?.power || '',
      imgUrl: (typeof getDesktopCardImageUrl === 'function' ? getDesktopCardImageUrl(c) : '') || ''
    }));
    sendHandActionDesktop('hand_data', { cards });
    showDesktopToast('相手があなたの手札を確認しています...', 'info', 2000);
  });

  es.addEventListener('hand_data', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    const cards = Array.isArray(data.cards) ? data.cards : [];
    openDesktopHandSelectModal(cards);
  });

  es.addEventListener('discard_select', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    openDesktopDiscardConfirmModal(data.cardName || '', false);
  });

  es.addEventListener('discard_random', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    openDesktopDiscardConfirmModal('', true);
  });

  // 相手が自分の非公開ゾーンを覗きにきた → そのゾーンのカードを返す
  es.addEventListener('peek_request', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const zone = String(data.zone || '');
    if (!['hand', 'shields', 'deck', 'grZone', 'battleZone', 'manaZone'].includes(zone)) return;
    const cards = (engine?.state?.[zone] || []).map((c) => _desktopPeekCardData(c));
    sendHandActionDesktop('peek_data', { zone, cards });
    appendDesktopGameLog(`相手があなたの${getDesktopZoneLabel(zone)}を確認中`);
    showDesktopToast(`相手があなたの${getDesktopZoneLabel(zone)}を確認しています`, 'info', 1800);
  });

  // 覗いた相手のカードが届いた → 公開モーダルを開く
  es.addEventListener('peek_data', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const zone = String(data.zone || '');
    const cards = Array.isArray(data.cards) ? data.cards : [];
    if (_desktopOppRevealState && _desktopOppRevealState.zone && _desktopOppRevealState.zone !== zone) return;
    openDesktopOppRevealModal(zone, cards);
  });

  // 相手が自分のカードを操作してきた → 自分のエンジンへ適用して再ブロードキャスト
  es.addEventListener('opp_op', (e) => {
    if (!window._ol || window._ol.room !== room) return;
    let data; try { data = JSON.parse(e.data); } catch { return; }
    applyDesktopIncomingOppOp(data);
  });

  es.onerror = () => {
    es.close();

    if (!window._ol || window._ol.room !== room) return;

    window._ol.connectionStatus = 'reconnecting';
    window._ol.reconnectAttempt = (window._ol.reconnectAttempt || 0) + 1;
    renderDesktopGame();
    if (window._ol.reconnectAttempt < 3) {
      const delay = Math.pow(2, window._ol.reconnectAttempt) * 1000;
      if (_olReconnectTimerDesktop) clearTimeout(_olReconnectTimerDesktop);
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

function sendHandActionDesktop(type, extra) {
  if (!window._ol || !engine) return;
  const payload = Object.assign({
    room: window._ol.room,
    p: window._ol.p,
    type: type,
    seq: nextOnlineSeqDesktop()
  }, extra || {});
  NetworkService.sendAction(payload);
}

function olSendActionDesktop(actionType) {
  if (window.GameController) {
    window.GameController.sendOnlineAction(engine, actionType);
    return;
  }

  if (!window._ol || !engine) return;
  const s = engine.state;
  const publicState = buildDesktopPublicState(s);
  let activePlayer;
  if (actionType === 'turn_end') {
    activePlayer = window._ol.p === 'p1' ? 'p2' : 'p1';
  } else if (window._olCurrentPlayer === 1) {
    activePlayer = 'p1';
  } else if (window._olCurrentPlayer === 2) {
    activePlayer = 'p2';
  } else {
    activePlayer = null; // unknown first player - receiver should not update their state
  }
  const payload = {
    room: window._ol.room,
    p: window._ol.p,
    type: actionType,
    seq: nextOnlineSeqDesktop(),
    turn: s.turn,
    active: activePlayer,
    p1: window._ol.p === 'p1' ? publicState : null,
    p2: window._ol.p === 'p2' ? publicState : null
  };
  NetworkService.sendAction(payload);
}
