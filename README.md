# Kukatpally voter atlas (AC 46)

A **plain React app** (static files, no server) over all **3,23,194 voters in 417 polling stations**
from `kkp_csv.zip` (2026 SIR draft roll, Kukatpally assembly constituency). Data preparation runs on
your computer with free tools - no cloud services and no AI tokens.

```
kkp_csv.zip ─► scripts/build_db.py ─► data/kphb.db ─► scripts/export_static.py ─► npm run pack ─► web/public/data/*.bin
              (clean, families,        (SQLite)        (compact columns)          (gzip + AES-256
               households, areas)                                                  with your password)
                                                                  React app (web/dist) downloads the .bin once,
                                                                  unlocks it in the browser and answers everything locally.
```

## Run it

Needs **Python 3** and **Node.js 18+**.

```bash
cd kphb_react_app
bash run.sh                  # first time ~3 min: builds the data, asks for a password, builds and opens http://localhost:4173
bash run.sh --rebuild        # new roll in kkp_csv.zip, or a new password
```

`run.sh` ends by serving `web/dist` with Python's simple file server - proof that the app is only files.
Self-checks: `cd web && npm run check` (engine against the data) - it also runs on every `run.sh`.

### How the browser handles 3.2 lakh voters

- `summary.bin` (~0.1 MB) opens first: stations, sections and the constituency overview, so the first page shows at once.
- `voters.bin` (~10 MB, encrypted) downloads in the background with a progress note, then is cached by the browser.
- A Web Worker unlocks it, builds the search keys and families, and answers every filter, search and drill-down
  in a few hundredths of a second. The pages stay responsive while it works.
- Opening needs `https://` or `localhost` (browsers only allow the decryption there).

**Click anything to drill down.** Every number tile, bar, age-pyramid bar, column, map circle and table row opens
a drill-down page for that slice of voters (e.g. *women aged 60–64 in KPHB Colony*): a map of where they are
(by polling station, or by street/section), breakdowns by area and station, age and sex, relatives, family size,
and the voter list with CSV download. Each filter shows as a chip you can remove with ✕, and you can keep clicking
to go deeper: constituency → locality → polling station → street.

| Page | What it shows |
|---|---|
| **Overview** | Voters, women per 1,000 men, average age, first-time voters, 60+, families, door numbers, entries to check; age-sex pyramid; localities; largest stations; family and household size |
| **Find voters** | Search in Telugu or English (sound-alike: *Lakshmi = Laxmi = లక్ష్మి*), voter ID (paste many), house no., serial no., `258/45` = station 258 serial 45. Filters, sort, CSV download |
| **Polling stations** | All 417 stations, sortable. Each station: KPIs, pyramid, sections (streets), largest families, busiest doors, full voter list |
| **Areas** | Mandal → police station → locality → station tree, plus tables by locality, police station, mandal, PIN and section |
| **Families** | Families worked out per polling station from the father / mother / husband each voter names; family tree with relations ("Father-in-law", "Nephew"…) |
| **Households** | Voters sharing a door number - doors with 10+ voters are flagged for field checks |
| **Map** | Stations on an OpenStreetMap base, sized by voters, coloured by any measure; drag a pin to fix its position |
| **Data checks** | OCR doubts, duplicates, cover-page totals that don't match |

The filter bar (mandal, police station, locality, PIN, station, sex, age) applies to every page and stays in the address bar, so a filtered view can be bookmarked.

## How families are found

For each voter the roll prints one relative. Inside the same polling station the build script links the voter to:

1. a voter with the **same name in the same house** (most reliable), then
2. a **similar spelling in the same house** (`రఘు బాబు` ↔ `కే రఘు బాబు`), then
3. a similar spelling **in the same building** (`8-8-51-2` vs `8-8-51-2-2`), then
4. the **same name elsewhere in the station** if only one plausible person has it.

Gender and age must fit (a father at least 14 years older, etc.). If the relative isn't on the roll, siblings who name the same parent at the same door are still grouped. In this urban roll many parents live elsewhere, so ~21% of voters link to a relative on the roll. Treat families as a strong guide, not proof.

## Map

The Map page draws the **official Kukatpally (AC 46) border** and the neighbouring constituencies from
`web/public/geo/constituencies.geojson` (DataMeet, CC BY 2.5 India, traced from ECI polling-station maps).
Inside the border the app shows, switchable in the side panel:

- **Localities**: shaded areas with names; labels appear as you zoom in.
- **Station areas**: the land closest to each polling station (Voronoi cells cut at the border).
- **Station circles**: one circle per station, sized by voters. In a drill-down, **Streets** shows sections.
- **Apartments**: 152 apartment blocks and gated communities (about 14,000 voters), found from building
  names in house numbers (Rainbow Vistas, Malaysian Township, SS Grandure…) and from many flat numbers
  under one door number. Also a table under Areas → Apartments; click any to drill down. Name the
  unnamed blocks in `scripts/apartment_names.csv` (door,name) and rebuild.

