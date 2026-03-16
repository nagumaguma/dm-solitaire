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
      graveyard: [],
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
      graveyard: [],
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
   * 指定ゾーンから墓地へ移動
   * @param {number} cardIdx - 移動するカードインデックス（-1で末尾）
   * @param {string} fromZone - 'hand' | 'battle' | 'mana' | 'shields'
   */
  moveToGraveyard(cardIdx = -1, fromZone = 'battle') {
    const zoneMap = {
      hand: 'hand',
      battle: 'battleZone',
      mana: 'manaZone',
      shield: 'shields',
      shields: 'shields'
    };
    const zoneKey = zoneMap[fromZone];
    if (!zoneKey) return false;

    const zone = this.state[zoneKey];
    if (!Array.isArray(zone) || zone.length === 0) return false;

    const idx = cardIdx < 0 ? zone.length - 1 : cardIdx;
    if (idx < 0 || idx >= zone.length) return false;

    this._saveState();
    const card = zone.splice(idx, 1)[0];
    if (!card) return false;

    if (zoneKey === 'shields' && card.faceUp !== undefined) {
      delete card.faceUp;
    }

    this.state.graveyard.push(card);
    return true;
  }

  /**
   * 墓地から指定ゾーンへ戻す
   * @param {number} cardIdx - 墓地インデックス（-1で末尾）
   * @param {string} toZone - 'hand' | 'battle' | 'mana' | 'shields'
   */
  returnFromGraveyard(cardIdx = -1, toZone = 'hand') {
    if (!Array.isArray(this.state.graveyard) || this.state.graveyard.length === 0) return false;

    const zoneMap = {
      hand: 'hand',
      battle: 'battleZone',
      mana: 'manaZone',
      shield: 'shields',
      shields: 'shields'
    };
    const zoneKey = zoneMap[toZone];
    if (!zoneKey) return false;

    const idx = cardIdx < 0 ? this.state.graveyard.length - 1 : cardIdx;
    if (idx < 0 || idx >= this.state.graveyard.length) return false;

    this._saveState();
    const card = this.state.graveyard.splice(idx, 1)[0];
    if (!card) return false;

    if (zoneKey === 'shields') {
      this.state.shields.push({ ...card, faceUp: false });
    } else {
      this.state[zoneKey].push(card);
    }

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
      const clone = typeof structuredClone === 'function'
        ? structuredClone(cardRef)
        : JSON.parse(JSON.stringify(cardRef));

      if (cardRef.count && cardRef.count > 1) {
        for (let i = 0; i < cardRef.count; i++) {
          const loopClone = typeof structuredClone === 'function'
            ? structuredClone(cardRef)
            : JSON.parse(JSON.stringify(cardRef));
          result.push(loopClone);
        }
      } else {
        result.push(clone);
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
