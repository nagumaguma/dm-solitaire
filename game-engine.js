/**
 * DM Solitaire - Game Engine
 * ゲームロジック中核（UI無依存）
 */

class GameEngine {
  constructor() {
    this.state = {
      hand: [],
      battleZone: [],
      manaZone: [],
      deck: [],
      shields: [],
      turn: 1
    };
    this.history = [];
  }

  /**
   * ゲーム初期化
   * @param {Array} deckData - デッキデータ（カード配列）
   */
  initGame(deckData) {
    if (!deckData || !Array.isArray(deckData)) {
      throw new Error('Invalid deck data');
    }

    const expanded = this._expandFrom(deckData);
    const shuffled = this._shuffle(expanded);

    this.state = {
      hand: [],
      battleZone: [],
      manaZone: [],
      deck: shuffled,
      shields: [],
      turn: 1
    };

    // 初期ハンド（5枚）
    for (let i = 0; i < 5 && this.state.deck.length; i++) {
      this.state.hand.push(this.state.deck.pop());
    }

    // 初期シールド（5枚）
    for (let i = 0; i < 5 && this.state.deck.length; i++) {
      this.state.shields.push({
        ...this.state.deck.pop(),
        faceUp: false
      });
    }

    this.history = [];
    this._saveState();
  }

  /**
   * カードをプレイ
   * @param {Object} card - カードオブジェクト
   * @param {string} zone - 配置ゾーン ('battle', 'mana')
   */
  playCard(card, zone) {
    const handIdx = this.state.hand.indexOf(card);
    if (handIdx === -1) return false;

    this._saveState();

    // 手札から削除
    const playedCard = this.state.hand.splice(handIdx, 1)[0];

    // ゾーンに追加
    if (zone === 'battle') {
      this.state.battleZone.push(playedCard);
    } else if (zone === 'mana') {
      this.state.manaZone.push(playedCard);
    }

    return true;
  }

  /**
   * 手札にドロー
   */
  drawCard() {
    if (this.state.deck.length === 0) return false;

    this._saveState();
    this.state.hand.push(this.state.deck.pop());
    return true;
  }

  /**
   * ターン終了
   */
  turnEnd() {
    this._saveState();
    this.state.turn++;
  }

  /**
   * アンドゥ
   */
  undo() {
    if (this.history.length === 0) return false;
    this.state = JSON.parse(this.history.pop());
    return true;
  }

  /**
   * 現在の状態を取得
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * 内部: 状態を履歴に保存
   */
  _saveState() {
    this.history.push(JSON.stringify(this.state));
  }

  /**
   * 内部: デッキ展開（複数枚指定対応）
   * @param {Array} deckCards - {id, count} 形式のカード配列
   * @returns {Array} 展開されたカード配列
   */
  _expandFrom(deckCards) {
    const result = [];
    for (const cardRef of deckCards) {
      if (cardRef.count && cardRef.count > 1) {
        for (let i = 0; i < cardRef.count; i++) {
          result.push({ ...cardRef });
        }
      } else {
        result.push({ ...cardRef });
      }
    }
    return result;
  }

  /**
   * 内部: シャッフル
   */
  _shuffle(arr) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
