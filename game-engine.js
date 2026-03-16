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
    this._instanceCounter = 0;
  }

  /**
   * ゲーム初期化
   * @param {Array} deckData - デッキデータ（カード配列）
   */
  initGame(deckData) {
    if (!deckData || !Array.isArray(deckData)) {
      throw new Error('Invalid deck data');
    }

    this._instanceCounter = 0;

    const expanded = this._expandFrom(deckData).map(card => ({
      ...card,
      tapped: false
    }));
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
        faceUp: false,
        tapped: false
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
      playedCard.tapped = false;
      this.state.battleZone.push(playedCard);
    } else if (zone === 'mana') {
      playedCard.tapped = false;
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
    const drawn = this.state.deck.pop();
    if (!drawn) return false;
    drawn.tapped = false;
    this.state.hand.push(drawn);
    return true;
  }

  /**
   * 指定ゾーンのカードをタップ/アンタップ
   * @param {string} zone - 'battleZone' | 'manaZone' | 'battle' | 'mana'
   * @param {number} cardIndex
   */
  tapCard(zone, cardIndex) {
    const zoneMap = {
      battle: 'battleZone',
      mana: 'manaZone',
      battleZone: 'battleZone',
      manaZone: 'manaZone'
    };
    const zoneKey = zoneMap[zone] || zone;
    const cards = this.state[zoneKey];

    if (!Array.isArray(cards) || !cards[cardIndex]) return false;

    this._saveState();
    cards[cardIndex].tapped = !cards[cardIndex].tapped;
    return true;
  }

  /**
   * シールドをブレイクして手札に加える
   * @param {number|null} targetShieldIndex
   * @returns {Object|null}
   */
  breakShield(targetShieldIndex = null) {
    if (this.state.shields.length === 0) return null;

    this._saveState();
    const idx = (targetShieldIndex !== null
      && targetShieldIndex >= 0
      && targetShieldIndex < this.state.shields.length)
      ? targetShieldIndex
      : 0;
    const [broken] = this.state.shields.splice(idx, 1);
    if (!broken) return null;

    if (broken.faceUp !== undefined) {
      delete broken.faceUp;
    }
    broken.tapped = false;
    this.state.hand.push(broken);
    return broken;
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
    const card = this._takeCardFromZone(zoneKey, idx);
    if (!card) return false;

    if (zoneKey === 'shields' && card.faceUp !== undefined) {
      delete card.faceUp;
    }

    this.state.graveyard.push(card);
    return true;
  }

  _normalizeUnderCards(card) {
    if (!card || typeof card !== 'object') return [];

    if (!Array.isArray(card.underCards)) {
      card.underCards = [];
      return card.underCards;
    }

    card.underCards = card.underCards.filter((item) => item && typeof item === 'object');
    return card.underCards;
  }

  _takeCardFromZone(zoneKey, idx) {
    const zone = this.state[zoneKey];
    if (!Array.isArray(zone) || idx < 0 || idx >= zone.length) return null;

    const card = zone[idx];
    if (!card) return null;

    const isStackZone = zoneKey === 'battleZone' || zoneKey === 'manaZone';
    const underCards = this._normalizeUnderCards(card);

    if (isStackZone && underCards.length > 0) {
      const nextTop = underCards.shift();
      if (nextTop && typeof nextTop === 'object') {
        const nextUnder = this._normalizeUnderCards(nextTop);
        nextTop.underCards = [...nextUnder, ...underCards];
        zone[idx] = nextTop;
      } else {
        zone.splice(idx, 1);
      }

      card.underCards = [];
      return card;
    }

    zone.splice(idx, 1);
    return card;
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
      this.state.shields.push({ ...card, faceUp: false, tapped: false });
    } else {
      card.tapped = false;
      this.state[zoneKey].push(card);
    }

    return true;
  }

  /**
   * 任意ゾーン間でカードを移動
   * @param {string} fromZone
   * @param {number} fromIndex
   * @param {string} toZone
   * @param {{position?: 'top'|'bottom'}} options
   */
  moveCardBetweenZones(fromZone, fromIndex, toZone, options = {}) {
    const zoneMap = {
      hand: 'hand',
      battle: 'battleZone',
      battleZone: 'battleZone',
      mana: 'manaZone',
      manaZone: 'manaZone',
      deck: 'deck',
      shield: 'shields',
      shields: 'shields',
      grave: 'graveyard',
      graveyard: 'graveyard'
    };

    const sourceKey = zoneMap[fromZone];
    const targetKey = zoneMap[toZone];
    if (!sourceKey || !targetKey) return false;

    const source = this.state[sourceKey];
    const target = this.state[targetKey];
    if (!Array.isArray(source) || !Array.isArray(target) || source.length === 0) return false;

    const idx = Number.isInteger(fromIndex)
      ? fromIndex
      : (fromIndex < 0 ? source.length - 1 : Number(fromIndex));
    if (!Number.isInteger(idx) || idx < 0 || idx >= source.length) return false;

    this._saveState();

    const card = this._takeCardFromZone(sourceKey, idx);
    if (!card) return false;

    if (sourceKey === 'shields' && card.faceUp !== undefined) {
      delete card.faceUp;
    }

    if (targetKey === 'shields') {
      card.faceUp = false;
      card.tapped = false;
    } else {
      if (card.faceUp !== undefined) delete card.faceUp;
      if (targetKey === 'battleZone' || targetKey === 'manaZone' || targetKey === 'hand') {
        card.tapped = false;
      }
    }

    const position = options?.position === 'bottom' ? 'bottom' : 'top';
    if (targetKey === 'deck') {
      // deck top is array tail because drawCard() uses pop().
      if (position === 'bottom') {
        target.unshift(card);
      } else {
        target.push(card);
      }
      return true;
    }

    if (targetKey === 'battleZone' && position === 'bottom') {
      target.unshift(card);
      return true;
    }

    if (targetKey === 'graveyard' && position === 'bottom') {
      target.unshift(card);
      return true;
    }

    target.push(card);
    return true;
  }

  /**
   * 任意カードを盤面カードの下に重ねる
   * @param {string} fromZone
   * @param {number} fromIndex
   * @param {string} targetZone - 'battleZone' | 'manaZone' | 'battle' | 'mana'
   * @param {number} targetIndex
   */
  insertCardUnderCard(fromZone, fromIndex, targetZone, targetIndex) {
    const zoneMap = {
      hand: 'hand',
      battle: 'battleZone',
      battleZone: 'battleZone',
      mana: 'manaZone',
      manaZone: 'manaZone',
      deck: 'deck',
      shield: 'shields',
      shields: 'shields',
      grave: 'graveyard',
      graveyard: 'graveyard'
    };

    const sourceKey = zoneMap[fromZone];
    const targetKey = zoneMap[targetZone];
    if (!sourceKey || !targetKey) return false;
    if (targetKey !== 'battleZone' && targetKey !== 'manaZone') return false;

    const source = this.state[sourceKey];
    const target = this.state[targetKey];
    if (!Array.isArray(source) || !Array.isArray(target) || !target.length) return false;

    const sourceIdx = Number.isInteger(fromIndex) ? fromIndex : Number(fromIndex);
    const rawTargetIdx = Number.isInteger(targetIndex) ? targetIndex : Number(targetIndex);
    if (!Number.isInteger(sourceIdx) || !Number.isInteger(rawTargetIdx)) return false;
    if (sourceIdx < 0 || sourceIdx >= source.length) return false;
    if (rawTargetIdx < 0 || rawTargetIdx >= target.length) return false;
    if (sourceKey === targetKey && sourceIdx === rawTargetIdx) return false;

    this._saveState();

    let adjustedTargetIdx = rawTargetIdx;
    if (sourceKey === targetKey && sourceIdx < rawTargetIdx) {
      adjustedTargetIdx -= 1;
    }

    const card = this._takeCardFromZone(sourceKey, sourceIdx);
    if (!card) return false;

    if (sourceKey === 'shields' && card.faceUp !== undefined) {
      delete card.faceUp;
    }
    if (card.faceUp !== undefined) {
      delete card.faceUp;
    }

    card.tapped = false;

    const targetCard = target[adjustedTargetIdx];
    if (!targetCard || typeof targetCard !== 'object') return false;

    const underCards = this._normalizeUnderCards(targetCard);
    underCards.push(card);
    targetCard.underCards = underCards;
    return true;
  }

  /**
   * ターン終了
   */
  turnEnd() {
    this._saveState();
    this.state.turn++;
    [...this.state.battleZone, ...this.state.manaZone].forEach(card => {
      card.tapped = false;
    });
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

  _makeInstanceId(cardId) {
    this._instanceCounter += 1;
    const seq = String(this._instanceCounter).padStart(6, '0');
    const rand = Math.random().toString(36).slice(2, 8);
    return `${cardId || 'card'}#${seq}_${rand}`;
  }

  /**
   * 内部: デッキ展開（複数枚指定対応）
   * @param {Array} deckCards - {id, count} 形式のカード配列
   * @returns {Array} 展開されたカード配列
   */
  _expandFrom(deckCards) {
    const result = [];
    for (const cardRef of deckCards) {
      const base = typeof structuredClone === 'function'
        ? structuredClone(cardRef)
        : JSON.parse(JSON.stringify(cardRef));

      const copies = Number(cardRef?.count) > 1 ? Number(cardRef.count) : 1;
      for (let i = 0; i < copies; i++) {
        const copy = typeof structuredClone === 'function'
          ? structuredClone(base)
          : JSON.parse(JSON.stringify(base));

        const cardId = String(copy?.cardId || copy?.id || copy?.name || 'card');
        copy.cardId = cardId;
        copy.instanceId = this._makeInstanceId(cardId);
        delete copy.count;
        result.push(copy);
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
