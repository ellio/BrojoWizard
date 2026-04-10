<#
.SYNOPSIS
    Deploy BrojoWizard to Cloud Run on the sidetrack-481819 GCP project.

.DESCRIPTION
    Builds a Docker image, pushes to Artifact Registry, and deploys to Cloud Run
    with always-on CPU to keep the Discord WebSocket connection alive.

.PARAMETER SkipBuild
    Skip the Docker build/push and just update the Cloud Run service config.
#>

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# ── Config ─────────────────────────────────────────────────────────────────────
$PROJECT_ID   = 'sidetrack-481819'
$REGION       = 'us-central1'
$SERVICE_NAME = 'brojo-bot'
$REPO         = "$REGION-docker.pkg.dev/$PROJECT_ID/sidetrack-repo/$SERVICE_NAME"
$TAG          = Get-Date -Format 'yyyyMMdd-HHmmss'
$IMAGE        = "${REPO}:${TAG}"

Write-Host "🧙 BrojoWizard Deployment" -ForegroundColor Magenta
Write-Host "   Project:  $PROJECT_ID"
Write-Host "   Service:  $SERVICE_NAME"
Write-Host "   Region:   $REGION"
Write-Host "   Image:    $IMAGE"
Write-Host ""

# ── Build & Push ───────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "📦 Building Docker image..." -ForegroundColor Cyan
    docker build -t $IMAGE .
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }

    Write-Host "🚀 Pushing to Artifact Registry..." -ForegroundColor Cyan
    docker push $IMAGE
    if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }
}

# ── Deploy to Cloud Run ───────────────────────────────────────────────────────
Write-Host "☁️  Deploying to Cloud Run..." -ForegroundColor Cyan

# Note: Environment variables should be set via Cloud Run secrets or env vars.
# First deployment: set them manually in the console or with:
#   gcloud run services update brojo-bot --set-env-vars "DISCORD_BOT_TOKEN=xxx,DISCORD_CLIENT_ID=xxx,GEMINI_API_KEY=xxx"

gcloud run deploy $SERVICE_NAME `
    --project $PROJECT_ID `
    --region $REGION `
    --image $IMAGE `
    --platform managed `
    --no-allow-unauthenticated `
    --min-instances 1 `
    --max-instances 1 `
    --cpu-always-allocated `
    --memory 256Mi `
    --cpu 1 `
    --port 8080 `
    --timeout 300

if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed" }

# ── Cleanup old images (keep 3 most recent) ────────────────────────────────────
Write-Host "🧹 Cleaning up old images..." -ForegroundColor Yellow
$digests = gcloud artifacts docker images list $REPO `
    --include-tags `
    --sort-by="~UPDATE_TIME" `
    --format="value(version)" `
    --project $PROJECT_ID 2>$null

if ($digests) {
    $digestList = $digests -split "`n" | Where-Object { $_ }
    if ($digestList.Count -gt 3) {
        $toDelete = $digestList | Select-Object -Skip 3
        foreach ($d in $toDelete) {
            Write-Host "   Deleting: $d"
            gcloud artifacts docker images delete "${REPO}@${d}" --quiet --project $PROJECT_ID 2>$null
        }
    }
}

Write-Host ""
Write-Host "✅ BrojoWizard deployed successfully!" -ForegroundColor Green
Write-Host "   Image: $IMAGE"
