#!/usr/bin/env bash
# One-time Google Cloud setup: APIs, Firestore (Tokyo), Artifact Registry, service accounts,
# IAM, Firestore TTL policies, optional Cloud Storage bucket. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/env.sh

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

echo "== Enabling APIs"
gcloud services enable \
  run.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com \
  iamcredentials.googleapis.com identitytoolkit.googleapis.com firebase.googleapis.com

echo "== Firestore (Native mode, $REGION)"
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
fi

echo "== Artifact Registry"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
    --description="Property Watch images"
fi
# Keep only the 3 most recent images (storage cost).
printf '%s' '[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":3}},{"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"604800s"}}]' > /tmp/gsb-ar-policy.json
gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" --policy=/tmp/gsb-ar-policy.json --no-dry-run || true

echo "== Service accounts"
gcloud iam service-accounts describe "$WORKER_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create gsb-worker --display-name="Property Watch worker (Cloud Run)"
gcloud iam service-accounts describe "$SCHEDULER_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create gsb-scheduler --display-name="Property Watch scheduler (OIDC caller)"

echo "== IAM for the worker (least privilege)"
for ROLE in roles/datastore.user roles/firebaseauth.admin roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$WORKER_SA" --role="$ROLE" --condition=None >/dev/null
done
# Cloud Build uses the default compute service account in new projects.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/artifactregistry.writer --condition=None >/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/logging.logWriter --condition=None >/dev/null || true

echo "== Firestore TTL (logs expire automatically)"
for CG in monitorLogs notificationLogs monitorRuns; do
  gcloud firestore fields ttls update expireAt --collection-group="$CG" --enable-ttl --async || true
done

if [ -n "${ARTIFACT_BUCKET}" ]; then
  echo "== Cloud Storage bucket for screenshots/HTML: $ARTIFACT_BUCKET"
  gcloud storage buckets describe "gs://$ARTIFACT_BUCKET" >/dev/null 2>&1 ||
    gcloud storage buckets create "gs://$ARTIFACT_BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  printf '%s' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > /tmp/gsb-lifecycle.json
  gcloud storage buckets update "gs://$ARTIFACT_BUCKET" --lifecycle-file=/tmp/gsb-lifecycle.json
  gcloud storage buckets add-iam-policy-binding "gs://$ARTIFACT_BUCKET" --member="serviceAccount:$WORKER_SA" --role=roles/storage.objectAdmin >/dev/null
  # V4 signed URLs from Cloud Run need signBlob on its own service account.
  gcloud iam service-accounts add-iam-policy-binding "$WORKER_SA" --member="serviceAccount:$WORKER_SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null
fi

echo "Done. Next: ./deploy/02-secrets.sh"
