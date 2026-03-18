#!/usr/bin/env python3
"""
DM 一人回しツール - ローカルカード検索プロキシ (Duel Masters Wiki API版)
=======================================================================
使い方:
  python dm-proxy.py

dm-solitaire.html と同じフォルダで実行してください。
停止: Ctrl+C

データソース: https://duelmasters.fandom.com (MediaWiki API)
"""

import hashlib
import html as _html
import json
import os
import queue
import random
import re
import secrets
import shutil
import sqlite3
import string
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

PORT     = int(os.environ.get("PORT", 8765))
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}")
APP_BUILD = os.environ.get("APP_BUILD", "2026-03-19-imgfix")
WIKI_API = "https://duelmasters.fandom.com/api.php"
WIKI_HEADERS = {"User-Agent": "DMSolitaireTool/1.0 (local proxy)"}

_dmwiki_cache: dict[str, list[dict]] = {}   # normalized_query → all matched cards
DMWIKI_CACHE_MAX = 500

# ─── Account management ──────────────────────────────────────────────────────────

def hash_pin(pin: str, salt: str = None) -> tuple[str, str]:
    """PIN をハッシュ化。(ハッシュ値の16進数, ソルトの16進数) を返す"""
    if salt is None:
        salt_bytes = secrets.token_bytes(16)
    else:
        salt_bytes = bytes.fromhex(salt)
    h = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt_bytes, 100000)
    return (h.hex(), salt_bytes.hex())

def verify_pin(pin: str, stored_hash: str, stored_salt: str) -> bool:
    """PIN が正しいかどうかを検証"""
    computed_hash, _ = hash_pin(pin, stored_salt)
    return computed_hash == stored_hash

# ─── Rate Limiting ────────────────────────────────────────────────────────────

_rate_limit: dict[str, dict] = {}  # ip → {count: int, reset_at: float}
_rate_limit_lock = threading.Lock()
RATE_LIMIT_WINDOW = 300  # 5 minutes
RATE_LIMIT_MAX_ATTEMPTS = 15  # attempts per window

def _sanitize_username(s: str, maxlen: int = 20) -> str:
    """Strip control characters and limit length from a username string."""
    cleaned = re.sub(r'[\x00-\x1f\x7f]', '', str(s or '')).strip()
    return cleaned[:maxlen] if maxlen else cleaned


def _safe_text(value, *, maxlen: int | None = None, strip: bool = True) -> str:
    """Safely coerce request values to text for robust API validation."""
    text = "" if value is None else str(value)
    if strip:
        text = text.strip()
    if maxlen is not None:
        text = text[:maxlen]
    return text


def check_rate_limit(ip: str) -> bool:
    """Check if IP has exceeded rate limit. Returns True if allowed, False if blocked."""
    now = time.time()
    with _rate_limit_lock:
        if ip not in _rate_limit:
            _rate_limit[ip] = {"count": 1, "reset_at": now + RATE_LIMIT_WINDOW}
            return True
        
        entry = _rate_limit[ip]
        if now >= entry["reset_at"]:
            # Window expired, reset
            entry["count"] = 1
            entry["reset_at"] = now + RATE_LIMIT_WINDOW
            return True
        
        # Still in window
        if entry["count"] >= RATE_LIMIT_MAX_ATTEMPTS:
            return False  # Blocked
        
        entry["count"] += 1
        return True

_profiles: dict[str, dict] = {}  # username → {pin_hash, pin_salt, last_deck}
_profiles_lock = threading.Lock()
_decks: dict[str, dict[str, dict]] = {}  # username → {deck_name: deck_data}
_decks_lock = threading.Lock()

# ─── Room management (online multiplayer) ──────────────────────────────────────────────────────────

_rooms: dict[str, dict] = {}
_rooms_lock = threading.Lock()
ROOM_TTL = 6 * 3600  # 6 hours


def _gen_room_id() -> str:
    """Generate a 6-character alphanumeric room code."""
    chars = string.ascii_uppercase + string.digits
    while True:
        rid = ''.join(random.choices(chars, k=6))
        with _rooms_lock:
            if rid not in _rooms:
                return rid


def _make_room(rid: str) -> dict:
    return {
        'id': rid,
        'p1': {'q': queue.Queue(), 'pub': None},
        'p2': {'q': queue.Queue(), 'pub': None},
        'p1_name': '',
        'p2_name': '',
        'created_at': time.time(),
        'lock': threading.Lock(),
    }


def _normalize_room_code(raw: str) -> str:
    """Normalize room code input and extract a 6-char token when possible."""
    text = str(raw or '')

    # fullwidth ASCII -> halfwidth
    text = ''.join(
        chr(ord(ch) - 0xFEE0) if 0xFF01 <= ord(ch) <= 0xFF5E else (' ' if ord(ch) == 0x3000 else ch)
        for ch in text
    )
    text = text.upper()

    m = re.search(r'(?:^|[^A-Z0-9])([A-Z0-9]{6})(?=$|[^A-Z0-9])', text)
    if m:
        return m.group(1)

    return re.sub(r'[^A-Z0-9]', '', text)[:6]


def _push_event(room: dict, p: str, event: str, data: dict):
    """Push an SSE event to a player's queue."""
    room[p]['q'].put_nowait({'event': event, 'data': data})


def _clean_rooms():
    """Remove rooms older than ROOM_TTL. Runs in a background thread."""
    while True:
        time.sleep(300)
        now = time.time()
        with _rooms_lock:
            to_del = [rid for rid, r in _rooms.items()
                      if now - r['created_at'] > ROOM_TTL]
            for rid in to_del:
                del _rooms[rid]
        if to_del:
            print(f"[rooms] cleaned {len(to_del)} expired room(s)", flush=True)

# ─── SQLite card detail cache ──────────────────────────────────────────────────

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_DB = os.path.join(_APP_DIR, "dm_cache.db")

def _resolve_cache_db_path() -> str:
    """Resolve SQLite DB path, preferring persistent volume paths when available."""
    explicit = os.environ.get("CACHE_DB_PATH", "").strip()
    if explicit:
        return explicit

    volume_mount = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if volume_mount:
        return os.path.join(volume_mount, "dm_cache.db")

    if os.path.isdir("/data"):
        return os.path.join("/data", "dm_cache.db")

    return _REPO_DB

CACHE_DB  = _resolve_cache_db_path()
CACHE_TTL = 90 * 86400  # 90 days
CACHE_TTL_NO_IMAGE = 10 * 60  # 10 minutes for incomplete card detail


def _bootstrap_cache_db_if_needed():
    """If using an external DB path and file is missing, seed it from repo DB once."""
    try:
        cache_dir = os.path.dirname(CACHE_DB)
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

        if CACHE_DB != _REPO_DB and not os.path.exists(CACHE_DB) and os.path.exists(_REPO_DB):
            shutil.copy2(_REPO_DB, CACHE_DB)
            print(f"[db] seeded cache DB from repo: {_REPO_DB} -> {CACHE_DB}", flush=True)
    except Exception as e:
        print(f"[db] bootstrap warning: {e}", file=sys.stderr, flush=True)


def _verify_db_integrity():
    """Verify SQLite database integrity on startup."""
    try:
        con = sqlite3.connect(CACHE_DB)
        result = con.execute("PRAGMA integrity_check").fetchone()
        con.close()
        if result and result[0] == "ok":
            print("[db] integrity check: OK", flush=True)
            return True
        else:
            print(f"[db] integrity check FAILED: {result}", file=sys.stderr, flush=True)
            return False
    except Exception as e:
        print(f"[db] integrity check error: {e}", file=sys.stderr, flush=True)
        return False


def _init_cache():
    _bootstrap_cache_db_if_needed()
    print(f"[db] using CACHE_DB: {CACHE_DB}", flush=True)
    con = sqlite3.connect(CACHE_DB)
    con.execute("""
        CREATE TABLE IF NOT EXISTS card_cache (
            id        TEXT PRIMARY KEY,
            data      TEXT NOT NULL,
            cached_at REAL NOT NULL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            pin_hash TEXT NOT NULL,
            pin_salt TEXT NOT NULL,
            last_deck TEXT
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS decks (
            username TEXT NOT NULL,
            deck_name TEXT NOT NULL,
            deck_data TEXT NOT NULL,
            PRIMARY KEY (username, deck_name)
        )
    """)
    con.commit()
    con.close()
    
    # Verify DB integrity
    _verify_db_integrity()
    
    # Load profiles and decks from DB into memory
    _load_from_db()


def _load_from_db():
    """Load profiles and decks from SQLite into memory on startup."""
    global _profiles, _decks
    try:
        con = sqlite3.connect(CACHE_DB)
        
        # Load profiles
        rows = con.execute("SELECT username, pin_hash, pin_salt, last_deck FROM profiles").fetchall()
        for username, pin_hash, pin_salt, last_deck in rows:
            _profiles[username] = {"pin_hash": pin_hash, "pin_salt": pin_salt, "last_deck": last_deck or ""}
        
        # Load decks with error recovery
        rows = con.execute("SELECT username, deck_name, deck_data FROM decks").fetchall()
        skip_count = 0
        for username, deck_name, deck_data in rows:
            try:
                if username not in _decks:
                    _decks[username] = {}
                _decks[username][deck_name] = json.loads(deck_data)
            except json.JSONDecodeError as je:
                print(f"[db] corrupt deck skipped: {username}/{deck_name} - {je}", file=sys.stderr, flush=True)
                skip_count += 1
        
        con.close()
        deck_count = sum(len(d) for d in _decks.values())
        if _profiles or _decks:
            msg = f"[db] Loaded {len(_profiles)} profiles, {deck_count} decks"
            if skip_count > 0:
                msg += f" ({skip_count} corrupt skipped)"
            print(msg, flush=True)
    except Exception as e:
        print(f"[db] load error: {e}", file=sys.stderr, flush=True)


