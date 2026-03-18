#!/usr/bin/env bash
# DanteCode npm installer
set -euo pipefail

PACKAGE_NAME="@dantecode/cli"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1" >&2; }

main() {
  echo ""
  echo "  DanteCode Installer"
  echo "  Portable skill runtime and coding agent"
  echo ""

  if ! command -v node >/dev/null 2>&1; then
    error "Node.js 20+ is required."
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    error "npm 11+ is required."
    exit 1
  fi

  info "Installing ${PACKAGE_NAME} from npm..."
  npm install --global "${PACKAGE_NAME}"

  echo ""
  success "DanteCode installed successfully."
  echo ""
  echo "  Get started:"
  echo "    export GROK_API_KEY=your-key"
  echo "    dantecode init"
  echo "    dantecode"
  echo ""
}

main "$@"
