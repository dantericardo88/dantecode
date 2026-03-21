# DanteCode PowerShell Installer
# Usage: iwr https://dantecode.dev/install.ps1 | iex
#        $env:DANTECODE_VERSION="2.0.0"; .\install.ps1
#
# Requires PowerShell 5.1+ and Node.js 20+.

$ErrorActionPreference = "Stop"

$PackageName = "@dantecode/cli"
$Version = if ($env:DANTECODE_VERSION) { $env:DANTECODE_VERSION } else { "latest" }

function Write-Info    { param($msg) Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[ok]   $msg" -ForegroundColor Green }
function Write-Failure { param($msg) Write-Host "[error] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  DanteCode Installer" -ForegroundColor White
Write-Host "  Portable skill runtime and coding agent"
Write-Host ""

# Check Node.js
try {
    $nodeVersion = (node --version 2>$null).TrimStart("v")
    $nodeMajor = [int]($nodeVersion.Split(".")[0])
    if ($nodeMajor -lt 20) {
        Write-Failure "Node.js 20+ required (found v$nodeVersion). Upgrade at https://nodejs.org"
        exit 1
    }
    Write-Info "Node.js v$nodeVersion detected"
} catch {
    Write-Failure "Node.js not found. Install from https://nodejs.org"
    exit 1
}

# Check npm
try {
    $npmVersion = (npm --version 2>$null)
    Write-Info "npm v$npmVersion detected"
} catch {
    Write-Failure "npm not found. Reinstall Node.js from https://nodejs.org"
    exit 1
}

# Install
Write-Info "Installing ${PackageName}@${Version} from npm..."
npm install --global "${PackageName}@${Version}"

Write-Host ""
Write-Success "DanteCode installed successfully."
Write-Host ""
Write-Host "  Get started:"
Write-Host "    `$env:ANTHROPIC_API_KEY = 'your-key'   # or GROK_API_KEY / OPENAI_API_KEY"
Write-Host "    dantecode init"
Write-Host "    dantecode"
Write-Host ""
Write-Host "  Run 'dantecode --help' for more options."
Write-Host ""
