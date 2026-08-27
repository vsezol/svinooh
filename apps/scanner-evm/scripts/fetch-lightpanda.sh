#!/usr/bin/env bash
# Download the lightpanda headless-browser binary for THIS machine.
#
# Local dev only: run once, then `SCANNER_ENGINE=lightpanda` (the default) finds
# it in apps/scanner-evm/bin. The binary is ~76 MB and gitignored; Docker
# downloads its own copy at build time (see Dockerfile, same pinned version).
set -euo pipefail

VERSION="0.3.7"
DEST="${1:-"$(cd "$(dirname "$0")/.." && pwd)/bin/lightpanda"}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  ASSET=lightpanda-aarch64-macos ;;
  Darwin-x86_64) ASSET=lightpanda-x86_64-macos ;;
  Linux-aarch64) ASSET=lightpanda-aarch64-linux ;;
  Linux-x86_64)  ASSET=lightpanda-x86_64-linux ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$DEST")"
echo "downloading lightpanda $VERSION ($ASSET) -> $DEST"
curl -fsSL -o "$DEST" "https://github.com/lightpanda-io/browser/releases/download/${VERSION}/${ASSET}"
chmod +x "$DEST"
"$DEST" version
echo "ok"
