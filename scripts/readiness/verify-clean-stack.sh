#!/usr/bin/env bash
# Real-stack browser acceptance from a clean committed checkout.
#
#   scripts/readiness/verify-clean-stack.sh --check            configuration validation ONLY (no Docker,
#                                                              no browser; never claims acceptance)
#   scripts/readiness/verify-clean-stack.sh --output DIR       full acceptance run, evidence into DIR
#
# Full run (host: Docker Desktop with WSL integration, e.g. Lerpterp3 WSL2):
#   1. exports HEAD (committed content only) into an ephemeral directory with `git archive`;
#      refuses to run with uncommitted tracked changes so the evidence matches the tested SHA;
#   2. builds the images with --no-cache from that checkout (the frontend bundle is built inside the
#      image; a prebuilt/local bundle can never be served) and starts an isolated Compose project
#      (unique name, free localhost ports, its own Redis, its own export files) with a real Celery worker;
#   3. runs the Playwright/Chromium acceptance suite (tests/readiness/browser) against it;
#   4. starts a separate isolated Compose project from docker-compose.dev.yaml (Vite + Flask + worker) and
#      smoke-checks the development launch path;
#   5. writes logs, traces, screenshots, network capture, versions, host, tested SHA and exact commands,
#      then removes ONLY the resources this run created (its two Compose projects and the temp checkout).
# Exit status: 0 PASS | 1 FAIL | 2 infrastructure unavailable (acceptance NOT run) | 3 OPEN (checks that
# cannot yet be decided, e.g. a pending owner decision; never reported as PASS).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BROWSER_DIR="tests/readiness/browser"
MODE=""; OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --output) MODE=run; shift; OUT="${1:-}" ;;
    --output=*) MODE=run; OUT="${1#--output=}" ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1 (use --check or --output DIR)" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "usage: $0 --check | --output DIR" >&2; exit 2; }

# ============================================================================================
# --check : configuration only
# ============================================================================================
if [ "$MODE" = check ]; then
  cd "$ROOT"
  fail=0
  bad() { echo "check FAILED: $*" >&2; fail=1; }
  ok()  { echo "check ok: $*"; }

  for f in "$BROWSER_DIR/acceptance.spec.mjs" "$BROWSER_DIR/playwright.config.mjs" "$BROWSER_DIR/package.json" \
           "$BROWSER_DIR/package-lock.json" "$BROWSER_DIR/required-checks.txt" scripts/readiness/summarize_evidence.py \
           tests/readiness/expectations.json docker-compose.yaml docker-compose.dev.yaml README.md; do
    [ -f "$f" ] && ok "$f exists" || bad "$f is missing"
  done
  bash -n "${BASH_SOURCE[0]}" && ok "this script parses" || bad "script syntax"
  command -v node >/dev/null || { bad "node not found"; }
  if command -v node >/dev/null; then
    node --check "$BROWSER_DIR/acceptance.spec.mjs" && ok "acceptance.spec.mjs syntax" || bad "acceptance.spec.mjs syntax"
    node --check "$BROWSER_DIR/playwright.config.mjs" && ok "playwright.config.mjs syntax" || bad "playwright.config.mjs syntax"
  fi
  PY="${PYTHON:-python3}"
  command -v "$PY" >/dev/null || { bad "python3 not found"; PY=""; }
  if [ -n "$PY" ]; then
    # Everything below is structural: it inspects files, it never builds, starts or browses anything.
    "$PY" -I - "$ROOT" <<'E_PY' || fail=1
import json, pathlib, re, sys
root = pathlib.Path(sys.argv[1]); br = root / "tests/readiness/browser"
errs = []
def need(c, m):
    print(("check ok: " if c else "check FAILED: ") + m, file=(sys.stdout if c else sys.stderr))
    if not c: errs.append(m)

pkg = json.loads((br / "package.json").read_text()); lock = json.loads((br / "package-lock.json").read_text())
v = pkg["devDependencies"]["@playwright/test"]
need(re.fullmatch(r"\d+\.\d+\.\d+", v) is not None, f"@playwright/test is pinned to an exact version ({v})")
need(lock["packages"]["node_modules/@playwright/test"]["version"] == v, "package-lock.json agrees with the pinned Playwright version")

