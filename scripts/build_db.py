#!/usr/bin/env python3
"""Kukatpally voter roll CSVs (kkp_csv.zip) -> SQLite database for the app.

    python3 scripts/build_db.py                      # uses ./kkp_csv.zip
    python3 scripts/build_db.py --src data/raw       # or an unzipped folder
    python3 scripts/build_db.py --extract            # also unzip to data/raw

Everything runs locally with the Python standard library (no pip installs).
Output: data/kphb.db  (voters, families, households, polling stations,
sections, localities, summaries and a full-text search index).
"""
import argparse
import csv
import io
import json
import math
import os
import re
import sqlite3
import sys
import time
import zipfile
from collections import Counter, defaultdict
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import telugu  # noqa: E402
import localities as L  # noqa: E402

csv.field_size_limit(10 ** 9)
AGE_BINS = [(18, 19, "18-19"), (20, 29, "20-29"), (30, 39, "30-39"), (40, 49, "40-49"),
            (50, 59, "50-59"), (60, 69, "60-69"), (70, 79, "70-79"), (80, 200, "80+")]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ------------------------------------------------------------------ reading
def iter_csv_sources(src, extract_to=None):
    """Yield (name, text-stream) for every roll CSV in a zip or folder."""
    if os.path.isfile(src) and src.lower().endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            names = sorted(n for n in z.namelist()
                           if n.lower().endswith(".csv") and "__MACOSX" not in n and not os.path.basename(n).startswith("._"))
            if extract_to:
                for n in names:
                    z.extract(n, extract_to)
                log(f"unzipped {len(names)} CSV files to {extract_to}")
            for n in names:
                with z.open(n) as fh:
                    yield n, io.TextIOWrapper(fh, encoding="utf-8-sig", newline="")
    else:
        names = []
        for d, _, files in os.walk(src):
            if "__MACOSX" in d:
                continue
            names += [os.path.join(d, f) for f in files if f.lower().endswith(".csv") and not f.startswith("._")]
        for n in sorted(names):
            with open(n, encoding="utf-8-sig", newline="") as fh:
                yield n, fh


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("�", "")).strip()


def to_int(s, default=None):
    s = (s or "").strip()
    return int(s) if s.isdigit() else default


HOUSE_PREFIX = re.compile(
    r"^\s*(h\s*\.?\s*no|d\s*\.?\s*no|door\s*no|house\s*no|plot\s*no|హెచ్\s*ఎన్\s*\S*|హెచ్ఎ\S*|ఏచ్\s*నం|ఎచ్\s*నం|"
    r"ఇంటి\s*నం\S*|ప్లాట్\s*నం\S*|డోర్\s*నం\S*)\s*[.:\-]*\s*", re.I)


def house_key(h):
    """Same house however the door number was typed: 'H NO 8-2-23' == '8-2-23'."""
    s = HOUSE_PREFIX.sub("", h or "")
    s = s.upper()
    s = re.sub(r"[^0-9A-Zఀ-౿]+", "-", s).strip("-")
    return s


def building_key(h):
    """Door number without flat/sub-number: '8-8-51-2-2వీ' -> '8-8-51-2' (used to find relatives next door)."""
    nums = re.findall(r"\d+", HOUSE_PREFIX.sub("", h or ""))
    return "-".join(nums[:4]) if len(nums) >= 3 else ""


def gender_code(g):
    return {"Male": "M", "Female": "F", "Third gender": "T"}.get(g, "?")


