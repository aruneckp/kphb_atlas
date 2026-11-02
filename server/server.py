#!/usr/bin/env python3
"""KPHB voter analytics - API + web server (Python standard library only).

    python3 server/server.py                 # http://127.0.0.1:8046
    python3 server/server.py --port 9000 --host 0.0.0.0

Optional login: set KPHB_USER and KPHB_PASS before starting.
"""
import argparse
import base64
import csv
import gzip
import io
import json
import mimetypes
import queue
import os
import re
import sqlite3
import sys
import threading
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import telugu  # noqa: E402

DB_PATH = os.environ.get("KPHB_DB", os.path.join(ROOT, "data", "kphb.db"))
DIST = os.path.join(ROOT, "web", "dist")
GEO_CSV = os.path.join(ROOT, "data", "station_geo.csv")
USER, PASS = os.environ.get("KPHB_USER"), os.environ.get("KPHB_PASS")

_local = threading.local()
_write_lock = threading.Lock()


# A small fixed pool of SQLite connections: memory stays flat however many requests arrive.
POOL_SIZE = int(os.environ.get("KPHB_DB_CONNECTIONS", "4"))
CACHE_MB = int(os.environ.get("KPHB_CACHE_MB", "32"))
MMAP_MB = int(os.environ.get("KPHB_MMAP_MB", "256"))
_pool = queue.Queue()
_pool_made = 0
_pool_lock = threading.Lock()


def _connect():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute(f"PRAGMA cache_size = -{CACHE_MB * 1000}")
    c.execute(f"PRAGMA mmap_size = {MMAP_MB * 1048576}")
    c.execute("PRAGMA temp_store = MEMORY")
    return c


def acquire():
    global _pool_made
    try:
        return _pool.get_nowait()
    except queue.Empty:
        with _pool_lock:
            if _pool_made < POOL_SIZE:
                _pool_made += 1
                return _connect()
        return _pool.get()


def db():
    c = getattr(_local, "db", None)
    if c is None:  # used outside a request (start-up warm-up)
        c = _local.db = acquire()
    return c


class pooled:
    """with pooled(): ... - lends this thread one connection for the length of a request."""
    def __enter__(self):
        self.had = getattr(_local, "db", None)
        if self.had is None:
            _local.db = acquire()

    def __exit__(self, *exc):
        if self.had is None:
            _pool.put(_local.db)
            _local.db = None


def rows(sql, args=()):
    return [dict(r) for r in db().execute(sql, args)]


def one(sql, args=()):
    r = db().execute(sql, args).fetchone()
    return dict(r) if r else None


# ------------------------------------------------------------------ filters
AGE_PYRAMID = [(18, 19)] + [(a, a + 4) for a in range(20, 85, 5)] + [(85, 200)]
STATION_FILTERS = {"locality": "locality", "police": "police_en", "mandal": "mandal_en", "pin": "pin"}


def ilist(v):
    return [int(x) for x in re.split(r"[,\s]+", v or "") if x.isdigit()]


