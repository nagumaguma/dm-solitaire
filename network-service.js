/**
 * DM Solitaire - Network Service
 * サーバー通信（API呼び出し）
 */

const NetworkService = {
  /**
   * API ベースURL（index.html で window.DM_API_BASE を設定可能）
   */
  getApiBase() {
    return (typeof window !== 'undefined' && window.DM_API_BASE) || 'http://localhost:8765';
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
      return Array.isArray(deck) ? deck : null;
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
          deck_data: deckData
        }),
        signal: this._abortSignal(10000)
      });

      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || 'クラウド保存に失敗しました' };
      }
      return { ok: true };
    } catch (error) {
      console.error('デッキ保存エラー:', error);
      return { error: 'ネットワークエラーで保存できませんでした' };
    }
  },

  /**
   * カード検索
   * @param {string} q - 検索クエリ
   * @param {number} page - ページ番号
   * @returns {Promise<Array>} 検索結果
   */
  async searchCards(q, page = 1) {
    try {
      const base = this.getApiBase();
      const query = `q=${encodeURIComponent(q)}&page=${page}`;
      const res = await fetch(`${base}/search?${query}`, {
        signal: this._abortSignal(10000)
      });

      if (!res.ok) {
        console.warn('検索失敗:', res.status);
        return [];
      }

      const data = await res.json();
      return Array.isArray(data.cards) ? data.cards : [];
    } catch (error) {
      console.error('検索エラー:', error);
      return [];
    }
  },

  // ─── オンライン対戦 ─────────────────────────────────────────────────────

  /**
   * ルーム作成
   * @param {string} name - プレイヤー名
   * @returns {Promise<{room: string, p: string}|{error: string}>}
   */
  async createRoom(name) {
    const base = this.getApiBase();
    const res = await fetch(`${base}/room/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: (name || 'Player 1').slice(0, 20) }),
      signal: this._abortSignal(10000)
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'ルーム作成に失敗しました' };
    return data;
  },

  /**
   * ルームに参加
   * @param {string} roomCode - 6文字ルームコード
   * @param {string} name - プレイヤー名
   * @returns {Promise<{ok: boolean, p: string, p1_name: string}|{error: string}>}
   */
  async joinRoom(roomCode, name) {
    const base = this.getApiBase();
    const res = await fetch(`${base}/room/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: String(roomCode).trim().toUpperCase().slice(0, 6), name: (name || 'Player 2').slice(0, 20) }),
      signal: this._abortSignal(10000)
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || '参加に失敗しました' };
    return data;
  },

  /**
   * アクション送信（状態・ターン終了）
   * @param {Object} payload - { room, p, type, turn, active, p1?, p2? }
   */
  sendAction(payload) {
    const base = this.getApiBase();
    fetch(`${base}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
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
