/**
 * DM Solitaire - Shared Game Controller
 * Consolidates shared state, deck and game action logic.
 */

(function initGameController(global) {
  function cloneCards(cards) {
    return Array.isArray(cards) ? JSON.parse(JSON.stringify(cards)) : [];
  }

  function getLocalSavedDecks() {
    try {
      const raw = localStorage.getItem('dm_decks');
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('dm_decks parse error', err);
      return {};
    }
  }

  function getSavedDecks() {
    return {};
  }

  function saveSavedDecks(_decks) {
    // Cloud-only deck management: do not write dm_decks during normal flows.
  }

  function setDeckEditingState(deckName, cards) {
    if (global.AppState) {
      global.AppState.patch({
        _deckEditing: deckName || null,
        _deckCards: cloneCards(cards)
      });
      return;
    }

    global._deckEditing = deckName || null;
    global._deckCards = cloneCards(cards);
  }

  function getDeckEditingState() {
    if (global.AppState) {
      return {
        deckName: global.AppState.get('_deckEditing'),
        cards: global.AppState.get('_deckCards') || []
      };
    }

    return {
      deckName: global._deckEditing,
      cards: global._deckCards || []
    };
  }

  async function resolveDeckData(deckName, account) {
    if (account && !account.isGuest && account.pin) {
      const remote = await NetworkService.fetchServerDeck(account.username, account.pin, deckName);
      return Array.isArray(remote) ? remote : null;
    }

    const editing = getDeckEditingState();
    if (
      String(editing.deckName || '') === String(deckName || '') &&
      Array.isArray(editing.cards) &&
      editing.cards.length
    ) {
      return cloneCards(editing.cards);
    }

    return null;
  }

  function addCardToDeck(cards, card, maxCopies = 4) {
    const next = cloneCards(cards);
    if (!card || typeof card !== 'object') return next;

    const cardKey = String(card.cardId || card.id || card.name || '');
    if (!cardKey) return next;

    const existing = next.find((item) => String(item.cardId || item.id || item.name || '') === cardKey);
    if (existing) {
      existing.count = Math.min(maxCopies, (existing.count || 1) + 1);
      return next;
    }

    next.push({ ...card, count: 1 });
    return next;
  }

  function changeDeckCardCount(cards, idx, delta, minCopies = 1, maxCopies = 4) {
    const next = cloneCards(cards);
    const target = next[idx];
    if (!target) return next;

    const current = target.count || 1;
    const updated = current + delta;
    if (updated < minCopies) {
      next.splice(idx, 1);
      return next;
    }

    target.count = Math.max(minCopies, Math.min(maxCopies, updated));
    return next;
  }

  function removeDeckCard(cards, idx) {
    const next = cloneCards(cards);
    if (idx < 0 || idx >= next.length) return next;
    next.splice(idx, 1);
    return next;
  }

  function countDeckCards(cards) {
    if (!Array.isArray(cards)) return 0;
    return cards.reduce((sum, card) => sum + (Number(card?.count) || 1), 0);
  }

  function getCardCivClass(card) {
    const raw = String(card?.civilization || card?.civ || '').toLowerCase();
    if (raw.includes('fire') || raw.includes('火')) return 'fire';
    if (raw.includes('water') || raw.includes('水')) return 'water';
    if (raw.includes('light') || raw.includes('光')) return 'light';
    if (raw.includes('darkness') || raw.includes('dark') || raw.includes('闇')) return 'dark';
    if (raw.includes('nature') || raw.includes('自然')) return 'nature';
    return 'multi';
  }

  function canActOnline(onlineState, currentPlayer) {
    if (!onlineState) return true;
    if (!currentPlayer) return false;
    const myNum = onlineState.p === 'p1' ? 1 : 2;
    return currentPlayer === myNum;
  }

  function clearOnlineSession() {
    if (global.AppState) {
      global.AppState.patch({
        _ol: null,
        _olDeckName: null,
        _olDeckData: null,
        _olOpponent: null,
        _olCurrentPlayer: null,
        _olStageName: null,
        _olChatLogDesktop: [],
        _olChatLogMobile: []
      });
      return;
    }

    global._ol = null;
    global._olDeckName = null;
    global._olDeckData = null;
    global._olOpponent = null;
    global._olCurrentPlayer = null;
    global._olStageName = null;
    global._olChatLogDesktop = [];
    global._olChatLogMobile = [];
  }

  function initSoloGame(engine, deckData) {
    if (!engine || !Array.isArray(deckData) || !deckData.length) return false;
    engine.initGame(deckData);
    clearOnlineSession();
    return true;
  }

  function playCardByHandIndex(engine, handIndex, zone) {
    if (!engine || !engine.state || !Array.isArray(engine.state.hand)) return false;
    const card = engine.state.hand[handIndex];
    if (!card) return false;
    return !!engine.playCard(card, zone);
  }

  function tapCard(engine, zone, idx) {
    if (!engine) return false;
    return !!engine.tapCard(zone, idx);
  }

  function setCardTapped(engine, zone, idx, tapped) {
    if (!engine || !engine.state) return false;

    const zoneMap = {
      battle: 'battleZone',
      mana: 'manaZone',
      battleZone: 'battleZone',
      manaZone: 'manaZone'
    };
    const zoneKey = zoneMap[zone] || zone;
    const cards = engine.state[zoneKey];
    const card = Array.isArray(cards) ? cards[idx] : null;
    if (!card) return false;

    const nextTapped = !!tapped;
    if (!!card.tapped === nextTapped) return true;
    return !!engine.tapCard(zone, idx);
  }

  function untapAllMana(engine) {
    if (!engine || typeof engine.untapAllMana !== 'function') return false;
    return !!engine.untapAllMana();
  }

  function setShieldFaceUp(engine, shieldIndex, faceUp) {
    if (!engine || typeof engine.setShieldFaceUp !== 'function') return false;
    return !!engine.setShieldFaceUp(shieldIndex, faceUp);
  }

  function breakShield(engine, selectedIndex) {
    if (!engine) return { ok: false, card: null };
    const card = engine.breakShield(selectedIndex);
    return { ok: !!card, card: card || null };
  }

  function drawCard(engine) {
    if (!engine) return false;
    return !!engine.drawCard();
  }

  function shuffleDeck(engine) {
    if (!engine || typeof engine.shuffleDeck !== 'function') return false;
    return !!engine.shuffleDeck();
  }

  function turnEnd(engine, onlineState) {
    if (!engine) return false;
    engine.turnEnd();

    if (onlineState) {
      const nextPlayer = onlineState.p === 'p1' ? 2 : 1;
      if (global.AppState) global.AppState.set('_olCurrentPlayer', nextPlayer);
      else global._olCurrentPlayer = nextPlayer;
    }

    return true;
  }

  function moveToGraveyard(engine, fromZone) {
    if (!engine) return false;
    return !!engine.moveToGraveyard(-1, fromZone);
  }

  function returnFromGraveyard(engine, toZone) {
    if (!engine) return false;
    return !!engine.returnFromGraveyard(-1, toZone || 'hand');
  }

  function moveCardBetweenZones(engine, fromZone, fromIndex, toZone, options) {
    if (!engine || typeof engine.moveCardBetweenZones !== 'function') return false;
    return !!engine.moveCardBetweenZones(fromZone, fromIndex, toZone, options || {});
  }

  function insertCardUnderCard(engine, fromZone, fromIndex, targetZone, targetIndex) {
    if (!engine || typeof engine.insertCardUnderCard !== 'function') return false;
    return !!engine.insertCardUnderCard(fromZone, fromIndex, targetZone, targetIndex);
  }

  function undo(engine) {
    if (!engine) return false;
    return !!engine.undo();
  }

  function startOnlineMatch(playerTag) {
    const initialOpponent = {
      hand: 5,
      battleZone: 0,
      manaZone: 0,
      shields: 5,
      deckRevealZone: 0,
      revealedZone: 0,
      hyperZone: 0,
      grZone: 0,
      specialZone: 0,
      deck: 30,
      graveyard: 0
    };
    // p1 randomly decides who goes first; p2 defers to p1's initial state broadcast.
    const current = playerTag === 'p1' ? (Math.random() < 0.5 ? 1 : 2) : null;

    if (global.AppState) {
      global.AppState.patch({
        _olOpponent: initialOpponent,
        _olCurrentPlayer: current,
        _olChatLogDesktop: [],
        _olChatLogMobile: []
      });
      return;
    }

    global._olOpponent = initialOpponent;
    global._olCurrentPlayer = current;
    global._olChatLogDesktop = [];
    global._olChatLogMobile = [];
  }

  function serializePublicCard(card) {
    const name = String(card?.name || card?.nameEn || '').trim();
    const cost = card?.cost ?? '';
    const power = String(card?.power || '').trim();
    const civilization = String(card?.civilization || card?.civ || '').trim();
    const imageUrl = String(card?.imageUrl || card?.img || card?.thumb || '').trim();
    const underCards = Array.isArray(card?.underCards)
      ? card.underCards.map((underCard) => serializePublicCard(underCard))
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

  function serializePublicCards(cards) {
    if (!Array.isArray(cards)) return [];
    return cards.map((card) => serializePublicCard(card));
  }

  function buildPublicState(state) {
    return {
      hand: state.hand.length,
      deck: state.deck.length,
      shields: state.shields.length,
      deckRevealZone: serializePublicCards(state.deckRevealZone),
      revealedZone: serializePublicCards(state.revealedZone),
      hyperZone: serializePublicCards(state.hyperZone),
      grZone: serializePublicCards(state.grZone),
      specialZone: serializePublicCards(state.specialZone),
      battleZone: serializePublicCards(state.battleZone),
      manaZone: serializePublicCards(state.manaZone),
      graveyard: serializePublicCards(state.graveyard)
    };
  }

  function buildActionPayload(engineState, onlineState, actionType, currentPlayer) {
    const s = engineState;
    const p = onlineState;
    const publicState = buildPublicState(s);
    let active;
    if (actionType === 'turn_end') {
      active = p.p === 'p1' ? 'p2' : 'p1';
    } else if (currentPlayer === 1) {
      active = 'p1';
    } else if (currentPlayer === 2) {
      active = 'p2';
    } else {
      active = null; // unknown first player - receiver should not update their state
    }
    return {
      room: p.room,
      p: p.p,
      type: actionType,
      seq: nextOnlineSeq(p),
      turn: s.turn,
      active,
      p1: p.p === 'p1' ? publicState : null,
      p2: p.p === 'p2' ? publicState : null
    };
  }

  function nextOnlineSeq(onlineState) {
    if (!onlineState || typeof onlineState !== 'object') return 0;
    onlineState.localSeq = (Number(onlineState.localSeq) || 0) + 1;
    return onlineState.localSeq;
  }

  function shouldApplyRemotePayload(onlineState, payload) {
    if (!onlineState || typeof onlineState !== 'object') return false;
    if (!payload || typeof payload !== 'object') return false;

    const seq = Number(payload?.seq || 0);
    const last = Number(onlineState.remoteSeq || 0);
    if (seq <= last) return false;

    onlineState.remoteSeq = seq;
    return true;
  }

  function sendOnlineAction(engine, actionType) {
    const onlineState = global.AppState ? global.AppState.get('_ol') : global._ol;
    const currentPlayer = global.AppState ? global.AppState.get('_olCurrentPlayer') : global._olCurrentPlayer;
    if (!onlineState || !engine || !engine.state) return;

    const payload = buildActionPayload(engine.state, onlineState, actionType, currentPlayer);
    NetworkService.sendAction(payload);
  }

  function createSearchController(config) {
    const pageSize = Number(config?.pageSize) || 20;
    const searchFn = config?.searchFn;
    const transformPage = typeof config?.transformPage === 'function'
      ? config.transformPage
      : null;

    if (typeof searchFn !== 'function') {
      throw new Error('createSearchController requires searchFn');
    }

    const emptyState = () => ({
      query: '',
      effectiveQuery: '',
      page: 0,
      items: [],
      total: 0,
      hasMore: false,
      loading: false,
      source: '',
      error: null
    });

    let state = emptyState();
    let requestId = 0;

    function snapshot() {
      return {
        query: state.query,
        effectiveQuery: state.effectiveQuery,
        page: state.page,
        items: [...state.items],
        total: state.total,
        hasMore: state.hasMore,
        loading: state.loading,
        source: state.source,
        error: state.error
      };
    }

    async function search(query, append = false) {
      const keyword = String(query || '').trim();
      if (!keyword) {
        requestId += 1;
        state = emptyState();
        return snapshot();
      }

      if (!append && keyword !== state.query) {
        state = { ...emptyState(), query: keyword };
      }

      if (state.loading) return snapshot();

      state.loading = true;
      const thisRequest = ++requestId;
      const nextPage = append ? state.page + 1 : 1;

      try {
        const result = await searchFn(keyword, nextPage);
        if (thisRequest !== requestId) return snapshot();

        const rawItems = Array.isArray(result)
          ? result.slice()
          : (Array.isArray(result?.cards) ? result.cards.slice() : []);
        const pageItems = transformPage
          ? await transformPage(rawItems, {
            query: keyword,
            page: nextPage,
            append,
            result
          })
          : rawItems;
        if (thisRequest !== requestId) return snapshot();
        const safePageItems = Array.isArray(pageItems) ? pageItems : [];

        const previousCount = append ? state.items.length : 0;
        const combinedCount = previousCount + safePageItems.length;
        const resultTotal = Number(result?.total);
        const hasTotal = Number.isFinite(resultTotal) && resultTotal >= 0;
        const fallbackHasMore = rawItems.length >= pageSize || safePageItems.length >= pageSize;

        state = {
          query: keyword,
          effectiveQuery: String(result?.query || keyword),
          page: Number(result?.page) || nextPage,
          items: append ? [...state.items, ...safePageItems] : safePageItems,
          total: hasTotal ? resultTotal : combinedCount,
          hasMore: result?.error ? false : (hasTotal ? combinedCount < resultTotal : fallbackHasMore),
          loading: false,
          source: String(result?.source || ''),
          error: result?.error ? result : null
        };
      } catch (err) {
        if (thisRequest === requestId) {
          state = {
            ...state,
            loading: false,
            hasMore: false,
            error: {
              error: 'search_failed',
              message: err?.message || 'search request failed',
              base: typeof NetworkService !== 'undefined' && NetworkService.getApiBase ? NetworkService.getApiBase() : ''
            }
          };
        }
        console.warn('search request failed', err);
      }

      return snapshot();
    }

    return {
      search: (query) => search(query, false),
      searchMore: () => search(state.query, true),
      reset: () => {
        requestId += 1;
        state = emptyState();
        return snapshot();
      },
      getState: snapshot
    };
  }

  global.GameController = {
    getSavedDecks,
    getLocalSavedDecks,
    saveSavedDecks,
    setDeckEditingState,
    getDeckEditingState,
    resolveDeckData,
    addCardToDeck,
    changeDeckCardCount,
    removeDeckCard,
    countDeckCards,
    getCardCivClass,
    canActOnline,
    clearOnlineSession,
    initSoloGame,
    playCardByHandIndex,
    tapCard,
    setCardTapped,
    untapAllMana,
    setShieldFaceUp,
    breakShield,
    drawCard,
    shuffleDeck,
    turnEnd,
    moveToGraveyard,
    returnFromGraveyard,
    moveCardBetweenZones,
    insertCardUnderCard,
    undo,
    startOnlineMatch,
    sendOnlineAction,
    nextOnlineSeq,
    shouldApplyRemotePayload,
    createSearchController
  };
})(window);
