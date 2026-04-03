# ============================================================================
# Run SWE-bench with DanteCode using Grok (PowerShell version)
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "DanteCode SWE-bench Runner" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Check for Grok API key
if (-not $env:GROK_API_KEY) {
    Write-Host "ERROR: GROK_API_KEY environment variable not set" -ForegroundColor Red
    Write-Host "Please set it with: `$env:GROK_API_KEY=`"your-key-here`"" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] GROK_API_KEY is set" -ForegroundColor Green
Write-Host ""

# Check Python version
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] Python version: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: python not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Install dependencies if needed
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
try {
    pip install -q datasets huggingface-hub 2>&1 | Out-Null
    Write-Host "[OK] Dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install Python dependencies" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Create results directory
New-Item -ItemType Directory -Force -Path "results" | Out-Null
Write-Host "[OK] Results directory ready" -ForegroundColor Green
Write-Host ""

# Check if DanteCode CLI is available
$dantecodePath = Get-Command dantecode -ErrorAction SilentlyContinue
if ($dantecodePath) {
    Write-Host "[OK] DanteCode CLI found at: $($dantecodePath.Path)" -ForegroundColor Green
} else {
    Write-Host "WARNING: dantecode CLI not found in PATH" -ForegroundColor Yellow
    Write-Host "The benchmark will attempt to find it in node_modules" -ForegroundColor Yellow
}
Write-Host ""

# Parse arguments with defaults
$limit = if ($args.Count -gt 0) { $args[0] } else { "5" }
$subset = if ($args.Count -gt 1) { $args[1] } else { "verified" }
$model = if ($args.Count -gt 2) { $args[2] } else { "grok/grok-3" }

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Subset: $subset" -ForegroundColor White
Write-Host "  Limit: $limit instances" -ForegroundColor White
Write-Host "  Model: $model" -ForegroundColor White
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Run the benchmark
Write-Host "Starting benchmark run..." -ForegroundColor Yellow
Write-Host ""

python swe_bench_runner.py `
    --subset $subset `
    --limit $limit `
    --model $model `
    --output-dir "./results"

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
if ($exitCode -eq 0) {
    Write-Host "[OK] Benchmark completed successfully!" -ForegroundColor Green
    Write-Host "Results saved in ./results/" -ForegroundColor White
} else {
    Write-Host "[FAIL] Benchmark failed with exit code $exitCode" -ForegroundColor Red
}
Write-Host "===================================" -ForegroundColor Cyan

exit $exitCode
