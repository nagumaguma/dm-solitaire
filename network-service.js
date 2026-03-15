/**
 * DM Solitaire - Network Service
 * サーバー通信（API呼び出し）
 */

const NetworkService = {
  /**
   * サーバーデッキ一覧を取得
   * @param {string} username
   * @param {string} pin
   * @returns {Promise<Array>} デッキ名配列
   */
  async loadServerDecks(username, pin) {
    try {
      const query = `username=${encodeURIComponent(username)}&pin=${encodeURIComponent(pin)}`;
      const res = await fetch(`http://localhost:8765/deck/list?${query}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
      });

      if (!res.ok) {
        console.warn('デッキ一覧取得失敗:', res.status);
        return [];
      }

      const data = await res.json();
      return Array.isArray(data) ? data : [];
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
      const query = `username=${encodeURIComponent(username)}&pin=${encodeURIComponent(pin)}&deck_name=${encodeURIComponent(deckName)}`;
      const res = await fetch(`http://localhost:8765/deck/get?${query}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
      });

      if (!res.ok) {
        console.warn('デッキ取得失敗:', res.status);
        return null;
      }

      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch (error) {
      console.error('デッキ取得エラー:', error);
      return null;
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
      const query = `q=${encodeURIComponent(q)}&page=${page}`;
      const res = await fetch(`http://localhost:8765/search?${query}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });

      if (!res.ok) {
        console.warn('検索失敗:', res.status);
        return [];
      }

      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('検索エラー:', error);
      return [];
    }
  }
};
