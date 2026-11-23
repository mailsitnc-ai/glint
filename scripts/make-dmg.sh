#!/bin/bash
# Builds dist/Glint-<version>-arm64.dmg from dist/Glint.app (drag-to-Applications layout).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
APP="dist/Glint.app"
OUT="dist/Glint-${VERSION}-arm64.dmg"
[ -d "$APP" ] || { echo "Missing $APP. Run the build first."; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/Glint.app"
ln -s /Applications "$STAGE/Applications"
cp assets/icon.icns "$STAGE/.VolumeIcon.icns"
cat > "$STAGE/READ ME FIRST.txt" <<'TXT'
Install: drag Glint into the Applications folder.

First launch: this build is not notarized by Apple, so macOS may block it.
Right-click Glint in Applications -> Open -> Open.
If it still says the app is damaged, run this in Terminal:
  xattr -cr /Applications/Glint.app
TXT
rm -f "$OUT"
hdiutil create -volname "Glint" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$OUT" >/dev/null
SetFile -a C "$STAGE" 2>/dev/null || true
echo "Created $OUT"