def search_clause(q, field):
    """Turn the search box text into SQL. Returns (sql, args) or (None, None)."""
    q = (q or "").strip()
    if not q:
        return None, None
    parts = [p for p in re.split(r"[\s,;]+", q) if p]
    # station/serial: '258/45' or '258-45' with field 'sn'
    m = re.fullmatch(r"(\d{1,3})\s*[/:]\s*(\d{1,4})", q)
    if m and field in ("any", "sn"):
        return "(v.part_no = ? AND v.serial_no = ?)", [int(m[1]), int(m[2])]
    if field == "sn":
        rng = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", q)
        if rng:
            a, b = sorted((int(rng[1]), int(rng[2])))
            return "v.serial_no BETWEEN ? AND ?", [a, b]
        nums = [int(p) for p in parts if p.isdigit()]
        if nums:
            return f"v.serial_no IN ({','.join('?' * len(nums))})", nums
        return "0", []
    epics = [p.upper() for p in parts if re.fullmatch(r"[A-Za-z]{2,4}\d{3,}", p)]
    if field == "epic" or (field == "any" and epics and len(epics) == len(parts)):
        lst = epics or [p.upper() for p in parts]
        full = [e for e in lst if re.fullmatch(r"[A-Z]{3}\d{7}", e)]
        if len(full) == len(lst):
            return f"v.epic IN ({','.join('?' * len(full))})", full
        return "(" + " OR ".join("v.epic LIKE ?" for _ in lst) + ")", [f"%{e}%" for e in lst]
    if field == "house" or (field == "any" and re.search(r"\d", q) and not telugu.TELUGU.search(q) and
                             re.fullmatch(r"[\dA-Za-z/\-. ]+", q)):
        hk = re.sub(r"[^0-9A-Zఀ-౿]+", "-", q.upper()).strip("-")
        if not hk:
            return "0", []
        if field == "any" and hk.isdigit():
            return "(v.serial_no = ? OR v.house_key LIKE ?)", [int(hk), hk + "-%"]
        return "v.house_key LIKE ?", [f"%{hk}%"]
    # names: every word must appear (Telugu or English spelling, sound-alike)
    keys = [k for k in (telugu.key(p) for p in parts) if k]
    if not keys:
        return "0", []
    cols = {"name": "name_key", "rel": "rel_key"}.get(field, "{name_key rel_key}")
    long_k = [k for k in keys if len(k) >= 3] if HAS_FTS() else []
    short_k = [k for k in keys if k not in long_k]
    sql, args = [], []
    if long_k:
        match = " AND ".join(f'{cols} : "{k}"' for k in long_k)
        sql.append("v.id IN (SELECT rowid FROM voters_fts WHERE voters_fts MATCH ?)")
        args.append(match)
    for k in short_k:
        if field == "rel":
            sql.append("v.rel_key LIKE ?"); args.append(f"%{k}%")
        elif field == "name":
            sql.append("v.name_key LIKE ?"); args.append(f"%{k}%")
        else:
            sql.append("(v.name_key LIKE ? OR v.rel_key LIKE ?)"); args += [f"%{k}%", f"%{k}%"]
    return " AND ".join(sql), args


@lru_cache(maxsize=1)
def HAS_FTS():
    r = db().execute("SELECT value FROM meta WHERE key = 'fts'").fetchone()
    return bool(json.loads(r[0])) if r else True


def where(p):
    """Query-string filters -> (WHERE sql, args) over voters v."""
    w, a = [], []
    parts = ilist(p.get("part"))
    if parts:
        w.append(f"v.part_no IN ({','.join('?' * len(parts))})"); a += parts
    st = []
    for key, col in STATION_FILTERS.items():
        if p.get(key):
            st.append(f"{col} = ?"); a.append(p[key])
    if st:
        w.insert(len(w), f"v.part_no IN (SELECT part_no FROM stations WHERE {' AND '.join(st)})")
        # args already appended in order
    if p.get("sec") and parts:
        w.append("v.section_no = ?"); a.append(int(p["sec"]))
    g = p.get("gender")
    if g in ("M", "F", "T", "?"):
        w.append("v.gender = ?"); a.append(g)
    if (p.get("age_min") or "").isdigit():
        w.append("v.age >= ?"); a.append(int(p["age_min"]))
    if (p.get("age_max") or "").isdigit():
        w.append("v.age <= ?"); a.append(int(p["age_max"]))
    if p.get("rel"):
        w.append("v.rel_type = ?"); a.append(p["rel"])
    if p.get("review") == "1":
        w.append("v.needs_review = 1")
    if p.get("reason"):
        w.append("v.review_reason LIKE ?"); a.append(f"%{p['reason']}%")
    if p.get("dup") == "1":
        w.append("(v.epic_dup <> '' OR v.name_dup <> '')")
    if p.get("linked") == "1":
        w.append("v.link_to <> '' AND v.link_to NOT LIKE 'g%'")
    elif p.get("linked") == "0":
        w.append("(v.link_to = '' OR v.link_to LIKE 'g%')")
    for key, table in (("fam_size", "families"), ("hh_size", "households")):
        m = re.fullmatch(r"(\d+)(\+?)", p.get(key) or "")
        if m:
            op = ">=" if m[2] else "="
            col = "family_id" if key == "fam_size" else "household_id"
            w.append(f"v.{col} IN (SELECT id FROM {table} WHERE size {op} ?)"); a.append(int(m[1]))
    if (p.get("ocr") or "").isdigit():
        w.append("v.ocr_conf >= ? AND v.ocr_conf < ?"); a += [int(p["ocr"]), int(p["ocr"]) + 5]
    if p.get("deleted") == "1":
        w.append("v.status = 'Deleted'")
    if p.get("nohouse") == "1":
        w.append("(v.house = '' OR v.house IS NULL)")
    s, sa = search_clause(p.get("q"), p.get("field") or "any")
    if s:
        w.append(s); a += sa
    return (" WHERE " + " AND ".join(w)) if w else "", a


