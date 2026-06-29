#!/usr/bin/env python3
"""Gently recover printings that the bulk crawl missed (rate-limit transients).

The full crawl interleaves list POSTs with parallel detail fetches, which bursts
the official site and gets some detail-title fetches throttled (concentrated on
the newest, variant-heavy sets). Those ids fetch fine one-at-a-time, so this tool:
  1) enumerates the whole list ONCE (gently) to find ids missing from card_prints,
  2) fetches just those names fully sequentially (~1.5s apart, retry-on-empty).
Only card_prints gets new rows (the cards themselves are already indexed), so no
heavy index rebuild is needed.

Usage (run locally in Japan):
    $env:SSL_CERT_FILE = (python -c "import certifi;print(certifi.where())")
    python recover_missing.py
Then:  railway up
"""
import importlib.util
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

_spec = importlib.util.spec_from_file_location("dmproxy", "dm-proxy-server.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def _list_page(pagenum: int, tries: int = 4):
    delay = 3.0
    for _ in range(tries):
        try:
            form = urllib.parse.urlencode(
                {"keyword": "", "keyword_type[]": "card_name", "samename": "1", "pagenum": str(pagenum)},
                encoding="utf-8",
            ).encode()
            req = urllib.request.Request(m.OFFICIAL_SEARCH, data=form, headers=m.OFFICIAL_HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                return m._official_search_pairs(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print(f"[recover] list page {pagenum} err ({e}); backoff {delay:.0f}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 30)
    return None


def _name_with_retry(card_id: str, tries: int = 3):
    # Retry only TRANSIENT failures (timeout / 5xx / 429). A 200 with an empty
    # title is deterministic — the official entry is a nameless placeholder
    # (e.g. "(DMEX08 22/???)") — so accept it immediately instead of re-fetching.
    url = f"{m.OFFICIAL_BASE}/card/detail/?id={urllib.parse.quote(card_id, safe='')}"
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=m.OFFICIAL_DETAIL_HEADERS)
            with urllib.request.urlopen(req, timeout=10) as r:
                chunk = r.read(4096).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2.0 * (attempt + 1))
                continue
            return ""
        except Exception:
            if attempt < tries - 1:
                time.sleep(2.0 * (attempt + 1))
                continue
            return ""
        mt = re.search(r'<title>([^<(|]+)', chunk)
        return mt.group(1).strip() if mt else ""
    return ""


def _store(records):
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
            [(pid, m._search_compact_text(nm), nm,
              f"{m.OFFICIAL_BASE}/wp-content/card/cardthumb/{urllib.parse.quote(pid, safe='')}.jpg", now)
             for pid, nm in records if nm],
        )
        con.commit()
    finally:
        con.close()


def main():
    if not m.OFFICIAL_SEARCH_ENABLED:
        print("[recover] ABORT: run from JP without OFFICIAL_SEARCH_ENABLED=0", flush=True)
        return
    t0 = time.time()

    # Phase 1: enumerate every printing id (gentle).
    all_ids = []
    page = 1
    while True:
        pairs = _list_page(page)
        if pairs is None:
            print("[recover] enumeration gave up; proceeding with what we have", flush=True)
            break
        if not pairs:
            break
        all_ids += [cid for cid, _ in pairs]
        if len(pairs) < 50:
            break
        page += 1
        time.sleep(0.4)
    print(f"[recover] enumerated {len(all_ids)} ids over {page} pages ({time.time()-t0:.0f}s)", flush=True)

    con = sqlite3.connect(m.CACHE_DB)
    con.execute("CREATE TABLE IF NOT EXISTS crawl_skip (print_id TEXT PRIMARY KEY, reason TEXT, noted_at REAL)")
    have = {r[0] for r in con.execute("SELECT print_id FROM card_prints").fetchall()}
    have |= {r[0] for r in con.execute("SELECT print_id FROM crawl_skip").fetchall()}  # known-empty placeholders
    con.close()
    missing = [c for c in all_ids if c not in have]
    print(f"[recover] missing printings to fetch: {len(missing)}", flush=True)

    # Phase 2: fetch missing names sequentially, gently.
    records = []
    ok = 0
    fail = 0
    for i, cid in enumerate(missing, 1):
        name = _name_with_retry(cid)
        if name:
            records.append((cid, name))
            ok += 1
        else:
            fail += 1
        if len(records) >= 100:
            _store(records)
            records = []
        if i % 50 == 0 or i == len(missing):
            print(f"[recover] {i}/{len(missing)} ok={ok} fail={fail} ({time.time()-t0:.0f}s)", flush=True)
        time.sleep(0.3)
    _store(records)

    con = sqlite3.connect(m.CACHE_DB)
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    prints = con.execute("SELECT COUNT(*) FROM card_prints").fetchone()[0]
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.close()
    print(f"[recover] DONE in {time.time()-t0:.0f}s | recovered={ok} still_failed={fail} "
          f"total_printings={prints} integrity={integrity}", flush=True)


if __name__ == "__main__":
    main()
