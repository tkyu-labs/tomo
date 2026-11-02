#!/usr/bin/env bash
# M8 check: install the unsigned dmg into a throw-away Applications folder (not /Applications) and run the
# first-run e2e against the installed app with its bundled engine and packs.
# Usage: npm run dist:mac && test/e2e/install-dmg.sh [release/Tomo-<version>-arm64.dmg]
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
dmg="${1:-$(ls -t "$root"/release/Tomo-*-arm64.dmg | head -1)}"
apps="$(mktemp -d)/Applications"
mkdir -p "$apps"
vol="$(hdiutil attach -nobrowse -readonly -noautoopen "$dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
# macOS writes a defaults plist for every app that runs; remove the one this test creates
plist="$HOME/Library/Preferences/io.github.tkyu-labs.tomo.plist"
had_plist=0; [ -e "$plist" ] && had_plist=1
trap 'hdiutil detach -quiet "$vol" 2>/dev/null || true; rm -rf "$(dirname "$apps")"; [ "$had_plist" = 1 ] || rm -f "$plist"' EXIT
ditto "$vol/Tomo.app" "$apps/Tomo.app"
hdiutil detach -quiet "$vol"
echo "installed: $apps/Tomo.app ($(du -sh "$apps/Tomo.app" | cut -f1))"
TOMO_E2E_APP="$apps/Tomo.app/Contents/MacOS/Tomo" TOMO_E2E_PACK="${TOMO_E2E_PACK:-shonan-it}" node "$root/test/e2e/first-run.mjs"
