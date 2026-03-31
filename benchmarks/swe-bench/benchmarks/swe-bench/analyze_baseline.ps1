# Baseline Results Analyzer
# Analyzes results from baseline run and provides next-step recommendations

param(
    [string]$ResultsDir = (Get-ChildItem -Path "results/baseline-*" | Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1).FullName
)

if (-not $ResultsDir -or -not (Test-Path $ResultsDir)) {
    Write-Host "ERROR: No results directory found" -ForegroundColor Red
    exit 1
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Baseline Results Analysis" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$resultsFile = Get-ChildItem -Path $ResultsDir -Filter "*.json" | Select-Object -First 1

if (-not $resultsFile) {
    Write-Host "ERROR: No results JSON found in $ResultsDir" -ForegroundColor Red
    exit 1
}

$results = Get-Content $resultsFile.FullName | ConvertFrom-Json

Write-Host "Results Summary:" -ForegroundColor Cyan
Write-Host "  Directory: $ResultsDir" -ForegroundColor White
Write-Host "  Instances: $($results.total_instances)" -ForegroundColor White
Write-Host "  Passed: $($results.passed)" -ForegroundColor White
Write-Host "  Failed: $($results.failed)" -ForegroundColor White
Write-Host "  Pass Rate: $($results.pass_rate * 100)%" -ForegroundColor White
Write-Host "  Total Cost: `$$([math]::Round($results.total_cost_usd, 4))" -ForegroundColor White
Write-Host "  Avg Time: $([math]::Round($results.avg_time_seconds, 1))s" -ForegroundColor White
Write-Host ""

# Assessment
$passRate = $results.pass_rate
$assessment = ""
$recommendation = ""
$nextStep = ""
$color = "White"

if ($passRate -ge 0.8) {
    $assessment = "EXCELLENT (80%+)"
    $recommendation = "Ready for scale testing!"
    $nextStep = "Run 50-instance validation: .\RUN_BENCHMARK.ps1 -Limit 50"
    $color = "Green"
} elseif ($passRate -ge 0.6) {
    $assessment = "GOOD (60-80%)"
    $recommendation = "Competitive with SOTA (Aider 88%, OpenHands 77.6%)"
    $nextStep = "Consider quick optimizations, then scale to 50 instances"
    $color = "Green"
} elseif ($passRate -ge 0.4) {
    $assessment = "FAIR (40-60%)"
    $recommendation = "Needs optimization before scale testing"
    $nextStep = "Implement token optimization and test-first prompts, then re-run baseline"
    $color = "Yellow"
} else {
    $assessment = "NEEDS WORK (<40%)"
    $recommendation = "Debug and iterate systematically"
    $nextStep = "Analyze failure patterns, investigate root causes, implement fixes"
    $color = "Red"
}

Write-Host "Assessment: $assessment" -ForegroundColor $color
Write-Host ""
Write-Host "Recommendation:" -ForegroundColor Cyan
Write-Host "  $recommendation" -ForegroundColor White
Write-Host ""
Write-Host "Next Step:" -ForegroundColor Cyan
Write-Host "  $nextStep" -ForegroundColor White
Write-Host ""

# Failure analysis if available
if ($results.failed -gt 0) {
    Write-Host "Failure Analysis:" -ForegroundColor Cyan

    # Check if we have detailed results
    $detailedFile = Get-ChildItem -Path $ResultsDir -Filter "*detailed*.json" | Select-Object -First 1
    if ($detailedFile) {
        $detailed = Get-Content $detailedFile.FullName | ConvertFrom-Json

        # Categorize failures
        $timeouts = @($detailed.results | Where-Object { $_.error -like "*timeout*" })
        $testFailures = @($detailed.results | Where-Object { $_.error -like "*test*" -and $_.error -notlike "*timeout*" })
        $toolErrors = @($detailed.results | Where-Object { $_.error -like "*tool*" -or $_.error -like "*Edit*" })
        $other = @($detailed.results | Where-Object {
            $_.error -notlike "*timeout*" -and
            $_.error -notlike "*test*" -and
            $_.error -notlike "*tool*" -and
            $_.error -notlike "*Edit*"
        })

        if ($timeouts.Count -gt 0) {
            Write-Host "  Timeouts: $($timeouts.Count)" -ForegroundColor Yellow
        }
        if ($testFailures.Count -gt 0) {
            Write-Host "  Test Failures: $($testFailures.Count)" -ForegroundColor Yellow
        }
        if ($toolErrors.Count -gt 0) {
            Write-Host "  Tool Errors: $($toolErrors.Count)" -ForegroundColor Yellow
        }
        if ($other.Count -gt 0) {
            Write-Host "  Other: $($other.Count)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Run with --verbose for detailed failure analysis" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan

# Project to 50 instances
if ($passRate -ge 0.4) {
    $projected50Cost = $results.total_cost_usd * 5
    $projected50Time = [math]::Round($results.avg_time_seconds * 50 / 60, 1)

    Write-Host ""
    Write-Host "Projection for 50 Instances:" -ForegroundColor Cyan
    Write-Host "  Estimated Cost: `$$([math]::Round($projected50Cost, 4))" -ForegroundColor White
    Write-Host "  Estimated Time: ~$projected50Time minutes" -ForegroundColor White
    Write-Host "  Expected Pass Rate: ~$($passRate * 100)% (assuming consistency)" -ForegroundColor White
}
