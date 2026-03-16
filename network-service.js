/**
 * DM Solitaire - Network Service
 * サーバー通信（API呼び出し）
 */

const NetworkService = {
  _cardDetailCache: new Map(),
  _searchCache: new Map(),
  _deckCache: new Map(),
  _searchCacheMaxEntries: 120,
  _searchCacheTtlMs: 5 * 60 * 1000,
  _deckCacheTtlMs: 3 * 60 * 1000,

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

  async fetchCardDetail(cardId) {
    const cacheKey = this._detailLookupId(cardId);
    if (!cacheKey) return null;

    if (this._cardDetailCache.has(cacheKey)) {
      return this._cardDetailCache.get(cacheKey);
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/detail?id=${encodeURIComponent(cacheKey)}`, {
        signal: this._abortSignal(10000)
      });

      if (!res.ok) {
        console.warn('カード詳細取得失敗:', res.status, cacheKey);
        return null;
      }

      const data = await res.json();
      const normalized = this.normalizeCardData(data);
      this._cardDetailCache.set(cacheKey, normalized);
      return normalized;
    } catch (error) {
      console.error('カード詳細取得エラー:', error);
      return null;
    }
  },

  async enrichCardImage(card) {
    const normalized = this.normalizeCardData(card);
    if (!normalized) return normalized;
    if (normalized.imageUrl && normalized.name && Number.isFinite(Number(normalized.cost))) return normalized;

    const detailId = this._detailLookupId(normalized.sourceId || normalized.id);
    if (!detailId) return normalized;

    const detail = await this.fetchCardDetail(detailId);
    if (!detail) return normalized;

    return this.normalizeCardData({
      ...normalized,
      ...detail
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

  /**
   * サーバーデッキ一覧を取得
   * @param {string} username
   * @param {string} pin
   * @returns {Promise<Array>} デッキ名配列
   */
  async loadServerDecks(username, pin) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/deck/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin }),
        signal: this._abortSignal(10000)
      });

      if (!res.ok) {
        console.warn('デッキ一覧取得失敗:', res.status);
        return [];
      }

      const data = await res.json();
      return Array.isArray(data.decks) ? data.decks : [];
    } catch (error) {
      console.error('デッキ一覧取得エラー:', error);
      return [];
    }
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
    if (cached && (Date.now() - cached.at) < this._deckCacheTtlMs) {
      return cached.items.map((card) => this.normalizeCardData(card));
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/deck/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin, deck_name: deckName }),
        signal: this._abortSignal(10000)
      });

      if (!res.ok) {
        console.warn('デッキ取得失敗:', res.status);
        return null;
      }

      const data = await res.json();
      const deck = data.deck_data;
      if (!Array.isArray(deck)) return null;

      const normalized = deck.map(card => this.normalizeCardData(card));
      this._deckCache.set(cacheKey, {
        items: normalized.map((card) => this.normalizeCardData(card)),
        at: Date.now()
      });

      return normalized;
    } catch (error) {
      console.error('デッキ取得エラー:', error);
      return null;
    }
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

      const data = await res.json();
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

      const data = await res.json();
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
          await this._wait(300 * (attempt + 1));
          continue;
        }

        return { error: serverError };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await this._wait(300 * (attempt + 1));
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
    const base = this.getApiBase();
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, p, message: String(message).slice(0, 200) })
    });
    return res.ok;
  }
};
