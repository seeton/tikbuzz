#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export npm_config_cache="$ROOT_DIR/.npm-cache"
cd "$ROOT_DIR"
exec "$ROOT_DIR/scripts/with-local-node.sh" npm run dev