def fkey(p, drop=("page", "size", "sort", "dir")):
    return json.dumps({k: v for k, v in sorted(p.items()) if k not in drop}, ensure_ascii=False)


VOTER_COLS = ("v.id, v.part_no, v.serial_no, v.section_no, v.epic, v.name, v.name_en, v.rel_type, v.rel_name, "
              "v.rel_name_en, v.house, v.age, v.gender, v.needs_review, v.review_reason, v.family_id, v.household_id, "
              "v.link_how")


# ------------------------------------------------------------------ handlers
OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'


def tiles():
    """Background map. Default: OpenStreetMap (no key needed).
    KPHB_CARTO_KEY=<free key from carto.com/basemaps/apikey>  -> CARTO light/dark maps
    KPHB_TILE_URL=https://.../{z}/{x}/{y}.png                  -> any other tile server"""
    custom, carto = os.environ.get("KPHB_TILE_URL"), os.environ.get("KPHB_CARTO_KEY")
    if custom:
        return dict(url=custom, dark=custom, attribution=os.environ.get("KPHB_TILE_ATTRIBUTION", OSM_ATTR), invert_dark=False)
    if carto:
        base = "https://basemaps.cartocdn.com/rastertiles/{style}/{{z}}/{{x}}/{{y}}{{r}}.png?key=" + carto
        return dict(url=base.format(style="light_all"), dark=base.format(style="dark_all"),
                    attribution=OSM_ATTR + ', &copy; <a href="https://carto.com/attributions">CARTO</a>', invert_dark=False)
    osm = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    return dict(url=osm, dark=osm, attribution=OSM_ATTR, invert_dark=True)


@lru_cache(maxsize=1)
def meta():
    m = {r["key"]: json.loads(r["value"]) for r in db().execute("SELECT key, value FROM meta")}
    m["stations"] = rows("SELECT part_no, name, locality, police_en, mandal_en, pin, voters FROM stations ORDER BY part_no")
    m["localities"] = [r["locality"] for r in db().execute("SELECT DISTINCT locality FROM stations ORDER BY locality")]
    m["police"] = [r["police_en"] for r in db().execute("SELECT DISTINCT police_en FROM stations ORDER BY 1")]
    m["mandals"] = [r["mandal_en"] for r in db().execute("SELECT DISTINCT mandal_en FROM stations ORDER BY 1")]
    m["pins"] = [r["pin"] for r in db().execute("SELECT DISTINCT pin FROM stations ORDER BY 1")]
    m["reasons"] = [r["r"] for r in db().execute(
        "SELECT review_reason r, count(*) n FROM voters WHERE review_reason <> '' GROUP BY 1 ORDER BY n DESC")]
    m["auth"] = bool(USER)
    m["tiles"] = tiles()
    return m


_summary_cache = {}


