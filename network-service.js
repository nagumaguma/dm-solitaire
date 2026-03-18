/**
 * DM Solitaire - Network Service
 * サーバー通信（API呼び出し）
 */

const NetworkService = {
  _cardDetailCache: new Map(),
  _searchCache: new Map(),
  _deckCache: new Map(),
  _illustrationCache: new Map(),
  _cardDetailCacheTtlMs: 60 * 60 * 1000,
  _cardDetailNoImageCacheTtlMs: 90 * 1000,
  _searchCacheMaxEntries: 120,
  _searchCacheTtlMs: 5 * 60 * 1000,
  _deckCacheTtlMs: 3 * 60 * 1000,
  _illustrationCacheTtlMs: 30 * 60 * 1000,

  _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  _toHalfWidthAscii(text) {
    return String(text || '').replace(/[！-～]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    ).replace(/　/g, ' ');
  },

  normalizeRoomCode(roomCode) {
    const upper = this._toHalfWidthAscii(roomCode).toUpperCase();
    const tokenMatch = upper.match(/(?:^|[^A-Z0-9])([A-Z0-9]{6})(?=$|[^A-Z0-9])/);
    if (tokenMatch && tokenMatch[1]) return tokenMatch[1];
    return upper.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  },

  async _readJsonSafe(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  },

  _searchCacheKey(q, page) {
    return `${String(q || '').trim()}::${Number(page) || 1}`;
  },

  _deckCacheKey(username, deckName) {
    return `${String(username || '').trim()}::${String(deckName || '').trim()}`;
  },

  _setSearchCache(key, cards, total = null) {
    const totalNumber = Number(total);
    this._searchCache.set(key, {
      items: cards,
      total: Number.isFinite(totalNumber) ? totalNumber : null,
      at: Date.now()
    });

    while (this._searchCache.size > this._searchCacheMaxEntries) {
      const oldest = this._searchCache.keys().next().value;
      if (oldest === undefined) break;
      this._searchCache.delete(oldest);
    }
  },

  clearSearchCache() {
    this._searchCache.clear();
  },

  clearIllustrationCache() {
    this._illustrationCache.clear();
  },

  clearDeckCache(deckName, username = '') {
    const targetDeck = String(deckName || '').trim();
    const targetUser = String(username || '').trim();

    if (!targetDeck && !targetUser) {
      this._deckCache.clear();
      return;
    }

    for (const key of Array.from(this._deckCache.keys())) {
      const sep = key.indexOf('::');
      const keyUser = sep >= 0 ? key.slice(0, sep) : '';
      const keyDeck = sep >= 0 ? key.slice(sep + 2) : key;

      if (targetDeck && keyDeck !== targetDeck) continue;
      if (targetUser && keyUser !== targetUser) continue;
      this._deckCache.delete(key);
    }
  },

  _stripSourcePrefix(value) {
    const text = String(value || '').trim();
    return text.startsWith('src:') ? text.slice(4) : text;
  },

  _detailLookupId(value) {
    const text = this._stripSourcePrefix(value);
    if (!text) return '';
    if (text.includes('|')) return '';
    return text;
  },

  _getCardImageUrl(card) {
    return String(card?.imageUrl || card?.img || card?.thumb || '').trim();
  },

  _detailNameCacheKey(name) {
    const normalized = this._toHalfWidthAscii(name)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';
    return `name:${normalized}`;
  },

  _illustrationCacheKey(card) {
    const normalized = this.normalizeCardData(card || {});
    const lookupId = this._detailLookupId(normalized?.sourceId || normalized?.id);
    if (lookupId) return `id:${lookupId}`;
    return this._detailNameCacheKey(normalized?.name || normalized?.nameEn || '');
  },

  _getCachedIllustrations(cacheKey) {
    if (!cacheKey || !this._illustrationCache.has(cacheKey)) return null;

    const cached = this._illustrationCache.get(cacheKey);
    if (!cached || !Number.isFinite(cached?.at)) {
      this._illustrationCache.delete(cacheKey);
      return null;
    }

    if ((Date.now() - cached.at) >= this._illustrationCacheTtlMs) {
      this._illustrationCache.delete(cacheKey);
      return null;
    }

    return {
      name: String(cached?.name || '').trim(),
      options: Array.isArray(cached?.options)
        ? cached.options.map((item) => ({ ...item }))
        : []
    };
  },

  _setCachedIllustrations(cacheKey, payload) {
    if (!cacheKey || !payload || typeof payload !== 'object') return;

    this._illustrationCache.set(cacheKey, {
      name: String(payload?.name || '').trim(),
      options: Array.isArray(payload?.options)
        ? payload.options.map((item) => ({ ...item }))
        : [],
      at: Date.now()
    });
  },

  _normalizeIllustrationOption(option, index = 0) {
    const imageUrl = String(option?.imageUrl || option?.img || option?.thumb || '').trim();
    if (!imageUrl) return null;

    const artId = String(option?.artId || option?.id || option?.sourceId || '').trim()
      || `image:${Math.max(1, Number(index) + 1)}`;
    const label = String(option?.label || option?.name || '').trim()
      || `イラスト ${Math.max(1, Number(index) + 1)}`;
    const source = String(option?.source || '').trim() || 'unknown';

    return {
      artId,
      label,
      source,
      imageUrl,
      thumb: imageUrl,
      img: imageUrl
    };
  },

  _withCurrentIllustrationOption(options, card) {
    const normalized = this.normalizeCardData(card || {});
    const list = Array.isArray(options)
      ? options.map((item) => ({ ...item }))
      : [];

    const currentUrl = this._getCardImageUrl(normalized);
    if (!currentUrl) return list;

    const exists = list.some((item) => this._getCardImageUrl(item) === currentUrl);
    if (!exists) {
      list.unshift({
        artId: String(normalized?.selectedArtId || '').trim() || 'current',
        label: '現在のイラスト',
        source: 'current',
        imageUrl: currentUrl,
        thumb: currentUrl,
        img: currentUrl
      });
    }

    return list;
  },

  _fallbackIllustrations(card) {
    const normalized = this.normalizeCardData(card || {});
    return {
      name: String(normalized?.name || normalized?.nameEn || '').trim(),
      options: this._withCurrentIllustrationOption([], normalized)
    };
  },

  _getCachedCardDetail(cacheKey) {
    if (!this._cardDetailCache.has(cacheKey)) return null;

    const cachedEntry = this._cardDetailCache.get(cacheKey);
    if (cachedEntry && typeof cachedEntry === 'object' && Object.prototype.hasOwnProperty.call(cachedEntry, 'data')) {
      const ttl = cachedEntry?.hasImage ? this._cardDetailCacheTtlMs : this._cardDetailNoImageCacheTtlMs;
      if (Number.isFinite(cachedEntry?.at) && (Date.now() - cachedEntry.at) < ttl) {
        return cachedEntry.data;
      }
      this._cardDetailCache.delete(cacheKey);
      return null;
    }

    // Backward-compatible fallback for old cache format.
    return cachedEntry || null;
  },

  _setCachedCardDetail(cacheKey, detail) {
    this._cardDetailCache.set(cacheKey, {
      data: detail,
      at: Date.now(),
      hasImage: !!this._getCardImageUrl(detail)
    });
  },

  makeCardId(card) {
    if (!card || typeof card !== 'object') return '';

    const sourceId = this._stripSourcePrefix(card?.sourceId || card?.id);
    if (sourceId && !sourceId.includes('|')) return `src:${sourceId}`;

    const name = String(card?.name || card?.nameEn || '').trim();
    const cost = String(card?.cost ?? '').trim();
    const civ = String(card?.civilization || card?.civ || '').trim().toLowerCase();
    const type = String(card?.type || '').trim().toLowerCase();

    return `${name}|${cost}|${civ}|${type}`;
  },

  normalizeCardData(card) {
    if (!card || typeof card !== 'object') return card;

    const raw = (card?.card && typeof card.card === 'object')
      ? { ...card.card, ...card }
      : { ...card };
    delete raw.card;

    const name = String(raw?.name || raw?.card_name || raw?.title || '').trim();
    const cost = raw?.cost ?? raw?.mana_cost ?? raw?.manaCost ?? '';
    const civilization = raw?.civilization || raw?.civ || raw?.civil || '';
    const sourceIdCandidate = this._stripSourcePrefix(raw?.sourceId || raw?.source_id || raw?.id || raw?.card_id || raw?.pageid);
    const sourceId = sourceIdCandidate.includes('|') ? '' : sourceIdCandidate;
    const imageUrl =
      (typeof raw?.imageUrl === 'string' && raw.imageUrl.trim())
      || (typeof raw?.img === 'string' && raw.img.trim())
      || (typeof raw?.thumb === 'string' && raw.thumb.trim())
      || (typeof raw?.image === 'string' && raw.image.trim())
      || (typeof raw?.image_url === 'string' && raw.image_url.trim())
      || '';

    const cardId = String(raw?.cardId || raw?.card_id || '').trim()
      || this.makeCardId({ ...raw, sourceId, civilization, name, cost });
    const id = sourceId || String(raw?.id || cardId || '').trim();
    const countNum = Number(raw?.count);
    const count = Number.isFinite(countNum) && countNum > 0 ? Math.floor(countNum) : 1;

    return {
      ...raw,
      name,
      cost,
      count,
      id,
      sourceId,
      cardId,
      civilization,
      civ: civilization,
      imageUrl,
      thumb: imageUrl,
      img: imageUrl
    };
  },

  async fetchCardDetail(cardId, options = {}) {
    const cacheKey = this._detailLookupId(cardId);
    if (!cacheKey) return null;

    const timeoutRaw = Number(options?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 20000;
    const forceRefresh = options?.forceRefresh === true;

    if (!forceRefresh) {
      const cached = this._getCachedCardDetail(cacheKey);
      if (cached) return cached;
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/detail?id=${encodeURIComponent(cacheKey)}`, {
        signal: this._abortSignal(timeoutMs)
      });

      if (!res.ok) {
        console.warn('カード詳細取得失敗:', res.status, cacheKey);
        return null;
      }

      const data = await this._readJsonSafe(res);
      const normalized = this.normalizeCardData(data);
      this._setCachedCardDetail(cacheKey, normalized);
      return normalized;
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn('カード詳細取得タイムアウト:', cacheKey, `${timeoutMs}ms`);
      } else {
        console.error('カード詳細取得エラー:', error);
      }
      return null;
    }
  },

  async fetchCardDetailByName(cardName, options = {}) {
    const safeName = String(cardName || '').trim();
    if (!safeName) return null;

    const cacheKey = this._detailNameCacheKey(safeName);
    if (!cacheKey) return null;

    const timeoutRaw = Number(options?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 20000;
    const forceRefresh = options?.forceRefresh === true;

    if (!forceRefresh) {
      const cached = this._getCachedCardDetail(cacheKey);
      if (cached) return cached;
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/detail?name=${encodeURIComponent(safeName)}`, {
        signal: this._abortSignal(timeoutMs)
      });

      if (!res.ok) {
        console.warn('カード詳細取得失敗(name):', res.status, safeName);
        return null;
      }

      const data = await this._readJsonSafe(res);
      const normalized = this.normalizeCardData(data);
      this._setCachedCardDetail(cacheKey, normalized);
      return normalized;
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn('カード詳細取得タイムアウト(name):', safeName, `${timeoutMs}ms`);
      } else {
        console.error('カード詳細取得エラー(name):', error);
      }
      return null;
    }
  },

  async enrichCardImage(card, options = {}) {
    const normalized = this.normalizeCardData(card);
    if (!normalized) return normalized;
    if (this._getCardImageUrl(normalized) && normalized.name && Number.isFinite(Number(normalized.cost))) return normalized;

    const detailId = this._detailLookupId(normalized.sourceId || normalized.id);
    const fallbackName = String(normalized.name || normalized.nameEn || '').trim();
    if (!detailId && !fallbackName) return normalized;

    const retriesRaw = Number(options?.retries);
    const retries = Number.isFinite(retriesRaw) ? Math.max(0, Math.min(4, Math.floor(retriesRaw))) : 1;
    const retryDelayRaw = Number(options?.retryDelayMs);
    const retryDelayMs = Number.isFinite(retryDelayRaw) ? Math.max(0, Math.floor(retryDelayRaw)) : 350;
    const timeoutRaw = Number(options?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 20000;
    const totalAttempts = retries + 1;
    let merged = normalized;

    if (detailId) {
      for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
        const detail = await this.fetchCardDetail(detailId, {
          timeoutMs,
          forceRefresh: options?.forceDetailRefresh === true || attempt > 0
        });

        if (detail) {
          merged = this.normalizeCardData({
            ...merged,
            ...detail
          });
          if (this._getCardImageUrl(merged)) {
            return merged;
          }
        }

        if (attempt < totalAttempts - 1) {
          await this._wait(retryDelayMs * (attempt + 1));
        }
      }
    }

    if (!this._getCardImageUrl(merged) && fallbackName) {
      const byName = await this.fetchCardDetailByName(fallbackName, {
        timeoutMs,
        forceRefresh: options?.forceDetailRefresh === true || !!detailId
      });
      if (byName) {
        merged = this.normalizeCardData({
          ...merged,
          ...byName
        });
        if (this._getCardImageUrl(merged)) {
          return merged;
        }
      }
    }

    if (!this._getCardImageUrl(merged) && retries > 0) {
      console.warn('カード画像補完失敗:', detailId || `name:${fallbackName || 'unknown'}`, `attempts=${totalAttempts}`);
    }
    return merged;
  },

  async fetchCardIllustrations(card, options = {}) {
    const normalized = this.normalizeCardData(card || {});
    const fallback = this._fallbackIllustrations(normalized);

    const detailId = this._detailLookupId(normalized?.sourceId || normalized?.id);
    const fallbackName = String(normalized?.name || normalized?.nameEn || '').trim();
    if (!detailId && !fallbackName) return fallback;

    const cacheKey = this._illustrationCacheKey(normalized);
    const forceRefresh = options?.forceRefresh === true;
    if (!forceRefresh && cacheKey) {
      const cached = this._getCachedIllustrations(cacheKey);
      if (cached) {
        cached.options = this._withCurrentIllustrationOption(cached.options, normalized);
        return cached;
      }
    }

    const timeoutRaw = Number(options?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 20000;

    try {
      const params = new URLSearchParams();
      if (detailId) params.set('id', detailId);
      if (fallbackName) params.set('name', fallbackName);

      const base = this.getApiBase();
      const res = await fetch(`${base}/illustrations?${params.toString()}`, {
        signal: this._abortSignal(timeoutMs)
      });

      if (!res.ok) {
        console.warn('イラスト一覧取得失敗:', res.status, detailId || fallbackName);
        return fallback;
      }

      const data = await this._readJsonSafe(res);
      const rawOptions = Array.isArray(data?.options) ? data.options : [];
      const optionsList = [];
      const seenImage = new Set();

      rawOptions.forEach((item, idx) => {
        const option = this._normalizeIllustrationOption(item, idx);
        if (!option) return;
        if (seenImage.has(option.imageUrl)) return;
        seenImage.add(option.imageUrl);
        optionsList.push(option);
      });

      const result = {
        name: String(data?.name || fallbackName || normalized?.name || '').trim(),
        options: this._withCurrentIllustrationOption(optionsList, normalized)
      };

      if (cacheKey) {
        this._setCachedIllustrations(cacheKey, result);
      }

      return result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn('イラスト一覧取得タイムアウト:', detailId || fallbackName, `${timeoutMs}ms`);
      } else {
        console.error('イラスト一覧取得エラー:', error);
      }
      return fallback;
    }
  },

  applyCardIllustration(card, option) {
    const normalized = this.normalizeCardData(card || {});
    if (!normalized) return normalized;

    const imageUrl = String(option?.imageUrl || option?.img || option?.thumb || '').trim();
    if (!imageUrl) return normalized;

    const artId = String(option?.artId || option?.id || '').trim();
    return this.normalizeCardData({
      ...normalized,
      selectedArtId: artId || String(normalized?.selectedArtId || '').trim(),
      selectedImageUrl: imageUrl,
      imageUrl,
      thumb: imageUrl,
      img: imageUrl
    });
  },

  /**
   * API ベースURL（index.html で window.DM_API_BASE を設定可能）
   */
  getApiBase() {
    return (typeof window !== 'undefined' && window.DM_API_BASE) || window.location.origin;
  },

  /**
   * タイムアウト付き AbortSignal（AbortSignal.timeout 未対応環境用）
   * @param {number} ms
   * @returns {AbortSignal|undefined}
   */
  _abortSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  },

  async _postJsonWithFallback(pathCandidates, payload, options = {}) {
    const candidates = Array.isArray(pathCandidates)
      ? pathCandidates.filter((path) => String(path || '').trim())
      : [String(pathCandidates || '').trim()];
    if (!candidates.length) {
      return { ok: false, status: 0, data: {}, endpoint: '', error: new Error('no endpoint candidates') };
    }

    const retriesRaw = Number(options?.retries);
    const retries = Number.isFinite(retriesRaw) ? Math.max(0, Math.min(4, Math.floor(retriesRaw))) : 2;
    const retryDelayRaw = Number(options?.retryDelayMs);
    const retryDelayMs = Number.isFinite(retryDelayRaw) ? Math.max(0, Math.floor(retryDelayRaw)) : 500;
    const timeoutRaw = Number(options?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 15000;

    let lastStatus = 0;
    let lastError = null;
    let lastData = {};
    let lastEndpoint = '';

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      for (const endpoint of candidates) {
        lastEndpoint = endpoint;
        try {
          const base = this.getApiBase();
          const res = await fetch(`${base}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
            signal: this._abortSignal(timeoutMs)
          });

          const data = await this._readJsonSafe(res);
          lastStatus = res.status;
          lastData = data;

          if (res.ok) {
            return { ok: true, status: res.status, data, endpoint, error: null };
          }

          // Candidate endpoint missing on old server: try next candidate.
          if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) {
            continue;
          }

          // 5xx can be transient on hosted environments: retry.
          if (res.status >= 500) {
            continue;
          }

          // 4xx considered deterministic failure.
          return { ok: false, status: res.status, data, endpoint, error: null };
        } catch (error) {
          lastError = error;
        }
      }

      if (attempt < retries) {
        await this._wait(retryDelayMs * (attempt + 1));
      }
    }

    return {
      ok: false,
      status: lastStatus,
      data: lastData,
      endpoint: lastEndpoint,
      error: lastError
    };
  },

  /**
   * サーバーデッキ一覧を取得
   * @param {string} username
   * @param {string} pin
   * @returns {Promise<Array|null>} デッキ名配列。通信障害時は null
   */
  async loadServerDecks(username, pin) {
    const result = await this._postJsonWithFallback(
      ['/deck/names', '/deck/list'],
      { username, pin },
      { retries: 2, retryDelayMs: 500, timeoutMs: 15000 }
    );

    if (result.ok) {
      const decks = result?.data?.decks;
      return Array.isArray(decks) ? decks : [];
    }

    if (result.status === 400 || result.status === 401) {
      console.warn('デッキ一覧取得失敗:', result.status, result.endpoint);
      return [];
    }

    console.error('デッキ一覧取得エラー:', result.error || result.status || 'unknown', result.endpoint);
    return null;
  },

  /**
   * デッキ一覧の取得結果が通信障害か判定
   * @param {Array|null} value
   * @returns {boolean}
   */
  isServerDeckListUnavailable(value) {
    return value === null;
  },

  /**
   * サーバーデッキ取得が通信障害か判定
   * @param {Array|null} value
   * @returns {boolean}
   */
  isServerDeckUnavailable(value) {
    return value === null;
  },

  /**
   * 特定のサーバーデッキを取得
   * @param {string} username
   * @param {string} pin
   * @param {string} deckName
   * @returns {Promise<Array|null>} カード配列 or null
   */
  async fetchServerDeck(username, pin, deckName) {
    const cacheKey = this._deckCacheKey(username, deckName);
    const cached = this._deckCache.get(cacheKey);
    if (cached && Number.isFinite(cached.at) && (Date.now() - cached.at) < this._deckCacheTtlMs) {
      return cached.items.map((card) => this.normalizeCardData(card));
    }

    const result = await this._postJsonWithFallback(
      ['/deck/fetch', '/deck/get'],
      { username, pin, deck_name: deckName },
      { retries: 2, retryDelayMs: 500, timeoutMs: 15000 }
    );

    if (!result.ok) {
      if (result.status === 404) {
        return null;
      }

      if (result.status === 400 || result.status === 401) {
        console.warn('デッキ取得失敗:', result.status, result.endpoint);
        return null;
      }

      console.error('デッキ取得エラー:', result.error || result.status || 'unknown', result.endpoint);
      return null;
    }

    const deck = result?.data?.deck_data;
    if (!Array.isArray(deck)) return null;

    const normalized = deck.map(card => this.normalizeCardData(card));
    this._deckCache.set(cacheKey, {
      items: normalized,
      at: Date.now()
    });

    return normalized;
  },

  /**
   * サーバーへデッキ保存
   * @param {string} username
   * @param {string} pin
   * @param {string} deckName
   * @param {Array} deckData
   * @returns {Promise<{ok: true}|{error: string}>}
   */
  async saveDeck(username, pin, deckName, deckData) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/deck/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          pin,
          deck_name: deckName,
          deck_data: Array.isArray(deckData)
            ? deckData.map(card => this.normalizeCardData(card))
            : []
        }),
        signal: this._abortSignal(10000)
      });

      let data = {};
      try { data = await res.json(); } catch { /* ignore non-JSON error body */ }
      if (!res.ok) {
        return { error: data.error || 'クラウド保存に失敗しました' };
      }
      this.clearDeckCache(deckName, username);
      return { ok: true };
    } catch (error) {
      console.error('デッキ保存エラー:', error);
      return { error: 'ネットワークエラーで保存できませんでした' };
    }
  },

  /**
   * サーバーのデッキを削除
   * @param {string} username
   * @param {string} pin
   * @param {string} deckName
   * @returns {Promise<{ok: true}|{error: string}>}
   */
  async deleteDeck(username, pin, deckName) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/deck/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin, deck_name: deckName }),
        signal: this._abortSignal(10000)
      });

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        return { error: data.error || `デッキ削除に失敗しました (${res.status})` };
      }
      this.clearDeckCache(deckName, username);
      return { ok: true };
    } catch (error) {
      console.error('デッキ削除エラー:', error);
      return { error: 'ネットワークエラーで削除できませんでした' };
    }
  },

  /**
   * カード検索（メタ情報付き）
   * @param {string} q - 検索クエリ
   * @param {number} page - ページ番号
   * @returns {Promise<{cards:Array,total:number,page:number}>}
   */
  async searchCardsWithMeta(q, page = 1) {
    try {
      const keyword = String(q || '').trim();
      const pageNumber = Number(page) || 1;
      if (!keyword) {
        return { cards: [], total: 0, page: pageNumber };
      }

      const cacheKey = this._searchCacheKey(keyword, pageNumber);
      const cached = this._searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.at) < this._searchCacheTtlMs) {
        const cachedTotal = Number(cached.total);
        return {
          cards: Array.isArray(cached.items) ? cached.items : [],
          total: Number.isFinite(cachedTotal) ? cachedTotal : 0,
          page: pageNumber
        };
      }

      const base = this.getApiBase();
      const query = `q=${encodeURIComponent(keyword)}&page=${pageNumber}`;
      const res = await fetch(`${base}/search?${query}`, {
        signal: this._abortSignal(10000)
      });

      if (!res.ok) {
        console.warn('検索失敗:', res.status);
        return { cards: [], total: 0, page: pageNumber };
      }

      let data = {};
      try { data = await res.json(); } catch { return { cards: [], total: 0, page: pageNumber }; }
      const cards = Array.isArray(data.cards) ? data.cards : [];
      const normalized = cards.map(card => this.normalizeCardData(card));
      const total = Number(data.total);
      const safeTotal = Number.isFinite(total) ? total : normalized.length;
      this._setSearchCache(cacheKey, normalized, safeTotal);
      return { cards: normalized, total: safeTotal, page: pageNumber };
    } catch (error) {
      console.error('検索エラー:', error);
      return { cards: [], total: 0, page: Number(page) || 1 };
    }
  },

  /**
   * カード検索
   * @param {string} q - 検索クエリ
   * @param {number} page - ページ番号
   * @returns {Promise<Array>} 検索結果
   */
  async searchCards(q, page = 1) {
    const result = await this.searchCardsWithMeta(q, page);
    return Array.isArray(result.cards) ? result.cards : [];
  },

  // ─── オンライン対戦 ─────────────────────────────────────────────────────

  /**
   * ルーム作成
   * @param {string} name - プレイヤー名
   * @returns {Promise<{room: string, p: string}|{error: string}>}
   */
  async createRoom(name) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: (name || 'Player 1').slice(0, 20) }),
        signal: this._abortSignal(10000)
      });
      const data = await this._readJsonSafe(res);
      if (!res.ok) return { error: data.error || 'ルーム作成に失敗しました' };
      return data;
    } catch (error) {
      console.error('createRoom通信エラー:', error);
      return { error: 'サーバーに接続できませんでした' };
    }
  },

  /**
   * ルームに参加
   * @param {string} roomCode - 6文字ルームコード
   * @param {string} name - プレイヤー名
   * @returns {Promise<{ok: boolean, p: string, p1_name: string}|{error: string}>}
   */
  async joinRoom(roomCode, name) {
    const normalizedRoom = this.normalizeRoomCode(roomCode);
    if (!normalizedRoom || normalizedRoom.length !== 6) {
      return { error: 'ルームコードは6文字で入力してください' };
    }

    const base = this.getApiBase();
    let lastError = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${base}/room/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: normalizedRoom, name: (name || 'Player 2').slice(0, 20) }),
          signal: this._abortSignal(10000)
        });
        const data = await this._readJsonSafe(res);

        if (res.ok) return data;

        const rawError = String(data.error || '').trim().toLowerCase();
        const serverError = rawError === 'room not found'
          ? 'ルームが見つかりません。コードを確認して再入力してください。'
          : (data.error || '参加に失敗しました');
        if (res.status === 404 && attempt < maxRetries) {
          // Room create/join calls can land on different instances in some deployments.
          // Retry briefly to increase the chance of reaching the room owner instance.
          await this._wait(1000 * (attempt + 1));
          continue;
        }

        return { error: serverError };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await this._wait(1000 * (attempt + 1));
          continue;
        }
      }
    }

    console.error('joinRoom通信エラー:', lastError);
    return { error: 'サーバーに接続できませんでした' };
  },

  /**
   * アクション送信（状態・ターン終了）
   * @param {Object} payload - { room, p, type, turn, active, p1?, p2? }
   * @returns {Promise<boolean>}
   */
  async sendAction(payload) {
    const base = this.getApiBase();
    const maxRetries = 1;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${base}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: this._abortSignal(8000)
        });

        if (res.ok) {
          return true;
        }

        const text = await res.text();
        if (attempt < maxRetries) {
          await this._wait(400 * (attempt + 1));
          continue;
        }

        console.warn('sendAction失敗:', res.status, text || 'empty response');
        return false;
      } catch (error) {
        if (attempt < maxRetries) {
          await this._wait(400 * (attempt + 1));
          continue;
        }

        console.warn('sendAction通信エラー:', error);
        return false;
      }
    }

    return false;
  },

  /**
   * SSE イベントストリーム取得
   * @param {string} room
   * @param {string} p - 'p1' | 'p2'
   * @returns {EventSource}
   */
  createEventSource(room, p) {
    const base = this.getApiBase();
    return new EventSource(`${base}/events?room=${encodeURIComponent(room)}&p=${encodeURIComponent(p)}`);
  },

  /**
   * チャット送信
   * @param {string} room
   * @param {string} p
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  async sendChat(room, p, message) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, p, message: String(message).slice(0, 200) }),
        signal: this._abortSignal(8000)
      });
      return res.ok;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('sendChat通信エラー:', error);
      }
      return false;
    }
  }
};
