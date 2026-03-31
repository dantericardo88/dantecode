# Complete SWE-bench Benchmark Runner with All Fixes
# Usage: .\RUN_BENCHMARK.ps1

param(
    [int]$Limit = 1,  # Start with 1 instance for testing
    [int]$Offset = 50
)

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "SWE-bench Benchmark - Complete Run" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check if GROK_API_KEY is set
if (-not $env:GROK_API_KEY) {
    Write-Host "ERROR: GROK_API_KEY environment variable not set!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set it first:" -ForegroundColor Yellow
    Write-Host '  $env:GROK_API_KEY = "xai-YOUR_KEY_HERE"' -ForegroundColor White
    Write-Host ""
    Write-Host "Or pass it via CLI:" -ForegroundColor Yellow
    Write-Host '  .\RUN_BENCHMARK.ps1 -ApiKey "xai-YOUR_KEY_HERE"' -ForegroundColor White
    exit 1
}

Write-Host "[OK] GROK_API_KEY is set (length: $($env:GROK_API_KEY.Length))" -ForegroundColor Green
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Limit: $Limit instances" -ForegroundColor White
Write-Host "  Offset: $Offset (skip first $Offset)" -ForegroundColor White
Write-Host "  Model: grok/grok-3" -ForegroundColor White
Write-Host ""

# Build path to local DanteCode
$dantecodeLocal = "node C:\Projects\DanteCode\packages\cli\dist\index.js"

# Run Python script with API key passed explicitly
Write-Host "Starting benchmark..." -ForegroundColor Cyan
Write-Host ""

python swe_bench_runner.py `
    --subset verified `
    --limit $Limit `
    --offset $Offset `
    --model grok/grok-3 `
    --dantecode $dantecodeLocal `
    --api-key $env:GROK_API_KEY `
    --output-dir "./results"

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
if ($exitCode -eq 0) {
    Write-Host "[SUCCESS] Benchmark completed!" -ForegroundColor Green
} else {
    Write-Host "[PARTIAL] Completed with errors" -ForegroundColor Yellow
}
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Check ./results/ directory for detailed output" -ForegroundColor White

exit $exitCode