def summary(p):
    k = fkey(p)
    if k in _summary_cache:
        return _summary_cache[k]
    w, a = where(p)
    base = f"FROM voters v{w}"
    tot = one(f"""SELECT count(*) voters, sum(gender='M') male, sum(gender='F') female, sum(gender='T') third,
        round(avg(age),1) avg_age, sum(age BETWEEN 18 AND 19) first_time, sum(age >= 60) senior, sum(age >= 80) over80,
        sum(age BETWEEN 18 AND 29) youth, sum(needs_review) review,
        count(DISTINCT family_id) families, count(DISTINCT nullif(household_id,0)) households,
        sum(link_to <> '' AND link_to NOT LIKE 'g%') linked, count(DISTINCT part_no) stations {base}""", a)
    case = " ".join(f"WHEN age BETWEEN {lo} AND {hi} THEN '{lo}-{hi}'" if hi < 200 else f"WHEN age >= {lo} THEN '{lo}+'"
                    for lo, hi in AGE_PYRAMID)
    pyr = rows(f"SELECT CASE {case} ELSE 'unknown' END band, sum(gender='M') male, sum(gender='F') female, "
               f"sum(gender NOT IN ('M','F')) other {base} GROUP BY band", a)
    order = [f"{lo}-{hi}" if hi < 200 else f"{lo}+" for lo, hi in AGE_PYRAMID]
    pyr.sort(key=lambda r: order.index(r["band"]) if r["band"] in order else 99)
    rel = rows(f"SELECT coalesce(nullif(rel_type,''),'Not read') rel, count(*) n {base} GROUP BY 1 ORDER BY n DESC", a)
    fam = rows(f"SELECT min(n,10) size, count(*) families FROM (SELECT count(*) n {base} GROUP BY family_id) GROUP BY 1", a)
    hh = rows(f"SELECT min(n,15) size, count(*) households FROM (SELECT count(*) n {base}"
              f"{' AND' if w else ' WHERE'} household_id > 0 GROUP BY household_id) GROUP BY 1", a)
    out = dict(totals=tot, pyramid=pyr, relations=rel, family_sizes=fam, household_sizes=hh)
    if len(_summary_cache) > 500:
        _summary_cache.clear()
    _summary_cache[k] = out
    return out


SORTS = {"part": "v.part_no, v.serial_no", "name": "v.name_en", "age": "v.age", "house": "v.house_key",
         "family": "v.family_id, v.gen"}


def voters(p):
    w, a = where(p)
    page, size = max(int(p.get("page") or 1), 1), min(max(int(p.get("size") or 50), 1), 500)
    sort = SORTS.get(p.get("sort"), SORTS["part"])
    d = "DESC" if p.get("dir") == "desc" else "ASC"
    order = ", ".join(f"{c.strip()} {d}" for c in sort.split(","))
    total = one(f"SELECT count(*) n FROM voters v{w}", a)["n"]
    data = rows(f"SELECT {VOTER_COLS}, s.locality FROM voters v JOIN stations s ON s.part_no = v.part_no{w} "
                f"ORDER BY {order} LIMIT ? OFFSET ?", a + [size, (page - 1) * size])
    return dict(total=total, page=page, size=size, rows=data)


def family_payload(fid):
    fam = one("SELECT * FROM families WHERE id = ?", (fid,))
    if not fam:
        return None
    mem = rows("SELECT v.id, v.part_no, v.serial_no, v.epic, v.name, v.name_en, v.rel_type, v.rel_name, v.rel_name_en, "
               "v.house, v.age, v.gender, v.gen, v.link_to, v.link_how, v.household_id FROM voters v "
               "WHERE family_id = ? ORDER BY gen, age DESC", (fid,))
    gh = rows("SELECT id, name, name_en, gender FROM ghosts WHERE family_id = ?", (fid,))
    fam["station"] = one("SELECT part_no, name, locality FROM stations WHERE part_no = ?", (fam["part_no"],))
    return dict(family=fam, members=mem, ghosts=gh)


def voter(vid):
    v = one("SELECT v.*, s.name station_name, s.address station_address, s.locality, s.police_en, s.mandal_en, s.pin "
            "FROM voters v JOIN stations s ON s.part_no = v.part_no WHERE v.id = ?", (vid,))
    if not v:
        return None
    for k in ("name_key", "rel_key"):
        v.pop(k, None)
    v["section_name"] = (one("SELECT name FROM sections WHERE part_no=? AND section_no=?",
                             (v["part_no"], v["section_no"])) or {}).get("name")
    v["linked"] = None
    if v["link_to"]:
        if v["link_to"].startswith("g"):
            v["linked"] = one("SELECT id, name, name_en, gender, 1 ghost FROM ghosts WHERE id = ?", (v["link_to"],))
        else:
            v["linked"] = one(f"SELECT {VOTER_COLS} FROM voters v WHERE id = ?", (int(v["link_to"]),))
    v["household"] = rows(f"SELECT {VOTER_COLS} FROM voters v WHERE household_id = ? AND household_id > 0 "
                          "ORDER BY serial_no", (v["household_id"],)) if v["household_id"] else []
    v["family"] = family_payload(v["family_id"])
    return v


