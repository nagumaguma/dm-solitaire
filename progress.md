Original prompt: デッキ管理の部分は、そのへんはこっちでわかってるから良いよ。ほかのやつは実装して

Progress:
- Started implementing non-deck-management improvements: card search stability, online UX/logging, DM-specific external zones.
- Implemented bounded SSE queues, room activity TTL, separated USER_DB, and bounded image cache in dm-proxy-server.py.
- Implemented search query normalization/fallback variants in network-service.js using Unicode escapes to avoid encoding damage.
- Added GameEngine external public zones: hyperZone, grZone, specialZone.
- Included external zones in desktop/mobile/game-controller public state sync.
- Added desktop/mobile menu moves for 超次元/超GR/特殊 zones.
- Added desktop/mobile external-zone board rows and online connection status text.
- Verified syntax with node --check for game-engine.js, game-controller.js, network-service.js, ui-desktop.js, ui-mobile.js.
- Verified dm-proxy-server.py syntax with Python compile.
- Ran Playwright web-game client successfully after installing Playwright/Chromium in the user skill environment; screenshot generation succeeded but local image viewing failed due Windows sandbox helper failure.
TODO:
- Existing Japanese UI strings are still partially mojibake and should be restored in a focused pass.
- Consider adding dedicated import/setup UI for external zones instead of only moving cards there during play.
- Consider exposing render_game_to_text for richer automated verification of this DOM-based app.

## 2026-06-27 Search Image Safety
- Suppressed unsafe image fields from /search results server-side.
- Normalized search result cards client-side so untrusted images render as NO IMG.
- Disabled desktop/mobile search-result image hydration and mobile DOM image patching.
- Direct add from unsafe search results no longer performs image/name fallback enrichment.
- Detail and illustration flows still use ID/name detail endpoints for explicit selection.

## 2026-06-28 Playwright Search Image Test
- Added local Playwright test setup for localhost:8000/index.html.
- Covered search terms: Bolmeteus, Fairy Life, Dedodam, Dogiragon.
- Verified search cards show name/cost/id metadata and prefer NO IMG for untrusted images.
- Verified a NO IMG search result can still be added to an in-memory editing deck.
- Found and fixed draft deck selection being cleared when the deck is not in cloud names.
- npm run test:search-image passed: 5/5.

## 2026-06-28 DM Manual Operation UI Pass
- Treated the game screen as a manual Duel Masters tabletop tool, not a generic card-game UI.
- Reworked desktop/mobile zone action menus with DM-specific move labels and added missing moves to shield, deck top/bottom, and external zones.
- Added clearer hand action shortcuts for desktop and fixed mobile hand sheet labels.
- Expanded deck reveal/peek quick destinations to hand, battle, mana, shield, grave, deck top/bottom, Hyper, GR, and Special.
- Fixed desktop opponent deck-reveal mode preserving opponent/public state instead of collapsing to public.
- Fixed renderDesktopGame onlineStatusText undefined reference.
- Added Playwright coverage for DM manual-operation UI labels and shield/external-zone menu actions.
- npx playwright test passed: 7/7.