def _save_profile_to_db(username: str, pin_hash: str, pin_salt: str, last_deck: str = ""):
    """Save or update profile in SQLite."""
    try:
        con = sqlite3.connect(CACHE_DB)
        con.execute(
            "INSERT OR REPLACE INTO profiles (username, pin_hash, pin_salt, last_deck) VALUES (?, ?, ?, ?)",
            (username, pin_hash, pin_salt, last_deck)
        )
        con.commit()
        con.close()
    except Exception as e:
        print(f"[db] save profile error: {e}", file=sys.stderr, flush=True)


def _save_deck_to_db(username: str, deck_name: str, deck_data: dict):
    """Save or update deck in SQLite."""
    try:
        con = sqlite3.connect(CACHE_DB)
        con.execute(
            "INSERT OR REPLACE INTO decks (username, deck_name, deck_data) VALUES (?, ?, ?)",
            (username, deck_name, json.dumps(deck_data, ensure_ascii=False))
        )
        con.commit()
        con.close()
    except Exception as e:
        print(f"[db] save deck error: {e}", file=sys.stderr, flush=True)


def _delete_deck_from_db(username: str, deck_name: str):
    """Delete deck from SQLite."""
    try:
        con = sqlite3.connect(CACHE_DB)
        con.execute("DELETE FROM decks WHERE username = ? AND deck_name = ?", (username, deck_name))
        con.commit()
        con.close()
    except Exception as e:
        print(f"[db] delete deck error: {e}", file=sys.stderr, flush=True)


def _cache_ttl(data: dict) -> int:
    image = str(data.get("imageUrl") or data.get("img") or data.get("thumb") or "").strip()
    return CACHE_TTL if image else CACHE_TTL_NO_IMAGE


def _cache_get(cid: str) -> dict | None:
    try:
        con = sqlite3.connect(CACHE_DB)
        row = con.execute(
            "SELECT data, cached_at FROM card_cache WHERE id = ?", (cid,)
        ).fetchone()
        con.close()
        if not row:
            return None

        data = json.loads(row[0])
        ttl = _cache_ttl(data)
        if (time.time() - row[1]) < ttl:
            return data
    except Exception as e:
        print(f"[cache] get error: {e}", file=sys.stderr, flush=True)
    return None


def _cache_set(cid: str, data: dict):
    try:
        con = sqlite3.connect(CACHE_DB)
        con.execute(
            "INSERT OR REPLACE INTO card_cache (id, data, cached_at) VALUES (?, ?, ?)",
            (cid, json.dumps(data, ensure_ascii=False), time.time())
        )
        con.commit()
        con.close()
    except Exception as e:
        print(f"[cache] set error: {e}", file=sys.stderr, flush=True)


# ─── Wiki API fetch ────────────────────────────────────────────────────────────

def wiki_get(params: dict) -> dict | None:
    params["format"] = "json"
    url = f"{WIKI_API}?{urllib.parse.urlencode(params, encoding='utf-8')}"
    req = urllib.request.Request(url, headers=WIKI_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except Exception as e:
        print(f"[wiki] {e}", file=sys.stderr, flush=True)
        return None


# ─── Card search ───────────────────────────────────────────────────────────────

_SKIP_SUFFIXES = ("/Gallery", "/Trivia", "/Lore", "/Strategy", "/Anime", "/Manga",
                  "/Card Rulings", "/Rulings", "/Sets", "/Tips", "/Support",
                  "/Deck", " Deck", " Set")

# Set-list / product pages: DMRP-01, DMBD-09, DMD-27, DMX-08, etc.
_SET_PAGE_RE = re.compile(r'^DM[A-Z]{0,3}-\d')

def _is_card_page(title: str) -> bool:
    for s in _SKIP_SUFFIXES:
        if title.endswith(s):
            return False
    if _SET_PAGE_RE.match(title):
        return False
    return True


SEARCH_LIMIT = 50   # MediaWiki allows up to 50 for anonymous users

_JP_RE = re.compile(r'[\u3040-\u30ff\u4e00-\u9fff]')  # hiragana / katakana / kanji


def _norm_fw(s: str) -> str:
    """Normalize fullwidth ASCII (U+FF01..FF5E) to halfwidth and lowercase for comparison.
    e.g. '＝' → '=',  '（' → '(',  'Ａ' → 'a', '〜' → '~'
    """
    result = []
    for ch in s:
        cp = ord(ch)
        if 0xFF01 <= cp <= 0xFF5E:      # fullwidth ASCII block
            result.append(chr(cp - 0xFEE0))
        elif cp == 0x3000:              # ideographic space → regular space
            result.append(' ')
        elif cp == 0x301C:              # wave dash 〜 → ~
            result.append('~')
        elif cp == 0x2015:              # horizontal bar ― → -
            result.append('-')
        else:
            result.append(ch)
    return ''.join(result).lower()


def _normalize_card_name_for_url(name: str) -> str:
    """Normalize a card name for dmwiki URL access (no lowercasing — preserves Japanese case).
    Converts fullwidth symbols and wave dash variants to their half-width equivalents.
    """
    result = []
    for ch in name:
        cp = ord(ch)
        if 0xFF01 <= cp <= 0xFF5E:      # fullwidth ASCII block → halfwidth
            result.append(chr(cp - 0xFEE0))
        elif cp == 0x3000:              # ideographic space → space
            result.append(' ')
        elif cp == 0x301C:              # wave dash 〜 → ~
            result.append('~')
        elif cp == 0x2015:              # horizontal bar ― → -
            result.append('-')
        else:
            result.append(ch)
    return ''.join(result)


def _dmwiki_name_candidates(name: str) -> list[str]:
    """Return a list of name variants to try when fetching a dmwiki page directly.
    Covers common encoding mismatches: fullwidth vs halfwidth symbols, wave dash variants.
    """
    seen: set[str] = set()
    out: list[str] = []
    def _add(v: str):
        if v and v not in seen:
            seen.add(v); out.append(v)
    _add(name)
    _add(_normalize_card_name_for_url(name))
    # swap wave dash (U+301C) → fullwidth tilde (U+FF5E)
    _add(name.replace('\u301c', '\uff5e'))
    # swap fullwidth tilde (U+FF5E) → wave dash (U+301C)
    _add(name.replace('\uff5e', '\u301c'))
    # also try the normalized form with wave dash instead of ~
    normed = _normalize_card_name_for_url(name)
    _add(normed.replace('~', '\u301c'))
    return out


def search_cards(query: str, page: int = 1) -> tuple[list[dict], int]:
    """Returns (cards, totalhits).

    For Japanese queries two searches are combined:
      1. Regular full-text search  – finds subtitles/冠詞 (searches rendered content)
      2. insource: raw-text search – finds infix/partial katakana names
    Results are merged and deduplicated.
    """
    offset = (page - 1) * SEARCH_LIMIT
    is_jp_query = bool(_JP_RE.search(query))

    def _wiki_search(q: str) -> tuple[list[dict], int]:
        d = wiki_get({
            "action": "query",
            "list": "search",
            "srsearch": q,
            "srnamespace": "0",
            "srlimit": str(SEARCH_LIMIT),
            "sroffset": str(offset),
            "srprop": "size",
        })
        if not d:
            return [], 0
        raw = d.get("query", {}).get("search", [])
        hits = [h for h in raw if _is_card_page(h["title"])]
        total = d.get("query", {}).get("searchinfo", {}).get("totalhits", 0)
        return hits, total

    # Japanese queries → search dmwiki.net; cache full results, return 10-per-page slices
    if is_jp_query:
        PAGE_SIZE = 10
        cache_key = _norm_fw(query).replace(" ", "")
        if cache_key not in _dmwiki_cache:
            results = search_cards_dmwiki(query)
            if results:  # only cache non-empty to avoid permanently stale entries
                if len(_dmwiki_cache) >= DMWIKI_CACHE_MAX:
                    _dmwiki_cache.clear()
                _dmwiki_cache[cache_key] = results
        all_cards = _dmwiki_cache.get(cache_key, [])
        start = (page - 1) * PAGE_SIZE
        return all_cards[start:start + PAGE_SIZE], len(all_cards)

    # English queries → English wiki
    hits, totalhits = _wiki_search(query)
    if not hits:
        return [], totalhits

    page_ids = "|".join(str(h["pageid"]) for h in hits)
    page_data = _get_page_data(page_ids)

    cards = []
    for h in hits:
        pid = str(h["pageid"])
        pdata = page_data.get(pid, {})
        jpname = pdata.get("jpname", "")
        thumb  = pdata.get("thumb", "")
        cards.append({
            "id":   pid,
            "name": jpname if jpname else h["title"],
            "thumb": thumb,
        })

    return cards, totalhits


def _get_page_data(page_ids: str, size: int = 200) -> dict[str, dict]:
    """Batch-fetch thumbnail + wikitext for multiple pages.
    Returns {pageid: {thumb: url, jpname: str, is_card: bool}}
    jpname includes the subtitle (冠詞) prepended when available.
    """
    data = wiki_get({
        "action": "query",
        "pageids": page_ids,
        "prop": "pageimages|revisions",
        "piprop": "thumbnail",
        "pithumbsize": str(size),
        "rvprop": "content",
        "rvslots": "main",
    })
    if not data:
        return {}
    result = {}
    for pid, page in data.get("query", {}).get("pages", {}).items():
        thumb = page.get("thumbnail", {}).get("source", "")
        try:
            wikitext = page["revisions"][0]["slots"]["main"]["*"]
        except (KeyError, IndexError):
            wikitext = ""
        ct = _parse_cardtable(wikitext)
        jpname = ct.get("jpname") or ct.get("janame") or ct.get("jname") or ""
        # Try to prepend subtitle (冠詞) – field name varies by wiki template version
        subtitle = (ct.get("subtitle") or ct.get("jpsub") or
                    ct.get("jpsubtitle") or ct.get("jptitle") or ct.get("name2") or "")
        if subtitle:
            jpname = f"{subtitle} {jpname}".strip()
        result[pid] = {"thumb": thumb, "jpname": jpname, "is_card": bool(ct)}
    return result


def _get_thumbnails(page_ids: str, size: int = 200) -> dict[str, str]:
    """Kept for use by get_card_detail (detail already fetches wikitext separately)."""
    data = wiki_get({
        "action": "query",
        "pageids": page_ids,
        "prop": "pageimages",
        "piprop": "thumbnail",
        "pithumbsize": str(size),
    })
    if not data:
        return {}
    return {
        pid: page.get("thumbnail", {}).get("source", "")
        for pid, page in data.get("query", {}).get("pages", {}).items()
    }


# ─── Card detail ───────────────────────────────────────────────────────────────

CIV_MAP = {
    "fire": "fire",
    "water": "water",
    "light": "light",
    "darkness": "dark",
    "nature": "nature",
    "zero": "multi",
    "colorless": "multi",
    "jokers": "multi",
    "gaia": "nature",
    "sand": "nature",
}

TYPE_MAP_KEYS = [
    ("evolution", "evolution"),
    ("creature",  "creature"),
    ("cross gear", "spell"),
    ("spell",     "spell"),
    ("twinpact",  "spell"),
    ("field",     "spell"),
    ("castle",    "spell"),
    ("f-text",    "spell"),
    ("fortress",  "spell"),
]


def _parse_civ(civ_text: str) -> str:
    t = civ_text.lower()
    if re.search(r'[/&,]|\band\b', t):
        return "multi"
    for key, val in CIV_MAP.items():
        if key in t:
            return val
    return "fire"


def _parse_type(type_text: str) -> str:
    t = type_text.lower()
    for key, val in TYPE_MAP_KEYS:
        if key in t:
            return val
    return "creature"


def _parse_int(text: str) -> int:
    m = re.search(r'[\d,]+', text)
    return int(m.group().replace(",", "")) if m else 0


def _parse_cardtable(wikitext: str) -> dict:
    """Extract key=value pairs from {{Cardtable ...}}"""
    m = re.search(r'\{\{[Cc]ardtable(.*?)(?=\n\}\}|\Z)', wikitext, re.DOTALL)
    if not m:
        return {}
    content = m.group(1)
    params: dict[str, str] = {}
    for part in re.split(r'\n[ \t]*\|', content):
        if '=' not in part:
            continue
        key, _, val = part.partition('=')
        key = key.strip().lower().replace(' ', '').replace('-', '')
        # Strip wikitext markup
        val = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]+)\]\]', r'\1', val)  # [[X|Y]] → Y
        val = re.sub(r'\{\{Ruby\|([^|{}]+)[^{}]*\}\}', r'\1', val, flags=re.IGNORECASE)  # {{Ruby|漢字|ふりがな}} → 漢字
        # Expand common DM keyword templates
        val = re.sub(r'\{\{Double Breaker(?:\|[^{}]*)?\}\}', 'W・ブレイカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Triple Breaker(?:\|[^{}]*)?\}\}', 'T・ブレイカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Quattro Breaker(?:\|[^{}]*)?\}\}', 'Q・ブレイカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Quintuple Breaker(?:\|[^{}]*)?\}\}', '5・ブレイカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Shield Trigger(?:\|[^{}]*)?\}\}', 'S・トリガー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Speed Attacker(?:\|[^{}]*)?\}\}', 'スピード・アタッカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{Blocker(?:\|[^{}]*)?\}\}', 'ブロッカー', val, flags=re.IGNORECASE)
        val = re.sub(r'\{\{[^{}]*\}\}', '', val)   # remove remaining {{...}}
        val = re.sub(r"<[^>]+>", '', val)            # remove HTML tags
        val = re.sub(r"'''?", '', val)               # remove bold/italic
        val = val.strip()
        if key and val:
            params[key] = val
    return params