def families(p):
    w, a = [], []
    parts = ilist(p.get("part"))
    if parts:
        w.append(f"f.part_no IN ({','.join('?' * len(parts))})"); a += parts
    for key, col in STATION_FILTERS.items():
        if p.get(key):
            w.append(f"s.{col} = ?"); a.append(p[key])
    if (p.get("min_size") or "").isdigit():
        w.append("f.size >= ?"); a.append(int(p["min_size"]))
    if (p.get("gens") or "").isdigit():
        w.append("f.gens >= ?"); a.append(int(p["gens"]))
    if p.get("q"):
        k = telugu.key(p["q"])
        if k:
            w.append("f.id IN (SELECT family_id FROM voters WHERE id IN (SELECT rowid FROM voters_fts WHERE voters_fts MATCH ?))"
                     if len(k) >= 3 and HAS_FTS() else "f.id IN (SELECT family_id FROM voters WHERE name_key LIKE ?)")
            a.append(f'{{name_key rel_key}} : "{k}"' if len(k) >= 3 and HAS_FTS() else f"%{k}%")
    ws = (" WHERE " + " AND ".join(w)) if w else ""
    sort = {"size": "f.size DESC, f.gens DESC", "gens": "f.gens DESC, f.size DESC", "part": "f.part_no, f.size DESC",
            "age": "f.max_age DESC"}.get(p.get("sort"), "f.size DESC, f.gens DESC")
    page, size = max(int(p.get("page") or 1), 1), min(int(p.get("size") or 50), 200)
    total = one(f"SELECT count(*) n FROM families f JOIN stations s ON s.part_no = f.part_no{ws}", a)["n"]
    data = rows(f"SELECT f.*, s.locality, s.name station_name FROM families f JOIN stations s ON s.part_no = f.part_no"
                f"{ws} ORDER BY {sort} LIMIT ? OFFSET ?", a + [size, (page - 1) * size])
    return dict(total=total, page=page, size=size, rows=data)


def households(p):
    w, a = [], []
    parts = ilist(p.get("part"))
    if parts:
        w.append(f"h.part_no IN ({','.join('?' * len(parts))})"); a += parts
    for key, col in STATION_FILTERS.items():
        if p.get(key):
            w.append(f"s.{col} = ?"); a.append(p[key])
    if (p.get("min_size") or "").isdigit():
        w.append("h.size >= ?"); a.append(int(p["min_size"]))
    if p.get("q"):
        hk = re.sub(r"[^0-9A-Zఀ-౿]+", "-", p["q"].upper()).strip("-")
        w.append("h.house_key LIKE ?"); a.append(f"%{hk}%")
    ws = (" WHERE " + " AND ".join(w)) if w else ""
    page, size = max(int(p.get("page") or 1), 1), min(int(p.get("size") or 50), 200)
    total = one(f"SELECT count(*) n FROM households h JOIN stations s ON s.part_no = h.part_no{ws}", a)["n"]
    data = rows(f"SELECT h.*, s.locality FROM households h JOIN stations s ON s.part_no = h.part_no{ws} "
                f"ORDER BY h.size DESC, h.part_no LIMIT ? OFFSET ?", a + [size, (page - 1) * size])
    return dict(total=total, page=page, size=size, rows=data)


def household(hid):
    h = one("SELECT h.*, s.locality, s.name station_name FROM households h JOIN stations s ON s.part_no=h.part_no "
            "WHERE h.id = ?", (hid,))
    if not h:
        return None
    h["members"] = rows(f"SELECT {VOTER_COLS} FROM voters v WHERE household_id = ? ORDER BY family_id, age DESC", (hid,))
    return h


