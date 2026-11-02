#!/usr/bin/env bash
# Source this file to get the isolated development environment for Hermes:
#   source scripts/dev-env.sh
# Everything lives under .dev/ in the repository; ~/.hermes and ~/.local/state/hermes are never used.
_tomo_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
export TOMO_DEV_DIR="$_tomo_root/.dev"
export HERMES_SRC="$TOMO_DEV_DIR/hermes-src"
export HERMES_VENV="$TOMO_DEV_DIR/hermes-venv"
export HERMES_HOME="$TOMO_DEV_DIR/home"
export HERMES_RUNTIME_DIR="$HERMES_HOME/tools"
export HERMES_GATEWAY_LOCK_DIR="$HERMES_HOME/locks"
export npm_config_cache="$TOMO_DEV_DIR/cache/npm"
export UV_CACHE_DIR="$TOMO_DEV_DIR/cache/uv"
export UV_PYTHON_INSTALL_DIR="$TOMO_DEV_DIR/python"
export UV_PROJECT_ENVIRONMENT="$HERMES_VENV"
export NODE_COMPILE_CACHE="$TOMO_DEV_DIR/cache/node-compile"

export ELECTRON_CACHE="$TOMO_DEV_DIR/cache/electron"
export electron_config_cache="$TOMO_DEV_DIR/cache/electron"
export ELECTRON_BUILDER_CACHE="$TOMO_DEV_DIR/cache/electron-builder"
unset _tomo_root
