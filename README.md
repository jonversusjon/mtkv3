# MTK v3 — Mammalian Toolkit primer designer

Flask API + Celery worker + Redis, with a React (Vite) frontend. The default Docker stack builds the
frontend inside the image and serves it from Flask, so one URL serves the UI and the API.

## Prerequisites

| Need | Version / note |
|---|---|
| git | any recent |
| Docker with Compose v2 | Docker Desktop with **WSL integration enabled for your distro** on Windows/WSL2; `docker compose version` must work |
| Node.js + npm | Node >= 18 (22 tested) — host-side tests only; the app image uses `node:22-alpine` itself |
| Python 3 | host `python3` (harness); Python **3.10 or 3.11** (`python3.10`) for `test-fast.sh` — set `PYTHON=/path/to/python3.10` if needed |
| Internet | to pull base images and npm/pip packages, and to download Playwright's Chromium (once per acceptance run) |
| Chromium system libraries (acceptance run only) | Debian/Ubuntu package names: `libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2` (on Ubuntu 24.04 the `libasound2`, `libatk1.0-0` and `libatk-bridge2.0-0` packages carry a `t64` suffix). The run verifies them with `ldd` and stops with *acceptance not run* if any is missing; it never installs packages. |

Free host ports: the default stack uses **5000** (app) and **6379** (Redis) on `127.0.0.1`. Override with
`MTK_BACKEND_PORT` / `MTK_REDIS_PORT` (and `MTK_FRONTEND_PORT` for the dev stack) to run beside another stack.

## Clean clone: build, start, use

Working directory: the repository root (the directory containing `docker-compose.yaml`).

```bash
git clone --branch logger-overhaul https://github.com/jonversusjon/mtkv3.git mtkv3
cd mtkv3
docker compose up --build            # builds the frontend bundle in the image, then starts backend, worker, redis
```

To reproduce a specific tested build, pin the SHA recorded in the acceptance evidence (`tested-sha.txt` in the
evidence directory) right after cloning: `git checkout <sha-from-tested-sha.txt>`.

Open **http://localhost:5000** (UI + API on one origin). Stop with `Ctrl-C`, then `docker compose down -v`.

### Expected observations

- `http://localhost:5000/` shows the page **“Primer Design Form”** with styled controls (pink *Generate Protocol* button).
- `http://localhost:5000/api/species` returns JSON `{"species": ["homo_sapiens", "mus_musculus"]}`; the same species
  appear in *Settings → Species*.
- A missing file such as `http://localhost:5000/static/react/assets/nope.js` returns **404 JSON**, never HTML.
- Submit a valid sequence (>= 80 bp, in frame, MTK part chosen): the Results page shows *Processing…*, then
  *Finished. Results are shown below.* with the processed DNA, MTK parts and restriction sites. In the
  *Mutation Analysis* step choose a codon and press **Design Primers**; the *Primer Design* step then lists a
  *Custom Design* primer set and **Download TSV** saves a file `primers_<time>_<id>.tsv` whose header is
  `Primer Name<TAB>Sequence<TAB>Amplicon` (the Amplicon column is empty: no amplicon length is computed).
- Invalid DNA (for example `ATGC!!!XYZ`) shows a red validation message and *Generate Protocol* stays disabled.

## Development launch (separate from the above)

```bash
docker compose -f docker-compose.dev.yaml up --build
```

Open **http://localhost:3000** (Vite dev server with hot reload; it proxies `/api` and `/sse` to the Flask
service on port 5000). Source directories are bind-mounted, so this is *not* the delivery path of the default
stack. Stop with `docker compose -f docker-compose.dev.yaml down -v`.

## Tests

### Fast suite (no Docker, no browser) and harness validation

From the repository root:

```bash
bash scripts/readiness/test-fast.sh all && bash scripts/readiness/verify-clean-stack.sh --check
```

`test-fast.sh all` runs the backend (pytest, pinned `flask_backend/requirements*.txt`) and frontend (`npm ci` +
vitest) suites plus tests of the acceptance harness itself. Dependencies are installed project-locally and removed
afterwards (`READINESS_KEEP_DEPS=1` keeps them). `verify-clean-stack.sh --check` validates the acceptance-harness
configuration only; it **does not run a browser and does not claim acceptance**.

### Real-stack browser acceptance (Docker + Chromium)

From the repository root of any checkout (a clean clone, or a working checkout that has unrelated local edits):

```bash
bash scripts/readiness/verify-clean-stack.sh --output /tmp/mtk-acceptance-$(date +%Y%m%d-%H%M%S)
```

The script tests exactly `git rev-parse HEAD` as committed. Uncommitted tracked edits and untracked files in your
working tree (for example a locally modified lockfile or an `environment.yml`) are **not** tested and **not** copied; they
are listed in `source-exclusions.txt`, and the snapshot is verified to contain none of them, no built bundle and no
`node_modules`. Your working tree is never modified.

