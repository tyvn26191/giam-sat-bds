#!/usr/bin/env bash
# Build the web app and deploy Firebase Hosting + Firestore rules + indexes.
# Needs apps/web/.env.production (copy apps/web/.env.example) with the Firebase web config.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/env.sh

if [ ! -f apps/web/.env.production ]; then
  echo "Missing apps/web/.env.production (copy apps/web/.env.example and fill in the Firebase web config)"
  exit 1
fi
npm ci --no-audit --no-fund
npm run build -w @gsb/web
npx firebase deploy --only hosting,firestore --project "$PROJECT_ID"
echo "Open https://${PROJECT_ID}.web.app"
