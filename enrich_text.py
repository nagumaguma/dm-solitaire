#!/usr/bin/env python3
"""Backfill card effect text into dm_cache.db from the official card DB.

The crawl (crawl_official.py) stores each card's name + image, but not its rules
text — so cards that were never warmed from another source show up with an empty
effect box (e.g. 偽りの希望 鬼丸「終斗」, and twinpacts whose two faces live in the
detail-page body). This pass fills card_index.rules_text for every card that is
still missing it, by fetching the official detail page and extracting the text.

Twinpacts (上面/下面) are handled: both faces' text is captured and joined.

Resumable + incremental: only cards with empty rules_text are processed, and each
attempted card is recorded in `text_enriched`, so a monthly re-run (after a fresh
crawl) only touches genuinely new cards. Re-running after a stop loses nothing.

Usage (run locally in Japan — the official site geo-blocks Railway):
    $env:SSL_CERT_FILE = (python -c "import certifi;print(certifi.where())")
    python enrich_text.py                 # fill all missing (resume-safe)
    python enrich_text.py --limit 50      # quick sample
    python enrich_text.py --redo          # ignore text_enriched, retry attempted-but-empty
Then verify and:  railway up
"""
import argparse
import importlib.util
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor

_spec = importlib.util.spec_from_file_location("dmproxy", "dm-proxy-server.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def _ensure_tables(con: sqlite3.Connection):
    con.execute(
        "CREATE TABLE IF NOT EXISTS text_enriched "
        "(card_id TEXT PRIMARY KEY, has_text INTEGER, noted_at REAL)"
    )


def _targets(con: sqlite3.Connection, redo: bool):
    """Cards still missing rules_text, paired with a representative print id to fetch."""
    rows = con.execute(
        """
        SELECT ci.card_id, ci.name,
               (SELECT cp.print_id FROM card_prints cp
                 WHERE cp.card_id = ci.name_compact AND cp.name != ''
                 ORDER BY (cp.image_url != '') DESC, cp.print_id ASC
                 LIMIT 1) AS pid
        FROM card_index ci
        WHERE ci.rules_text IS NULL OR trim(ci.rules_text) = ''
        """
    ).fetchall()
    done = set()
    if not redo:
        done = {r[0] for r in con.execute("SELECT card_id FROM text_enriched").fetchall()}
    return [(cid, name, pid) for (cid, name, pid) in rows if pid and cid not in done]


def _fetch(job):
    cid, name, pid = job
    return cid, name, m._official_fetch_detail_text(pid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap cards processed (0 = all)")
    ap.add_argument("--workers", type=int, default=3, help="parallel detail fetchers")
    ap.add_argument("--redo", action="store_true", help="retry cards already attempted (text_enriched)")
    ap.add_argument("--batch", type=int, default=200, help="commit every N updates")
    a = ap.parse_args()

    print(f"[enrich] CACHE_DB={m.CACHE_DB}", flush=True)
    if not m.OFFICIAL_SEARCH_ENABLED:
        print("[enrich] ABORT: OFFICIAL_SEARCH_ENABLED=0 — run from JP without that env var", flush=True)
        sys.exit(1)

    con = sqlite3.connect(m.CACHE_DB)
    con.execute("PRAGMA busy_timeout=15000")
    _ensure_tables(con)
    con.commit()

    jobs = _targets(con, a.redo)
    if a.limit:
        jobs = jobs[: a.limit]
    print(f"[enrich] {len(jobs)} cards to enrich", flush=True)
    if not jobs:
        con.close()
        return

    t0 = time.time()
    filled = empty = 0
    consec_empty = 0
    pending = 0
    now = time.time

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        for cid, name, text in ex.map(_fetch, jobs):
            ts = now()
            if text:
                con.execute(
                    "UPDATE card_index SET rules_text = ?, updated_at = ? WHERE card_id = ?",
                    (text[:5000], ts, cid),
                )
                filled += 1
                consec_empty = 0
            else:
                empty += 1
                consec_empty += 1
            con.execute(
                "INSERT OR REPLACE INTO text_enriched (card_id, has_text, noted_at) VALUES (?, ?, ?)",
                (cid, 1 if text else 0, ts),
            )
            pending += 1
            if pending >= a.batch:
                con.commit()
                pending = 0
                el = ts - t0
                print(f"[enrich] {filled + empty}/{len(jobs)} filled={filled} empty={empty} ({el:.0f}s)", flush=True)

            # Burst-throttle guard: a long run of empties usually means the official
            # site is rate-limiting (returning bodies without the data table), not that
            # every card is vanilla. Pause to let it recover.
            if consec_empty and consec_empty % 40 == 0:
                con.commit()
                pending = 0
                print(f"[enrich] {consec_empty} consecutive empties — backing off 20s (possible throttling)", flush=True)
                time.sleep(20.0)

    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    still = con.execute(
        "SELECT COUNT(*) FROM card_index WHERE rules_text IS NULL OR trim(rules_text) = ''"
    ).fetchone()[0]
    con.close()
    print(
        f"[enrich] DONE in {time.time() - t0:.0f}s | filled={filled} empty={empty} "
        f"| card_index still missing text: {still}",
        flush=True,
    )


if __name__ == "__main__":
    main()
