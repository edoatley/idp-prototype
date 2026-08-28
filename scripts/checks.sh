#!/usr/bin/env bash
# Local mirror of the credential-free `terraform-checks` CI: run the same
# fmt / validate / test / tflint / trivy gates over every Terraform root before
# you push. No cloud access or credentials required.
#
#   scripts/checks.sh              # run all checks on all roots
#   scripts/checks.sh --fmt-fix    # auto-format instead of just checking
#   scripts/checks.sh idp-gitops/modules/gcs-bucket   # limit to one root
#
# Exit non-zero on the first failure so it's CI-faithful.
set -euo pipefail

cd "$(dirname "$0")/.."

# Terraform roots to check — keep in sync with the matrix in
# .github/workflows/terraform-checks.yml.
DEFAULT_ROOTS=(
  idp-bootstrap
  idp-gitops/modules/gcs-bucket
)

FMT_FLAG="-check"
ROOTS=()
for arg in "$@"; do
  case "$arg" in
    --fmt-fix) FMT_FLAG="" ;;
    -h | --help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) ROOTS+=("$arg") ;;
  esac
done
[ ${#ROOTS[@]} -eq 0 ] && ROOTS=("${DEFAULT_ROOTS[@]}")

need() { command -v "$1" >/dev/null 2>&1 || { echo "!! '$1' not installed — see README"; exit 127; }; }
need terraform
need tflint
need trivy

for root in "${ROOTS[@]}"; do
  echo "==================================================================="
  echo "== $root"
  echo "==================================================================="

  echo "-- terraform fmt"
  # shellcheck disable=SC2086
  terraform fmt $FMT_FLAG -recursive "$root"

  echo "-- terraform init (no backend)"
  terraform -chdir="$root" init -backend=false -input=false >/dev/null

  echo "-- terraform validate"
  terraform -chdir="$root" validate

  echo "-- terraform test (mock provider)"
  terraform -chdir="$root" test

  echo "-- tflint"
  tflint --chdir="$root" --init >/dev/null
  tflint --chdir="$root" --format compact

  echo "-- trivy config (misconfig scan; honours .trivyignore)"
  trivy config --quiet --exit-code 1 --severity LOW,MEDIUM,HIGH,CRITICAL "$root"

  echo "-- OK: $root"
  echo
done

echo "All checks passed."
