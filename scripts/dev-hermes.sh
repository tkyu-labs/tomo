#!/usr/bin/env bash
# Sets up the pinned Hermes Agent for development under .dev/ (idempotent):
#   .dev/hermes-src   source at the pinned commit
#   .dev/hermes-venv  Python environment (uv, locked dependencies)
#   .dev/home         HERMES_HOME for development
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$here/hermes-pin.env"
# shellcheck source=/dev/null
source "$here/dev-env.sh"
command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)" >&2; exit 1; }
mkdir -p "$TOMO_DEV_DIR" "$HERMES_HOME" "$HERMES_RUNTIME_DIR" "$HERMES_GATEWAY_LOCK_DIR"

if [ ! -d "$HERMES_SRC/.git" ]; then
  git init -q "$HERMES_SRC"
  git -C "$HERMES_SRC" remote add origin "$HERMES_REPO"
fi
if [ "$(git -C "$HERMES_SRC" rev-parse HEAD 2>/dev/null || true)" != "$HERMES_COMMIT" ]; then
  git -C "$HERMES_SRC" fetch -q --depth 1 origin "$HERMES_COMMIT"
  git -C "$HERMES_SRC" checkout -q --detach FETCH_HEAD
fi
test "$(git -C "$HERMES_SRC" rev-parse HEAD)" = "$HERMES_COMMIT"

# Minimal development config until Tomo writes its own (M4): no update checks, no remote catalog, no free tier.
if [ ! -f "$HERMES_HOME/config.yaml" ]; then
  cat > "$HERMES_HOME/config.yaml" <<'YAML'
updates:
  check: false
model_catalog:
  enabled: false
onboarding:
  profile_build: "off"
nous:
  guest: false
YAML
fi

( cd "$HERMES_SRC" && uv sync --frozen --python "$HERMES_PYTHON" --no-dev --extra ddgs -q ) # extras: src/main/engine/installer.ts ENGINE_EXTRAS
py="$HERMES_VENV/bin/python"; [ -x "$py" ] || py="$HERMES_VENV/Scripts/python.exe" # macOS / Windows
( cd "$HERMES_SRC" && "$py" -c "import tui_gateway.entry" )
# Separate small environment for the Tomo plugin unit tests (pytest), same Python.
if [ ! -x "$TOMO_DEV_DIR/test-venv/bin/python" ] && [ ! -x "$TOMO_DEV_DIR/test-venv/Scripts/python.exe" ]; then
  uv venv -q "$TOMO_DEV_DIR/test-venv" --python "$HERMES_PYTHON"
  uv pip install -q -p "$TOMO_DEV_DIR/test-venv" pytest
fi
echo "Hermes $HERMES_TAG ($HERMES_COMMIT) ready in $HERMES_VENV"