The default host is **Lerpterp3 (WSL2, Docker Desktop with WSL integration)**. The output directory must be new or empty.
The run, in order:

1. exports the committed tree to an ephemeral directory (`git archive`), so no local bundle, `node_modules` or stale
   worker can be used;
2. installs the Playwright runner and downloads Chromium into the run's own temporary directory (`npm` cache and
   `PLAYWRIGHT_BROWSERS_PATH` are run-owned and deleted at teardown; nothing goes into `~/.npm` or `~/.cache`), then
   checks the Chromium shared libraries with `ldd` (see Prerequisites);
3. builds the images with `--no-cache` and starts an isolated Compose project (`mtkready-<id>`: its own Redis, worker,
   free localhost ports, its own export files) — the real Flask app, real Redis and a real Celery worker; no eager
   mode, no mocked API. The worker must answer a bounded `celery inspect ping` (at most 30 attempts; every attempt's
   output is in `logs/worker-ping.txt`);
4. runs Playwright/Chromium (`tests/readiness/browser`) against it: form/JS/CSS load with MIME and body validation
   (plus negative missing-asset/HTML-as-JS checks), species population, then the three distinct outcomes:
   - **pending** — only this run's own worker container is `docker pause`d (its compose-project and service labels are
     re-checked before every call; no other container, such as unrelated CVAT/nuclio services, is touched), the named
     fixture (`NLS-mTag-BFP`, `TEST_SEQ_1`) is submitted through the form, and the test asserts the API reports
     `pending` with no result and the page shows *Processing…* and no success status; the worker is unpaused in a
     `finally` block (and again by the script's teardown if the run is interrupted);
   - **success** — the same job then finishes: displayed fields are correlated with
     `tests/readiness/expectations.json` and this submission, then a user-selected codon -> **Design Primers** on the
     first sequence and its displayed result, the browser **Download TSV** parsed against the selected result, and
     API-only follow-ups;
   - **failure** — visible invalid input, and a controlled **real-worker** failure (this run's own Redis record of a
     finished job is deleted, so the real Celery worker rejects the primer-design request and the browser must show
     the bounded error);
5. smoke-checks the **development** launch (`docker-compose.dev.yaml`, separate isolated project);
6. removes only what it created (the two Compose projects, their images/volumes, the temp checkout and caches).

Evidence in the output directory: **`summary.json`** and **`browser-results.json`** (always written, each at least
100 bytes, derived only from observed facts: `NOT-RUN`, `FAIL`, `OPEN` or `PASS`; they include the per-test Playwright
outcomes and the pending/success/failure observations), `SUMMARY.md`, `result.json` (same verdict as `summary.json`;
not written when acceptance did not run), `checks.jsonl`, `tested-sha.txt`, `source-exclusions.txt`, `environment.json`
(host, kernel, Docker/Compose/Node/Playwright/Chromium versions, image IDs), `commands.txt` (exact commands),
`trace.zip` (Playwright trace), `screenshots/` (including `05a2-pending.png`), `network.json`, `browser-console.json`,
`downloaded-primers.tsv`, `playwright-report.json`, `logs/` (build, compose, `worker-ping.txt`, `chromium-ldd.txt`,
container versions and `pip freeze`, teardown leftovers).

Exit status: `0` PASS, `1` FAIL, `2` infrastructure unavailable (**acceptance not run**, `NOT-RUN.txt` explains), `3`
**OPEN** (some required check cannot be decided yet). Only a check recorded `PASS` satisfies a required check: a required
check that is missing, or recorded `INFO`, `SKIP` or any unknown status, fails the run; a Playwright test that was
skipped, interrupted or failed fails the run; `OPEN` stays `OPEN`. On another host, run the same command there;
acceptance for Lerpterp3 stays open until it has been run on Lerpterp3.

### Known OPEN item: maximum mutations per site

The form's *Max mutations/site* setting is sent as `maxMutationsPerSite`, but the backend only reads
`maxMutPerSite` (default **3**), so the form's effective limit is the legacy 3. The named fixture's expectations use the
canonical limit 1. Which mapping is intended is an **owner decision that has not been made**; nothing here maps the
setting, changes defaults, or rewrites requests to fake limit 1. Consequently the acceptance run records
`fixture.canonical-limit-1-run` as **OPEN** (result `3`), and reports the codon options it actually observed under the
effective limit 3 separately (`fixture.synonymous-alternatives-observed-under-limit-3`), never as the canonical run.
The restriction-site and processed-sequence checks do not depend on this limit.

### Controlled-failure note

The controlled worker failure uses the primer-design task with a deleted submission record because it is the failure a
browser user can actually reach in the real worker: the generate step's own worker-side failures need input that the
form blocks (it requires at least 80 bp) or that the API rejects up front with a 400, and those request-time rejections
are not worker failures. The injection touches only the run's own Redis, so the failure is produced by the real Celery
worker and shown by the real UI, not by a mocked response.