spec = (br / "acceptance.spec.mjs").read_text()
cfg = (br / "playwright.config.mjs").read_text()
need("retries: 0" in cfg, "no retries (a flaky pass is not a pass)")
need(not re.search(r"\.(skip|fixme|fail)\(|test\.only|describe\.only", spec), "spec contains no skip/fixme/only")
need("page.route(" not in spec and "context.route(" not in spec and ".route(" not in spec,
     "spec does not intercept or rewrite requests (no mocked API success)")
need("ALWAYS_EAGER" not in spec, "spec has no Celery eager-mode shortcut")
need("process.env.MTK_BASE_URL" in cfg and "MTK_BASE_URL ||" not in cfg, "base URL comes only from the environment (no default port)")
need("localhost:5000" not in spec and "127.0.0.1:5000" not in spec, "spec never targets the well-known port 5000")

req = [l.strip() for l in (br / "required-checks.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
# every required id must be producible: exact ids appear in the spec or the harness
harness = (root / "scripts/readiness/verify-clean-stack.sh").read_text()
for r in req:
    stem = r.rstrip("*")
    need(stem in spec or stem in harness, f"required check '{r}' is produced by the spec or harness")

exp = json.loads((root / "tests/readiness/expectations.json").read_text())
td = (root / "flask_backend/dev/tests/test_data.py").read_text()
m = re.search(r'^%s\s*=\s*"([A-Za-z]+)"' % exp["fixture"]["sequence_constant"], td, re.M)
need(bool(m) and len(m.group(1)) == exp["fixture"]["sequence_length"], "fixture sequence literal exists and matches expectations.json length")

for name in ("docker-compose.yaml", "docker-compose.dev.yaml"):
    t = (root / name).read_text()
    need("${MTK_BACKEND_PORT" in t and "${MTK_REDIS_PORT" in t, f"{name}: host ports are parameterised (isolated runs)")
    need(not re.search(r'-\s*"(5000:5000|6379:6379|3000:3000)"', t), f"{name}: no hard-coded host ports")
need("${MTK_FRONTEND_PORT" in (root / "docker-compose.dev.yaml").read_text(), "dev compose: frontend port parameterised")
need("- .:/app" not in (root / "docker-compose.yaml").read_text(), "default compose has no source bind mount over the built bundle")

readme = (root / "README.md").read_text()
for needle in ("verify-clean-stack.sh --output", "verify-clean-stack.sh --check", "test-fast.sh all",
               "Prerequisites", "http://localhost:5000", "http://localhost:3000", "Expected observations",
               "Lerpterp3", "OPEN"):
    need(needle in readme, f"README documents: {needle}")
sys.exit(1 if errs else 0)
E_PY
  fi
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    for f in docker-compose.yaml docker-compose.dev.yaml; do
      docker compose -p mtkcheck -f "$f" config -q >/dev/null 2>&1 && ok "docker compose config validates $f" || bad "docker compose config rejects $f"
    done
  else
    echo "check note: docker compose not available here; compose files were validated structurally only"
  fi
  if [ "$fail" -ne 0 ]; then echo "CHECK FAILED: harness configuration is not valid." >&2; exit 1; fi
  echo "CHECK OK: harness configuration is valid. Browser acceptance was NOT run and nothing here claims it."
  exit 0
fi

# ============================================================================================
# full run
# ============================================================================================
[ -n "$OUT" ] || { echo "--output DIR is required" >&2; exit 2; }
cd "$ROOT"
mkdir -p "$OUT" || { echo "cannot create $OUT" >&2; exit 2; }
OUT="$(cd "$OUT" && pwd)"
[ -z "$(ls -A "$OUT")" ] || { echo "ACCEPTANCE NOT RUN: output directory $OUT is not empty (use a fresh one)" >&2; exit 2; }
mkdir -p "$OUT/logs" "$OUT/screenshots"
CMDS="$OUT/commands.txt"; : > "$CMDS"
STARTED="$(date -u +%FT%TZ)"
infra_fail() { echo "ACCEPTANCE NOT RUN (infrastructure unavailable): $*" | tee "$OUT/NOT-RUN.txt" >&2; exit 2; }

# record + run a command; the exact command line goes into commands.txt
run() { printf '+ %s\n' "$*" >> "$CMDS"; "$@"; }
runlog() { local log="$1"; shift; printf '+ %s   > %s\n' "$*" "$log" >> "$CMDS"; "$@" >> "$OUT/logs/$log" 2>&1; }

# ---- preflight: hard failures, never skips ------------------------------------------------
command -v git    >/dev/null || infra_fail "git not found"
command -v docker >/dev/null || infra_fail "docker not found (enable Docker Desktop WSL integration for this distro)"
docker info >/dev/null 2>&1   || infra_fail "docker daemon not reachable (start Docker Desktop and enable WSL integration)"
docker compose version >/dev/null 2>&1 || infra_fail "docker compose v2 not available"
command -v node >/dev/null || infra_fail "node not found"
command -v npm  >/dev/null || infra_fail "npm not found"
command -v python3 >/dev/null || infra_fail "python3 not found"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || infra_fail "node >= 18 required"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  infra_fail "tracked files have uncommitted changes; commit first so the tested SHA is what ran"
fi
SHA="$(git rev-parse HEAD)"

RUNID="$(date +%s)-$RANDOM"
PROJ="mtkready-$RUNID"; DEVPROJ="mtkready-dev-$RUNID"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/mtkready-XXXXXX")"
CHK="$TMP/checkout"
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
BACKEND_PORT="$(free_port)"; REDIS_PORT="$(free_port)"
DEV_BACKEND_PORT="$(free_port)"; DEV_REDIS_PORT="$(free_port)"; DEV_FRONT_PORT="$(free_port)"
BASE="http://127.0.0.1:$BACKEND_PORT"

compose()    { MTK_BACKEND_PORT=$BACKEND_PORT MTK_REDIS_PORT=$REDIS_PORT docker compose -p "$PROJ" -f docker-compose.yaml "$@"; }
devcompose() { MTK_BACKEND_PORT=$DEV_BACKEND_PORT MTK_REDIS_PORT=$DEV_REDIS_PORT MTK_FRONTEND_PORT=$DEV_FRONT_PORT docker compose -p "$DEVPROJ" -f docker-compose.dev.yaml "$@"; }

# ---- cleanup: ONLY resources created by this run ---------------------------------------------
cleaned=0
cleanup() {
  [ "$cleaned" = 1 ] && return; cleaned=1
  if [ -d "$CHK" ]; then
    ( cd "$CHK" && { compose logs --no-color > "$OUT/logs/stack-compose.log" 2>&1; compose ps -a > "$OUT/logs/stack-ps.txt" 2>&1; } ) || true
    ( cd "$CHK" && { devcompose logs --no-color > "$OUT/logs/dev-compose.log" 2>&1; } ) || true
    ( cd "$CHK" && { printf '+ docker compose -p %s down -v --rmi local --remove-orphans\n' "$PROJ" >> "$CMDS"; compose down -v --rmi local --remove-orphans >> "$OUT/logs/teardown.log" 2>&1; } ) || true
    ( cd "$CHK" && { printf '+ docker compose -p %s down -v --rmi local --remove-orphans\n' "$DEVPROJ" >> "$CMDS"; devcompose down -v --rmi local --remove-orphans >> "$OUT/logs/teardown.log" 2>&1; } ) || true
  fi
  {
    echo "leftover containers (project label) -> $(docker ps -aq --filter "label=com.docker.compose.project=$PROJ" | wc -l) / dev $(docker ps -aq --filter "label=com.docker.compose.project=$DEVPROJ" | wc -l)"
    echo "leftover volumes -> $(docker volume ls -q --filter "label=com.docker.compose.project=$PROJ" | wc -l) / dev $(docker volume ls -q --filter "label=com.docker.compose.project=$DEVPROJ" | wc -l)"
    echo "leftover networks -> $(docker network ls -q --filter "label=com.docker.compose.project=$PROJ" | wc -l) / dev $(docker network ls -q --filter "label=com.docker.compose.project=$DEVPROJ" | wc -l)"
  } >> "$OUT/logs/teardown.log" 2>&1
  case "$TMP" in "${TMPDIR:-/tmp}"/mtkready-*) rm -rf -- "$TMP" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT TERM

addcheck() {   # addcheck ID STATUS DETAIL
  python3 -I -c 'import json,sys,datetime;print(json.dumps({"id":sys.argv[1],"status":sys.argv[2],"detail":sys.argv[3],"at":datetime.datetime.utcnow().isoformat()+"Z"}))' "$1" "$2" "$3" >> "$OUT/checks.jsonl"
}

# ---- 1. ephemeral clean checkout of the committed SHA -----------------------------------------
mkdir -p "$CHK"
printf '+ git archive %s | tar -x -C <ephemeral checkout>\n' "$SHA" >> "$CMDS"
git archive "$SHA" | tar -x -C "$CHK" || infra_fail "git archive failed"
if [ -e "$CHK/flask_backend/static/react" ] || [ -e "$CHK/react-frontend/node_modules" ]; then
  addcheck stack.fresh-build FAIL "committed tree already contains a built bundle or node_modules"
else
  addcheck stack.fresh-build PASS "checkout of $SHA has no flask_backend/static/react and no node_modules before the build"
fi
cd "$CHK"

# ---- 2. browser tooling inside the ephemeral checkout ----------------------------------------
( cd "$BROWSER_DIR" && run npm ci --no-audit --no-fund ) >> "$OUT/logs/npm-ci-browser.log" 2>&1 || infra_fail "npm ci for Playwright failed (see logs/npm-ci-browser.log)"
( cd "$BROWSER_DIR" && run npx playwright install chromium ) >> "$OUT/logs/playwright-install.log" 2>&1 \
  || infra_fail "could not install Chromium for Playwright (see logs/playwright-install.log)"

# ---- 3. isolated stack, fresh build -------------------------------------------------------
printf '+ MTK_BACKEND_PORT=%s MTK_REDIS_PORT=%s docker compose -p %s -f docker-compose.yaml build --no-cache\n' "$BACKEND_PORT" "$REDIS_PORT" "$PROJ" >> "$CMDS"
compose build --no-cache >> "$OUT/logs/build.log" 2>&1 || infra_fail "image build failed (see logs/build.log)"
printf '+ MTK_BACKEND_PORT=%s MTK_REDIS_PORT=%s docker compose -p %s -f docker-compose.yaml up -d\n' "$BACKEND_PORT" "$REDIS_PORT" "$PROJ" >> "$CMDS"
compose up -d >> "$OUT/logs/up.log" 2>&1 || infra_fail "compose up failed (see logs/up.log)"

wait_http() {  # url seconds
  local end=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$end" ]; do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1
  done; return 1
}
wait_http "$BASE/api/species" 120 || { compose logs --no-color > "$OUT/logs/stack-compose.log" 2>&1; infra_fail "backend did not become ready at $BASE"; }

# worker readiness: the real Celery worker must answer a ping (no stale/old worker can: Redis is brand new)
WORKER_OK=0
for _ in $(seq 1 60); do
  if compose exec -T worker celery -A flask_backend.celery_worker.celery inspect ping -t 2 2>/dev/null | grep -q pong; then WORKER_OK=1; break; fi
  sleep 2
done
[ "$WORKER_OK" = 1 ] || infra_fail "Celery worker never answered ping"

# isolation / freshness evidence
NPROJ="$(docker ps -q --filter "label=com.docker.compose.project=$PROJ" | wc -l)"
DBSIZE_BEFORE="$(compose exec -T redis redis-cli DBSIZE | tr -dc '0-9' )"
addcheck stack.isolated-project PASS "project $PROJ: $NPROJ containers (backend, worker, redis), own Redis (dbsize at start tail: $DBSIZE_BEFORE), localhost ports backend=$BACKEND_PORT redis=$REDIS_PORT, no other project touched"
BUNDLE_IN_IMAGE="$(compose exec -T backend ls /app/flask_backend/static/react/assets | tr '\n' ' ')"
SERVED_ASSETS="$(curl -fsS "$BASE/" | grep -o 'assets/[^"]*' | sed 's#assets/##' | tr '\n' ' ')"
ALLIN=1; for a in $SERVED_ASSETS; do case " $BUNDLE_IN_IMAGE " in *" $a "*) ;; *) ALLIN=0 ;; esac; done
[ -n "$SERVED_ASSETS" ] && [ "$ALLIN" = 1 ] \
  && addcheck stack.bundle-from-image PASS "assets referenced by index.html ($SERVED_ASSETS) exist in the image built from the clean checkout" \
  || addcheck stack.bundle-from-image FAIL "served assets [$SERVED_ASSETS] are not the image's bundle [$BUNDLE_IN_IMAGE]"

