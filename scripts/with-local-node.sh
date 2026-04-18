#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="$ROOT_DIR/.local/node-v24.14.1-darwin-arm64/bin"

if [ ! -x "$NODE_DIR/node" ]; then
  echo "Local Node.js not found at $NODE_DIR" >&2
  exit 1
fi

export PATH="$NODE_DIR:$PATH"
exec "$@"
