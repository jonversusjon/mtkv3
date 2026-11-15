#!/usr/bin/env bash
# Re-runnable capture of the pre-fix startup defects. Run against the BASELINE
# commit (git worktree of 653b2f0), not the fixed tree. Output = baseline.txt.
set -u
ROOT="${1:?usage: capture_baseline.sh <baseline-checkout> <python-with-deps>}"; PY="${2:?}"
cd "$ROOT"
echo "== A: default container CMD 'flask run' (no FLASK_APP) =="
PYTHONPATH="$ROOT" "$PY" -m flask run --port 5099 2>&1 | tail -n 2
echo "== B: create_app() with a clean checkout (no log dir) =="
PYTHONPATH="$ROOT" "$PY" -c "from flask_backend.app import create_app; create_app()" 2>&1 | tail -n 1
echo "== C: built bundle asset requested through Flask catch-all =="
SCR="$(mktemp -d)"; mkdir -p "$SCR/flask_backend/log_utils/logs"
( cd react-frontend && npx vite build --outDir "$SCR/dist" >/dev/null 2>&1 )
mkdir -p flask_backend/static/react && cp -r "$SCR/dist/." flask_backend/static/react/
JS="$(grep -o '/assets/[^"]*\.js' flask_backend/static/react/index.html | head -1)"
( cd "$SCR" && PYTHONPATH="$ROOT" "$PY" - "$JS" <<'PY'
import sys
from flask_backend.app import create_app
r = create_app().test_client().get(sys.argv[1])
print(sys.argv[1], "->", r.status_code, r.content_type, r.data[:15])
PY
) 2>&1 | tail -n 1
rm -rf flask_backend/static/react "$SCR"