def stations(p):
    w, a = [], []
    for key, col in STATION_FILTERS.items():
        if p.get(key):
            w.append(f"{col} = ?"); a.append(p[key])
    ws = (" WHERE " + " AND ".join(w)) if w else ""
    return rows(f"SELECT * FROM stations{ws} ORDER BY part_no", a)


def station(part):
    s = one("SELECT * FROM stations WHERE part_no = ?", (part,))
    if not s:
        return None
    s["sections_list"] = rows("SELECT * FROM sections WHERE part_no = ? ORDER BY section_no", (part,))
    s["top_families"] = rows("SELECT * FROM families WHERE part_no = ? ORDER BY size DESC, gens DESC LIMIT 12", (part,))
    s["top_households"] = rows("SELECT * FROM households WHERE part_no = ? ORDER BY size DESC LIMIT 12", (part,))
    s["neighbours"] = rows("SELECT part_no, name, voters FROM stations WHERE part_no IN (?,?) ORDER BY part_no",
                           (part - 1, part + 1))
    return s


AREA_LEVELS = {"locality": "locality", "police": "police_en", "mandal": "mandal_en", "pin": "pin"}


def areas(p):
    level = p.get("level") or "locality"
    if level == "section":
        w, a = [], []
        parts = ilist(p.get("part"))
        if parts:
            w.append(f"x.part_no IN ({','.join('?' * len(parts))})"); a += parts
        if p.get("locality"):
            w.append("x.locality = ?"); a.append(p["locality"])
        ws = (" WHERE " + " AND ".join(w)) if w else ""
        return rows(f"SELECT x.*, x.part_no || '-' || x.section_no area FROM sections x{ws} ORDER BY x.voters DESC LIMIT 2000", a)
    col = AREA_LEVELS.get(level, "locality")
    w, a = [], []
    for key, c in STATION_FILTERS.items():
        if p.get(key) and key != level:
            w.append(f"{c} = ?"); a.append(p[key])
    ws = (" WHERE " + " AND ".join(w)) if w else ""
    return rows(f"""SELECT {col} area, count(*) stations, sum(voters) voters, sum(male) male, sum(female) female,
        sum(third) third, round(sum(avg_age*voters)/sum(voters),1) avg_age, sum(a18_19) first_time,
        sum(a18_19+a20_29) youth, sum(a60_69+a70_79+a80p) senior, sum(a80p) over80, sum(families) families,
        sum(households) households, sum(review) review, sum(sections) sections,
        avg(lat) lat, avg(lng) lng, group_concat(part_no) parts
        FROM stations{ws} GROUP BY {col} ORDER BY voters DESC""", a)


_breakdown_cache = {}


def breakdown(p):
    """Where a slice of voters lives: counts per polling station and per section (street)."""
    k = fkey(p)
    if k in _breakdown_cache:
        return _breakdown_cache[k]
    w, a = where(p)
    out = dict(
        stations=rows(f"SELECT v.part_no, count(*) n, sum(gender='M') male, sum(gender='F') female, "
                      f"round(avg(age),1) avg_age FROM voters v{w} GROUP BY v.part_no", a),
        sections=rows(f"SELECT v.part_no, v.section_no, count(*) n, sum(gender='M') male, sum(gender='F') female "
                      f"FROM voters v{w} GROUP BY v.part_no, v.section_no", a),
    )
    if len(_breakdown_cache) > 300:
        _breakdown_cache.clear()
    _breakdown_cache[k] = out
    return out


@lru_cache(maxsize=1)
def sections_all():
    return rows("SELECT part_no, section_no, name, place, locality, voters FROM sections ORDER BY part_no, section_no")


_quality_cache = {}


def quality(p):
    k = fkey(p)
    if k not in _quality_cache:
        if len(_quality_cache) > 200:
            _quality_cache.clear()
        _quality_cache[k] = _quality(p)
    return _quality_cache[k]


