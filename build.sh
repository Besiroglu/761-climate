#!/bin/bash
# Build and publish the 761 climate app: src/ -> build/ (plaintext, deleted after) -> docs/ (encrypted) -> GitHub Pages.
# Two passwords live in the macOS Keychain: 761-climate-app (shared) and 761-climate-admin (Tamay). Created on first run.
# Usage: ./build.sh "commit message"
set -euo pipefail
cd "$(dirname "$0")"
pw() { security find-generic-password -s "$1" -w 2>/dev/null || true; }
# The pages are public, so the password must resist offline guessing: 5 groups of 4 from a-z0-9 (about 100 bits).
newpw() { python3 -c "import secrets,string; a=string.ascii_lowercase+string.digits; print('-'.join(''.join(secrets.choice(a) for _ in range(4)) for _ in range(5)))"; }
for svc in 761-climate-app 761-climate-admin; do
  [ -n "$(pw $svc)" ] || { security add-generic-password -U -a "$USER" -s "$svc" -w "$(newpw)"; echo "new password saved in Keychain: $svc"; }
done
KEY="$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.house-automation/messana_key.json")))["key"])')"
MESSANA_KEY="$KEY" node build.js >/dev/null
enc() {  # $1 input, $2 out dir, $3 keychain item, $4 salt, $5 title
  STATICRYPT_PASSWORD="$(pw "$3")" npx --yes staticrypt "$1" -d "$2" -c false --salt "$4" --remember 3650 --short \
    -t src/login_template.html --template-title "$5" >/dev/null
}
enc build/index.html docs 761-climate-app 6f2c41d8a9b07e35c1d4f8a2b6e09173 "761"
enc build/admin/index.html docs/admin 761-climate-admin b81e5a3c07d94f26e1a8c3b5d70f2e94 "761 admin"
rm -rf build
if grep -rqF "$KEY" docs src supervisor .github 2>/dev/null; then echo "ABORT: the API key appears in plain text; nothing published"; exit 1; fi
git add -A docs src supervisor .github build.js build.sh README.md .gitignore test/unit.js test/mock.js test/shoot.js test/icon.js test/package.json
git commit -qm "${1:-publish}" || { echo "nothing to publish"; exit 0; }
if git remote get-url origin >/dev/null 2>&1; then git push -q origin main && echo "published"; else echo "committed locally (no GitHub remote yet)"; fi
