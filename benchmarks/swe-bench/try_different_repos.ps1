# Skip the problematic astropy instances and try different repos
# This will start at instance 10 instead of 0

param(
    [int]$Limit = 5,
    [int]$Offset = 10  # Skip first 10 (likely all astropy)
)

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "SWE-bench - Try Different Repos" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Skipping first $Offset instances (astropy)" -ForegroundColor Yellow
Write-Host "Testing next $Limit instances with Grok" -ForegroundColor Yellow
Write-Host ""

if (-not $env:GROK_API_KEY) {
    Write-Host "ERROR: GROK_API_KEY not set" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] GROK_API_KEY is set" -ForegroundColor Green
Write-Host ""

# Clean up old workspaces to save disk space
if (Test-Path ".swe-bench-workspace") {
    Write-Host "Cleaning up old workspaces..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force ".swe-bench-workspace" -ErrorAction SilentlyContinue
}

Write-Host "Starting benchmark run..." -ForegroundColor Cyan
Write-Host ""

# Run with offset to skip astropy instances
python swe_bench_runner.py `
    --subset verified `
    --limit $Limit `
    --offset $Offset `
    --model grok/grok-3 `
    --output-dir "./results"

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
if ($exitCode -eq 0) {
    Write-Host "[SUCCESS] Got some passing tests!" -ForegroundColor Green
    Write-Host "Check results/ directory for details" -ForegroundColor White
} else {
    Write-Host "[PARTIAL] Completed with some failures" -ForegroundColor Yellow
    Write-Host "Check results/ directory for details" -ForegroundColor White
}
Write-Host "====================================" -ForegroundColor Cyan

exit $exitCode
