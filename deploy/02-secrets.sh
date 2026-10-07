#!/usr/bin/env bash
# Store secrets in Secret Manager. Values are typed at a hidden prompt — never passed as
# arguments, never written to disk — and only the worker service account can read them.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/env.sh

put_secret() {
  local name="$1" prompt="$2" value
  read -rsp "$prompt (Enter = skip): " value
  echo
  if [ -z "$value" ]; then
    echo "  skipped $name"
    return
  fi
  gcloud secrets describe "$name" >/dev/null 2>&1 || gcloud secrets create "$name" --replication-policy=automatic >/dev/null
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$WORKER_SA" --role=roles/secretmanager.secretAccessor >/dev/null
  echo "  stored $name"
}

put_secret TELEGRAM_BOT_TOKEN "Telegram bot token from @BotFather"
case "$EMAIL_PROVIDER" in
  smtp) put_secret SMTP_PASS "SMTP password / app password" ;;
  resend) put_secret RESEND_API_KEY "Resend API key" ;;
  sendgrid) put_secret SENDGRID_API_KEY "SendGrid API key" ;;
  mailgun) put_secret MAILGUN_API_KEY "Mailgun API key" ;;
esac
echo "Done. Next: ./deploy/03-deploy-worker.sh"
