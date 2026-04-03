# Test script with explicit API key
param(
    [string]$ApiKey = ""
)

if (-not $ApiKey) {
    Write-Host "Usage: .\test_with_key.ps1 -ApiKey YOUR_KEY_HERE" -ForegroundColor Red
    exit 1
}

Write-Host "Testing SWE-bench with explicit API key..." -ForegroundColor Cyan
Write-Host "API Key length: $($ApiKey.Length)" -ForegroundColor Green
Write-Host ""

$dantecodeLocal = "node C:\Projects\DanteCode\packages\cli\dist\index.js"

python swe_bench_runner.py `
    --subset verified `
    --limit 1 `
    --offset 54 `
    --model grok/grok-3 `
    --dantecode $dantecodeLocal `
    --api-key $ApiKey `
    --output-dir "./results"

Write-Host ""
Write-Host "Test complete!" -ForegroundColor Cyan
