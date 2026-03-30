# Test SWE-bench with different models to find best performer
# Starts with cheapest/fastest models

param(
    [int]$Limit = 3,  # Test with just 3 instances per model (faster)
    [int]$Offset = 0   # Skip first N instances
)

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Multi-Model SWE-bench Test" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check API keys
$hasAnthropic = $env:ANTHROPIC_API_KEY
$hasOpenAI = $env:OPENAI_API_KEY
$hasGrok = $env:GROK_API_KEY

Write-Host "API Keys Available:" -ForegroundColor Yellow
if ($hasGrok) { Write-Host "  [OK] Grok" -ForegroundColor Green } else { Write-Host "  [SKIP] Grok" -ForegroundColor DarkGray }
if ($hasAnthropic) { Write-Host "  [OK] Anthropic (Claude)" -ForegroundColor Green } else { Write-Host "  [SKIP] Anthropic" -ForegroundColor DarkGray }
if ($hasOpenAI) { Write-Host "  [OK] OpenAI (GPT)" -ForegroundColor Green } else { Write-Host "  [SKIP] OpenAI" -ForegroundColor DarkGray }
Write-Host ""

# Models to test (in order: cheapest/fastest first)
$models = @(
    @{
        Name = "GPT-4o Mini"
        ID = "openai/gpt-4o-mini"
        Enabled = $hasOpenAI
        Cost = "~$0.05 per instance"
    },
    @{
        Name = "Claude Haiku 4.5"
        ID = "anthropic/claude-haiku-4-5"
        Enabled = $hasAnthropic
        Cost = "~$0.10 per instance"
    },
    @{
        Name = "Grok 3"
        ID = "grok/grok-3"
        Enabled = $hasGrok
        Cost = "~$0.15 per instance"
    }
)

$results = @()

foreach ($model in $models) {
    if (-not $model.Enabled) {
        Write-Host "Skipping $($model.Name) - no API key" -ForegroundColor DarkGray
        continue
    }

    Write-Host ""
    Write-Host "====================================" -ForegroundColor Cyan
    Write-Host "Testing: $($model.Name)" -ForegroundColor Cyan
    Write-Host "Model ID: $($model.ID)" -ForegroundColor White
    Write-Host "Expected Cost: $($model.Cost)" -ForegroundColor White
    Write-Host "====================================" -ForegroundColor Cyan
    Write-Host ""

    $startTime = Get-Date

    # Run benchmark
    python swe_bench_runner.py `
        --subset verified `
        --limit $Limit `
        --model $($model.ID) `
        --output-dir "./results"

    $elapsed = (Get-Date) - $startTime
    $exitCode = $LASTEXITCODE

    Write-Host ""
    if ($exitCode -eq 0) {
        Write-Host "[OK] $($model.Name) completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $($model.Name) completed with errors" -ForegroundColor Yellow
    }
    Write-Host "Time: $($elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor White

    $results += @{
        Model = $model.Name
        ExitCode = $exitCode
        Time = $elapsed.TotalSeconds
    }
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

foreach ($result in $results) {
    $status = if ($result.ExitCode -eq 0) { "[PASS]" } else { "[FAIL]" }
    $color = if ($result.ExitCode -eq 0) { "Green" } else { "Yellow" }
    Write-Host "$status $($result.Model) - $($result.Time.ToString('F1'))s" -ForegroundColor $color
}

Write-Host ""
Write-Host "Check results/ directory for detailed JSON output" -ForegroundColor White
