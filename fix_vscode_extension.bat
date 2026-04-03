@echo off
REM Force reinstall DanteCode VSCode extension with fixes

echo.
echo ========================================
echo DanteCode Extension Reinstall Script
echo ========================================
echo.

echo Step 1: Uninstalling old extension...
code --uninstall-extension dantecode.dantecode
timeout /t 2

echo.
echo Step 2: Building packages with fixes...
cd C:\Projects\DanteCode
call npm run build --workspace=packages/core
call npm run build --workspace=packages/cli
call npm run build --workspace=packages/vscode
timeout /t 2

echo.
echo Step 3: Packaging VSCode extension...
cd C:\Projects\DanteCode\packages\vscode
call npm run package
timeout /t 2

echo.
echo Step 4: Installing updated extension...
for %%f in (*.vsix) do (
    code --install-extension %%f
    goto :installed
)
:installed

echo.
echo ========================================
echo Installation complete!
echo ========================================
echo.
echo IMPORTANT: Close ALL VSCode windows and reopen
echo Then press Ctrl+Shift+P and run "Developer: Reload Window"
echo.
echo Your DanteCode now has all 4 fixes:
echo   1. cd commands work (isRepoInternalCdChain fixed)
echo   2. Parse errors show details
echo   3. No false confabulation warnings
echo   4. Command translation suggestions
echo.
pause
