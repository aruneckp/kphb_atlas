#!/bin/bash
# Push the app + encrypted data to GitHub, so Render can build the static site.
#   bash publish.sh                       (uses https://github.com/aruneckp/kphb_atlas.git)
#   bash publish.sh <your-repo-url>
# Run `bash run.sh` first: it packs the voter data with your password into web/public/data/*.bin.
set -e
cd "$(dirname "$0")"
REPO="${1:-https://github.com/aruneckp/kphb_atlas.git}"
command -v git >/dev/null || { echo "git is needed (xcode-select --install)"; exit 1; }
[ -f web/public/data/voters.bin ] || { echo "No packed data yet. Run: bash run.sh   (it asks for the password)"; exit 1; }
head -c 5 web/public/data/voters.bin | grep -q KPHB1 || { echo "web/public/data/voters.bin is NOT encrypted. Run: bash run.sh --rebuild"; exit 1; }
[ ! -f backup/kkp_csv.zip.enc ] || head -c 5 backup/kkp_csv.zip.enc | grep -q KPHB1 || { echo "backup/kkp_csv.zip.enc is not encrypted."; exit 1; }

[ -d .git ] || git init -q -b main
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO"
git add -A
# safety net: the raw roll, the database and unencrypted exports must never leave this computer
if git diff --cached --name-only | grep -E '(^|/)kkp_csv\.zip$|^data/|\.db$|(summary|voters)\.json$'; then
  echo "Stopped: raw voter data is staged (listed above). Nothing was pushed."; exit 1
fi
git commit -q -m "KPHB voter atlas: app and encrypted data" || echo "Nothing new to commit."
# also check every earlier commit: a file committed once stays in the history and would be pushed too
if git log --all --name-only --format= | sort -u | grep -E '(^|/)kkp_csv\.zip$|^data/|\.db$|(summary|voters)\.json$'; then
  echo "Stopped: an earlier commit in this folder contains raw voter data (listed above). Nothing was pushed."
  echo "Fix: rm -rf .git   then run   bash publish.sh   again."; exit 1
fi
git pull -q --no-rebase --no-edit --allow-unrelated-histories -X ours origin main 2>/dev/null || true
git push -u origin main
echo
echo "Pushed. On render.com: New → Blueprint → choose $(basename "$REPO" .git) → Apply."
