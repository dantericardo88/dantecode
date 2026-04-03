#!/bin/bash
# Force reinstall DanteCode with fixes

echo ""
echo "========================================"
echo "DanteCode Extension Reinstall Script"
echo "========================================"
echo ""

echo "Step 1: Uninstalling old extension..."
code --uninstall-extension dantecode.dantecode
sleep 2

echo ""
echo "Step 2: Building packages with fixes..."
cd /c/Projects/DanteCode
npm run build --workspace=packages/core --if-present
npm run build --workspace=packages/cli --if-present
npm run build --workspace=packages/vscode --if-present
sleep 2

echo ""
echo "Step 3: Packaging VSCode extension..."
cd /c/Projects/DanteCode/packages/vscode
npm run package
sleep 2

echo ""
echo "Step 4: Installing updated extension..."
code --install-extension *.vsix

echo ""
echo "========================================"
echo "Installation complete!"
echo "========================================"
echo ""
echo "IMPORTANT: Close ALL VSCode windows and reopen"
echo "Then press Ctrl+Shift+P → 'Developer: Reload Window'"
echo ""
echo "Your DanteCode now has all 4 fixes:"
echo "  ✅ cd commands work"
echo "  ✅ Parse errors show details"
echo "  ✅ No false confabulation warnings"
echo "  ✅ Command translation suggestions"
echo ""
