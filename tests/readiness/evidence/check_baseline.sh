#!/usr/bin/env bash
# Safe, repeatable reproduction of the pre-fix startup defects.
#   usage: check_baseline.sh <baseline-rev> <python-with-backend-deps> [node_modules-dir]
# The baseline revision is exported with `git archive` into a private temp dir; all
# probes (including the vite build) run there.  The caller's checkout -- its logs,
# bundle, node_modules -- is never written to.  Each probe must show its DEFECT;
# exit 0 means all three defects reproduced, exit 1 means one did not (baseline
# looks fixed or the probe is broken).  Independent of scripts/readiness/test-fast.sh.
set -u
REV="${1:?usage: check_baseline.sh <baseline-rev> <python> [node_modules]}"; PY="${2:?}"
[ -x "$PY" ] || { echo "python not found" >&2; exit 2; }; case "$PY" in /*) ;; *) PY="$PWD/$PY";; esac
NM="${3:-$(git rev-parse --show-toplevel)/react-frontend/node_modules}"
[ -d "$NM" ] || { echo "node_modules not found at $NM" >&2; exit 2; }
TOP="$(git rev-parse --show-toplevel)"
W="$(mktemp -d)"; trap 'rm -rf "$W" "${SC:-}"' EXIT
git -C "$TOP" archive "$REV" | tar -x -C "$W" || exit 2
ln -s "$NM" "$W/react-frontend/node_modules"
cd "$W"; export PYTHONPATH="$W" PYTHONDONTWRITEBYTECODE=1; unset FLASK_APP
fail=0
expect() { # name, pattern, output
  if printf '%s' "$3" | grep -q -- "$2"; then echo "DEFECT REPRODUCED [$1]: $(printf '%s' "$3" | grep -- "$2" | head -n1)"
  else echo "DEFECT NOT SEEN [$1]; output was: $3"; fail=1; fi; }

A="$(cd "$W" && "$PY" -m flask run --port 5099 2>&1 | tail -n 3)"
expect "A flask run has no discoverable app" "Could not locate a Flask application" "$A"

B="$(cd "$(mktemp -d)" && "$PY" -c "from flask_backend.app import create_app; create_app()" 2>&1 | tail -n 1)"
expect "B create_app without log dirs" "Unable to configure handler" "$B"

SC="$(mktemp -d)"; mkdir -p "$SC/flask_backend/log_utils/logs"   # baseline logs are cwd-relative; give C a log dir so only C's defect shows
( cd react-frontend && npx vite build --outDir "$W/flask_backend/static/react" --emptyOutDir >/dev/null 2>&1 )
JS="$(grep -o '/assets/[^"]*\.js' flask_backend/static/react/index.html | head -n1)"
C="$(cd "$SC" && "$PY" - "$JS" <<'PY' 2>&1 | tail -n 1
import sys
from flask_backend.app import create_app
r = create_app().test_client().get(sys.argv[1])
print(sys.argv[1], "->", r.status_code, r.content_type, r.data[:15])
PY
)"
expect "C missing/unprefixed JS served as HTML" "text/html.*<!doctype html>" "$C"
[ "$fail" = 0 ] && echo "BASELINE $REV: all 3 defects reproduced" || echo "BASELINE $REV: a defect did NOT reproduce"
exit "$fail"
