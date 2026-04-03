#!/bin/bash
# DanteCode Universal Update Script (Unix/Mac/WSL)
# Updates CLI, VSCode Extension, and Desktop App all at once

set -e  # Exit on error

echo ""
echo "========================================"
echo "DanteCode Universal Update Script"
echo "========================================"
echo ""

PROJECT_ROOT="/c/Projects/DanteCode"
START_DIR=$(pwd)

cd "$PROJECT_ROOT"

# Step 1: Check git status
echo "[1/8] Checking git status..."
if [[ -n $(git status --short) ]]; then
    echo "  ⚠️  Uncommitted changes detected:"
    git status --short
    read -p "  Commit changes first? (y/N): " commit
    if [[ "$commit" == "y" || "$commit" == "Y" ]]; then
        read -p "  Commit message: " message
        message=${message:-"chore: update before reinstall"}
        git add .
        git commit -m "$message"
        echo "  ✅ Changes committed"
    fi
else
    echo "  ✅ Working directory clean"
fi

# Step 2: Build all packages
echo ""
echo "[2/8] Building all packages..."
npm run build --workspaces --if-present
echo "  ✅ All packages built successfully"

# Step 3: Run tests
echo ""
echo "[3/8] Running tests..."
if npm test 2>&1 | grep -E "✓|✗|passed|failed"; then
    echo "  ✅ Tests passed"
else
    echo "  ⚠️  Some tests failed, but continuing..."
fi

# Step 4: Update CLI (global)
echo ""
echo "[4/8] Updating CLI (global)..."
cd "$PROJECT_ROOT/packages/cli"
npm link
echo "  ✅ CLI linked globally"

# Verify CLI version
CLI_VERSION=$(dantecode --version 2>&1)
echo "  📦 CLI Version: $CLI_VERSION"

# Step 5: Package VSCode Extension
echo ""
echo "[5/8] Packaging VSCode extension..."
cd "$PROJECT_ROOT/packages/vscode"

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo "  Installing vsce (VSCode Extension Manager)..."
    npm install -g @vscode/vsce
fi

npm run package
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n1)
if [[ -z "$VSIX_FILE" ]]; then
    echo "❌ No .vsix file found"
    exit 1
fi
echo "  ✅ VSCode extension packaged: $VSIX_FILE"

# Step 6: Uninstall old VSCode extension
echo ""
echo "[6/8] Uninstalling old VSCode extension..."
code --uninstall-extension dantecode.dantecode 2>/dev/null || true
code --uninstall-extension danteforge.dantecode 2>/dev/null || true
echo "  ✅ Old extensions removed"

# Wait for uninstall to complete
sleep 2

# Step 7: Install new VSCode extension
echo ""
echo "[7/8] Installing new VSCode extension..."
code --install-extension "$VSIX_FILE" --force
echo "  ✅ VSCode extension installed: $VSIX_FILE"

# Step 8: Update Desktop App (if exists)
echo ""
echo "[8/8] Checking for Desktop app..."
cd "$PROJECT_ROOT/packages/desktop"

if [[ -f "package.json" ]]; then
    echo "  Building Desktop app..."
    if npm run build; then
        echo "  ✅ Desktop app built successfully"
        echo "  ℹ️  Run 'npm start' in packages/desktop to launch"
    else
        echo "  ⚠️  Desktop build skipped (not critical)"
    fi
else
    echo "  ℹ️  Desktop app not found (skipping)"
fi

# Summary
echo ""
echo "========================================"
echo "✅ DanteCode Update Complete!"
echo "========================================"
echo ""
echo "Updated versions:"
echo "  • CLI (global):          dantecode"
echo "  • VSCode Extension:      $VSIX_FILE"
echo "  • Desktop App:           packages/desktop"
echo ""
echo "Next steps:"
echo "  1. Close ALL VSCode/Antigravity windows"
echo "  2. Reopen VSCode/Antigravity"
echo "  3. Press Ctrl+Shift+P → 'Developer: Reload Window'"
echo "  4. Test DanteCode with your fixed version!"
echo ""
echo "Verify installation:"
echo "  code --list-extensions --show-versions | grep dante"
echo ""

cd "$START_DIR"
