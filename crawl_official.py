#!/usr/bin/env python3
"""Crawl the official Duel Masters card DB (dm.takaratomy.co.jp) from a Japanese IP.

Collects, for every card, its name plus ALL illustration variants (印刷/イラスト違い),
and bakes them into dm_cache.db so production serves them without ever calling the
geo-blocked official site at runtime.

Design (resilient + resumable):
  - Walks the official list (empty card_name search, `samename=1`, 50/page, ~22,000).
  - Per page: read it, fetch each NEW printing's name from its detail title, store
    immediately. Progress is persisted page-by-page, so a crash/stop loses nothing
    and re-running just continues (already-stored printings are skipped).
  - Polite + rate-limit aware: small delays, retries with backoff, and it backs off
    when the official site starts returning errors / empty titles (burst throttling).

Usage (run locally in Japan):
    $env:SSL_CERT_FILE = (python -c "import certifi;print(certifi.where())")
    python crawl_official.py              # incremental (resume / monthly update)
    python crawl_official.py --force      # full re-crawl
    python crawl_official.py --limit 300  # quick sample
Then verify counts/integrity and:  railway up
"""
import argparse
import importlib.util
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

_spec = importlib.util.spec_from_file_location("dmproxy", "dm-proxy-server.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

LIST_PAGE_SIZE = 50
_TOTAL_RE = re.compile(r'id ?="total_count"[^>]*>([\d,]+)')


def _enumerate_page(pagenum: int):
    """Return (pairs, total) for one list page, or raise on HTTP/network error."""
    form = urllib.parse.urlencode(
        {"keyword": "", "keyword_type[]": "card_name", "samename": "1", "pagenum": str(pagenum)},
        encoding="utf-8",
    ).encode()
    req = urllib.request.Request(m.OFFICIAL_SEARCH, data=form, headers=m.OFFICIAL_HEADERS)
    with urllib.request.urlopen(req, timeout=25) as r:
        html = r.read().decode("utf-8", "replace")
    tc = _TOTAL_RE.search(html)
    total = int(tc.group(1).replace(",", "")) if tc else None
    return m._official_search_pairs(html), total


def _enumerate_with_retry(pagenum: int, tries: int = 4):
    """Robust page fetch. Returns (pairs, total) or (None, total) if it gives up."""
    delay = 3.0
    last = None
    for attempt in range(tries):
        try:
            return _enumerate_page(pagenum)
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429, 500, 502, 503, 504):
                print(f"[crawl] page {pagenum} HTTP {e.code} — backing off {delay:.0f}s", flush=True)
            else:
                print(f"[crawl] page {pagenum} HTTP {e.code}", flush=True)
        except Exception as e:
            last = e
            print(f"[crawl] page {pagenum} error: {e} — backing off {delay:.0f}s", flush=True)
        time.sleep(delay)
        delay = min(delay * 2, 30.0)
    print(f"[crawl] page {pagenum} giving up after {tries} tries ({last})", flush=True)
    return None, None


def _fetch_name(card_id: str):
    name = m._official_fetch_detail_title(card_id)
    image = f"{m.OFFICIAL_BASE}/wp-content/card/cardthumb/{urllib.parse.quote(card_id, safe='')}.jpg"
    return card_id, name, image


def _existing_print_ids() -> set:
    """Printings to skip: already stored, plus known-empty official placeholders
    (crawl_skip) — ids the official DB lists but leaves nameless/imageless, so
    there is nothing to fetch and re-trying them every run is wasted."""
    con = sqlite3.connect(m.CACHE_DB)
    try:
        con.execute("CREATE TABLE IF NOT EXISTS crawl_skip (print_id TEXT PRIMARY KEY, reason TEXT, noted_at REAL)")
        ids = {r[0] for r in con.execute("SELECT print_id FROM card_prints").fetchall()}
        ids |= {r[0] for r in con.execute("SELECT print_id FROM crawl_skip").fetchall()}
        return ids
    except Exception:
        return set()
    finally:
        con.close()


def _store_prints(records):
    if not records:
        return
    con = sqlite3.connect(m.CACHE_DB)
    con.execute("PRAGMA busy_timeout=15000")
    try:
        now = time.time()
        con.executemany(
            "INSERT OR REPLACE INTO card_prints "
            "(print_id, card_id, name, set_code, print_code, image_url, source, updated_at) "
            "VALUES (?, ?, ?, '', '', ?, 'official', ?)",
            [(pid, m._search_compact_text(nm), nm, img, now) for pid, nm, img in records if nm],
        )
        con.commit()
    finally:
        con.close()


