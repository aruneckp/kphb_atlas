#!/usr/bin/env python3
"""data/kphb.db -> compact JSON for the plain React (static) app.

    python3 scripts/export_static.py

Writes data/static/summary.json (stations, sections, headline numbers - small, loads first)
and data/static/voters.json (every voter as compact columns). The next step,
`cd web && npm run pack -- --password ...`, compresses and encrypts both into web/public/data/.
"""
import json
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB = os.path.join(ROOT, "data", "kphb.db")
OUT = os.path.join(ROOT, "data", "static")

REL = {"Father": "F", "Husband": "H", "Mother": "M", "Other": "O"}
HOW = {"same house": "h", "similar name in house": "s", "same building": "b", "same name in station": "n", "not on roll": "g"}


def main():
    if not os.path.exists(DB):
        sys.exit("Run python3 scripts/build_db.py first.")
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    meta = {r["key"]: json.loads(r["value"]) for r in c.execute("SELECT key, value FROM meta")}
    reasons = [r[0] for r in c.execute(
        "SELECT review_reason, count(*) n FROM voters WHERE review_reason <> '' GROUP BY 1 ORDER BY n DESC")]
    rix = {r: i + 1 for i, r in enumerate(reasons)}

    cols = {k: [] for k in ("part", "serial", "sec", "page", "age", "fam", "hh", "gen", "link", "flags", "ocr", "reason", "apt",
                            "epic", "name", "rname", "house")}
    g, rel, how = [], [], []
    extra = {}  # sparse: duplicates and deletion notes
    n = 0
    for v in c.execute("SELECT * FROM voters ORDER BY id"):
        n += 1
        assert v["id"] == n, "voter ids must run 1..n"
        cols["part"].append(v["part_no"]); cols["serial"].append(v["serial_no"]); cols["sec"].append(v["section_no"])
        cols["page"].append(v["page_no"]); cols["age"].append(v["age"] or 0)
        cols["fam"].append(v["family_id"]); cols["hh"].append(v["household_id"]); cols["gen"].append(v["gen"])
        lt = v["link_to"] or ""
        cols["link"].append(-int(lt[1:]) if lt.startswith("g") else int(lt) if lt else 0)
        flags = (1 if v["needs_review"] else 0) | (2 if (v["epic_dup"] or v["name_dup"]) else 0) | \
                (4 if v["status"] == "Deleted" else 0)
        cols["flags"].append(flags)
        cols["ocr"].append(int(round(v["ocr_conf"] * 10)) if v["ocr_conf"] is not None else 0)
        cols["reason"].append(rix.get(v["review_reason"], 0))
        cols["apt"].append(v["apt_id"] if "apt_id" in v.keys() and v["apt_id"] else 0)
        # search keys, house keys and relatives not on the roll are rebuilt in the browser to keep the file small
        for k, src in (("epic", "epic"), ("name", "name"), ("rname", "rel_name"), ("house", "house")):
            cols[k].append(v[src] or "")
        g.append(v["gender"] if v["gender"] in ("M", "F", "T") else "?")
        rel.append(REL.get(v["rel_type"], "-"))
        how.append(HOW.get(v["link_how"], "-"))
        if v["epic_dup"] or v["name_dup"] or v["deletion_code"]:
            extra[n] = [v["epic_dup"] or v["name_dup"] or "", v["deletion_code"] or ""]

    voters = dict(v=1, n=n, cols=cols, g="".join(g), rel="".join(rel), how="".join(how), extra=extra, reasons=reasons)
    stations = [dict(r) for r in c.execute("SELECT * FROM stations ORDER BY part_no")]
    sections = [dict(r) for r in c.execute("SELECT * FROM sections ORDER BY part_no, section_no")]
    has_apt = c.execute("SELECT count(*) FROM sqlite_master WHERE name = 'apartments'").fetchone()[0]
    apartments = [dict(r) for r in c.execute("SELECT * FROM apartments ORDER BY id")] if has_apt else []
    summary = dict(v=1, meta=meta, stations=stations, sections=sections, reasons=reasons, apartments=apartments)

    for name, obj in (("summary.json", summary), ("voters.json", voters)):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {os.path.getsize(path) / 1e6:.1f} MB")
    print(f"exported {n:,} voters in {time.time() - t0:.0f}s -> {OUT}")


if __name__ == "__main__":
    main()
