#!/bin/bash
# Build everything and open the plain React app (no server needed).
#   bash run.sh             first time: builds the database, packs the data with your password, builds the app
#   bash run.sh --rebuild   start again from kkp_csv.zip (new roll, or a new password)
# Needs Python 3 (data prep) and Node.js 18+ (React build). The password can also come from KPHB_PASS.
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Python 3 is needed: https://www.python.org/downloads/"; exit 1; }
command -v npm >/dev/null || { echo "Node.js is needed: https://nodejs.org/"; exit 1; }
REBUILD=""; [ "$1" == "--rebuild" ] && REBUILD=1

if [ ! -f kkp_csv.zip ] && [ -f backup/kkp_csv.zip.enc ]; then
  echo "kkp_csv.zip not found - restoring it from the encrypted backup in the repo."
  if [ -z "$KPHB_PASS" ]; then read -r -s -p "Password: " KPHB_PASS; echo; fi
  [ -d web/node_modules ] || (cd web && npm install)
  (cd web && KPHB_PASS="$KPHB_PASS" npm run restore)
fi
if [ -n "$REBUILD" ] || [ ! -f data/kphb.db ]; then
  [ -f kkp_csv.zip ] || { echo "Put kkp_csv.zip in $(pwd) first."; exit 1; }
  python3 scripts/build_db.py
fi
if [ -n "$REBUILD" ] || [ ! -f data/static/voters.json ] || [ data/kphb.db -nt data/static/voters.json ]; then
  python3 scripts/export_static.py
fi
[ -d web/node_modules ] || (cd web && npm install)
if [ -n "$REBUILD" ] || [ ! -f web/public/data/voters.bin ] || [ data/static/voters.json -nt web/public/data/voters.bin ]; then
  if [ -z "$KPHB_PASS" ]; then
    read -r -s -p "Choose the password people will type to open the app (12+ characters): " KPHB_PASS; echo
  fi
  (cd web && KPHB_PASS="$KPHB_PASS" npm run pack)
  (cd web && KPHB_PASS="$KPHB_PASS" npm run backup)   # encrypted copy of the raw roll, for rebuilding from GitHub
fi
(cd web && npm run check && npm run build)
echo
echo "The app is plain files in web/dist (that folder is what goes on Render)."
echo "Opening http://localhost:4173  - press Ctrl+C to stop."
( sleep 2; (command -v open >/dev/null && open http://localhost:4173) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4173) ) >/dev/null 2>&1 &
cd web/dist && python3 -m http.server 4173 --bind 127.0.0.1