Colour by voters, women per 1,000 men, average age, first-time %, 18–29 %, 60+ % or entries to check.
Hover for numbers, click to pin an area in the side panel, then *Drill down*. There are buttons for
Fit Kukatpally and Full screen. Area shapes are estimates built from approximate station positions;
the border itself is official. Stations that fall outside the border are moved just inside it.

## Map positions

The roll has no coordinates. Streets (sections) are drawn on a small ring around their polling station. Each station starts near the **approximate centre of its locality** (`scripts/localities.py` - edit names/centres there). To improve:

- **Drag on the map**: open a station's circle → *Move this pin* → drag → *Save pin*. It is kept in that browser;
  *Download saved pins* gives `station_geo.csv` - put it at `data/station_geo.csv` and `bash run.sh --rebuild` so everyone gets it.
- **Geocoder**: `python3 scripts/geocode_stations.py` (free OpenStreetMap Nominatim, ~1 station/second, needs internet),
  then `bash run.sh --rebuild`. Finds what it can; the rest stay approximate.

## Files

```
scripts/build_db.py         zip/CSVs -> SQLite (stdlib only)
scripts/telugu.py           Telugu -> English letters + sound key for search
scripts/localities.py       locality spellings and approximate map centres
scripts/schema.sql, indexes.sql
scripts/geocode_stations.py optional exact station pins
scripts/smoke_test.py       automated checks
scripts/export_static.py    SQLite -> compact columns for the browser
web/scripts/pack.mjs        gzip + encrypt -> web/public/data/*.bin
web/scripts/check.mjs       self-check of the browser engine
web/src/data/engine.js      the in-browser engine (filters, search, families, drill-downs)
web/src/data/worker.js      Web Worker: download, unlock, answer
server/server.py            optional Python API (not needed for the static app)
web/                        React 18 + Vite + Leaflet source; web/dist is the built app
```

Change the UI: `cd web && npm run dev` (opens on :5173 using the packed data), then `npm run build`.

## Background map (no API key needed)

The map background uses free OpenStreetMap tiles, which need no key. (CARTO's map tiles started asking
for an API key in August 2026 and showed an "API KEY REQUIRED" banner, so they are no longer the default.)
The street map needs internet; the voter data is never sent anywhere.

## What is stored in Git

| File | Size | In Git? |
|---|---|---|
| `web/public/data/summary.bin`, `voters.bin` | ~10 MB | Yes - gzip + AES-256 encrypted, read by the app |
| `backup/kkp_csv.zip.enc` | ~20 MB | Yes - encrypted copy of the raw roll, so a fresh clone can rebuild everything |
| `kkp_csv.zip`, `data/` (kphb.db 312 MB, exports) | - | Never - raw, unencrypted voter data stays on your computer |

On a new computer: `git clone …`, then `bash run.sh` - it restores `kkp_csv.zip` from the backup with your
password and rebuilds the database. Manual: `cd web && npm run backup` / `npm run restore` (password via `KPHB_PASS`).

## Deploy on Render (Static Site)

1. Run `bash run.sh` once, so `web/public/data/*.bin` exists, encrypted with your password.
2. Push to GitHub: `bash publish.sh` (defaults to https://github.com/aruneckp/kphb_atlas.git; pass another URL to change).
   It refuses to push if the raw roll, the database or unencrypted data is staged - only the encrypted `.bin` files go up.
3. On render.com: **New → Blueprint** → pick the repo (it reads `render.yaml`), or **New → Static Site** with
   build command `cd web && npm ci && npm run build` and publish directory `web/dist`.
4. Share the `https://….onrender.com` link and the password separately. Static sites on Render don't sleep.

After a new roll or password: `bash run.sh --rebuild`, then commit and push the new `.bin` files.

Pins dragged on the Map are saved in that browser. "Download saved pins" gives a `station_geo.csv`;
put it at `data/station_geo.csv` and run `bash run.sh --rebuild` to give everyone the same pins.

The Python API server (`server/server.py`) still works for local use if you prefer it:
`python3 server/server.py` after `cd web && VITE_DATA=server npm run build`.

## Privacy

Voter names, IDs and addresses are personal data. On a static site anyone with the link can download the
`.bin` files, so the password is what protects them: use a long one (12+ characters is enforced; 16+ recommended for a public repo, not reused elsewhere),
share it only with your team, and rebuild with a new password if it leaks. The files are AES-256-GCM encrypted
with a key derived from the password (PBKDF2-SHA256, 210,000 rounds); the password itself is never stored in
the files or sent anywhere. Keep the repository private, and keep `kkp_csv.zip` and `data/` out of Git.