# ---- 4. environment evidence ---------------------------------------------------------------
PWV="$(cd "$BROWSER_DIR" && node -p 'require("@playwright/test/package.json").version')"
CHROMIUM="$(cd "$BROWSER_DIR" && node --input-type=module -e 'import {chromium} from "@playwright/test"; const b=await chromium.launch(); console.log(b.version()); await b.close()' 2>>"$OUT/logs/playwright-install.log")"
BIMG="$(compose images -q backend 2>/dev/null | head -1)"
WIMG="$(compose images -q worker 2>/dev/null | head -1)"
export OUT SHA STARTED PROJ DEVPROJ BACKEND_PORT REDIS_PORT BASE PWV CHROMIUM BIMG WIMG
python3 -I - <<'E_PY' > "$OUT/environment.json"
import json, os, platform, subprocess, socket
def sh(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception as e: return f"unavailable: {e}"
proc = open("/proc/version").read().strip() if os.path.exists("/proc/version") else ""
host = socket.gethostname()
wsl = "microsoft" in proc.lower()
print(json.dumps({
  "tested_sha": os.environ["SHA"], "started_at": os.environ["STARTED"],
  "finished_at": None,
  "host": host, "kernel": platform.release(), "proc_version": proc, "wsl2": wsl,
  "designated_host_match": host.lower() == "lerpterp3" and wsl,
  "docker": sh("docker", "version", "--format", "{{.Server.Platform.Name}} engine {{.Server.Version}} client {{.Client.Version}}"),
  "docker_compose": sh("docker", "compose", "version", "--short"),
  "docker_info_os": sh("docker", "info", "--format", "{{.OperatingSystem}}"),
  "node": sh("node", "--version"), "npm": sh("npm", "--version"), "host_python3": sh("python3", "--version"),
  "playwright": os.environ["PWV"], "chromium": os.environ["CHROMIUM"],
  "backend_image_id": os.environ["BIMG"], "worker_image_id": os.environ["WIMG"],
  "compose_project": os.environ["PROJ"], "dev_compose_project": os.environ["DEVPROJ"],
  "base_url": os.environ["BASE"], "git_describe": sh("git", "describe", "--always", "--dirty"),
}, indent=1))
E_PY
compose exec -T backend python --version > "$OUT/logs/container-python-version.txt" 2>&1
compose exec -T backend pip freeze > "$OUT/logs/container-pip-freeze.txt" 2>&1
compose exec -T redis redis-server --version > "$OUT/logs/container-redis-version.txt" 2>&1
compose ps -a > "$OUT/logs/stack-ps-start.txt" 2>&1
printf '%s\n' "$SHA" > "$OUT/tested-sha.txt"

# ---- 5. Playwright acceptance ------------------------------------------------------------
REDIS_CLI_JSON="$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1:]))' docker compose -p "$PROJ" -f "$CHK/docker-compose.yaml" exec -T redis redis-cli)"
printf '+ (cd %s && MTK_BASE_URL=%s MTK_OUTPUT=%s MTK_REPO=<checkout> MTK_REDIS_CLI_JSON=... npx playwright test)\n' "$BROWSER_DIR" "$BASE" "$OUT" >> "$CMDS"
( cd "$BROWSER_DIR" && MTK_BASE_URL="$BASE" MTK_OUTPUT="$OUT" MTK_REPO="$CHK" MTK_REDIS_CLI_JSON="$REDIS_CLI_JSON" \
    MTK_BACKEND_PORT=$BACKEND_PORT MTK_REDIS_PORT=$REDIS_PORT npx playwright test -c playwright.config.mjs ) > "$OUT/logs/playwright.log" 2>&1
PW_EXIT=$?
cp "$BROWSER_DIR/package-lock.json" "$OUT/playwright-package-lock.json" 2>/dev/null || true

# ---- 6. separate development launch smoke ---------------------------------------------------
printf '+ MTK_BACKEND_PORT=%s MTK_REDIS_PORT=%s MTK_FRONTEND_PORT=%s docker compose -p %s -f docker-compose.dev.yaml up -d --build\n' "$DEV_BACKEND_PORT" "$DEV_REDIS_PORT" "$DEV_FRONT_PORT" "$DEVPROJ" >> "$CMDS"
if devcompose up -d --build >> "$OUT/logs/dev-up.log" 2>&1; then
  DEVURL="http://127.0.0.1:$DEV_FRONT_PORT"; DEVAPI="http://127.0.0.1:$DEV_BACKEND_PORT"
  if wait_http "$DEVURL/" 300 && wait_http "$DEVAPI/api/species" 120; then
    HDR="$(curl -fsS -D - -o "$OUT/logs/dev-index.html" "$DEVURL/")"
    if grep -qi '^content-type: text/html' <<<"$HDR" && grep -q 'id="root"' "$OUT/logs/dev-index.html" && grep -q '/src/main.jsx' "$OUT/logs/dev-index.html"; then
      addcheck dev.vite-index PASS "Vite dev server at $DEVURL serves the app shell (text/html, #root, /src/main.jsx)"
    else addcheck dev.vite-index FAIL "unexpected dev index: $(head -c 200 "$OUT/logs/dev-index.html")"; fi
    JH="$(curl -fsS -D - -o "$OUT/logs/dev-main.jsx" "$DEVURL/src/main.jsx")"
    if grep -qi '^content-type: .*javascript' <<<"$JH" && ! head -c 200 "$OUT/logs/dev-main.jsx" | grep -qi '<html\|<!doctype'; then
      addcheck dev.vite-main-js PASS "/src/main.jsx served as JavaScript, not HTML"
    else addcheck dev.vite-main-js FAIL "main.jsx content-type/body wrong: $(grep -i '^content-type' <<<"$JH")"; fi
    PX="$(curl -fsS "$DEVURL/api/species")"; DX="$(curl -fsS "$DEVAPI/api/species")"
    if [ -n "$PX" ] && [ "$PX" = "$DX" ] && grep -q homo_sapiens <<<"$PX"; then
      addcheck dev.api-proxy PASS "GET $DEVURL/api/species (Vite proxy) equals the dev backend's own answer: $PX"
    else addcheck dev.api-proxy FAIL "proxy answer [$PX] vs backend answer [$DX]"; fi
    addcheck dev.backend-species PASS "dev backend $DEVAPI answered /api/species"
  else
    addcheck dev.vite-index FAIL "dev stack did not become ready (see logs/dev-compose.log)"
    for i in dev.vite-main-js dev.api-proxy dev.backend-species; do addcheck $i FAIL "dev stack did not become ready"; done
  fi
else
  addcheck dev.vite-index FAIL "docker compose dev up failed (see logs/dev-up.log)"
  for i in dev.vite-main-js dev.api-proxy dev.backend-species; do addcheck $i FAIL "dev stack failed to start"; done
fi

# ---- 7. teardown (run-owned only), then summarise -------------------------------------------
cd "$ROOT"
cd "$CHK" && cleanup; cd "$ROOT"
python3 -I - "$OUT" <<'E_PY'
import json, sys, datetime, pathlib
p = pathlib.Path(sys.argv[1]) / "environment.json"
d = json.loads(p.read_text()); d["finished_at"] = datetime.datetime.utcnow().isoformat() + "Z"
p.write_text(json.dumps(d, indent=1))
E_PY
python3 -I scripts/readiness/summarize_evidence.py "$OUT" "$ROOT/$BROWSER_DIR/required-checks.txt" "$PW_EXIT"
RC=$?
echo "evidence: $OUT (SUMMARY.md, result.json, trace.zip, screenshots/, network.json, logs/, commands.txt)"
exit $RC
