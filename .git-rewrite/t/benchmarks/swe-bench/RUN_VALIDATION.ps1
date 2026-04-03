# SWE-Bench Validation Runner for DanteCode
# Enterprise Readiness Validation Script

param(
    [int]$Limit = 10,
    [int]$Offset = 20,
    [string]$Subset = "verified",
    [string]$Model = "grok/grok-3"
)

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "DanteCode SWE-Bench Validation" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if GROK_API_KEY is set
if (-not $env:GROK_API_KEY) {
    Write-Host "[ERROR] GROK_API_KEY environment variable not set!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set it first:" -ForegroundColor Yellow
    Write-Host '  $env:GROK_API_KEY = "<XAI_KEY_REMOVED>..."' -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "[OK] API key found: " -NoNewline -ForegroundColor Green
Write-Host $env:GROK_API_KEY.Substring(0, 15) + "..." -ForegroundColor Gray
Write-Host ""

# Configuration
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Subset: $Subset" -ForegroundColor Gray
Write-Host "  Instances: $Limit (offset $Offset)" -ForegroundColor Gray
Write-Host "  Model: $Model" -ForegroundColor Gray
Write-Host "  Max Rounds: 15" -ForegroundColor Gray
Write-Host "  Clone Timeout: 300s" -ForegroundColor Gray
Write-Host "  Retry: Enabled (3 attempts)" -ForegroundColor Gray
Write-Host ""

# Estimate
$estimatedMinutes = [math]::Ceiling(($Limit * 5) / 2)
Write-Host "Estimated time: $estimatedMinutes-" -NoNewline -ForegroundColor Yellow
Write-Host ($estimatedMinutes * 2) -NoNewline -ForegroundColor Yellow
Write-Host " minutes" -ForegroundColor Yellow
Write-Host ""

Write-Host "Starting validation..." -ForegroundColor Cyan
Write-Host ""

# Run validation
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = "validation-$timestamp.log"

try {
    python swe_bench_runner.py `
        --subset $Subset `
        --limit $Limit `
        --offset $Offset `
        --model $Model `
        2>&1 | Tee-Object -FilePath $logFile

    Write-Host ""
    Write-Host "=====================================================================" -ForegroundColor Green
    Write-Host "Validation Complete!" -ForegroundColor Green
    Write-Host "=====================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results saved to:" -ForegroundColor Cyan
    Write-Host "  Log: $logFile" -ForegroundColor Gray

    # Find the most recent results JSON
    $resultsFile = Get-ChildItem -Path ..\results -Filter "swe-bench-*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($resultsFile) {
        Write-Host "  Results: $($resultsFile.FullName)" -ForegroundColor Gray

        # Parse and display summary
        $results = Get-Content $resultsFile.FullName | ConvertFrom-Json
        Write-Host ""
        Write-Host "Summary:" -ForegroundColor Cyan
        Write-Host "  Pass Rate: " -NoNewline -ForegroundColor Gray
        Write-Host "$([math]::Round($results.pass_rate * 100, 1))%" -ForegroundColor $(if ($results.pass_rate -gt 0.15) { "Green" } elseif ($results.pass_rate -gt 0.05) { "Yellow" } else { "Red" })
        Write-Host "  Passed: $($results.passed)/$($results.total_instances)" -ForegroundColor Gray
        Write-Host "  Failed: $($results.failed)" -ForegroundColor Gray
        Write-Host "  Errors: $($results.errors)" -ForegroundColor Gray
        Write-Host "  Avg Time: $([math]::Round($results.avg_time_seconds, 1))s" -ForegroundColor Gray
        Write-Host "  Total Cost: `$$([math]::Round($results.total_cost_usd, 4))" -ForegroundColor Gray
    }

} catch {
    Write-Host ""
    Write-Host "[ERROR] Validation failed: $_" -ForegroundColor Red
    exit 1
}
