#!/usr/bin/env bash
# Deploys the MCP server as its OWN Cloud Run service.
#
# It must never share a process or a revision with the web app. If this service falls
# over, the journal has to keep working.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-e090d449-585b-495d-8b9}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-compass-mcp}"
SA="${SA:-compass-mcp@${PROJECT_ID}.iam.gserviceaccount.com}"

echo "Deploying ${SERVICE} to ${REGION} in ${PROJECT_ID}"

gcloud run deploy "${SERVICE}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --service-account "${SA}" \
  --labels dev-tutorial=cloud-run-ai-challenge \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},FIRESTORE_DATABASE_ID=ai-studio-compass-c30e6245-09d5-4235-8adc-d4c50e6ddca0" \
  --max-instances 3

echo
echo "Deployed. The service is reachable without Cloud Run IAM, because callers"
echo "authenticate with a Firebase ID token that this server verifies itself."
