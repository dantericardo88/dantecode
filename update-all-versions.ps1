# DanteCode Universal Update Script
# Updates CLI, VSCode Extension, and Desktop App all at once

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DanteCode Universal Update Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"
$startLocation = Get-Location
$projectRoot = "C:\Projects\DanteCode"

try {
    Set-Location $projectRoot

    # Step 1: Check git status
    Write-Host "[1/8] Checking git status..." -ForegroundColor Yellow
    $gitStatus = git status --short
    if ($gitStatus) {
        Write-Host "  ⚠️  Uncommitted changes detected:" -ForegroundColor Yellow
        Write-Host $gitStatus
        $commit = Read-Host "  Commit changes first? (y/N)"
        if ($commit -eq 'y' -or $commit -eq 'Y') {
            $message = Read-Host "  Commit message"
            if (-not $message) { $message = "chore: update before reinstall" }
            git add .
            git commit -m $message
            Write-Host "  ✅ Changes committed" -ForegroundColor Green
        }
    } else {
        Write-Host "  ✅ Working directory clean" -ForegroundColor Green
    }

    # Step 2: Build all packages
    Write-Host ""
    Write-Host "[2/8] Building all packages..." -ForegroundColor Yellow
    npm run build --workspaces --if-present
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Write-Host "  ✅ All packages built successfully" -ForegroundColor Green

    # Step 3: Run tests (optional but recommended)
    Write-Host ""
    Write-Host "[3/8] Running tests..." -ForegroundColor Yellow
    npm test 2>&1 | Select-String -Pattern "✓|✗|passed|failed|error" | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠️  Some tests failed, but continuing..." -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ Tests passed" -ForegroundColor Green
    }

    # Step 4: Update CLI (global)
    Write-Host ""
    Write-Host "[4/8] Updating CLI (global)..." -ForegroundColor Yellow
    Set-Location "$projectRoot\packages\cli"
    npm link
    if ($LASTEXITCODE -ne 0) { throw "CLI link failed" }
    Write-Host "  ✅ CLI linked globally" -ForegroundColor Green

    # Verify CLI version
    $cliVersion = dantecode --version 2>&1 | Out-String
    Write-Host "  📦 CLI Version: $($cliVersion.Trim())" -ForegroundColor Cyan

    # Step 5: Package VSCode Extension
    Write-Host ""
    Write-Host "[5/8] Packaging VSCode extension..." -ForegroundColor Yellow
    Set-Location "$projectRoot\packages\vscode"

    # Check if vsce is installed
    $vsce = Get-Command vsce -ErrorAction SilentlyContinue
    if (-not $vsce) {
        Write-Host "  Installing vsce (VSCode Extension Manager)..." -ForegroundColor Yellow
        npm install -g @vscode/vsce
    }

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "VSCode packaging failed" }

    $vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
    if (-not $vsixFile) { throw "No .vsix file found" }
    Write-Host "  ✅ VSCode extension packaged: $($vsixFile.Name)" -ForegroundColor Green

    # Step 6: Uninstall old VSCode extension
    Write-Host ""
    Write-Host "[6/8] Uninstalling old VSCode extension..." -ForegroundColor Yellow

    # Uninstall both possible versions
    code --uninstall-extension dantecode.dantecode 2>&1 | Out-Null
    code --uninstall-extension danteforge.dantecode 2>&1 | Out-Null

    Write-Host "  ✅ Old extensions removed" -ForegroundColor Green

    # Wait for uninstall to complete
    Start-Sleep -Seconds 2

    # Step 7: Install new VSCode extension
    Write-Host ""
    Write-Host "[7/8] Installing new VSCode extension..." -ForegroundColor Yellow
    code --install-extension $vsixFile.FullName --force
    if ($LASTEXITCODE -ne 0) { throw "VSCode installation failed" }
    Write-Host "  ✅ VSCode extension installed: $($vsixFile.Name)" -ForegroundColor Green

    # Step 8: Update Desktop App (if exists)
    Write-Host ""
    Write-Host "[8/8] Checking for Desktop app..." -ForegroundColor Yellow
    Set-Location "$projectRoot\packages\desktop"

    if (Test-Path "package.json") {
        Write-Host "  Building Desktop app..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✅ Desktop app built successfully" -ForegroundColor Green
            Write-Host "  ℹ️  Run 'npm start' in packages/desktop to launch" -ForegroundColor Cyan
        } else {
            Write-Host "  ⚠️  Desktop build skipped (not critical)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ℹ️  Desktop app not found (skipping)" -ForegroundColor Cyan
    }

    # Summary
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✅ DanteCode Update Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Updated versions:" -ForegroundColor Cyan
    Write-Host "  • CLI (global):          dantecode" -ForegroundColor White
    Write-Host "  • VSCode Extension:      $($vsixFile.Name)" -ForegroundColor White
    Write-Host "  • Desktop App:           packages/desktop" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Close ALL VSCode/Antigravity windows" -ForegroundColor White
    Write-Host "  2. Reopen VSCode/Antigravity" -ForegroundColor White
    Write-Host "  3. Press Ctrl+Shift+P → 'Developer: Reload Window'" -ForegroundColor White
    Write-Host "  4. Test DanteCode with your fixed version!" -ForegroundColor White
    Write-Host ""
    Write-Host "Verify installation:" -ForegroundColor Yellow
    Write-Host "  code --list-extensions --show-versions | grep dante" -ForegroundColor White
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host ""
    exit 1
} finally {
    Set-Location $startLocation
}