def get_card_detail(wiki_page_id: str) -> dict | None:
    data = wiki_get({
        "action": "query",
        "pageids": wiki_page_id,
        "prop": "revisions|pageimages",
        "rvprop": "content",
        "rvslots": "main",
        "piprop": "thumbnail",
        "pithumbsize": "400",
    })
    if not data:
        return None

    page = data.get("query", {}).get("pages", {}).get(str(wiki_page_id))
    if not page or "missing" in page:
        return None

    title     = page.get("title", "")
    thumb_url = page.get("thumbnail", {}).get("source", "")

    try:
        wikitext = page["revisions"][0]["slots"]["main"]["*"]
    except (KeyError, IndexError):
        wikitext = ""

    ct = _parse_cardtable(wikitext)

    jp_name = ct.get("jpname") or ct.get("janame") or ct.get("jname") or ""
    subtitle = (ct.get("subtitle") or ct.get("jpsub") or
                ct.get("jpsubtitle") or ct.get("jptitle") or ct.get("name2") or "")
    if subtitle:
        jp_name = f"{subtitle} {jp_name}".strip()
    name = jp_name if jp_name else title

    civ  = _parse_civ(ct.get("civilization", ct.get("civ", "fire")))
    cost = _parse_int(ct.get("cost", "1"))
    pwr  = _parse_int(ct.get("power", "0"))
    card_type = _parse_type(ct.get("type", ct.get("cardtype", "creature")))

    # Effect text: prefer Japanese, fall back to English
    text = ct.get("jptext") or ct.get("engtext") or ""
    text = re.sub(r'\n{2,}', '\n', text).strip()

    return {
        "id":     wiki_page_id,
        "name":   name,
        "nameEn": title,
        "civ":    civ,
        "cost":   max(1, cost),
        "type":   card_type,
        "power":  pwr,
        "img":    thumb_url,
        "race":   ct.get("race", ""),
        "text":   text,
    }


# ─── dmwiki.net scraper (Japanese DM wiki, PukiWiki) ──────────────────────────

DMWIKI_BASE = "https://dmwiki.net"

# Civilization name → internal key
_CIV_MAP_JA = {
    "光":         "light",
    "水":         "water",
    "闇":         "dark",
    "火":         "fire",
    "自然":       "nature",
    "ゼロ":       "multi",
    "ジョーカーズ": "multi",
    "無色":       "multi",
}

# Card type name → internal key
_TYPE_MAP_JA = {
    "進化クリーチャー": "evolution",
    "クリーチャー":    "creature",
    "呪文":           "spell",
    "クロスギア":      "spell",
    "フィールド":      "spell",
    "城":             "spell",
    "ツインパクト":    "spell",
    "D2フィールド":    "spell",
}


