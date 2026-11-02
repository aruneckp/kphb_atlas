#!/usr/bin/env python3
"""Checks the database against the source CSVs and every API endpoint of a running server.

    python3 scripts/smoke_test.py                  # server on http://127.0.0.1:8046
    python3 scripts/smoke_test.py --rounds 3       # repeat the API loop to check speed
"""
import argparse
import csv
import io
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
csv.field_size_limit(10 ** 9)
ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {name}")
    else:
        fail += 1
        print(f"  FAIL  {name}  {detail}")


def get(base, path, **params):
    url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    t = time.time()
    with urllib.request.urlopen(url, timeout=60) as r:
        body = r.read()
    ms = (time.time() - t) * 1000
    return (json.loads(body) if path != "/api/export.csv" else body), ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8046")
    ap.add_argument("--zip", default=os.path.join(ROOT, "kkp_csv.zip"))
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "kphb.db"))
    ap.add_argument("--rounds", type=int, default=1)
    a = ap.parse_args()

    print("1. Database vs source CSVs")
    db = sqlite3.connect(a.db)
    n_db = db.execute("SELECT count(*) FROM voters").fetchone()[0]
    if os.path.exists(a.zip):
        keys, parts = set(), set()
        with zipfile.ZipFile(a.zip) as z:
            for n in z.namelist():
                if n.endswith(".csv") and "__MACOSX" not in n:
                    for r in csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig", newline="")):
                        keys.add(r["record_key"]); parts.add(r["part_no"])
        check("every CSV row is in the database", len(keys) == n_db, f"csv {len(keys)} vs db {n_db}")
        check("every polling station is present", len(parts) == db.execute("SELECT count(*) FROM stations").fetchone()[0])
    check("station totals add up", db.execute("SELECT sum(voters) FROM stations").fetchone()[0] == n_db)
    check("every voter has a family", db.execute("SELECT count(*) FROM voters WHERE family_id IS NULL").fetchone()[0] == 0)
    check("family sizes add up", db.execute("SELECT sum(size) FROM families").fetchone()[0] == n_db)
    check("links point inside the same family", db.execute(
        "SELECT count(*) FROM voters v JOIN voters w ON w.id = CAST(v.link_to AS INTEGER) "
        "WHERE v.link_to <> '' AND v.link_to NOT LIKE 'g%' AND w.family_id <> v.family_id").fetchone()[0] == 0)
    if db.execute("SELECT count(*) FROM sqlite_master WHERE name = 'voters_fts'").fetchone()[0]:
        check("search index matches", db.execute("SELECT count(*) FROM voters_fts").fetchone()[0] == n_db)

    print("2. API")
    try:
        meta, _ = get(a.base, "/api/meta")
    except Exception as e:
        print(f"  server not reachable at {a.base}: {e}\n  start it with: python3 server/server.py")
        sys.exit(1)
    check("meta voters", meta["voters"] == n_db)
    loc = meta["localities"][0]
    some = db.execute("SELECT id, part_no, serial_no, epic, name, family_id, household_id FROM voters "
                      "WHERE epic <> '' AND household_id > 0 LIMIT 1 OFFSET 12345").fetchone()
    for rnd in range(a.rounds):
        times = {}
        s, times["summary"] = get(a.base, "/api/summary")
        check("summary total", s["totals"]["voters"] == n_db)
        s2, times["summary locality"] = get(a.base, "/api/summary", locality=loc)
        check("locality summary is smaller", 0 < s2["totals"]["voters"] < n_db)
        v, times["search epic"] = get(a.base, "/api/voters", q=some[3])
        check("search by voter ID finds the voter", any(r["id"] == some[0] for r in v["rows"]))
        v, times["search ps/serial"] = get(a.base, "/api/voters", q=f"{some[1]}/{some[2]}")
        check("search by station/serial", v["total"] == 1 and v["rows"][0]["id"] == some[0])
        v, times["search telugu"] = get(a.base, "/api/voters", q=some[4], part=some[1])
        check("search by Telugu name", any(r["id"] == some[0] for r in v["rows"]), some[4])
        v, times["search english"] = get(a.base, "/api/voters", q="lakshmi")
        check("English name search returns matches", v["total"] > 1000)
        v, times["filters"] = get(a.base, "/api/voters", gender="F", age_min=18, age_max=19, locality=loc)
        check("filters combine", all(r["gender"] == "F" and 18 <= r["age"] <= 19 for r in v["rows"]))
        d, times["voter"] = get(a.base, f"/api/voter/{some[0]}")
        check("voter page has family + household", d["family"] and d["household"])
        d, times["family"] = get(a.base, f"/api/family/{some[5]}")
        check("family members", any(m["id"] == some[0] for m in d["members"]))
        d, times["household"] = get(a.base, f"/api/household/{some[6]}")
        check("household members", any(m["id"] == some[0] for m in d["members"]))
        d, times["families"] = get(a.base, "/api/families", min_size=5)
        check("families list", d["total"] > 0 and d["rows"][0]["size"] >= 5)
        d, times["households"] = get(a.base, "/api/households", min_size=10)
        check("households list", d["total"] > 0)
        d, times["stations"] = get(a.base, "/api/stations")
        check("417 stations with positions", len(d) == len(meta["stations"]) and all(x["lat"] and x["lng"] for x in d))
        d, times["station"] = get(a.base, f"/api/station/{some[1]}")
        check("station detail", d["voters"] > 0 and d["sections_list"])
        for lvl in ("locality", "police", "mandal", "pin", "section"):
            d, times[f"areas {lvl}"] = get(a.base, "/api/areas", level=lvl)
            check(f"areas by {lvl}", len(d) > 0)
        d, times["quality"] = get(a.base, "/api/quality")
        check("quality report", "reasons" in d)
        d, times["breakdown"] = get(a.base, "/api/breakdown", gender="F", age_min=60)
        s3, _ = get(a.base, "/api/summary", gender="F", age_min=60)
        check("drill-down map counts add up", sum(x["n"] for x in d["stations"]) == s3["totals"]["voters"] == sum(x["n"] for x in d["sections"]))
        d, times["drill family size"] = get(a.base, "/api/voters", fam_size="10+", size=5)
        check("drill by family size", d["total"] >= 10)
        d, times["drill door size"] = get(a.base, "/api/summary", hh_size="15+")
        check("drill by voters per door", d["totals"]["voters"] > 0)
        d, times["drill reading confidence"] = get(a.base, "/api/voters", ocr=60, size=1)
        check("drill by reading confidence", d["total"] > 0)
        d, times["sections"] = get(a.base, "/api/sections")
        check("sections list", len(d) > 1000)
        d, times["export"] = get(a.base, "/api/export.csv", part=some[1])
        check("CSV export", d.decode("utf-8-sig").count("\n") > 100)
        slow = {k: round(v) for k, v in times.items() if v > 800}
        print(f"  round {rnd + 1}: slowest {max(times, key=times.get)} {max(times.values()):.0f} ms" + (f"; over 800 ms: {slow}" if slow else ""))
    print(f"\n{ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
