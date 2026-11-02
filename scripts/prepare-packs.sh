#!/usr/bin/env bash
# Copies the school packs that ship with the app into build/packs. Source: TOMO_PACKS_SRC (a tomo-packs `packs`
# folder, e.g. an unpacked, signature-verified release) or the local tomo-packs checkout next to this repository.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="${TOMO_PACKS_SRC:-$root/tomo-packs/packs}"
[ -d "$src" ] || { echo "no packs at $src" >&2; exit 1; }
rm -rf "$root/build/packs"
mkdir -p "$root/build/packs"
rsync -a --exclude 'evals' --exclude 'data/build' --exclude '__pycache__' "$src/" "$root/build/packs/"
ls "$root/build/packs"