def section_place(name):
    """Text part of a section name ('శాంతి నికేతన్ కాలనీ 8-1-59 to 8-1-69' -> 'శాంతి నికేతన్ కాలనీ')."""
    s = re.sub(r"[0-9][0-9A-Za-z/\-&.,]*", " ", name or "")
    s = re.sub(r"\b(to|TO|To|t0|ro)\b", " ", s)
    s = s.replace("నుండి", " ").replace("వరకు", " ")
    s = re.sub(r"[\-/&.,()]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) >= 3 else ""


# ------------------------------------------------------------------ family linking
EXPECT = {"Father": "M", "Husband": "M", "Mother": "F"}


class DSU:
    def __init__(self):
        self.p = {}

    def find(self, x):
        p = self.p
        p.setdefault(x, x)
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def plausible(v, c, rtype):
    """Can candidate c be v's father / mother / husband?"""
    if c["id"] == v["id"]:
        return False
    exp = EXPECT.get(rtype)
    if exp and c["g"] not in (exp, "?"):
        return False
    va, ca = v["age"], c["age"]
    if va and ca:
        if rtype in ("Father", "Mother") and ca - va < 14:
            return False
        if rtype == "Husband" and not (-10 <= ca - va <= 35):
            return False
        if rtype == "Other" and abs(ca - va) > 60:
            return False
    return True


def link_part(rows):
    """Link each voter in one polling station to the relative they name.
    Returns {voter_id: (target, how)}; target is a voter id or a ghost tuple."""
    by_key = defaultdict(list)
    by_house = defaultdict(list)
    by_bld = defaultdict(list)
    for v in rows:
        if v["bkey"]:
            by_bld[v["bkey"]].append(v)
        if v["nkey"]:
            by_key[v["nkey"]].append(v)
        if v["hkey"]:
            by_house[v["hkey"]].append(v)
    links = {}
    ghost_seen = defaultdict(list)
    for v in rows:
        rk, rtype = v["rkey"], v["rtype"] or "Other"
        if not rk:
            continue
        best, best_s, tie = None, -1, False
        for c in by_key.get(rk, ()):
            if not plausible(v, c, rtype):
                continue
            s = 2 + (4 if v["hkey"] and c["hkey"] == v["hkey"] else 0) \
                + (1 if c["sec"] == v["sec"] else 0) \
                + (1 if v["hblk"] and c["hblk"] == v["hblk"] else 0)
            if s > best_s:
                best, best_s, tie = c, s, False
            elif s == best_s:
                tie = True
        how = None
        if best is not None and (not tie or best_s >= 6):
            how = "same house" if best_s >= 6 else "same name in station"
            if best_s < 4 and len(by_key.get(rk, ())) > 3:
                best = None  # a very common name with no house match: too uncertain
        else:
            best = None
        if best is None and v["hkey"]:
            # spelling differs inside the same house: 'రఘు బాబు' -> 'కే రఘు బాబు', 'saiyadaomara' -> 'sayadumar'
            rws = set(w for w in v["rwords"] if len(w) > 1)
            scored = []
            for c in by_house[v["hkey"]]:
                if not c["nkey"] or not plausible(v, c, rtype):
                    continue
                cws = set(w for w in c["nwords"] if len(w) > 1)
                if rws and (rws <= cws or (cws and cws <= rws and len(cws) >= len(rws) - 1)):
                    scored.append((0.95, c))
                    continue
                sm = SequenceMatcher(None, rk, c["nkey"])
                if sm.real_quick_ratio() >= 0.72 and sm.quick_ratio() >= 0.72:
                    r = sm.ratio()
                    if r >= 0.72:
                        scored.append((r, c))
            if scored:
                scored.sort(key=lambda t: -t[0])
                if len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.06:
                    best, how = scored[0][1], "similar name in house"
        if best is None and v["bkey"]:
            # same building, different flat / sub-number: stricter spelling match
            scored = []
            for c in by_bld[v["bkey"]]:
                if c["hkey"] == v["hkey"] or not c["nkey"] or not plausible(v, c, rtype):
                    continue
                r = 1.0 if c["nkey"] == rk else SequenceMatcher(None, rk, c["nkey"]).ratio()
                if r >= 0.82:
                    scored.append((r, c))
            if scored:
                scored.sort(key=lambda t: -t[0])
                if len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.06:
                    best, how = scored[0][1], "same building"
        if best is not None:
            links[v["id"]] = (best["id"], how)
        elif v["hkey"]:
            # relative not on the roll: one shared placeholder per house + similar name, so siblings group together
            gk = None
            for (g_rk, g_exp) in ghost_seen[v["hkey"]]:
                if g_exp == EXPECT.get(rtype, "?") and (g_rk == rk or SequenceMatcher(None, g_rk, rk).ratio() >= 0.8):
                    gk = g_rk
                    break
            if gk is None:
                gk = rk
                ghost_seen[v["hkey"]].append((rk, EXPECT.get(rtype, "?")))
            links[v["id"]] = (("ghost", v["part"], v["hkey"], gk, EXPECT.get(rtype, "?")), "not on roll")
    return links


def read_voter(r, part):
    vname, rname = clean(r.get("voter_name")), clean(r.get("relation_name"))
    house = clean(r.get("house_no"))
    hk = house_key(house)
    hparts = [p for p in hk.split("-") if p]
    nwords, rwords = telugu.word_keys(vname), telugu.word_keys(rname)
    return dict(
        record_key=r.get("record_key") or "", part=part, serial=to_int(r.get("serial_no"), 0),
        sec=to_int(r.get("section_no"), 0), sec_name=clean(r.get("section_name")),
        page=to_int(r.get("page_no"), 0), epic=clean(r.get("epic_no")).upper().replace(" ", ""),
        name=vname, rtype=clean(r.get("relation_type")), rname=rname, house=house, hkey=hk,
        hblk="-".join(hparts[:2]) if len(hparts) >= 3 else "", bkey=building_key(house),
        age=to_int(r.get("age"), 0), g=gender_code(r.get("gender")),
        status=r.get("status") or "", deletion=r.get("deletion_code") or "",
        modified=1 if r.get("modified_in_revision") == "yes" else 0,
        review=1 if r.get("needs_review") == "yes" else 0, reason=r.get("review_reason") or "",
        ocr=float(r["ocr_confidence"]) if re.match(r"^\d+(\.\d+)?$", r.get("ocr_confidence") or "") else None,
        epic_dup=r.get("epic_duplicate_of") or "", name_dup=r.get("name_duplicate_of") or "",
        src=r.get("source_file") or "", nwords=nwords, rwords=rwords, nkey="".join(nwords), rkey="".join(rwords),
    )


def station_info(r):
    return dict(
        name=clean(r.get("polling_station")), address=clean(r.get("polling_station_address")),
        police=clean(r.get("police_station")), pin=clean(r.get("pin_code")),
        post=clean(r.get("post_office")), mandal=clean(r.get("mandal")),
        town=clean(r.get("main_town_or_village")), sections_cover=clean(r.get("sections_on_cover")),
        cover_total=to_int(r.get("cover_total")), cover_men=to_int(r.get("cover_men")),
        cover_women=to_int(r.get("cover_women")), cover_tg=to_int(r.get("cover_third_gender")),
        ac_no=r.get("ac_no"), ac_name=clean(r.get("ac_name")), pc_name=clean(r.get("pc_name")),
        district=clean(r.get("district")), source=r.get("source_file") or "",
        publication=clean(r.get("publication_date")), qualifying=clean(r.get("qualifying_date")),
    )


def process_part(db, part, voters, s, ids, tot, how_count, loc_slots, exact):
    """Families, households, station and section summaries for one polling station, written straight to SQLite."""
    for v in voters:
        ids["voter"] += 1
        v["id"] = ids["voter"]
    dsu = DSU()
    ghosts, link_of = {}, {}
    for vid, (tgt, how) in link_part(voters).items():
        how_count[how] += 1
        if isinstance(tgt, tuple):
            gid = ghosts.get(tgt)
            if gid is None:
                ids["ghost"] += 1
                gid = f"g{ids['ghost']}"
                ghosts[tgt] = gid
            tgt = gid
        link_of[vid] = (tgt, how)
        dsu.union(("g", tgt) if isinstance(tgt, str) else ("v", tgt), ("v", vid))
    vtype = {v["id"]: v["rtype"] for v in voters}
    gen_cache = {}

    def gen(node, depth=0):
        if node in gen_cache:
            return gen_cache[node]
        if depth > 15 or not isinstance(node, int):
            return 0
        l = link_of.get(node)
        g = 0 if not l else (gen(l[0], depth + 1) + (0 if vtype.get(node) == "Husband" else 1))
        gen_cache[node] = g
        return g

    fam_ids, fam_members = {}, defaultdict(list)
    for v in voters:
        root = dsu.find(("v", v["id"]))
        if root not in fam_ids:
            ids["family"] += 1
            fam_ids[root] = ids["family"]
        v["fam"] = fam_ids[root]
        fam_members[v["fam"]].append(v)
        v["gen"] = gen(v["id"])
        l = link_of.get(v["id"])
        v["link_to"], v["link_how"] = (str(l[0]), l[1]) if l else ("", "")
    for mem in fam_members.values():
        m = min(x["gen"] for x in mem)
        if m:
            for x in mem:
                x["gen"] -= m
    hh_ids = {}
    for v in voters:
        if v["hkey"]:
            if v["hkey"] not in hh_ids:
                ids["household"] += 1
                hh_ids[v["hkey"]] = ids["household"]
            v["hh"] = hh_ids[v["hkey"]]
        else:
            v["hh"] = 0

    ghost_name = {}
    for v in voters:
        if v["link_to"].startswith("g") and v["link_to"] not in ghost_name:
            ghost_name[v["link_to"]] = v["rname"]
    ghost_rows = [(gid, fam_ids.get(dsu.find(("g", gid))), part, ghost_name.get(gid, ""),
                   telugu.readable(ghost_name.get(gid, "")), key_[4], key_[2]) for key_, gid in ghosts.items()]
    db.executemany("INSERT INTO ghosts VALUES (?,?,?,?,?,?,?)", ghost_rows)
    db.executemany(f"INSERT INTO voters VALUES ({','.join('?' * 32)})", [
        (v["id"], v["record_key"], v["part"], v["serial"], v["sec"], v["page"], v["epic"], v["name"],
         telugu.readable(v["name"]), v["rtype"], v["rname"], telugu.readable(v["rname"]), v["house"],
         v["hkey"], v["age"] or None, v["g"], v["status"], v["deletion"], v["modified"], v["review"],
         v["reason"], v["ocr"], v["epic_dup"], v["name_dup"], v["fam"], v["gen"], v["link_to"],
         v["link_how"], v["hh"], v["nkey"], v["rkey"], v["src"]) for v in voters])

    gh_by_fam = Counter(g[1] for g in ghost_rows)
    fam_rows = []
    for fid, mem in fam_members.items():
        root = [x for x in mem if not x["link_to"] or x["link_to"].startswith("g")]
        head = sorted(root or mem, key=lambda x: (x["g"] != "M", -(x["age"] or 0)))[0]
        ages = [x["age"] for x in mem if x["age"]]
        houses = Counter(x["hkey"] for x in mem if x["hkey"])
        fam_rows.append((fid, part, head["sec"], len(mem), gh_by_fam.get(fid, 0), max(x["gen"] for x in mem) + 1,
                         len(houses), sum(x["g"] == "M" for x in mem), sum(x["g"] == "F" for x in mem),
                         head["id"], head["name"], telugu.readable(head["name"]),
                         houses.most_common(1)[0][0] if houses else "",
                         round(sum(ages) / len(ages), 1) if ages else None,
                         min(ages) if ages else None, max(ages) if ages else None))
    db.executemany(f"INSERT INTO families VALUES ({','.join('?' * 16)})", fam_rows)
    hh = defaultdict(list)
    for v in voters:
        if v["hh"]:
            hh[v["hh"]].append(v)
    db.executemany("INSERT INTO households VALUES (?,?,?,?,?,?,?,?,?)", [
        (hid, part, m[0]["sec"], m[0]["house"], m[0]["hkey"], len(m), len({x["fam"] for x in m}),
         sum(x["g"] == "M" for x in m), sum(x["g"] == "F" for x in m)) for hid, m in hh.items()])

    # station: locality from its name/address, else from its section names, else its police station
    last_bit = s["address"].split(",")[-1] if s["address"] else ""
    m = L.match(last_bit) or L.match(s["name"]) or L.match(s["address"])
    if not m:
        secs = Counter(mm[0] for mm in (L.match(x["sec_name"]) for x in voters) if mm)
        if secs:
            nm = secs.most_common(1)[0][0]
            m = next((n, ll) for n, _, ll in L.LOCALITIES if n == nm)
    police_en, police_ll = L.POLICE.get(s["police"], (s["police"], L.CENTRE))
    if not m and police_en in L.POLICE_LOCALITY:
        nm = L.POLICE_LOCALITY[police_en]
        m = next(((n, ll) for n, _, ll in L.LOCALITIES if n == nm), None)
    loc_name, ll = m if m else (police_en + " PS area", police_ll)
    k = loc_slots[loc_name]          # spread stations of one locality on a spiral so pins don't overlap
    loc_slots[loc_name] += 1
    ang, rad = k * 2.4, 0.0015 * math.sqrt(k)
    lat, lng, gsrc = ll[0] + rad * math.sin(ang), ll[1] + rad * math.cos(ang), "approximate"
    if part in exact:
        lat, lng, gsrc = exact[part]
    ages = [x["age"] for x in voters if x["age"]]
    bins = [sum(lo <= (x["age"] or -1) <= hi for x in voters) for lo, hi, _ in AGE_BINS]
    row = (part, s["name"], s["address"], loc_name, s["police"], police_en, s["pin"], s["post"],
           L.POST_OFFICES.get(s["post"], s["post"]), s["mandal"], L.MANDALS.get(s["mandal"], s["mandal"]),
           len(voters), sum(x["g"] == "M" for x in voters), sum(x["g"] == "F" for x in voters),
           sum(x["g"] == "T" for x in voters), round(sum(ages) / len(ages), 1) if ages else None,
           *bins, len(fam_members), len(hh_ids), len({x["sec"] for x in voters}), sum(x["review"] for x in voters),
           s["cover_total"], s["cover_men"], s["cover_women"], s["sections_cover"],
           round(lat, 6), round(lng, 6), gsrc, s["source"])
    db.execute(f"INSERT INTO stations VALUES ({','.join('?' * len(row))})", row)

    sec_rows = defaultdict(list)
    for v in voters:
        sec_rows[v["sec"]].append(v)
    out = []
    for sec, mem in sorted(sec_rows.items()):
        nm = Counter(x["sec_name"] for x in mem).most_common(1)[0][0]
        mm = L.match(nm)
        ages = [x["age"] for x in mem if x["age"]]
        out.append((part, sec, nm, section_place(nm), mm[0] if mm else loc_name, len(mem),
                    sum(x["g"] == "M" for x in mem), sum(x["g"] == "F" for x in mem),
                    round(sum(ages) / len(ages), 1) if ages else None,
                    len({x["hh"] for x in mem if x["hh"]}), len({x["fam"] for x in mem})))
    db.executemany("INSERT INTO sections VALUES (?,?,?,?,?,?,?,?,?,?,?)", out)
    tot["voters"] += len(voters); tot["families"] += len(fam_members)
    tot["households"] += len(hh_ids); tot["ghosts"] += len(ghosts)


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, "kkp_csv.zip"), help="zip file or folder of CSVs")
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "kphb.db"))
    ap.add_argument("--extract", action="store_true", help="also unzip the CSVs to data/raw")
    ap.add_argument("--geo", default=os.path.join(ROOT, "data", "station_geo.csv"),
                    help="optional exact station pins (from geocode_stations.py or the map page)")
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit(f"Source not found: {a.src}\nPut kkp_csv.zip in the project folder or pass --src")
    os.makedirs(os.path.dirname(a.db), exist_ok=True)
    t0 = time.time()

    # ---------- write SQLite as we go: one polling station (one CSV) at a time keeps memory low
    tmp = a.db + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript(open(os.path.join(HERE, "schema.sql"), encoding="utf-8").read())

    exact = {}
    if os.path.exists(a.geo):
        with open(a.geo, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                try:
                    exact[int(r["part_no"])] = (float(r["lat"]), float(r["lng"]), r.get("source") or "geocoded")
                except (KeyError, ValueError):
                    pass
        log(f"{len(exact)} exact station pins from {a.geo}")

    pending_station = {}
    ids = dict(voter=0, family=0, ghost=0, household=0)
    tot = Counter()
    how_count = Counter()
    loc_slots = Counter()
    stations = {}
    seen_keys = set()
    files = 0
    for name, fh in iter_csv_sources(a.src, os.path.join(ROOT, "data", "raw") if a.extract else None):
        files += 1
        by_part = defaultdict(list)
        for r in csv.DictReader(fh):
            rk = r.get("record_key") or ""
            if rk in seen_keys:
                continue
            seen_keys.add(rk)
            part = to_int(r.get("part_no"), 0)
            if part in stations:
                sys.exit(f"Polling station {part} appears in two CSV files ({name}). Merge them into one file and run again.")
            by_part[part].append(read_voter(r, part))
            if part not in stations and part not in pending_station:
                pending_station[part] = station_info(r)
        for part, rows in sorted(by_part.items()):
            stations[part] = pending_station.pop(part)
            process_part(db, part, rows, stations[part], ids, tot, how_count, loc_slots, exact)
        if files % 50 == 0:
            log(f"{files} files, {tot['voters']:,} voters so far")
    db.commit()
    log(f"read {tot['voters']:,} voters from {files} CSV files in {len(stations)} polling stations")
    log("links:", dict(how_count))
    log(f"{tot['families']:,} families, {tot['ghosts']:,} relatives not on the roll")

    # meta
    one = stations[min(stations)]
    meta = dict(
        ac_no=one["ac_no"], ac_name=one["ac_name"], ac_name_en="Kukatpally", pc_name=one["pc_name"],
        district=one["district"], publication=one["publication"], qualifying=one["qualifying"],
        files=files, voters=tot["voters"], stations=len(stations), families=tot["families"],
        households=tot["households"], ghosts=tot["ghosts"], built=time.strftime("%Y-%m-%d %H:%M"),
        centre=list(L.CENTRE), source=os.path.basename(a.src), links=dict(how_count),
    )
    db.executemany("INSERT INTO meta VALUES (?,?)", [(k, json.dumps(v, ensure_ascii=False)) for k, v in meta.items()])

    log("building search index")
    try:
        db.executescript(open(os.path.join(HERE, "fts.sql"), encoding="utf-8").read())
        db.executescript("""
            INSERT INTO voters_fts(rowid, name_key, rel_key, name, rel_name, epic, house_key)
              SELECT id, name_key, rel_key, name, rel_name, epic, house_key FROM voters;
            INSERT INTO voters_fts(voters_fts) VALUES('optimize');
        """)
        fts = True
    except sqlite3.OperationalError as e:
        # older SQLite without the trigram tokenizer: search still works, just slower
        log(f"fast search index not available on SQLite {sqlite3.sqlite_version} ({e}); using plain search")
        fts = False
    db.execute("INSERT INTO meta VALUES ('fts', ?)", (json.dumps(fts),))
    db.executescript(open(os.path.join(HERE, "indexes.sql"), encoding="utf-8").read())
    db.commit()
    db.execute("ANALYZE")
    db.commit()
    db.close()
    if os.path.exists(a.db):
        os.remove(a.db)
    os.replace(tmp, a.db)
    log(f"done in {time.time() - t0:.0f}s -> {a.db} ({os.path.getsize(a.db) / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
