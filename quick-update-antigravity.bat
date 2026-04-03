@echo off
REM Quick Antigravity/VSCode Extension Update (Fast Method)
REM Uses VSCode Extension Development Mode - No packaging needed!

echo.
echo ========================================
echo DanteCode Antigravity Quick Update
echo ========================================
echo.

cd /d C:\Projects\DanteCode

echo [1/3] Building packages...
call npm run build --workspaces --if-present
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed
    pause
    exit /b 1
)
echo   ✅ Packages built

echo.
echo [2/3] Linking CLI globally...
cd packages\cli
call npm link
echo   ✅ CLI linked

echo.
echo [3/3] Setting up Development Extension...
echo.
echo   📝 For Antigravity/VSCode, use Extension Development Mode:
echo.
echo   1. Open: File → Open Folder
echo   2. Browse to: C:\Projects\DanteCode
echo   3. Press F5 (or Run → Start Debugging)
echo   4. A new "Extension Development Host" window opens
echo   5. In that window, open your project (e.g., SettleThis)
echo   6. DanteCode now has ALL your fixes! ✅
echo.
echo   This runs the extension directly from source code.
echo   No packaging or installation needed!
echo.
echo ========================================
echo ✅ Quick Update Complete!
echo ========================================
echo.
echo Your fixes are ready to use in Extension Development Mode.
echo.
echo Alternative: Use the extension in THIS window:
echo   code --extensionDevelopmentPath=C:\Projects\DanteCode\packages\vscode .
echo.
pause
