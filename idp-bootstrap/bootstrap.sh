#!/usr/bin/env bash
#
# Bootstrap the IDP prototype's GCP foundations (project, APIs, state bucket,
# Workload Identity Federation, CI service account) with LOCAL Terraform state.
#
# Safe by default: runs plan and asks before applying. Nothing is created until
# you confirm.
#
# Usage:
#   ./bootstrap.sh                 # init + plan + (confirmed) apply
#   ./bootstrap.sh --plan-only     # init + plan, then stop
#   ./bootstrap.sh --set-github-vars  # after apply, push outputs to GitHub repo variables (needs gh)
#
set -euo pipefail

cd "$(dirname "$0")"

PLAN_ONLY=false
SET_GH_VARS=false
for arg in "$@"; do
  case "$arg" in
    --plan-only) PLAN_ONLY=true ;;
    --set-github-vars) SET_GH_VARS=true ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Checking prerequisites"
command -v terraform >/dev/null || { echo "terraform not found" >&2; exit 1; }
command -v gcloud >/dev/null    || { echo "gcloud not found" >&2; exit 1; }

echo "==> Checking GCP auth (Application Default Credentials)"
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "No ADC found. Run:  gcloud auth application-default login" >&2
  exit 1
fi

if [[ ! -f terraform.tfvars ]]; then
  echo "No terraform.tfvars found. Copy the example and edit it:"
  echo "    cp terraform.tfvars.example terraform.tfvars"
  exit 1
fi

echo "==> terraform init"
terraform init -input=false

echo "==> terraform validate"
terraform validate

echo "==> terraform plan"
terraform plan -input=false -out=tfplan

if $PLAN_ONLY; then
  echo "Plan written to ./tfplan (plan-only mode). Not applying."
  exit 0
fi

read -r -p "Apply this plan and create real GCP resources? [y/N] " reply
if [[ "${reply:-N}" != "y" && "${reply:-N}" != "Y" ]]; then
  echo "Aborted. No changes made."
  exit 0
fi

echo "==> terraform apply"
terraform apply -input=false tfplan
rm -f tfplan

if $SET_GH_VARS; then
  command -v gh >/dev/null || { echo "gh not found; skipping GitHub var sync" >&2; exit 1; }
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo edoatley/idp-prototype)"
  echo "==> Setting GitHub repository variables on $REPO"
  gh variable set GCP_PROJECT_ID                --repo "$REPO" --body "$(terraform output -raw project_id)"
  gh variable set GCP_REGION                    --repo "$REPO" --body "$(terraform output -raw region)"
  gh variable set TFSTATE_BUCKET                --repo "$REPO" --body "$(terraform output -raw tfstate_bucket)"
  gh variable set GCP_SERVICE_ACCOUNT           --repo "$REPO" --body "$(terraform output -raw ci_service_account)"
  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --body "$(terraform output -raw workload_identity_provider)"
  echo "Done."
fi

echo
echo "==> Outputs (publish these as GitHub Actions repository variables):"
terraform output
