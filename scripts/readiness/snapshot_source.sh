#!/usr/bin/env bash
# Export the committed HEAD of the repository containing this script into an empty directory and
# record, WITHOUT copying them, the working-tree changes that were excluded.
#
#   snapshot_source.sh SNAPSHOT_DIR EVIDENCE_FILE
#
# The snapshot is `git archive HEAD` only: tracked-but-modified files come out as committed, untracked
# files (environment.yml, stale bundles, node_modules, ...) are never included. EVIDENCE_FILE lists the
# HEAD sha and every excluded change (`git status --porcelain`, with tracked diffs summarised). The
# script then verifies the isolation: each excluded path is absent from the snapshot or byte-identical
# to its committed version, and no built bundle or dependency directory is present.
# stdout: the tested SHA.  Exit 0 ok, 1 isolation failure, 2 usage / git error. Never modifies the repo.
set -euo pipefail
SNAP="${1:-}"; EVID="${2:-}"
[ -n "$SNAP" ] && [ -n "$EVID" ] || { echo "usage: $0 SNAPSHOT_DIR EVIDENCE_FILE" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git checkout: $ROOT" >&2; exit 2; }
SHA="$(git rev-parse HEAD)"
mkdir -p "$SNAP"
[ -z "$(ls -A "$SNAP")" ] || { echo "snapshot dir $SNAP is not empty" >&2; exit 2; }

git archive "$SHA" | tar -x -C "$SNAP"

{
  echo "tested HEAD: $SHA"
  echo "source: committed content only (git archive); the working-tree changes below were NOT copied"
  echo
  echo "## git status --porcelain (all excluded)"
  git status --porcelain --untracked-files=all
  echo
  echo "## tracked changes (git diff HEAD --stat)"
  git diff HEAD --stat
} > "$EVID"

bad=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  path="${line:3}"; path="${path##* -> }"; path="${path%\"}"; path="${path#\"}"
  code="${line:0:2}"
  if [ "$code" = "??" ]; then
    # untracked: must not be in the snapshot (a trailing slash means a whole directory)
    if [ -e "$SNAP/$path" ]; then echo "ISOLATION FAILURE: untracked $path is in the snapshot" >&2; bad=1; fi
  elif git cat-file -e "$SHA:$path" 2>/dev/null; then
    if ! diff -q <(git show "$SHA:$path") "$SNAP/$path" >/dev/null 2>&1; then
      echo "ISOLATION FAILURE: $path differs from its committed content in the snapshot" >&2; bad=1
    fi
  elif [ -e "$SNAP/$path" ]; then
    echo "ISOLATION FAILURE: $path (not in HEAD) is in the snapshot" >&2; bad=1
  fi
done < <(git status --porcelain --untracked-files=all)

for forbidden in flask_backend/static/react react-frontend/node_modules react-frontend/dist tests/readiness/browser/node_modules; do
  if [ -e "$SNAP/$forbidden" ]; then echo "ISOLATION FAILURE: $forbidden is present in the snapshot" >&2; bad=1; fi
done
echo "isolation check: $([ "$bad" = 0 ] && echo ok || echo FAILED)" >> "$EVID"
echo "$SHA"
exit "$bad"
