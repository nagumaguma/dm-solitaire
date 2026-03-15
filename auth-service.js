/**
 * DM Solitaire - Authentication Service
 * ユーザー認証・セッション管理
 */

const AuthService = {
  // 現在のアカウント
  _account: null,

  /**
   * アカウント情報をSessionStorageに保存
   * @param {string} username
   * @param {string} pin
   */
  saveAccount(username, pin) {
    this._account = { username, pin };
    try {
      sessionStorage.setItem('dm_account', JSON.stringify({ username, pin }));
    } catch (e) {
      console.error('SessionStorage保存失敗:', e);
    }
  },

  /**
   * SessionStorageからアカウント情報を読み込み
   * @returns {Object|null} {username, pin} または null
   */
  loadAccount() {
    try {
      const stored = sessionStorage.getItem('dm_account');
      this._account = stored ? JSON.parse(stored) : null;
      return this._account;
    } catch (e) {
      console.error('SessionStorage読み込み失敗:', e);
      return null;
    }
  },

  /**
   * アカウント情報クリア
   */
  clearAccount() {
    this._account = null;
    try {
      sessionStorage.removeItem('dm_account');
    } catch (e) {
      console.error('SessionStorage削除失敗:', e);
    }
  },

  /**
   * 現在のアカウント情報を取得
   * @returns {Object|null}
   */
  getCurrentAccount() {
    return this._account;
  },

  /**
   * ログイン（サーバー認証）
   * @param {string} username
   * @param {string} pin
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async login(username, pin) {
    try {
      const res = await fetch('http://localhost:8765/profile/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `name=${encodeURIComponent(username)}&password=${encodeURIComponent(pin)}`
      });

      const data = await res.json();

      if (data.success) {
        this.saveAccount(username, pin);
        return { success: true, message: 'ログイン成功' };
      } else {
        return { success: false, message: data.message || 'ログイン失敗' };
      }
    } catch (error) {
      console.error('ログイン中にエラー:', error);
      return { success: false, message: 'ネットワークエラー: ' + error.message };
    }
  },

  /**
   * 新規登録
   * @param {string} username
   * @param {string} pin
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async register(username, pin) {
    try {
      const res = await fetch('http://localhost:8765/profile/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `name=${encodeURIComponent(username)}&password=${encodeURIComponent(pin)}`
      });

      const data = await res.json();

      if (data.success) {
        this.saveAccount(username, pin);
        return { success: true, message: '登録成功' };
      } else {
        return { success: false, message: data.message || '登録失敗' };
      }
    } catch (error) {
      console.error('登録中にエラー:', error);
      return { success: false, message: 'ネットワークエラー: ' + error.message };
    }
  },

  /**
   * ゲストプレイ（アカウント不要）
   */
  guest() {
    this.clearAccount();
  },

  /**
   * ログアウト
   */
  logout() {
    this.clearAccount();
  }
};
