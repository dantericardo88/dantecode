#!/usr/bin/env bash
# DanteCode Installer
# Usage: curl -fsSL https://get.dantecode.dev | bash
set -euo pipefail

REPO="dantecode/dantecode"
BINARY_NAME="dantecode"
INSTALL_DIR="/usr/local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1" >&2; }

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *) error "Unsupported OS: $os"; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) error "Unsupported architecture: $arch"; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

get_latest_version() {
  local version
  version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
  if [ -z "$version" ]; then
    error "Failed to fetch latest version"
    exit 1
  fi
  echo "$version"
}

main() {
  echo ""
  echo "  DanteCode Installer"
  echo "  Open-Source Model-Agnostic AI Coding Agent"
  echo ""

  local platform version download_url tmp_dir

  info "Detecting platform..."
  platform=$(detect_platform)
  success "Platform: $platform"

  info "Fetching latest version..."
  version=$(get_latest_version)
  success "Version: v$version"

  download_url="https://github.com/${REPO}/releases/download/v${version}/${BINARY_NAME}-${platform}"
  tmp_dir=$(mktemp -d)

  info "Downloading ${BINARY_NAME} v${version}..."
  if ! curl -fsSL -o "${tmp_dir}/${BINARY_NAME}" "$download_url"; then
    error "Download failed. Check your internet connection."
    rm -rf "$tmp_dir"
    exit 1
  fi

  chmod +x "${tmp_dir}/${BINARY_NAME}"

  # Try system-wide install, fall back to user-local
  if [ -w "$INSTALL_DIR" ]; then
    mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    success "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
  elif command -v sudo >/dev/null 2>&1; then
    info "Requesting sudo for /usr/local/bin install..."
    sudo mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    success "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
  else
    local user_bin="${HOME}/.local/bin"
    mkdir -p "$user_bin"
    mv "${tmp_dir}/${BINARY_NAME}" "${user_bin}/${BINARY_NAME}"
    success "Installed to ${user_bin}/${BINARY_NAME}"
    if [[ ":$PATH:" != *":${user_bin}:"* ]]; then
      info "Add ${user_bin} to your PATH:"
      echo "  export PATH=\"${user_bin}:\$PATH\""
    fi
  fi

  rm -rf "$tmp_dir"

  echo ""
  success "DanteCode v${version} installed successfully!"
  echo ""
  echo "  Get started:"
  echo "    export GROK_API_KEY=your-key    # Get one at https://console.x.ai/"
  echo "    dantecode                        # Start interactive session"
  echo "    dantecode config init            # Initialize project"
  echo ""
}

main "$@"