def _quality(p):
    w, a = where(p)
    base = f"FROM voters v{w}"
    and_ = " AND" if w else " WHERE"
    return dict(
        reasons=rows(f"SELECT review_reason reason, count(*) n {base}{and_} review_reason <> '' GROUP BY 1 ORDER BY n DESC", a),
        ocr=rows(f"SELECT CAST(ocr_conf/5 AS INT)*5 band, count(*) n {base}{and_} ocr_conf IS NOT NULL GROUP BY 1 ORDER BY 1", a),
        epic_dups=one(f"SELECT count(*) n {base}{and_} epic_dup <> ''", a)["n"],
        name_dups=one(f"SELECT count(*) n {base}{and_} name_dup <> ''", a)["n"],
        deleted=one(f"SELECT count(*) n {base}{and_} status = 'Deleted'", a)["n"],
        no_house=one(f"SELECT count(*) n {base}{and_} (house = '' OR house IS NULL)", a)["n"],
        no_age=one(f"SELECT count(*) n {base}{and_} age IS NULL", a)["n"],
        cover=rows("SELECT part_no, name, locality, voters, cover_total, voters - cover_total diff, review FROM stations "
                   "WHERE cover_total IS NOT NULL AND voters <> cover_total ORDER BY abs(voters - cover_total) DESC"),
        worst=rows("SELECT part_no, name, locality, voters, review, round(100.0*review/voters,1) pct FROM stations "
                   "ORDER BY pct DESC LIMIT 15"),
    )


def export_csv(p):
    w, a = where(p)
    cur = db().execute(
        "SELECT v.part_no, v.serial_no, v.section_no, v.epic, v.name, v.name_en, v.rel_type, v.rel_name, v.rel_name_en, "
        "v.house, v.age, v.gender, s.locality, s.name station, v.family_id, v.household_id, v.needs_review, v.review_reason "
        f"FROM voters v JOIN stations s ON s.part_no = v.part_no{w} ORDER BY v.part_no, v.serial_no LIMIT 400000", a)
    buf = io.StringIO()
    buf.write("﻿")
    wr = csv.writer(buf)
    wr.writerow([d[0] for d in cur.description])
    wr.writerows(cur)
    return buf.getvalue().encode("utf-8")


