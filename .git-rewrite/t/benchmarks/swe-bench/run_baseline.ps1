# 10-Instance Baseline Runner
# Quick validation script to test improvements before large-scale runs

param(
    [int]$Offset = 0,
    [string]$Model = "grok/grok-3",
    [string]$ApiKey = $env:GROK_API_KEY
)

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "SWE-bench 10-Instance Baseline" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "ERROR: API key not provided!" -ForegroundColor Red
    Write-Host "Use: .\run_baseline.ps1 -ApiKey 'your-key'" -ForegroundColor Yellow
    exit 1
}

Write-Host "[INFO] Configuration:" -ForegroundColor Cyan
Write-Host "  Model: $Model" -ForegroundColor White
Write-Host "  Instances: 10" -ForegroundColor White
Write-Host "  Offset: $Offset" -ForegroundColor White
Write-Host ""

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDir = "results/baseline-$timestamp"

Write-Host "[INFO] Running baseline..." -ForegroundColor Cyan
Write-Host ""

python swe_bench_runner.py `
    --subset verified `
    --limit 10 `
    --offset $Offset `
    --model $Model `
    --dantecode "node C:\Projects\DanteCode\packages\cli\dist\index.js" `
    --api-key $ApiKey `
    --output-dir $outputDir

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan

if ($exitCode -eq 0) {
    Write-Host "[SUCCESS] Baseline complete!" -ForegroundColor Green

    # Show cost summary if available
    $resultsFile = Get-ChildItem -Path $outputDir -Filter "*.json" | Select-Object -First 1
    if ($resultsFile) {
        $results = Get-Content $resultsFile.FullName | ConvertFrom-Json

        Write-Host ""
        Write-Host "Results Summary:" -ForegroundColor Cyan
        Write-Host "  Pass Rate: $($results.pass_rate * 100)% ($($results.passed)/$($results.total_instances))" -ForegroundColor White
        Write-Host "  Total Cost: `$$([math]::Round($results.total_cost_usd, 4))" -ForegroundColor White
        Write-Host "  Avg Time: $([math]::Round($results.avg_time_seconds, 1))s" -ForegroundColor White

        # Quick assessment
        Write-Host ""
        if ($results.pass_rate -ge 0.8) {
            Write-Host "Assessment: EXCELLENT (80%+) - Ready for scale!" -ForegroundColor Green
        } elseif ($results.pass_rate -ge 0.6) {
            Write-Host "Assessment: GOOD (60-80%) - Competitive with SOTA" -ForegroundColor Green
        } elseif ($results.pass_rate -ge 0.4) {
            Write-Host "Assessment: FAIR (40-60%) - Needs optimization" -ForegroundColor Yellow
        } else {
            Write-Host "Assessment: NEEDS WORK (<40%) - Debug and iterate" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[ERROR] Baseline failed" -ForegroundColor Red
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Results saved to: $outputDir" -ForegroundColor White

exit $exitCode
