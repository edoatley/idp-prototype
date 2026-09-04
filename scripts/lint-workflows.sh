#!/usr/bin/env bash
# Local mirror of the credential-free `workflow-checks` CI: lint the workflow
# YAML, the shell scripts they delegate to, and the github-script report
# modules. No cloud access or credentials required.
#
#   scripts/lint-workflows.sh          # run every check
#
# Needs actionlint, shellcheck and node on PATH:
#   brew install actionlint shellcheck
#
# Exit non-zero on the first failure so it's CI-faithful.
set -euo pipefail

cd "$(dirname "$0")/.."

for arg in "$@"; do
  case "$arg" in
    -h | --help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "!! unknown argument: $arg"
      exit 2
      ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || {
  echo "!! '$1' not installed — see the header of this script"
  exit 127
}; }
need actionlint
need shellcheck
need node

echo "-- actionlint (workflow YAML + inline run: blocks)"
actionlint -color

echo "-- shellcheck (extracted scripts)"
shellcheck .github/scripts/*.sh scripts/*.sh idp-bootstrap/*.sh

echo "-- node --check (report modules)"
for f in .github/scripts/*.js; do node --check "$f"; done

echo "-- TF_VERSION pinned consistently across workflows"
versions=$(grep -h '^  TF_VERSION: ' .github/workflows/*.yml | sort -u)
if [ "$(echo "$versions" | wc -l)" -ne 1 ]; then
  echo "!! TF_VERSION differs between workflows:"
  echo "$versions"
  exit 1
fi

echo
echo "All workflow checks passed."
