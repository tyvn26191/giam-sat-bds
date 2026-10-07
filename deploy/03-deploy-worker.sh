#!/usr/bin/env bash
# Build the worker image with Cloud Build and deploy it to Cloud Run.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/env.sh

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app" # deterministic Cloud Run URL
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/worker:${TAG}"

if [ "$ENABLE_BROWSER" = "true" ]; then
  RUNTIME_IMAGE="mcr.microsoft.com/playwright:v1.56.1-noble"
  RUNTIME_USER="pwuser"
  MEMORY="2Gi"
else
  RUNTIME_IMAGE="node:22-bookworm-slim"
  RUNTIME_USER="node"
  MEMORY="512Mi"
fi
SCREENSHOTS=false
[ -n "$ARTIFACT_BUCKET" ] && [ "$ENABLE_BROWSER" = "true" ] && SCREENSHOTS=true
SAVE_HTML=false
[ -n "$ARTIFACT_BUCKET" ] && SAVE_HTML=true

echo "== Building $IMAGE"
gcloud builds submit --config deploy/cloudbuild.worker.yaml \
  --substitutions="_IMAGE=${IMAGE},_RUNTIME_IMAGE=${RUNTIME_IMAGE},_RUNTIME_USER=${RUNTIME_USER}" .

# Mount only the secrets that exist (02-secrets.sh lets you skip some).
SECRETS=""
add_secret() {
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    SECRETS="${SECRETS:+$SECRETS,}$1=$1:latest"
  else
    echo "  (secret $1 not found — skipped)"
  fi
}
add_secret TELEGRAM_BOT_TOKEN
case "$EMAIL_PROVIDER" in
  smtp) add_secret SMTP_PASS ;;
  resend) add_secret RESEND_API_KEY ;;
  sendgrid) add_secret SENDGRID_API_KEY ;;
  mailgun) add_secret MAILGUN_API_KEY ;;
esac
SECRET_FLAGS=()
[ -n "$SECRETS" ] && SECRET_FLAGS=(--set-secrets="$SECRETS")

# "^@^" switches the env-var separator to "@" so values may contain commas.
ENV_VARS="^@^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@APP_URL=https://${PROJECT_ID}.web.app@ADMIN_EMAILS=${ADMIN_EMAILS}@MEMBER_EMAILS=${MEMBER_EMAILS}"
ENV_VARS="${ENV_VARS}@TASKS_AUDIENCE=${URL}@SCHEDULER_SA_EMAIL=${SCHEDULER_SA}@ENABLE_BROWSER=${ENABLE_BROWSER}"
ENV_VARS="${ENV_VARS}@EMAIL_PROVIDER=${EMAIL_PROVIDER}@EMAIL_FROM=${EMAIL_FROM}@SMTP_HOST=${SMTP_HOST}@SMTP_PORT=${SMTP_PORT}"
ENV_VARS="${ENV_VARS}@SMTP_USER=${SMTP_USER}@MAILGUN_DOMAIN=${MAILGUN_DOMAIN}@ARTIFACT_BUCKET=${ARTIFACT_BUCKET}"
ENV_VARS="${ENV_VARS}@ENABLE_SCREENSHOTS=${SCREENSHOTS}@SAVE_HTML_ON_CHANGE=${SAVE_HTML}@LOG_CHECKS=all@LOG_RETENTION_DAYS=14"

echo "== Deploying $SERVICE"
# --allow-unauthenticated: Firebase Hosting forwards /api/** here. Every route authenticates
# itself (Firebase ID token for /api, Cloud Scheduler OIDC token for /tasks).
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" --region="$REGION" --service-account="$WORKER_SA" \
  --allow-unauthenticated --ingress=all \
  --cpu=1 --memory="$MEMORY" --concurrency=10 --timeout=600 \
  --min-instances=0 --max-instances=2 \
  --set-env-vars="$ENV_VARS" "${SECRET_FLAGS[@]}"

# Older projects may expose a different URL form; accept both as OIDC audience.
STATUS_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
if [ "$STATUS_URL" != "$URL" ]; then
  gcloud run services update "$SERVICE" --region="$REGION" --update-env-vars="^@^TASKS_AUDIENCE=${URL},${STATUS_URL}"
fi
echo "Deployed: $STATUS_URL"
curl -fsS "$STATUS_URL/healthz" && echo
echo "Done. Next: ./deploy/04-scheduler.sh"