def save_pin(part, body):
    lat, lng = float(body["lat"]), float(body["lng"])
    if not (17.0 < lat < 18.0 and 78.0 < lng < 79.0):
        raise ValueError("pin is outside Hyderabad")
    with _write_lock:
        c = db()
        c.execute("UPDATE stations SET lat=?, lng=?, geo_source='saved' WHERE part_no=?", (lat, lng, part))
        c.execute("INSERT OR REPLACE INTO station_pins VALUES (?,?,?,?)", (part, lat, lng, time.strftime("%F %T")))
        c.commit()
        # keep the pin across database rebuilds
        pins = {}
        if os.path.exists(GEO_CSV):
            with open(GEO_CSV, encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    pins[r["part_no"]] = r
        pins[str(part)] = {"part_no": str(part), "lat": f"{lat:.6f}", "lng": f"{lng:.6f}", "source": "saved"}
        with open(GEO_CSV, "w", encoding="utf-8", newline="") as fh:
            wr = csv.DictWriter(fh, fieldnames=["part_no", "lat", "lng", "source"], extrasaction="ignore")
            wr.writeheader()
            for k in sorted(pins, key=int):
                wr.writerow(pins[k])
    return dict(ok=True, part_no=part, lat=lat, lng=lng)


# ------------------------------------------------------------------ HTTP
ROUTES = [
    (r"/api/meta", lambda m, p: meta()),
    (r"/api/summary", lambda m, p: summary(p)),
    (r"/api/voters", lambda m, p: voters(p)),
    (r"/api/voter/(\d+)", lambda m, p: voter(int(m[1]))),
    (r"/api/families", lambda m, p: families(p)),
    (r"/api/family/(\d+)", lambda m, p: family_payload(int(m[1]))),
    (r"/api/households", lambda m, p: households(p)),
    (r"/api/household/(\d+)", lambda m, p: household(int(m[1]))),
    (r"/api/stations", lambda m, p: stations(p)),
    (r"/api/station/(\d+)", lambda m, p: station(int(m[1]))),
    (r"/api/areas", lambda m, p: areas(p)),
    (r"/api/quality", lambda m, p: quality(p)),
    (r"/api/breakdown", lambda m, p: breakdown(p)),
    (r"/api/sections", lambda m, p: sections_all()),
]


class Handler(BaseHTTPRequestHandler):
    server_version = "KPHB/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("KPHB_LOG"):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _auth_ok(self):
        if not USER:
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                u, _, pw = base64.b64decode(h[6:]).decode().partition(":")
                return u == USER and pw == PASS
            except Exception:
                return False
        return False

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store", extra=None):
        if isinstance(body, (dict, list)) or body is None:
            body = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", "") and not ctype.startswith("image/"):
            body = gzip.compress(body, 5)
            enc = True
        else:
            enc = False
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if enc:
            self.send_header("Content-Encoding", "gzip")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="KPHB voters"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        with pooled():
            return self._get()

    def _get(self):
        u = urlparse(self.path)
        if u.path == "/healthz":  # for Render's health check; reveals nothing
            return self._send(200, {"ok": True})
        if not self._auth_ok():
            return self._deny()
        p = {k: v[-1] for k, v in parse_qs(u.query).items()}
        t = time.time()
        try:
            if u.path == "/api/export.csv":
                return self._send(200, export_csv(p), "text/csv; charset=utf-8",
                                  extra={"Content-Disposition": 'attachment; filename="kphb_voters.csv"'})
            for pat, fn in ROUTES:
                m = re.fullmatch(pat, u.path)
                if m:
                    out = fn(m, p)
                    if out is None:
                        return self._send(404, {"error": "Not found"})
                    return self._send(200, out, extra={"X-Time-ms": str(int((time.time() - t) * 1000))})
            if u.path.startswith("/api/"):
                return self._send(404, {"error": "Unknown API path"})
            return self._static(u.path)
        except sqlite3.OperationalError as e:
            return self._send(400, {"error": f"Search could not run: {e}"})
        except Exception as e:  # keep the server alive whatever happens
            import traceback
            traceback.print_exc()
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        with pooled():
            return self._post()

    def _post(self):
        if not self._auth_ok():
            return self._deny()
        u = urlparse(self.path)
        m = re.fullmatch(r"/api/station/(\d+)/pin", u.path)
        if not m:
            return self._send(404, {"error": "Unknown API path"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            out = save_pin(int(m[1]), body)
            meta.cache_clear()
            return self._send(200, out)
        except (ValueError, KeyError) as e:
            return self._send(400, {"error": str(e)})

    def _static(self, path):
        if not os.path.isdir(DIST):
            return self._send(200, b"<h1>Web app not built</h1><p>Run <code>cd web && npm install && npm run build</code>.</p>",
                              "text/html; charset=utf-8")
        rel = os.path.normpath(path.lstrip("/")) if path != "/" else "index.html"
        full = os.path.join(DIST, rel)
        if rel.startswith("..") or not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache = "public, max-age=31536000, immutable" if "/assets/" in full else "no-cache"
        with open(full, "rb") as fh:
            return self._send(200, fh.read(), ctype, cache)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("KPHB_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT") or os.environ.get("KPHB_PORT") or "8046"))
    a = ap.parse_args()
    if a.host not in ("127.0.0.1", "localhost", "::1") and not (USER and PASS) and os.environ.get("KPHB_ALLOW_PUBLIC") != "1":
        sys.exit("Refusing to put voter data on the network without a login.\n"
                 "Set KPHB_USER and KPHB_PASS (on Render: Environment tab), then start again.")
    if not os.path.exists(DB_PATH):
        sys.exit(f"Database not found at {DB_PATH}\nRun: python3 scripts/build_db.py")
    mimetypes.add_type("application/javascript", ".js")
    t = time.time()
    with pooled():
        meta(); summary({}); breakdown({}); sections_all()  # warm the cache for the first page
    print(f"KPHB voter app ready in {time.time() - t:.1f}s -> http://{a.host}:{a.port}"
          + ("  (login required)" if USER else ""), flush=True)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
