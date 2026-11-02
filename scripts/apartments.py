"""Find apartments / gated communities named in the roll's house numbers and section names.

    detect(house, section) -> (key, display name, kind) or None

The roll often writes the building after the flat number: 'ఫ్లాట్ 105, వృషభద్రి టవర్స్',
'804, ఓ బ్లాక్, రైన్బో విస్టా', '1307 RAINBOWVISTAS'. Telugu and English spellings of the same
name reduce to one sound key (telugu.key), so they group together.
"""
import re
import telugu

# well-known communities: spellings seen in the roll -> display name (checked first, in house no. and section name)
KNOWN = [
    ("Rainbow Vistas", ["రైన్బో", "rainbow"]),
    ("Malaysian Township", ["మలేషియా", "malaysian"]),
    ("SS Grandure", ["grandure", "గ్రాండ్యూర్"]),
    ("Indu Fortune Fields", ["ఇందు ఫార్చ్యూన్", "indu fortune", "fortune fields"]),
    ("Lodha Bellezza", ["లోధా", "lodha", "bellezza"]),
    ("Manjeera Majestic", ["మంజీర", "manjeera"]),
    ("Marina Skies", ["మరీనా", "marina skies", "marinaskies"]),
    ("HAL Township", ["హెచ్ఏఎల్ టౌన్", "haltownship", "hal township"]),
    ("RBI Quarters", ["rbi quarters", "ఆర్బీఐ"]),
    ("KPHB MIG Flats", ["mig flats"]),
]

KINDS = [
    ("Apartments", r"అపార్ట\S*|అపార్టమె\S*|అపార్ట్మెం\S*|ఆపార్ట\S*|apartments?|aprts?|apts?"),
    ("Towers", r"టవర్స్?|టవర్|towers?"),
    ("Enclave", r"ఎన్క్లేవ్|ఎన్‌క్లేవ్|enclave"),
    ("Residency", r"రెసిడెన్\S*|residen\S*"),
    ("Heights", r"హైట్స్?|heights?"),
    ("Nest", r"నెస్ట్|nest"),
    ("Avenue", r"అవెన్యూ|avenue"),
    ("Complex", r"కాంప్లెక్స్?|complex"),
    ("Homes", r"హోమ్స్?|homes"),
    ("Vistas", r"విస్టా\S*|vistas?"),
    ("Estate", r"ఎస్టేట్|estate"),
    ("Gardens", r"గార్డెన్స్?|gardens?"),
    ("Residences", r"రెసిడెన్సెస్|residences"),
]
KIND_RE = re.compile(r"(" + "|".join(p for _, p in KINDS) + r")", re.I)
STOP = {"flat", "no", "plot", "block", "h", "d", "nam", "nm", "ఫ్లాట్", "నం", "ప్లాట్", "బ్లాక్", "నెం", "హెచ్", "ఏచ్", "శ్రీ", "శ్రి", "sri", "sree"}


def _name_before(text, m):
    """Up to 3 words right before the building word, skipping numbers and flat/plot words."""
    head = re.split(r"[,;:()/]", text[:m.start()])[-1]
    words = [w for w in re.split(r"[\s.\-]+", head) if w]
    out = []
    for w in reversed(words):
        if re.search(r"\d", w) or w.lower() in STOP:
            if out:
                break
            continue
        out.insert(0, w)
        if len(out) == 3:
            break
    return out


def detect(house, section=""):
    hs = f"{house or ''}"
    low = (hs + " | " + (section or "")).lower()
    for name, pats in KNOWN:
        if any(p.lower() in low for p in pats):
            return telugu.key(name), name, "Community"
    m = KIND_RE.search(hs)
    if not m:
        return None
    words = _name_before(hs, m)
    if not words:
        return None
    kind = next(k for k, p in KINDS if re.fullmatch(p, m.group(0), re.I))
    base = " ".join(words)
    k = telugu.key(base)
    if len(k) < 3:
        return None
    display = (telugu.readable(base) if telugu.TELUGU.search(base) else base.title()) + " " + kind
    return k + ":" + kind.lower(), display, kind


FLAT = re.compile(r"^(?:[A-Z]{1,2})?([1-9]\d{2,3})[A-Z]?$|^G\d{1,2}$|^[A-Z]{1,2}\d{3,4}$")


def split_flat(house_key):
    """'8-5-80-502' -> ('8-5-80', '502'): a door number whose last part is a flat number.
    Needs at least 4 parts, so ordinary plot numbers like '12-4-185' are not mistaken for flats."""
    t = [x for x in (house_key or "").split("-") if x]
    if len(t) < 4:
        return None
    m = FLAT.match(t[-1])
    if not m:
        return None
    if m.group(1):
        n = int(m.group(1))
        if not (101 <= n <= 3999 and n % 100 <= 40):   # floor 1-39, flat 00-40
            return None
    return "-".join(t[:-1]), t[-1]