def _dmwiki_fetch(path: str, post_data: bytes = None) -> str:
    """Fetch a page from dmwiki.net and return decoded HTML."""
    url = DMWIKI_BASE + path
    headers = {**WIKI_HEADERS, "Accept-Language": "ja,en;q=0.5"}
    if post_data:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=post_data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            for enc in ("utf-8", "euc-jp", "shift_jis"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    pass
            return raw.decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[dmwiki] {e}", file=sys.stderr, flush=True)
        return ""


def _strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()


def _ja_insert_spaces(q: str) -> str:
    """Insert spaces at kanji↔katakana transitions.
    'レッドゾーン' stays as-is; '霊淵ゴツンマ' → '霊淵 ゴツンマ' (matches wiki spacing).
    """
    result = []
    for i, ch in enumerate(q):
        if i > 0:
            prev = q[i - 1]
            p_kanji  = 0x4E00 <= ord(prev) <= 0x9FFF
            c_kanji  = 0x4E00 <= ord(ch)   <= 0x9FFF
            p_kana   = 0x30A0 <= ord(prev) <= 0x30FF
            c_kana   = 0x30A0 <= ord(ch)   <= 0x30FF
            if (p_kanji and c_kana) or (p_kana and c_kanji):
                result.append(' ')
        result.append(ch)
    return ''.join(result)


def search_cards_dmwiki(query: str) -> list[dict]:
    """Search dmwiki.net page titles for cards matching query (partial ok)."""
    nq = _norm_fw(query)
    # Normalize query for wiki search: insert spaces at kanji/kana boundary
    search_query = _ja_insert_spaces(query)

    def _parse_result_html(html: str) -> list[dict]:
        cards = []
        seen: set[str] = set()
        # Search results link as: ?cmd=read&amp;page=ENCODED_PAGE_NAME&amp;word=...
        # In raw HTML &amp; appears as literal &amp; so ';page=' precedes the value
        for m in re.finditer(r'(?:[?&;])page=([^&"\'<>;]+)', html):
            try:
                page_name = urllib.parse.unquote(m.group(1), encoding="utf-8")
            except Exception:
                continue
            if not (page_name.startswith("《") and page_name.endswith("》")):
                continue
            clean = page_name[1:-1]  # strip 《》
            if not clean or clean in seen:
                continue
            ntitle = _norm_fw(clean)
            # Match with or without spaces (wiki uses "霊淵 ゴツンマ", user may type "霊淵ゴツンマ")
            if nq not in ntitle and nq.replace(" ", "") not in ntitle.replace(" ", ""):
                continue
            seen.add(clean)
            card_id = f"dmwiki_{clean}"
            thumb = ""
            cached = _cache_get(card_id)
            if cached:
                thumb = str(cached.get("img") or cached.get("thumb") or "").strip()
            cards.append({"id": card_id, "name": clean, "thumb": thumb})
        return cards

    # First try: page-title-only search (fast, precise)
    form = urllib.parse.urlencode(
        {"word": search_query, "type": "AND", "scope": "page"}, encoding="utf-8"
    ).encode()
    html = _dmwiki_fetch("/?cmd=search", post_data=form)
    if not html:
        return []

    cards = _parse_result_html(html)

    # Second try: full-content search when title search returns nothing
    # (handles cases where PukiWiki title tokenization misses partial matches)
    if not cards:
        form2 = urllib.parse.urlencode(
            {"word": search_query, "type": "AND"}, encoding="utf-8"
        ).encode()
        html2 = _dmwiki_fetch("/?cmd=search", post_data=form2)
        if html2:
            cards = _parse_result_html(html2)

    # For exact-match queries, proactively resolve one thumbnail so search list doesn't stay NO IMG.
    norm_query = nq.replace(" ", "")
    for c in cards:
        if c.get("thumb"):
            continue
        if _norm_fw(c.get("name", "")).replace(" ", "") != norm_query:
            continue
        detail = get_card_detail_dmwiki(c.get("name", ""))
        if not detail:
            continue
        thumb = str(detail.get("img") or detail.get("thumb") or "").strip()
        if thumb:
            c["thumb"] = thumb
        _cache_set(c["id"], detail)
        break

    return cards


OFFICIAL_BASE    = "https://dm.takaratomy.co.jp"
OFFICIAL_SEARCH  = OFFICIAL_BASE + "/card/"
OFFICIAL_HEADERS = {
    **WIKI_HEADERS,
    "X-Requested-With": "XMLHttpRequest",
    "Referer": OFFICIAL_SEARCH,
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept-Language": "ja,en;q=0.5",
}
OFFICIAL_DETAIL_HEADERS = {
    "User-Agent": WIKI_HEADERS["User-Agent"],
    "Referer": OFFICIAL_SEARCH,
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ja,en;q=0.5",
}


def _img_from_en_wiki(card_name: str) -> str:
    """Search English Fandom wiki for the JP name in wikitext and return thumbnail.
    Only returns a thumbnail if the matched page actually has a Cardtable (is a card page).
    """
    safe_name = card_name.replace('"', '')
    d = wiki_get({
        "action": "query",
        "list": "search",
        "srsearch": f'insource:"{safe_name}"',
        "srnamespace": "0",
        "srlimit": "5",
        "srprop": "size",
    })
    if not d:
        return ""
    hits = [h for h in d.get("query", {}).get("search", []) if _is_card_page(h["title"])]
    if not hits:
        return ""
    page_ids = "|".join(str(h["pageid"]) for h in hits)
    page_data = _get_page_data(page_ids, size=400)
    # Only return a thumbnail if the page's own jpname matches the queried card name.
    # This prevents pages that merely *mention* the card name from being used.
    nq = _norm_fw(card_name).replace(" ", "")
    for h in hits:
        pid = str(h["pageid"])
        pdata = page_data.get(pid, {})
        thumb = pdata.get("thumb", "")
        if not (pdata.get("is_card") and thumb and not _is_pack_img_url(thumb)):
            continue
        jpname_norm = _norm_fw(pdata.get("jpname", "")).replace(" ", "")
        # Exact match
        if jpname_norm == nq:
            return thumb
        # Subtitle mismatch handling (e.g. query="ヴァルハラ・グランデ",
        # page has "暗黒の騎士ヴァルハラ・グランデ" or vice-versa).
        # Use endswith so the core name must be a suffix of the full name.
        # Minimum 8 chars to avoid short-name false positives.
        if len(nq) >= 8 and jpname_norm.endswith(nq):
            return thumb
        if len(jpname_norm) >= 8 and nq.endswith(jpname_norm):
            return thumb
        # Twin Pact: nq is the full twin-pact name (has "/"), page stores one half
        if "/" in nq and len(jpname_norm) >= 4:
            if nq.startswith(jpname_norm + "/") or nq.endswith("/" + jpname_norm):
                return thumb
        # Twin Pact: nq is one half, page stores the full twin-pact name
        if "/" in jpname_norm and len(nq) >= 4:
            if jpname_norm.startswith(nq + "/") or jpname_norm.endswith("/" + nq):
                return thumb
    return ""


def _official_keyword(card_name: str) -> str:
    """Return the card name as-is for the official site search.
    Using the full name avoids false positives between cards that share
    the same katakana title but have different kanji prefixes.
    """
    return card_name


def _name_variants(card_name: str) -> list[str]:
    """Generate conservative name variants to tolerate minor spacing/alias differences."""
    base = str(card_name or "").strip()
    if not base:
        return []

    variants: list[str] = []
    seen: set[str] = set()

    def _add(v: str):
        t = str(v or "").strip()
        if not t or t in seen:
            return
        seen.add(t)
        variants.append(t)

    _add(base)
    squashed = re.sub(r'[\s　]+', '', base)
    _add(squashed)
    if squashed:
        _add(_ja_insert_spaces(squashed))

    tail = re.split(r'[\s　]+', base)[-1].strip()
    if len(tail) >= 4:
        _add(tail)

    # Twin pact (e.g. "カードA/カードB"): add each half as a separate variant
    if '/' in base:
        for part in base.split('/'):
            part = part.strip()
            if len(part) >= 2:
                _add(part)

    return variants[:6]


def _official_proxy_image_url(raw_url: str) -> str:
    url = str(raw_url or "").strip()
    if not url:
        return ""
    if not (url.startswith("http://") or url.startswith("https://")):
        url = OFFICIAL_BASE + url
    return f"{BASE_URL}/img?url={urllib.parse.quote(url, safe='')}"


def _official_search_pairs(html: str) -> list[tuple[str, str]]:
    pairs = re.findall(
        r"href=['\"](?:/card/detail/\?id=([^'\"]+))['\"]"
        r".*?src=['\"](/wp-content/card/cardthumb/[^'\"]+)['\"]",
        html,
        re.DOTALL,
    )
    if not pairs:
        return []

    uniq: list[tuple[str, str]] = []
    seen: set[str] = set()
    for card_id, thumb_path in pairs:
        cid = str(card_id or "").strip()
        thumb = str(thumb_path or "").strip()
        if not cid or not thumb:
            continue
        key = f"{cid}::{thumb}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append((cid, thumb))
    return uniq


def _official_fetch_detail_title(card_id: str) -> str:
    safe_id = urllib.parse.quote(str(card_id or "").strip(), safe="")
    if not safe_id:
        return ""

    detail_url = f"{OFFICIAL_BASE}/card/detail/?id={safe_id}"
    req = urllib.request.Request(detail_url, headers=OFFICIAL_DETAIL_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            chunk = r.read(4096).decode("utf-8", errors="replace")
    except Exception:
        return ""

    m = re.search(r'<title>([^<(|]+)', chunk)
    return m.group(1).strip() if m else ""


def _official_url_exists(url: str, timeout: int = 8) -> bool:
    req = urllib.request.Request(url, headers={**WIKI_HEADERS, "Accept": "image/*"}, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code = int(getattr(r, "status", 200) or 200)
            return 200 <= code < 400
    except Exception:
        pass

    # Some hosts reject HEAD; retry with normal GET and read only a tiny chunk.
    req2 = urllib.request.Request(url, headers={**WIKI_HEADERS, "Accept": "image/*"})
    try:
        with urllib.request.urlopen(req2, timeout=timeout) as r:
            r.read(16)
            return True
    except Exception:
        return False


def _official_image_proxy_from_card_id(card_id: str) -> str:
    cid = str(card_id or "").strip()
    if not cid:
        return ""

    encoded = urllib.parse.quote(cid, safe="")
    candidates = [
        f"{OFFICIAL_BASE}/wp-content/card/cardthumb/{encoded}.jpg",
        f"{OFFICIAL_BASE}/wp-content/card/cardthumb/{encoded}.png",
        f"{OFFICIAL_BASE}/wp-content/card/cardimage/{encoded}.jpg",
        f"{OFFICIAL_BASE}/wp-content/card/cardimage/{encoded}.png",
    ]

    for full_url in candidates:
        if _official_url_exists(full_url):
            return _official_proxy_image_url(full_url)
    return ""


def _dmwiki_page_html(card_name: str) -> str:
    for candidate in _dmwiki_name_candidates(card_name):
        encoded = urllib.parse.quote(f"《{candidate}》", encoding="utf-8")
        html = _dmwiki_fetch(f"/{encoded}")
        if html:
            return html
    return ""


def _official_ids_from_set_and_print(set_code: str, print_code: str) -> list[str]:
    sc = re.sub(r"[^A-Z0-9-]", "", str(set_code or "").upper())
    pc = re.sub(r"[^A-Z0-9]", "", str(print_code or "").upper())
    if not sc or not pc:
        return []

    prefix = sc.replace("-", "").lower()
    out: list[str] = []
    seen: set[str] = set()

    def _add(v: str):
        s = str(v or "").strip()
        if not s or s in seen:
            return
        seen.add(s)
        out.append(s)

    _add(f"{prefix}-{pc}")

    if pc.startswith("P") and pc[1:].isdigit():
        _add(f"{prefix}-{int(pc[1:]):03d}")
    elif pc.isdigit():
        _add(f"{prefix}-{int(pc):03d}")

    m_digit_suffix = re.fullmatch(r"(\d+)([A-Z])", pc)
    if m_digit_suffix:
        number = int(m_digit_suffix.group(1))
        suffix = m_digit_suffix.group(2)
        _add(f"{prefix}-{number}{suffix}")
        _add(f"{prefix}-{number:02d}{suffix}")
        _add(f"{prefix}-{number:03d}{suffix}")

    m_head_digits = re.fullmatch(r"([A-Z]+)(\d+)", pc)
    if m_head_digits:
        head = m_head_digits.group(1)
        number = int(m_head_digits.group(2))
        _add(f"{prefix}-{head}{number}")
        _add(f"{prefix}-{head}{number:02d}")
        _add(f"{prefix}-{head}{number:03d}")

    return out


def _official_art_variants_from_dmwiki(card_name: str, limit: int = 12) -> list[dict]:
    html = _dmwiki_page_html(card_name)
    if not html:
        return []

    set_print_pairs: list[tuple[str, str]] = []
    seen_pairs: set[str] = set()

    # Pair set-code links with nearby print notations: (KM1/KM2), (1S/2), (1B/10), etc.
    for m in re.finditer(r'href="/(DM[A-Z0-9\-]+)"', html, re.IGNORECASE):
        set_code = m.group(1).upper()
        context = html[m.end(): m.end() + 420]
        for p in re.finditer(r'[（(]\s*([A-Z0-9]{1,6})\s*/\s*[A-Z0-9]{1,6}\s*[）)]', context):
            print_code = p.group(1).upper()
            if not re.search(r'\d', print_code):
                continue
            key = f"{set_code}|{print_code}"
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            set_print_pairs.append((set_code, print_code))

    # Promo notation may appear only in plain text: DMPROMOY21 P34/Y21, etc.
    plain = _html.unescape(re.sub(r'<[^>]+>', ' ', html))
    for m in re.finditer(r'\b(DM[A-Z0-9\-]{4,})\s+([A-Z]?\d{1,3}[A-Z]?)\s*/\s*[A-Z0-9]{1,6}\b', plain, re.IGNORECASE):
        set_code = m.group(1).upper()
        print_code = m.group(2).upper()
        if not re.search(r'\d', print_code):
            continue
        key = f"{set_code}|{print_code}"
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        set_print_pairs.append((set_code, print_code))

    variants: list[dict] = []
    seen_ids: set[str] = set()
    seen_images: set[str] = set()
    max_items = max(1, int(limit or 1))

    for set_code, print_code in set_print_pairs:
        if len(variants) >= max_items:
            break

        for card_id in _official_ids_from_set_and_print(set_code, print_code):
            if len(variants) >= max_items:
                break
            if card_id in seen_ids:
                continue

            image_url = _official_image_proxy_from_card_id(card_id)
            if not image_url or image_url in seen_images:
                continue

            page_title = _official_fetch_detail_title(card_id)
            if page_title and not _official_name_matches(card_name, page_title):
                # If title exists and clearly points to another card, skip.
                continue

            seen_ids.add(card_id)
            seen_images.add(image_url)
            variants.append({
                "artId": f"official:{card_id}",
                "sourceId": card_id,
                "name": page_title or card_name,
                "label": f"{set_code} {print_code}",
                "imageUrl": image_url,
                "thumb": image_url,
                "source": "dmwiki-print",
            })

    return variants


def _official_name_matches(query_name: str, page_title: str) -> bool:
    page_norm = _norm_fw(page_title).replace(" ", "")
    if not page_norm:
        return False

    for candidate in _name_variants(query_name):
        qn = _norm_fw(candidate).replace(" ", "")
        if not qn:
            continue

        if page_norm == qn:
            return True
        if page_norm.startswith(qn + "/"):
            return True
        if qn.startswith(page_norm + "/"):
            return True

        if len(qn) >= 8 and page_norm.endswith(qn):
            return True
        if len(page_norm) >= 8 and qn.endswith(page_norm):
            return True

        if "/" in qn and len(page_norm) >= 4:
            if qn.startswith(page_norm + "/") or qn.endswith("/" + page_norm):
                return True
        if "/" in page_norm and len(qn) >= 4:
            if page_norm.startswith(qn + "/") or page_norm.endswith("/" + qn):
                return True

    return False


def _official_art_variants(card_name: str, limit: int = 20) -> list[dict]:
    keyword = _official_keyword(card_name)
    if not keyword:
        return []

    form = urllib.parse.urlencode(
        {"keyword": keyword, "keyword_type[]": "card_name", "pagenum": "1"},
        encoding="utf-8",
    ).encode()
    req = urllib.request.Request(OFFICIAL_SEARCH, data=form, headers=OFFICIAL_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[official] fetch error: {e}", file=sys.stderr, flush=True)
        return []

    pairs = _official_search_pairs(html)
    if not pairs:
        return []

    variants: list[dict] = []
    seen_ids: set[str] = set()
    seen_images: set[str] = set()
    max_items = max(1, int(limit or 1))

    for card_id, thumb_path in pairs:
        if len(variants) >= max_items:
            break
        if card_id in seen_ids:
            continue

        page_title = _official_fetch_detail_title(card_id)
        if not page_title:
            continue
        if not _official_name_matches(card_name, page_title):
            continue

        image_url = _official_proxy_image_url(thumb_path)
        if not image_url or image_url in seen_images:
            continue

        seen_ids.add(card_id)
        seen_images.add(image_url)
        variants.append({
            "artId": f"official:{card_id}",
            "sourceId": card_id,
            "name": page_title,
            "label": f"ID:{card_id}",
            "imageUrl": image_url,
            "thumb": image_url,
            "source": "official",
        })

    # dmwiki print codes often include additional alt-art identifiers that
    # official keyword search does not return from non-JP environments.
    if len(variants) < max_items:
        extra = _official_art_variants_from_dmwiki(card_name, limit=max_items)
        for item in extra:
            if len(variants) >= max_items:
                break
            cid = str(item.get("sourceId") or "").strip()
            img = str(item.get("imageUrl") or item.get("thumb") or "").strip()
            if not cid or cid in seen_ids:
                continue
            if not img or img in seen_images:
                continue
            seen_ids.add(cid)
            seen_images.add(img)
            variants.append(item)

    return variants


def _img_from_official(card_name: str) -> str:
    """Get card image URL from the official Takara Tomy DM card database.
    Searches by card name, then verifies each result by fetching the detail
    page title (only first 2 KB) to confirm name match.
    """
    variants = _official_art_variants(card_name, limit=1)
    if not variants:
        return ""
    first = variants[0]
    return str(first.get("imageUrl") or first.get("thumb") or "").strip()


# Set/pack image filenames look like DM24-RP1.jpg, DMRP01.jpg, DMBD09.jpg, DMX-08.jpg
_PACK_FNAME_RE = re.compile(r'^DM[A-Z0-9_-]*\d', re.IGNORECASE)

def _is_pack_filename(ref_url: str) -> bool:
    """Return True if the ref plugin URL's src= parameter looks like a set/pack image."""
    m = re.search(r'[&?]src=([^&"]+)', ref_url, re.IGNORECASE)
    if not m:
        return False
    fname = urllib.parse.unquote(m.group(1)).rsplit('/', 1)[-1]
    return bool(_PACK_FNAME_RE.match(fname))


def _is_pack_img_url(url: str) -> bool:
    """Return True if a full image URL's filename looks like a set/pack image."""
    path = urllib.parse.urlparse(url).path
    fname = path.rsplit('/', 1)[-1]
    return bool(_PACK_FNAME_RE.match(fname))


def _img_from_dmwiki_setcode(html: str) -> str:
    """Extract card image URL from official site using set code + card number found in dmwiki HTML.

    dmwiki pages list the card's set code and number like:
      <a href="/DM24-BD2">DM24-BD2 ...</a>（5/16）
    This lets us construct the official thumbnail URL directly without a POST search,
    which is unreliable from non-Japanese IP addresses (Railway, etc.).
    """
    # Find all occurrences of set code links followed by (N/M) card number
    # e.g. href="/DM24-BD2" ... （5/16）
    for m in re.finditer(r'href="/(DM[A-Z0-9\-]+)"', html, re.IGNORECASE):
        raw_set = m.group(1)   # e.g. "DM24-BD2"
        # Look for （N/M） within the next 300 chars (allows for tag content between </a> and the number)
        context = html[m.start(): m.start() + 300]
        num_m = re.search(r'[（(](\d+)/\d+[）)]', context)
        if not num_m:
            continue
        card_num = int(num_m.group(1))  # e.g. 5

        # Construct filename: "DM24-BD2" + num 5 → "dm24bd2-005"
        set_part = re.sub(r'-', '', raw_set).lower()   # "dm24bd2"
        fname    = f"{set_part}-{card_num:03d}.jpg"

        thumb_path = f"/wp-content/card/cardthumb/{fname}"
        full_url   = OFFICIAL_BASE + thumb_path
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    return ""


def _img_from_dmwiki_html(html: str) -> str:
    """Extract a card scan (non-pack) image from an already-fetched dmwiki page.

    Pack/set images have filenames like DM24-RP1.jpg; card scans have other names.
    Returns "" if only pack images are found so the caller can try other sources.
    """
    # Linked images: href="?plugin=ref..." (most common)
    for m in re.finditer(
        r'href="(\?plugin=ref[^"]*\.(?:jpg|jpeg|png)[^"]*)"',
        html, re.IGNORECASE
    ):
        url = m.group(1)
        if _is_pack_filename(url):
            continue  # skip pack/set images
        rel = re.sub(r'&thumbnail(?:=[^&"]*)?', '', url)
        full_url = f"{DMWIKI_BASE}/{rel}"
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    # nolink images: <img src="?plugin=ref..."> without anchor wrapper
    for m in re.finditer(
        r'<img[^>]+src="(\?plugin=ref[^"]*\.(?:jpg|jpeg|png)[^"]*)"',
        html, re.IGNORECASE
    ):
        url = m.group(1)
        if _is_pack_filename(url):
            continue
        rel = re.sub(r'&thumbnail(?:=[^&"]*)?', '', url)
        full_url = f"{DMWIKI_BASE}/{rel}"
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    return ""


def _img_from_dmwiki_attach(page_name: str) -> str:
    """Fetch dmwiki's attachment list for 《page_name》 and return the first
    non-pack image URL found there.  This catches card scans that are uploaded
    to the page but not directly linked in the rendered HTML."""
    html = None
    for candidate in _dmwiki_name_candidates(page_name):
        encoded = urllib.parse.quote(f"《{candidate}》", encoding="utf-8")
        html = _dmwiki_fetch(f"/?cmd=attach&refer={encoded}&pcmd=list")
        if html:
            break
    if not html:
        return ""
    # Pattern 1: ?plugin=ref links (same page may embed ref links)
    for m in re.finditer(
        r'href="(\?plugin=ref[^"]*\.(?:jpg|jpeg|png)[^"]*)"',
        html, re.IGNORECASE
    ):
        url = m.group(1)
        if _is_pack_filename(url):
            continue
        rel = re.sub(r'&thumbnail(?:=[^&\"]*)?', '', url)
        full_url = f"{DMWIKI_BASE}/{rel}"
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    # Pattern 2: PukiWiki attach list links (?cmd=attach&...&file=xxx.jpg&pcmd=open)
    for m in re.finditer(
        r'href="(\?cmd=attach[^"]*&file=[^"&]*\.(?:jpg|jpeg|png)[^"]*)"',
        html, re.IGNORECASE
    ):
        url = m.group(1)
        file_m = re.search(r'[?&]file=([^&\"]+)', url, re.IGNORECASE)
        if file_m:
            fn = urllib.parse.unquote(file_m.group(1)).rsplit('/', 1)[-1]
            if _PACK_FNAME_RE.match(fn):
                continue
        full_url = f"{DMWIKI_BASE}/{url}"
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    return ""


def get_card_detail_dmwiki(name: str) -> dict | None:
    """Fetch card detail from dmwiki.net by card name (without 《》 brackets).
    Tries multiple name variants to handle fullwidth/halfwidth and wave-dash encoding mismatches.
    """
    html = None
    for candidate in _dmwiki_name_candidates(name):
        encoded = urllib.parse.quote(f"《{candidate}》", encoding="utf-8")
        html = _dmwiki_fetch(f"/{encoded}")
        if html:
            break
    if not html:
        return None

    # Extract text from all style_td cells (card data table)
    rows = []
    for m in re.finditer(r'<td[^>]*class="style_td"[^>]*>(.*?)</td>', html, re.DOTALL):
        text = _strip_tags(m.group(1)).strip()
        if text:
            rows.append(text)

    # No card table found — page doesn't exist or isn't a card page
    if not rows:
        return None

    # Row 0: "カード名　レアリティ　X文明　(コスト)"
    # Tabs and ideographic spaces separate fields; cost is in parentheses
    row0 = rows[0]
    m0 = re.match(
        r'^(.+?)[\s\t　]+[A-Z]{1,5}[+＋]?[\s\t　]+(.+?)[\s\t　]+[（(](\d+)[）)]',
        row0
    )
    if m0:
        card_name = m0.group(1).strip()
        civ_raw   = m0.group(2).strip()
        cost      = int(m0.group(3))
    else:
        # Fallback: try without rarity
        m0b = re.match(r'^(.+?)[\s\t　]+(.+?文明.*)[\s\t　]+[（(](\d+)[）)]', row0)
        card_name = m0b.group(1).strip() if m0b else name
        civ_raw   = m0b.group(2).strip() if m0b else ""
        cost      = int(m0b.group(3)) if m0b else 1

    # Civilization: count distinct civs
    civ_hits = [en for ja, en in _CIV_MAP_JA.items() if ja in civ_raw]
    if len(civ_hits) > 1:
        civ = "multi"
    elif civ_hits:
        civ = civ_hits[0]
    else:
        civ = "fire"

    # Row 1: "クリーチャー：種族名　パワー"  or  "呪文"
    card_type = "creature"
    race      = ""
    power     = 0
    if len(rows) > 1:
        m1 = re.match(r'^(.+?)：(.+?)[\s\t　]+(\d[\d,]*)', rows[1])
        if m1:
            type_text = m1.group(1)
            race      = m1.group(2).strip()
            power     = int(m1.group(3).replace(",", ""))
            for ja, en in _TYPE_MAP_JA.items():
                if ja in type_text:
                    card_type = en
                    break
        else:
            for ja, en in _TYPE_MAP_JA.items():
                if ja in rows[1]:
                    card_type = en
                    break

    # Remaining rows: effect text (skip set codes; stop at wiki strategy sections)
    effect_rows = []
    for r in rows[2:]:
        if re.match(r'^DM\d', r):
            continue
        if re.match(r'^《', r):
            break  # wiki strategy section starts here (card name ref at row start)
        effect_rows.append(r)
    effect = "\n".join(effect_rows).strip()

    # Get card image: dmwiki HTML → dmwiki set-code → dmwiki attach list → official (name variants) → English wiki (name variants)
    img_url = _img_from_dmwiki_html(html) or _img_from_dmwiki_setcode(html) or _img_from_dmwiki_attach(name)
    candidates = _name_variants(card_name)
    if card_name != name:
        for variant in _name_variants(name):
            if variant not in candidates:
                candidates.append(variant)

    if not img_url:
        for candidate in candidates:
            img_url = _img_from_official(candidate)
            if img_url:
                break

    if not img_url:
        for candidate in candidates:
            img_url = _img_from_en_wiki(candidate)
            if img_url:
                break

    return {
        "id":     f"dmwiki_{name}",
        "name":   card_name,
        "nameEn": name,
        "civ":    civ,
        "cost":   max(1, cost),
        "type":   card_type,
        "power":  power,
        "img":    img_url,
        "race":   race,
        "text":   effect,
    }


# ─── Image proxy ──────────────────────────────────────────────────────────────

IMG_FETCH_TIMEOUT = 15
IMG_FETCH_RETRIES = 2


def fetch_binary(url: str):
    last_error = None
    for attempt in range(IMG_FETCH_RETRIES + 1):
        req = urllib.request.Request(url, headers={**WIKI_HEADERS, "Accept": "image/*"})
        try:
            with urllib.request.urlopen(req, timeout=IMG_FETCH_TIMEOUT) as r:
                return r.read(), r.headers.get("Content-Type", "image/jpeg"), 200
        except urllib.error.HTTPError as e:
            last_error = e
            code = int(getattr(e, "code", 0) or 0)
            print(f"[img] HTTP {code}: {url} (attempt {attempt + 1})", file=sys.stderr, flush=True)
            if code == 404:
                return None, None, 404
        except Exception as e:
            last_error = e
            print(f"[img] {e} (attempt {attempt + 1})", file=sys.stderr, flush=True)

        if attempt < IMG_FETCH_RETRIES:
            time.sleep(0.25 * (attempt + 1))

    if isinstance(last_error, urllib.error.HTTPError):
        code = int(getattr(last_error, "code", 0) or 0)
        if 400 <= code <= 599:
            return None, None, code
    return None, None, 504


def _extract_card_image(data: dict | None) -> str:
    if not isinstance(data, dict):
        return ""
    return str(data.get("imageUrl") or data.get("img") or data.get("thumb") or "").strip()


# ─── HTTP Handler ──────────────────────────────────────────────────────────────

class DMServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True         # threads die with the server


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}", flush=True)

    def _client_ip(self) -> str:
        """クライアントIPを取得。X-Real-IP > X-Forwarded-For先頭 > 直接接続の優先順。
        X-Forwarded-For は偽装可能なため、信頼できるプロキシが付与する
        X-Real-IP を優先する。"""
        real_ip = self.headers.get("X-Real-IP", "").strip()
        if real_ip:
            return real_ip
        forwarded = self.headers.get("X-Forwarded-For", "").strip()
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    # ── POST handler ──────────────────────────────────────────────────────────

    def do_POST(self):
        try:
            self._do_post_impl()
        except Exception as e:
            print(f"[server-error] POST {self.path}: {e}", file=sys.stderr, flush=True)
            try:
                self._json({"error": "internal server error"}, 500)
            except Exception:
                pass

    def _do_post_impl(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return self._json({"error": "invalid JSON"}, 400)

        # POST /room/create  { name }
        if parsed.path == "/room/create":
            rid  = _gen_room_id()
            room = _make_room(rid)
            room['p1_name'] = _sanitize_username(data.get("name", ""), maxlen=20) or "Player 1"
            with _rooms_lock:
                _rooms[rid] = room
            print(f"[rooms] created {rid} by {room['p1_name']}", flush=True)
            self._json({"room": rid, "p": "p1"})

        # POST /room/join  { room, name }
        elif parsed.path == "/room/join":
            rid = _normalize_room_code(data.get("room", ""))
            if len(rid) != 6:
                return self._json({"error": "room code must be 6 chars"}, 400)
            with _rooms_lock:
                room = _rooms.get(rid)
            if not room:
                return self._json({"error": "room not found"}, 404)
            with room['lock']:
                if room['p2_name']:
                    return self._json({"error": "room is full"}, 409)
                room['p2_name'] = _sanitize_username(data.get("name", ""), maxlen=20) or "Player 2"
                _push_event(room, 'p1', 'joined', {'p2_name': room['p2_name']})
            print(f"[rooms] {room['p2_name']} joined {rid}", flush=True)
            self._json({"ok": True, "p": "p2", "p1_name": room['p1_name']})

        # POST /action  { room, p, type, ...state }
        elif parsed.path == "/action":
            rid   = _normalize_room_code(data.get("room", ""))
            p     = _safe_text(data.get("p", ""))
            atype = _safe_text(data.get("type", "state"), maxlen=40) or "state"
            with _rooms_lock:
                room = _rooms.get(rid)
            if not room:
                return self._json({"error": "room not found"}, 404)
            if p not in ("p1", "p2"):
                return self._json({"error": "invalid p"}, 400)
            op = "p2" if p == "p1" else "p1"
            _TRANSIENT = {"hand_reveal_request", "hand_data", "discard_select", "discard_random"}
            # Allowlist: only relay known fields to prevent arbitrary data passthrough
            _ALLOWED_STATE_FIELDS = {"room", "p", "type", "seq", "turn", "active", "p1", "p2"}
            _ALLOWED_TRANSIENT_FIELDS = {"room", "p", "type", "seq", "cardName", "random", "cards"}
            allowed = _ALLOWED_TRANSIENT_FIELDS if atype in _TRANSIENT else _ALLOWED_STATE_FIELDS
            clean_data = {k: v for k, v in data.items() if k in allowed}
            with room['lock']:
                if atype not in _TRANSIENT:
                    room[p]['pub'] = clean_data
                if atype == "turn_end":
                    _push_event(room, op, "turn_end", clean_data)
                elif atype in _TRANSIENT:
                    _push_event(room, op, atype, clean_data)
                else:
                    _push_event(room, op, "opponent_state", clean_data)
            self._json({"ok": True})

        # POST /chat  { room, p, message }
        elif parsed.path == "/chat":
            rid = _normalize_room_code(data.get("room", ""))
            p = _safe_text(data.get("p", ""))
            msg = _safe_text(data.get("message", ""), maxlen=200)
            with _rooms_lock:
                room = _rooms.get(rid)
            if not room:
                return self._json({"error": "room not found"}, 404)
            if p not in ("p1", "p2"):
                return self._json({"error": "invalid p"}, 400)
            if not msg:
                return self._json({"error": "message empty"}, 400)
            player_name = room['p1_name'] if p == 'p1' else room['p2_name']
            op = "p2" if p == "p1" else "p1"
            with room['lock']:
                _push_event(room, op, 'chat_message', {'p': p, 'name': player_name, 'msg': msg})
            self._json({"ok": True})

        # POST /profile/create  { username, pin, last_deck }
        elif parsed.path == "/profile/create":
            # Rate limiting
            client_ip = self._client_ip()
            if not check_rate_limit(client_ip):
                return self._json({"error": "too many requests"}, 429)
            
            username = _sanitize_username(data.get("username", ""), maxlen=20)
            pin = str(data.get("pin", "")).strip()
            last_deck = _safe_text(data.get("last_deck", ""), maxlen=20)
            
            if not username or not pin or len(pin) != 4 or not pin.isdigit():
                return self._json({"error": "invalid username or pin"}, 400)
            
            with _profiles_lock:
                if username in _profiles:
                    return self._json({"error": "username already exists"}, 409)
                # PIN をハッシュ化して保存
                pin_hash, pin_salt = hash_pin(pin)
                _profiles[username] = {"pin_hash": pin_hash, "pin_salt": pin_salt, "last_deck": last_deck}
            
            # Save to database
            _save_profile_to_db(username, pin_hash, pin_salt, last_deck)
            
            print(f"[profile] created {username}", flush=True)
            self._json({"ok": True})

        # POST /profile/login  { username, pin }
        elif parsed.path == "/profile/login":
            # Rate limiting
            client_ip = self._client_ip()
            if not check_rate_limit(client_ip):
                return self._json({"error": "too many requests"}, 429)

            username = _sanitize_username(data.get("username", ""))
            pin = str(data.get("pin", "")).strip()

            if not username or not pin:
                return self._json({"error": "username and pin required"}, 400)

            with _profiles_lock:
                profile = _profiles.get(username)

            if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                return self._json({"error": "invalid username or pin"}, 401)
            
            print(f"[profile] login {username}", flush=True)
            self._json({"ok": True, "last_deck": profile.get("last_deck", "")})

        # POST /profile/update  { username, pin, last_deck }
        elif parsed.path == "/profile/update":
            # Rate limiting
            client_ip = self._client_ip()
            if not check_rate_limit(client_ip):
                return self._json({"error": "too many requests"}, 429)
            
            username = _sanitize_username(data.get("username", ""))
            pin = str(data.get("pin", "")).strip()
            last_deck = _safe_text(data.get("last_deck", ""), maxlen=20)

            if not username or not pin:
                return self._json({"error": "username and pin required"}, 400)
            
            with _profiles_lock:
                profile = _profiles.get(username)
                if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                    return self._json({"error": "invalid username or pin"}, 401)
                _profiles[username]["last_deck"] = last_deck
                pin_hash = profile["pin_hash"]
                pin_salt = profile["pin_salt"]

            # Save to database
            _save_profile_to_db(username, pin_hash, pin_salt, last_deck)
            
            print(f"[profile] updated {username}", flush=True)
            self._json({"ok": True})

        # POST /deck/save  { username, pin, deck_name, deck_data }
        elif parsed.path == "/deck/save":
            username = _sanitize_username(data.get("username", ""), maxlen=20)
            pin = str(data.get("pin", "")).strip()
            deck_name = _safe_text(data.get("deck_name", ""), maxlen=50)
            deck_data = data.get("deck_data", [])

            if not username or not pin:
                return self._json({"error": "username and pin required"}, 400)
            if not deck_name:
                return self._json({"error": "deck_name required"}, 400)
            if not isinstance(deck_data, list):
                return self._json({"error": "deck_data must be an array"}, 400)
            
            with _profiles_lock:
                profile = _profiles.get(username)
            
            if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                return self._json({"error": "invalid username or pin"}, 401)
            
            with _decks_lock:
                if username not in _decks:
                    _decks[username] = {}
                _decks[username][deck_name] = deck_data
            
            # Save to database
            _save_deck_to_db(username, deck_name, deck_data)
            
            print(f"[deck] saved {username}/{deck_name}", flush=True)
            self._json({"ok": True})

        # POST /deck/list | /deck/names  { username, pin }
        elif parsed.path in ("/deck/list", "/deck/names"):
            username = _sanitize_username(data.get("username", ""), maxlen=20)
            pin = str(data.get("pin", "")).strip()

            if not username or not pin:
                return self._json({"error": "username and pin required"}, 400)

            with _profiles_lock:
                profile = _profiles.get(username)

            if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                return self._json({"error": "invalid username or pin"}, 401)

            with _decks_lock:
                deck_list = list(_decks.get(username, {}).keys())

            print(f"[deck] list {username} ({len(deck_list)} decks)", flush=True)
            self._json({"ok": True, "decks": deck_list})

        # POST /deck/get | /deck/fetch  { username, pin, deck_name }
        elif parsed.path in ("/deck/get", "/deck/fetch"):
            username = _sanitize_username(data.get("username", ""), maxlen=20)
            pin = str(data.get("pin", "")).strip()
            deck_name = _safe_text(data.get("deck_name", ""), maxlen=50)

            if not username or not pin or not deck_name:
                return self._json({"error": "username, pin, deck_name required"}, 400)

            with _profiles_lock:
                profile = _profiles.get(username)

            if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                return self._json({"error": "invalid username or pin"}, 401)

            with _decks_lock:
                deck_data = _decks.get(username, {}).get(deck_name)

            if deck_data is None:
                return self._json({"error": "deck not found"}, 404)

            print(f"[deck] get {username}/{deck_name}", flush=True)
            self._json({"ok": True, "deck_data": deck_data})

        # POST /deck/delete  { username, pin, deck_name }
        elif parsed.path == "/deck/delete":
            username = _sanitize_username(data.get("username", ""), maxlen=20)
            pin = str(data.get("pin", "")).strip()
            deck_name = _safe_text(data.get("deck_name", ""), maxlen=50)
            
            if not username or not pin or not deck_name:
                return self._json({"error": "username, pin, deck_name required"}, 400)
            
            with _profiles_lock:
                profile = _profiles.get(username)
            
            if not profile or not verify_pin(pin, profile["pin_hash"], profile["pin_salt"]):
                return self._json({"error": "invalid username or pin"}, 401)
            
            with _decks_lock:
                if username in _decks and deck_name in _decks[username]:
                    del _decks[username][deck_name]
            
            # Delete from database
            _delete_deck_from_db(username, deck_name)
            
            print(f"[deck] deleted {username}/{deck_name}", flush=True)
            self._json({"ok": True})

        else:
            self._json({"error": "unknown endpoint"}, 404)

    # ── SSE stream ────────────────────────────────────────────────────────────

    def _sse_stream(self, room: dict, p: str):
        """Hold the connection open and stream SSE events to the client."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()
        # Send opponent's last-known state only when queue is empty (reconnect with no queued events).
        # If the queue already has events they include the latest state in chronological order.
        op = "p2" if p == "p1" else "p1"
        if room[op]['pub'] and room[p]['q'].empty():
            self._sse_write("opponent_state", room[op]['pub'])
        q = room[p]['q']
        try:
            while True:
                try:
                    msg = q.get(timeout=10)
                    self._sse_write(msg['event'], msg['data'])
                except queue.Empty:
                    self._sse_write("ping", {})
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def _sse_write(self, event: str, data: dict):
        body = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        self.wfile.write(body.encode("utf-8"))
        self.wfile.flush()

    def do_GET(self):
        try:
            self._do_get_impl()
        except Exception as e:
            print(f"[server-error] GET {self.path}: {e}", file=sys.stderr, flush=True)
            try:
                self._json({"error": "internal server error"}, 500)
            except Exception:
                pass

    def _do_get_impl(self):
        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)

        def p(key, default=""):
            return qs.get(key, [default])[0]

        # /ping
        if parsed.path == "/ping":
            self._json({"status": "ok", "port": PORT, "source": "dmwiki", "build": APP_BUILD})

        # /test/rate-limit-status (for debugging)
        elif parsed.path == "/test/rate-limit-status":
            with _rate_limit_lock:
                status = {
                    "rate_limit_entries": len(_rate_limit),
                    "entries": {ip: {"count": e["count"], "reset_at": int(e["reset_at"])} for ip, e in _rate_limit.items()}
                }
            self._json(status)

        # /events?room=XXXX&p=p1  (SSE stream)
        elif parsed.path == "/events":
            rid    = _normalize_room_code(p("room", ""))
            player = p("p", "")
            with _rooms_lock:
                room = _rooms.get(rid)
            if not room or player not in ("p1", "p2"):
                return self._json({"error": "room not found"}, 404)
            self._sse_stream(room, player)

        # /deck/list, /deck/names, /deck/get, /deck/fetch are POST-only to keep PIN out of URL
        elif parsed.path in ("/deck/list", "/deck/names", "/deck/get", "/deck/fetch"):
            self._json({"error": "use POST for this endpoint"}, 405)

        # /search?q=...&page=1
        elif parsed.path == "/search":
            q = p("q")
            if not q:
                return self._json({"error": "q required"}, 400)
            try:
                page = int(p("page", "1"))
            except (TypeError, ValueError):
                return self._json({"error": "page must be an integer"}, 400)
            page = max(1, page)
            cards, total = search_cards(q, page)
            self._json({"cards": cards, "query": q, "page": page, "total": total})

        # /detail?id=...  (prefix "dmwiki_" = dmwiki.net)
        # /detail?name=... (dmwiki card name fallback)
        elif parsed.path == "/detail":
            pid = p("id")
            name = p("name").strip()
            if not pid and not name:
                return self._json({"error": "id or name required"}, 400)

            cache_key = pid
            if not cache_key:
                lookup_name = name[7:] if name.startswith("dmwiki_") else name
                cache_key = f"dmwiki_{lookup_name}"

            cached = _cache_get(cache_key)
            if cached:
                cached_image = str(cached.get("imageUrl") or cached.get("img") or cached.get("thumb") or "").strip()
                if cached_image:
                    return self._json(cached)
                print(f"[detail] cached entry missing image, refreshing: {cache_key}", flush=True)

            if pid:
                if pid.startswith("dmwiki_"):
                    detail = get_card_detail_dmwiki(pid[7:])
                else:
                    detail = get_card_detail(pid)
            else:
                lookup_name = name[7:] if name.startswith("dmwiki_") else name
                detail = get_card_detail_dmwiki(lookup_name)

            if detail:
                image = _extract_card_image(detail)
                if not image:
                    print(f"[detail] image missing (short cache): {cache_key}", flush=True)
                _cache_set(cache_key, detail)
                self._json(detail)
            elif cached:
                self._json(cached)
            else:
                self._json({"error": "not found"}, 404)

        # /illustrations?id=... | /illustrations?name=...
        elif parsed.path == "/illustrations":
            pid = p("id").strip()
            if pid.startswith("src:"):
                pid = pid[4:]
            if "|" in pid:
                pid = ""

            raw_name = p("name").strip()
            name = raw_name[7:] if raw_name.startswith("dmwiki_") else raw_name
            if not pid and not name:
                return self._json({"error": "id or name required"}, 400)

            detail_for_current = None
            lookup_name = name

            if not lookup_name and pid:
                cached = _cache_get(pid)
                if cached:
                    detail_for_current = cached
                    lookup_name = _safe_text(cached.get("name") or cached.get("nameEn"), maxlen=160)

                if not lookup_name and pid.startswith("dmwiki_"):
                    lookup_name = pid[7:]

                if not lookup_name and pid and not pid.startswith("dmwiki_"):
                    official_name = _safe_text(_official_fetch_detail_title(pid), maxlen=160)
                    if official_name:
                        lookup_name = official_name

                if not lookup_name and pid.isdigit():
                    detail = get_card_detail(pid)
                    if detail:
                        detail_for_current = detail
                        lookup_name = _safe_text(detail.get("name") or detail.get("nameEn"), maxlen=160)
                        _cache_set(pid, detail)

            lookup_name = _safe_text(lookup_name, maxlen=160)
            if not lookup_name:
                return self._json({"error": "card name not found"}, 404)

            options = _official_art_variants(lookup_name, limit=24)
            current_img = _extract_card_image(detail_for_current)

            if not current_img and pid:
                current_img = _extract_card_image(_cache_get(pid))
            if not current_img:
                current_img = _extract_card_image(_cache_get(f"dmwiki_{lookup_name}"))

            if current_img:
                has_current = any(_extract_card_image(opt) == current_img for opt in options)
                if not has_current:
                    options.insert(0, {
                        "artId": "current",
                        "sourceId": pid,
                        "name": lookup_name,
                        "label": "現在のイラスト",
                        "imageUrl": current_img,
                        "thumb": current_img,
                        "source": "current",
                    })

            self._json({"name": lookup_name, "options": options, "count": len(options)})

        # /img?url=ENCODED_URL  (proxy for CORS safety)
        elif parsed.path == "/img":
            url = p("url")
            if not url:
                self.send_response(400); self.end_headers(); return
            data, ctype, status = fetch_binary(url)
            if data:
                self.send_response(200)
                self.send_header("Content-Type", ctype or "image/jpeg")
                self.send_header("Cache-Control", "public, max-age=86400")
                self._cors()
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(status if status else 502)
                self._cors()
                self.end_headers()

        else:
            self._json({"error": "unknown endpoint"}, 404)

    def _json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    _init_cache()
    threading.Thread(target=_clean_rooms, daemon=True, name="room-cleaner").start()
    server = DMServer(("0.0.0.0", PORT), Handler)
    sys.stdout.write(f"[DM Proxy] Starting on http://localhost:{PORT}\n")
    sys.stdout.write(f"[DM Proxy] Source: Duel Masters Wiki API\n")
    sys.stdout.write(f"[DM Proxy] Press Ctrl+C to stop.\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stdout.write("\n[DM Proxy] Stopped.\n")