def _rebuild_search_index():
    con = sqlite3.connect(m.CACHE_DB)
    try:
        rows = con.execute(
            "SELECT name, image_url FROM card_prints WHERE name != '' AND image_url != '' "
            "ORDER BY updated_at ASC, rowid ASC"
        ).fetchall()
    finally:
        con.close()
    representative: dict[str, tuple[str, str]] = {}
    for name, image in rows:
        representative[m._search_compact_text(name)] = (name, image)
    n = 0
    for name, image in representative.values():
        m._upsert_card_search_index(
            f"dmwiki_{name}",
            {"name": name, "thumb": image, "img": image, "imageUrl": image},
            source="official-crawl",
        )
        n += 1
        if n % 2000 == 0:
            print(f"[crawl] rebuilt index {n}/{len(representative)}", flush=True)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-crawl printings already stored")
    ap.add_argument("--limit", type=int, default=0, help="cap NEW printings stored (0 = all)")
    ap.add_argument("--max-pages", type=int, default=0, help="cap list pages (0 = all)")
    ap.add_argument("--workers", type=int, default=3, help="parallel detail-name fetchers")
    ap.add_argument("--page-delay", type=float, default=0.6, help="seconds between pages")
    ap.add_argument("--no-rebuild", action="store_true", help="skip index rebuild")
    a = ap.parse_args()

    print(f"[crawl] CACHE_DB={m.CACHE_DB}", flush=True)
    if not m.OFFICIAL_SEARCH_ENABLED:
        print("[crawl] ABORT: OFFICIAL_SEARCH_ENABLED=0 — run from JP without that env var", flush=True)
        sys.exit(1)

    known = set() if a.force else _existing_print_ids()
    print(f"[crawl] already stored: {len(known)} printings", flush=True)

    total = None
    page = 1
    stored = 0
    named = 0
    failed = 0
    t0 = time.time()

    while True:
        if a.max_pages and page > a.max_pages:
            break
        pairs, total = _enumerate_with_retry(page)
        if pairs is None:
            print("[crawl] STOP: list enumeration failed repeatedly (likely rate-limited). Re-run later to resume.", flush=True)
            break
        if not pairs:
            break

        new_ids = [cid for cid, _ in pairs if cid not in known]
        if new_ids:
            records = []
            with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
                for cid, name, image in ex.map(_fetch_name, new_ids):
                    if name:
                        records.append((cid, name, image))
                        known.add(cid)
                    else:
                        failed += 1
            _store_prints(records)
            stored += len(records)
            named += len(records)

            # Burst-throttle detection: many empty titles on a page => back off and
            # drop the negative-title cache so those ids retry on the next run.
            empties = len(new_ids) - len(records)
            if len(new_ids) >= 8 and empties > len(new_ids) * 0.5:
                m._official_detail_title_cache.clear()
                print(f"[crawl] page {page}: {empties}/{len(new_ids)} empty titles — backing off 20s", flush=True)
                time.sleep(20.0)

        if page % 20 == 0 or (total and page * LIST_PAGE_SIZE >= total):
            el = time.time() - t0
            print(f"[crawl] page {page}/{(total // LIST_PAGE_SIZE + 1) if total else '?'} "
                  f"stored={stored} failed={failed} ({el:.0f}s)", flush=True)

        if a.limit and stored >= a.limit:
            print(f"[crawl] reached --limit {a.limit}", flush=True)
            break
        if total and page * LIST_PAGE_SIZE >= total:
            break
        page += 1
        time.sleep(max(0.0, a.page_delay))

    if not a.no_rebuild:
        print("[crawl] rebuilding search index from card_prints ...", flush=True)
        indexed = _rebuild_search_index()
    else:
        indexed = -1

    con = sqlite3.connect(m.CACHE_DB)
    # Fold the WAL into the main file so `railway up` ships a self-contained DB
    # (it uploads dm_cache.db, not dm_cache.db-wal).
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    prints = con.execute("SELECT COUNT(*) FROM card_prints").fetchone()[0]
    distinct = con.execute("SELECT COUNT(DISTINCT card_id) FROM card_prints").fetchone()[0]
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.close()
    print(f"[crawl] DONE in {time.time() - t0:.0f}s | printings={prints} cards={distinct} "
          f"indexed={indexed} integrity={integrity} (official total={total})", flush=True)
    if integrity != "ok":
        print("[crawl] WARNING: integrity not ok — DO NOT deploy", flush=True)
        sys.exit(2)


if __name__ == "__main__":
    main()
