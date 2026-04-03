# SWE-bench 20-instance validation runner (PowerShell)
# Sets environment and runs validation with proper logging

$env:GROK_API_KEY = $env:XAI_API_KEY # Use environment variable instead of hardcoding

Write-Host "================================"
Write-Host "SWE-bench Validation Runner"
Write-Host "================================"
Write-Host "Start time: $(Get-Date)"
Write-Host "API Key: $($env:GROK_API_KEY.Substring(0,15))..."
Write-Host "Working dir: $PWD"
Write-Host ""
Write-Host "First testing DanteCode subprocess call..."

python test_dantecode_call.py

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: DanteCode test call failed!" -ForegroundColor Red
    Write-Host "Fix the subprocess issue before running full validation" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================"
Write-Host "Test successful! Starting full validation..."
Write-Host "================================"
Write-Host ""

python swe_bench_runner.py --subset verified --limit 20 --offset 50

Write-Host ""
Write-Host "================================"
Write-Host "Validation complete: $(Get-Date)"
Write-Host "================================"
