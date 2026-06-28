# PROJECT_STATE

Last updated: 2026-06-28

## Current Direction

- This is a private Duel Masters playtesting and online match helper for friends.
- Prioritize practical DM paper-play operations, speed, and recoverability over public-service polish.
- Do not turn the UI into a generic card-game UI.
- Keep changes small. Avoid broad refactors and unrelated files.
- Cloud decks are the normal source of truth. Do not restore `localStorage.dm_decks` as the normal deck list.
- Search results must prefer `NO IMG` / placeholders over showing a possibly wrong card image.
- API failures should be distinguishable from login failure or zero search results.

## Main Files

- `index.html`: entry point, auth screen, API base selection, desktop/mobile bootstrap.
- `app-state.js`: shared state store and legacy window bridges.
- `auth-service.js`: login/register/guest session handling.
- `network-service.js`: API calls, search, card detail, cloud deck, online room/SSE helpers.
- `game-engine.js`: UI-independent game state and DM zone operations.
- `game-controller.js`: shared deck/game helpers and online public-state serialization.
- `ui-desktop.js`: desktop deck builder, game board, online lobby, manual operation UI.
- `ui-mobile.js`: mobile deck builder, game board, online lobby, manual operation UI.
- `dm-proxy-server.py`: local Python API, search/cache DB, profile/deck DB, rooms, SSE, `/ping`.

## Local Runbook

Start the API server:

```bash
python dm-proxy-server.py
```

Start the frontend server:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/index.html
```

Local API health check:

```text
http://localhost:8765/ping
```

`index.html` sets `window.DM_API_BASE` to `http://localhost:8765` for localhost/file use.

## Verification

Syntax checks:

```bash
node --check app-state.js
node --check auth-service.js
node --check network-service.js
node --check game-engine.js
node --check game-controller.js
node --check ui-desktop.js
node --check ui-mobile.js
python -c "compile(open('dm-proxy-server.py', encoding='utf-8').read(), 'dm-proxy-server.py', 'exec'); print('syntax ok')"
```

Playwright:

```bash
npm test
```

Production smoke check:

```bash
npm run prod:check
```

On PowerShell, direct `npx` may hit script execution policy. Use:

```bash
npx.cmd --no-install playwright test
```

Latest local check on 2026-06-28:

- `/ping`: OK on `localhost:8765`
- `index.html`: HTTP 200 on `localhost:8000`
- `npm test`: 9 passed

## Implemented Assumptions

- `/search` suppresses unsafe image fields server-side.
- Client search normalization keeps untrusted search result images as `NO IMG`.
- Direct add from unsafe search results does not inject fallback images.
- Detail and illustration flows can still fetch images through explicit detail/illustration endpoints.
- Normal deck management ignores `localStorage.dm_decks`; local decks are migration-only.
- Desktop/mobile manual operation menus include DM-specific moves among hand, battle, mana, shields, grave, deck top/bottom, public zones, and external zones.
- Hyper, GR, and Special zones exist in engine state and public online state.
- Online public state sends counts for hidden hand/deck/shields and public card lists for battle/mana/grave/revealed/external zones.
- Auth screen shows the current API base and `/ping` status.
- Login/register check `/ping` before auth requests so API outages are not shown as account failures.
- Search UI can show API connection failure separately from ordinary zero search results.
- The Python backend can infer its public base URL from `BASE_URL`, common hosting env vars, or reverse-proxy request headers. This keeps `/img` proxy URLs from becoming `localhost` in production.
- Production frontend API base can be overridden with `?api=https://YOUR-BACKEND` and cleared with `?clearApi=1`.
- `npm run prod:check` verifies the deployed app HTML and API `/ping`; set `DM_PROD_CHECK_SEARCH=1` to include a search endpoint check.

## Known Gaps / Next Priorities

1. Expand Playwright coverage:
   - Cloud deck source-of-truth regressions around `localStorage.dm_decks`.
   - More online sync and reconnect flows.
2. Audit DM manual-operation UI:
   - List what is available, missing, too far away, online-synced, or local-only.
3. Improve deck-top inspection:
   - `山札全部見る` currently shows deck order and can shuffle, but does not provide arbitrary reorder controls.
4. Consider untracking or ignoring generated Python bytecode in a focused cleanup.
