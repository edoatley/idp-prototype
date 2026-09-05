#!/usr/bin/env bash
# Emit the stack directories a workflow should act on, as a JSON array ready for
# a GitHub Actions matrix. A stack is idp-gitops/stacks/<env>/<name> — a path
# four segments deep — and counts only if it contains a main.tf.
#
#   detect-stacks.sh --changed [--merge-base] --base <sha> [--head <ref>]
#   detect-stacks.sh --removed --base <sha> [--head <ref>]
#   detect-stacks.sh --all
#
#   --changed     stacks added or modified between base and head  (pr.yml, apply.yml)
#   --removed     stacks whose files were deleted and are now gone (destroy.yml)
#   --all         every stack in the tree, ignoring git history    (drift.yml)
#   --merge-base  diff base...head instead of base head — on a PR this ignores
#                 commits main gained after the branch was cut
#   --base <sha>  required by --changed/--removed; an all-zero sha (the first
#                 push to a branch) falls back to head's parent
#   --head <ref>  defaults to HEAD
#
# Writes `base=` and `stacks=` to $GITHUB_OUTPUT, or to stdout when that is
# unset — so the same invocations CI runs can be run and diffed locally.
set -euo pipefail

cd "$(dirname "$0")/../.."

STACKS_ROOT="idp-gitops/stacks"

MODE=""
BASE=""
HEAD="HEAD"
MERGE_BASE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --changed) MODE="changed" ;;
    --removed) MODE="removed" ;;
    --all) MODE="all" ;;
    --merge-base) MERGE_BASE=1 ;;
    --base)
      BASE="${2:-}"
      shift
      ;;
    --head)
      HEAD="${2:-}"
      shift
      ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "!! unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

[ -n "$MODE" ] || {
  echo "!! one of --changed / --removed / --all is required" >&2
  exit 2
}
if [ "$MODE" != "all" ] && [ -z "$BASE" ]; then
  echo "!! --base is required with --$MODE" >&2
  exit 2
fi

# The first push to a branch reports an all-zero "before"; fall back to the
# parent of head (on a runner the checkout is at head, so this is HEAD~1).
if [ -n "$BASE" ] && ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  BASE=$(git rev-parse "${HEAD}~1")
fi

if [ "$MODE" = "all" ]; then
  dirs=$(find "$STACKS_ROOT" -mindepth 2 -maxdepth 2 -type d | sort)
else
  FILTER=()
  if [ "$MODE" = "removed" ]; then FILTER=(--diff-filter=D); fi
  if [ "$MERGE_BASE" = "1" ]; then RANGE=("${BASE}...${HEAD}"); else RANGE=("$BASE" "$HEAD"); fi
  # Trim each changed file down to its stack directory.
  dirs=$(git diff --name-only ${FILTER[@]+"${FILTER[@]}"} "${RANGE[@]}" -- "$STACKS_ROOT/" \
    | awk -F/ 'NF>=4 {print $1"/"$2"/"$3"/"$4}' | sort -u)
fi

# --removed wants the stacks whose main.tf is gone (destroy is a separate
# pipeline from apply); every other mode wants the ones where it is present.
WANT_MAINTF=1
if [ "$MODE" = "removed" ]; then WANT_MAINTF=0; fi

stacks=()
while IFS= read -r d; do
  [ -n "$d" ] || continue
  if [ -f "$d/main.tf" ]; then present=1; else present=0; fi
  if [ "$present" = "$WANT_MAINTF" ]; then stacks+=("$d"); fi
done <<<"$dirs"

if [ ${#stacks[@]} -eq 0 ]; then
  json="[]"
else
  json=$(printf '%s\n' "${stacks[@]}" | jq -R . | jq -sc .)
fi

emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >>"$GITHUB_OUTPUT"; else echo "$1"; fi
}
[ -z "$BASE" ] || emit "base=$BASE"
emit "stacks=$json"

case "$MODE" in
  changed) label="Changed stacks" ;;
  removed) label="Removed stacks" ;;
  all) label="Stacks" ;;
esac
echo "$label: ${stacks[*]:-none}"
