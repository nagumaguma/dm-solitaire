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

import html as _html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

PORT     = int(os.environ.get("PORT", 8765))
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}")
WIKI_API = "https://duelmasters.fandom.com/api.php"
WIKI_HEADERS = {"User-Agent": "DMSolitaireTool/1.0 (local proxy)"}

_dmwiki_cache: dict[str, list[dict]] = {}   # normalized_query → all matched cards

# ─── SQLite card detail cache ──────────────────────────────────────────────────

CACHE_DB  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dm_cache.db")
CACHE_TTL = 90 * 86400  # 90 days


def _init_cache():
    con = sqlite3.connect(CACHE_DB)
    con.execute("""
        CREATE TABLE IF NOT EXISTS card_cache (
            id        TEXT PRIMARY KEY,
            data      TEXT NOT NULL,
            cached_at REAL NOT NULL
        )
    """)
    con.commit()
    con.close()


def _cache_get(cid: str) -> dict | None:
    try:
        con = sqlite3.connect(CACHE_DB)
        row = con.execute(
            "SELECT data, cached_at FROM card_cache WHERE id = ?", (cid,)
        ).fetchone()
        con.close()
        if row and (time.time() - row[1]) < CACHE_TTL:
            return json.loads(row[0])
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
    e.g. '＝' → '=',  '（' → '(',  'Ａ' → 'a'
    """
    result = []
    for ch in s:
        cp = ord(ch)
        if 0xFF01 <= cp <= 0xFF5E:      # fullwidth ASCII block
            result.append(chr(cp - 0xFEE0))
        elif cp == 0x3000:              # ideographic space → regular space
            result.append(' ')
        else:
            result.append(ch)
    return ''.join(result).lower()


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
            _dmwiki_cache[cache_key] = search_cards_dmwiki(query)
        all_cards = _dmwiki_cache[cache_key]
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

    # POST to PukiWiki search — scope=page searches page titles only
    form = urllib.parse.urlencode(
        {"word": search_query, "type": "AND", "scope": "page"}, encoding="utf-8"
    ).encode()
    html = _dmwiki_fetch("/?cmd=search", post_data=form)
    if not html:
        return []

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
        cards.append({"id": f"dmwiki_{clean}", "name": clean, "thumb": ""})

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


def _img_from_en_wiki(card_name: str) -> str:
    """Search English Fandom wiki for the JP name in wikitext and return thumbnail.
    Only returns a thumbnail if the matched page actually has a Cardtable (is a card page).
    """
    d = wiki_get({
        "action": "query",
        "list": "search",
        "srsearch": f'insource:"{card_name}"',
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


def _img_from_official(card_name: str) -> str:
    """Get card image URL from the official Takara Tomy DM card database.
    Searches by card name, then verifies each result by fetching the detail
    page title (only first 2 KB) to confirm name match.
    """
    keyword = _official_keyword(card_name)
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
        return ""

    # Extract (card_id, thumb_path) pairs — search results have no card names
    pairs = re.findall(
        r"href=['\"](?:/card/detail/\?id=([^'\"]+))['\"]"
        r".*?src=['\"](/wp-content/card/cardthumb/[^'\"]+)['\"]",
        html, re.DOTALL
    )
    if not pairs:
        return ""

    nq = _norm_fw(card_name).replace(" ", "")
    # Headers for plain GET (no XMLHttpRequest — avoids AJAX-only response)
    detail_headers = {
        "User-Agent": WIKI_HEADERS["User-Agent"],
        "Referer":    OFFICIAL_SEARCH,
        "Accept":     "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
    }

    for card_id, thumb_path in pairs:
        try:
            detail_url = f"{OFFICIAL_BASE}/card/detail/?id={card_id}"
            detail_req = urllib.request.Request(detail_url, headers=detail_headers)
            with urllib.request.urlopen(detail_req, timeout=8) as r:
                # Only read first 2 KB — title tag is always near the top
                chunk = r.read(2048).decode("utf-8", errors="replace")
            m = re.search(r'<title>([^<(|]+)', chunk)
            if not m:
                continue
            page_name = _norm_fw(m.group(1).strip()).replace(" ", "")
            if page_name == nq or page_name.startswith(nq + "/"):
                return f"{BASE_URL}/img?url={urllib.parse.quote(OFFICIAL_BASE + thumb_path)}"
        except Exception:
            continue

    return ""


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


def _img_from_dmwiki_html(html: str) -> str:
    """Extract a card scan (non-pack) image from an already-fetched dmwiki page.

    Pack/set images have filenames like DM24-RP1.jpg; card scans have other names.
    Returns "" if only pack images are found so the caller can try other sources.
    """
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
    return ""


def _img_from_dmwiki_attach(page_name: str) -> str:
    """Fetch dmwiki's attachment list for 《page_name》 and return the first
    non-pack image URL found there.  This catches card scans that are uploaded
    to the page but not directly linked in the rendered HTML."""
    encoded = urllib.parse.quote(f"《{page_name}》", encoding="utf-8")
    html = _dmwiki_fetch(f"/?cmd=attach&refer={encoded}&pcmd=list")
    if not html:
        return ""
    for m in re.finditer(
        r'href="(\?plugin=ref[^"]*\.(?:jpg|jpeg|png)[^"]*)"',
        html, re.IGNORECASE
    ):
        url = m.group(1)
        if _is_pack_filename(url):
            continue
        rel = re.sub(r'&thumbnail(?:=[^&"]*)?', '', url)
        full_url = f"{DMWIKI_BASE}/{rel}"
        return f"{BASE_URL}/img?url={urllib.parse.quote(full_url, safe='')}"
    return ""


def get_card_detail_dmwiki(name: str) -> dict | None:
    """Fetch card detail from dmwiki.net by card name (without 《》 brackets)."""
    encoded = urllib.parse.quote(f"《{name}》", encoding="utf-8")
    html = _dmwiki_fetch(f"/{encoded}")
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

    # Remaining rows: effect text (skip set codes like "DM24-RP1 18/75")
    effect = "\n".join(
        r for r in rows[2:] if not re.match(r'^DM\d', r)
    ).strip()

    # Get card image: dmwiki HTML → dmwiki attach list → official → English wiki (by table name, then page name)
    img_url = (
        _img_from_dmwiki_html(html)
        or _img_from_dmwiki_attach(name)
        or _img_from_official(card_name)
        or _img_from_en_wiki(card_name)
        or (card_name != name and _img_from_en_wiki(name))
    )

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

def fetch_binary(url: str):
    req = urllib.request.Request(url, headers={**WIKI_HEADERS, "Accept": "image/*"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read(), r.headers.get("Content-Type", "image/jpeg")
    except Exception as e:
        print(f"[img] {e}", file=sys.stderr, flush=True)
        return None, None


# ─── HTTP Handler ──────────────────────────────────────────────────────────────

class DMServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = False   # prevent old zombie processes from stealing requests
    daemon_threads = True         # threads die with the server


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}", flush=True)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)

        def p(key, default=""):
            return qs.get(key, [default])[0]

        # /ping
        if parsed.path == "/ping":
            self._json({"status": "ok", "port": PORT, "source": "dmwiki"})

        # /search?q=...&page=1
        elif parsed.path == "/search":
            q = p("q")
            if not q:
                return self._json({"error": "q required"}, 400)
            page  = max(1, int(p("page", "1")))
            cards, total = search_cards(q, page)
            self._json({"cards": cards, "query": q, "page": page, "total": total})

        # /detail?id=...  (prefix "dmwiki_" = dmwiki.net)
        elif parsed.path == "/detail":
            pid = p("id")
            if not pid:
                return self._json({"error": "id required"}, 400)
            cached = _cache_get(pid)
            if cached:
                return self._json(cached)
            if pid.startswith("dmwiki_"):
                detail = get_card_detail_dmwiki(pid[7:])
            else:
                detail = get_card_detail(pid)
            if detail:
                _cache_set(pid, detail)
                self._json(detail)
            else:
                self._json({"error": "not found"}, 404)

        # /img?url=ENCODED_URL  (proxy for CORS safety)
        elif parsed.path == "/img":
            url = p("url")
            if not url:
                self.send_response(400); self.end_headers(); return
            data, ctype = fetch_binary(url)
            if data:
                self.send_response(200)
                self.send_header("Content-Type", ctype or "image/jpeg")
                self.send_header("Cache-Control", "public, max-age=86400")
                self._cors()
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(404); self.end_headers()

        else:
            self._json({"error": "unknown endpoint"}, 404)

    def _json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
    server = DMServer(("0.0.0.0", PORT), Handler)
    sys.stdout.write(f"[DM Proxy] Starting on http://localhost:{PORT}\n")
    sys.stdout.write(f"[DM Proxy] Source: Duel Masters Wiki API\n")
    sys.stdout.write(f"[DM Proxy] Press Ctrl+C to stop.\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stdout.write("\n[DM Proxy] Stopped.\n")
