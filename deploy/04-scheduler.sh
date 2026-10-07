#!/usr/bin/env bash
# Cloud Scheduler: one tick every 5 minutes (each property is due every 15/30/60 min and the
# properties spread over ticks) + a daily cleanup. Both call the worker with an OIDC token
# of the gsb-scheduler service account; the worker verifies issuer, audience and email.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/env.sh

URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
[ -n "$URL" ] || { echo "Service $SERVICE not found — run ./deploy/03-deploy-worker.sh first"; exit 1; }

upsert_job() {
  local name="$1" schedule="$2" path="$3" verb=create
  gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1 && verb=update
  gcloud scheduler jobs "$verb" http "$name" \
    --location="$REGION" --schedule="$schedule" --time-zone="Asia/Tokyo" \
    --uri="${URL}${path}" --http-method=POST \
    --oidc-service-account-email="$SCHEDULER_SA" --oidc-token-audience="$URL" \
    --attempt-deadline=600s --max-retry-attempts=0
}

upsert_job gsb-run-due "*/5 * * * *" /tasks/run-due
upsert_job gsb-cleanup "30 3 * * *" /tasks/cleanup
gcloud scheduler jobs run gsb-run-due --location="$REGION"
echo "Done. Logs: gcloud run services logs read $SERVICE --region=$REGION --limit=30"
