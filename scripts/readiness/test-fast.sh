#!/usr/bin/env bash
# Fast readiness tests.  Usage: scripts/readiness/test-fast.sh <suite>...
#   suites: startup | lifecycle | followups | browser | all   (browser = harness validation incl. verify-clean-stack.sh --check; it never runs the real browser)
# Dependencies are installed reproducibly into project-local locations:
#   backend : scripts/readiness/.venv  (Python 3.10/3.11 from flask_backend/requirements*.txt, exact pins)
#   frontend: react-frontend/node_modules via `npm ci` (committed package-lock.json)
# Run-owned cleanup: every generated path that did NOT exist when this run began
# (venv, bootstrap tools, node_modules, built bundle, log dirs) is removed on exit,
# pass or fail, so repeat judgment/review/merge sees a clean tree. Paths that already
# existed before the run are never touched. Set READINESS_KEEP_DEPS=1 to keep
# generated dependencies between local runs.
# Nothing is skipped silently: a missing suite, test file, tool or dependency fails.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
VENV="$ROOT/scripts/readiness/.venv"
TOOLS="$ROOT/scripts/readiness/.tools"

export PYTHONDONTWRITEBYTECODE=1

OWNED=()
own_if_absent() { [ -e "$1" ] || OWNED+=("$1"); }
cleanup() {
  local rc=$? p
  if [ "${READINESS_KEEP_DEPS:-0}" != 1 ]; then
    for p in "${OWNED[@]}"; do
      case "$p" in "$ROOT"/*) rm -rf -- "$p" ;; esac   # never delete outside this checkout
    done
  fi
  exit "$rc"
}
trap cleanup EXIT
own_if_absent "$VENV"
own_if_absent "$TOOLS"
own_if_absent "$ROOT/react-frontend/node_modules"
own_if_absent "$ROOT/tests/readiness/browser/node_modules"
own_if_absent "$ROOT/flask_backend/static/react"
own_if_absent "$ROOT/flask_backend/log_utils"
own_if_absent "$ROOT/flask_backend/log_utils/logs"
own_if_absent "$ROOT/flask_backend/logs"
own_if_absent "$ROOT/flask_backend/static/exports"   # export tests isolate their own dir; this guards stray writes

die() { echo "test-fast: ERROR: $*" >&2; exit 1; }

# ---- suite registry: each later unit adds its tests/readiness/<suite> dir ----
SUITES=(startup lifecycle followups browser)
declare -A SUITE_PY=( [startup]="tests/readiness/test_startup.py"
                      [lifecycle]="tests/readiness/test_lifecycle.py"
                      [followups]="tests/readiness/test_followups.py"
                      [browser]="tests/readiness/test_browser_harness.py" )
declare -A SUITE_FRONTEND=( [startup]=1 [lifecycle]=1 [followups]=1 )   # browser: harness checks only (no vitest)   # suites that also run vitest
declare -A SUITE_SMOKE=( [startup]="tests/readiness/smoke_dev.py" )

usage() { echo "usage: $0 <startup|lifecycle|followups|browser|all>..." >&2; exit 2; }
[ "$#" -ge 1 ] || usage
REQUESTED=()
for s in "$@"; do
  if [ "$s" = all ]; then REQUESTED+=("${SUITES[@]}"); continue; fi
  [[ " ${SUITES[*]} " == *" $s "* ]] || { echo "unknown suite: $s" >&2; usage; }
  REQUESTED+=("$s")
done

command -v node >/dev/null || die "node not found"
command -v npm  >/dev/null || die "npm not found"

# ---- python environment ------------------------------------------------------
pick_python() {
  local c
  for c in "${PYTHON:-}" python3.10 python3.11; do
    [ -n "$c" ] && command -v "$c" >/dev/null && { command -v "$c"; return; }
  done
  die "need Python 3.10 or 3.11 (pinned numpy==1.23.5 has no wheel for newer); set PYTHON=/path/to/python3.10"
}

ensure_venv() {
  local stamp="$VENV/.installed" want
  want="$(cat flask_backend/requirements.txt flask_backend/requirements-test.txt | sha256sum | cut -d' ' -f1)"
  if [ -x "$VENV/bin/python" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ]; then return; fi
  local py; py="$(pick_python)"
  rm -rf "$VENV"
  if ! "$py" -m venv "$VENV" >/dev/null 2>&1; then
    # Debian/Ubuntu python without ensurepip: bootstrap virtualenv locally.
    rm -rf "$VENV"
    local boot="${PYTHON_BOOTSTRAP:-python3}"
    "$boot" -m pip install -q --target "$TOOLS" virtualenv >/dev/null || die "cannot create venv: install python3-venv or pip"
    PYTHONPATH="$TOOLS" "$boot" -m virtualenv -q -p "$py" "$VENV" || die "virtualenv creation failed"
  fi
  "$VENV/bin/pip" install -q -r flask_backend/requirements.txt -r flask_backend/requirements-test.txt \
    || die "pip install failed"
  echo "$want" > "$stamp"
}

ensure_node() {
  [ -f react-frontend/package-lock.json ] || die "react-frontend/package-lock.json missing"
  # npm ci fails if package.json and the lockfile disagree -> reproducibility check.
  (cd react-frontend && npm ci --no-audit --no-fund >/dev/null) || die "npm ci failed (lockfile out of sync?)"
}

ensure_browser_runner() {
  # Only the Playwright *test runner* (no browser download): the harness tests run real Playwright
  # specs that skip/pass without launching a browser, to prove skipped tests can never become a PASS.
  (cd tests/readiness/browser && npm ci --no-audit --no-fund >/dev/null) || die "npm ci for the Playwright runner failed"
}

ensure_venv
ensure_node
case " ${REQUESTED[*]} " in *" browser "*) ensure_browser_runner ;; esac

# ---- run ---------------------------------------------------------------------
for s in "${REQUESTED[@]}"; do
  echo "=== suite: $s ==="
  py="${SUITE_PY[$s]}"
  [ -f "$py" ] || die "suite '$s': test file $py does not exist (no tests = failure, not a skip)"
  PYTHONPATH="$ROOT" "$VENV/bin/python" -m pytest -q -p no:cacheprovider --rootdir="$ROOT" "$py"
  if [ -n "${SUITE_FRONTEND[$s]:-}" ]; then
    (cd react-frontend && npx vitest run --passWithNoTests=false) || die "suite '$s': vitest failed"
  fi
  if [ -n "${SUITE_SMOKE[$s]:-}" ]; then
    [ -f "${SUITE_SMOKE[$s]}" ] || die "suite '$s': smoke script ${SUITE_SMOKE[$s]} missing"
    PYTHONPATH="$ROOT" "$VENV/bin/python" "${SUITE_SMOKE[$s]}"
  fi
done
echo "test-fast: all requested suites passed: ${REQUESTED[*]}"
