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
