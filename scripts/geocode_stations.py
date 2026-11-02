#!/usr/bin/env python3
"""Find map positions for polling stations with OpenStreetMap's free geocoder (Nominatim).

    python3 scripts/geocode_stations.py            # needs internet, ~1 station per second
    python3 scripts/geocode_stations.py --limit 20 # try a few first

Results go to data/station_geo.csv (part_no,lat,lng,source) and straight into
data/kphb.db, so the Map page uses them at once and rebuilds keep them.
Pins you saved on the Map page are never overwritten. Stations the geocoder
cannot find keep their approximate locality position - drag those on the map.
"""
import argparse
import csv
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import telugu  # noqa: E402

BOX = (17.42, 17.53, 78.36, 78.52)  # lat_min, lat_max, lng_min, lng_max around Kukatpally
URL = "https://nominatim.openstreetmap.org/search"
UA = "kphb-voter-atlas/1.0 (local research script)"


def lookup(q):
    url = URL + "?" + urllib.parse.urlencode({
        "q": q, "format": "jsonv2", "limit": 3, "countrycodes": "in",
        "viewbox": f"{BOX[2]},{BOX[1]},{BOX[3]},{BOX[0]}", "bounded": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "te,en"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "kphb.db"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "station_geo.csv"))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    db = sqlite3.connect(a.db)
    db.row_factory = sqlite3.Row
    pins = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as fh:
            pins = {r["part_no"]: r for r in csv.DictReader(fh)}
    todo = [r for r in db.execute("SELECT part_no, name, address, locality, pin FROM stations ORDER BY part_no")
            if str(r["part_no"]) not in pins]
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(todo)} stations to look up ({len(pins)} already placed)")
    found = 0
    for i, s in enumerate(todo, 1):
        building = (s["address"] or s["name"] or "").split(",")[0]
        tries = [
            f"{s['address']}, హైదరాబాద్",
            f"{telugu.readable(building)}, {s['locality']}, Hyderabad {s['pin']}",
            f"{telugu.readable(s['address'])}, Hyderabad",
        ]
        hit = None
        for q in tries:
            try:
                res = lookup(q)
            except Exception as e:  # network trouble: stop politely, keep what we have
                print("lookup failed:", e)
                res = []
            time.sleep(1.1)  # Nominatim allows one request per second
            for r in res:
                lat, lng = float(r["lat"]), float(r["lon"])
                if BOX[0] <= lat <= BOX[1] and BOX[2] <= lng <= BOX[3] and r.get("addresstype") not in ("city", "state", "county", "suburb"):
                    hit = (lat, lng, r.get("display_name", "")[:80])
                    break
            if hit:
                break
        if hit:
            found += 1
            pins[str(s["part_no"])] = {"part_no": str(s["part_no"]), "lat": f"{hit[0]:.6f}", "lng": f"{hit[1]:.6f}", "source": "geocoded"}
            db.execute("UPDATE stations SET lat=?, lng=?, geo_source='geocoded' WHERE part_no=?", (hit[0], hit[1], s["part_no"]))
            db.commit()
        print(f"[{i}/{len(todo)}] PS {s['part_no']}: {'found ' + hit[2] if hit else 'not found - keeps locality position'}")
        with open(a.out, "w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["part_no", "lat", "lng", "source"], extrasaction="ignore")
            w.writeheader()
            for k in sorted(pins, key=int):
                w.writerow(pins[k])
    print(f"done: {found} of {len(todo)} placed. Restart the server to clear its cache.")


if __name__ == "__main__":
    main()