def build(db, min_voters=25, min_flats=8):
    """Group voters into apartments; adds voters.apt_id and an apartments table. Returns the count."""
    import json
    from collections import Counter, defaultdict
    sec = {(p, s): n for p, s, n in db.execute("SELECT part_no, section_no, name FROM sections")}
    loc = {p: l for p, l in db.execute("SELECT part_no, locality FROM stations")}
    rows = db.execute("SELECT id, part_no, section_no, house, house_key, gender, age FROM voters").fetchall()
    named, door = {}, {}
    ng, bg = defaultdict(set), defaultdict(lambda: {"ids": set(), "flats": set(), "names": Counter()})
    for vid, p, s, h, hk, g, a in rows:
        d = detect(h, sec.get((p, s), ""))
        if d:
            key = d[0] if d[2] == "Community" else f"{d[0]}@{loc.get(p, '')}"
            named[vid] = (key, d[1], d[2])
            ng[key].add(vid)
        b = split_flat(hk)
        if b:
            door[vid] = b[0]
            o = bg[b[0]]
            o["ids"].add(vid); o["flats"].add(b[1])
            if d:
                o["names"][(named[vid][0], d[1], d[2])] += 1
    groups = {}  # key -> {name, kind, door, ids}
    for key, ids in ng.items():
        first = next(iter(ids))
        groups[key] = {"name": named[first][1], "kind": named[first][2], "door": "", "ids": set(ids), "names": Counter()}
    for bkey, o in bg.items():
        if len(o["flats"]) < min_flats:
            continue
        top = o["names"].most_common(1)
        if top and top[0][1] >= max(3, 0.2 * len(o["ids"])):
            groups[top[0][0][0]]["ids"] |= o["ids"]           # a named building: its unnamed flats join the name
            groups[top[0][0][0]]["door"] = groups[top[0][0][0]]["door"] or bkey
        else:
            groups["door:" + bkey] = {"name": f"Apartment block {bkey}", "kind": "Apartment block", "door": bkey, "ids": set(o["ids"])}
    # one apartment per voter: the largest group that holds them
    owner = {}
    for key, gr in sorted(groups.items(), key=lambda kv: -len(kv[1]["ids"])):
        for vid in gr["ids"]:
            owner.setdefault(vid, key)
    final = defaultdict(list)
    for vid, key in owner.items():
        final[key].append(vid)
    info = {vid: (p, g, a, hk) for vid, p, s, h, hk, g, a in rows}
    # names you know for unnamed blocks: scripts/apartment_names.csv  (door,name)
    import csv, os
    known_names = {}
    names_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apartment_names.csv")
    if os.path.exists(names_file):
        with open(names_file, encoding="utf-8") as fh:
            for r in csv.DictReader(line for line in fh if not line.startswith("#")):
                if (r.get("door") or "").strip() and (r.get("name") or "").strip():
                    known_names[r["door"].strip().upper()] = r["name"].strip()
    out, assign = [], {}
    for key, ids in sorted(final.items(), key=lambda kv: -len(kv[1])):
        if len(ids) < min_voters:
            continue
        aid = len(out) + 1
        parts = Counter(info[v][0] for v in ids)
        ages = [info[v][2] for v in ids if info[v][2]]
        main = parts.most_common(1)[0][0]
        gr = groups[key]
        if gr["door"] and gr["door"].upper() in known_names:
            gr = {**gr, "name": known_names[gr["door"].upper()], "kind": "Apartments"}
        out.append((aid, gr["name"], gr["kind"], loc.get(main, ""), main,
                    json.dumps(dict(parts.most_common())), len(ids), len({info[v][3] for v in ids}),
                    sum(info[v][1] == "M" for v in ids), sum(info[v][1] == "F" for v in ids),
                    round(sum(ages) / len(ages), 1) if ages else None, gr["door"]))
        for v in ids:
            assign[v] = aid
    db.executescript("""
        DROP TABLE IF EXISTS apartments;
        CREATE TABLE apartments (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, locality TEXT, part_no INTEGER,
          parts TEXT, voters INTEGER, doors INTEGER, male INTEGER, female INTEGER, avg_age REAL, door TEXT);
    """)
    db.executemany("INSERT INTO apartments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", out)
    cols = [r[1] for r in db.execute("PRAGMA table_info(voters)")]
    if "apt_id" not in cols:
        db.execute("ALTER TABLE voters ADD COLUMN apt_id INTEGER DEFAULT 0")
    db.execute("UPDATE voters SET apt_id = 0")
    db.executemany("UPDATE voters SET apt_id = ? WHERE id = ?", [(a, v) for v, a in assign.items()])
    db.execute("CREATE INDEX IF NOT EXISTS ix_v_apt ON voters(apt_id)")
    return len(out), len(assign)
