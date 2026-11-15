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
| Internet | to pull base images, npm/pip packages and, once, Playwright's Chromium |

Free host ports: the default stack uses **5000** (app) and **6379** (Redis) on `127.0.0.1`. Override with
`MTK_BACKEND_PORT` / `MTK_REDIS_PORT` (and `MTK_FRONTEND_PORT` for the dev stack) to run beside another stack.

## Clean clone: build, start, use

Working directory: the repository root (the directory containing `docker-compose.yaml`).

```bash
git clone <repo-url> mtkv3 && cd mtkv3
docker compose up --build            # builds the frontend bundle in the image, then starts backend, worker, redis
```

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

From the repository root of a **committed** checkout (the script refuses uncommitted tracked changes and tests exactly
`git rev-parse HEAD`):

```bash
bash scripts/readiness/verify-clean-stack.sh --output /tmp/mtk-acceptance-$(date +%Y%m%d-%H%M%S)
```

The default host is **Lerpterp3 (WSL2, Docker Desktop with WSL integration)**. The output directory must be new or empty.
The run, in order:

1. exports the committed tree to an ephemeral directory (`git archive`), so no local bundle, `node_modules` or stale
   worker can be used;
2. builds the images with `--no-cache` and starts an isolated Compose project (`mtkready-<id>`: its own Redis, worker,
   free localhost ports, its own export files) — the real Flask app, real Redis and a real Celery worker; no eager
   mode, no mocked API;
3. runs Playwright/Chromium (`tests/readiness/browser`) against it: form/JS/CSS load with MIME and body validation
   (plus negative missing-asset/HTML-as-JS checks), species population, submission of the named fixture
   (`NLS-mTag-BFP`, `TEST_SEQ_1`) through the form and correlation of the displayed fields with
   `tests/readiness/expectations.json` and this submission, bounded success, a user-selected codon -> **Design
   Primers** on the first sequence and its displayed result, the browser **Download TSV** parsed against the selected
   result, API-only follow-ups, visible invalid input, and a controlled **real-worker** failure (this run's own Redis
   record of a finished job is deleted, so the real Celery worker rejects the primer-design request and the browser
   must show the bounded error);
4. smoke-checks the **development** launch (`docker-compose.dev.yaml`, separate isolated project);
5. removes only what it created (the two Compose projects, their images/volumes, the temp checkout).

Evidence in the output directory: `SUMMARY.md`, `result.json`, `checks.jsonl`, `tested-sha.txt`, `environment.json`
(host, kernel, Docker/Compose/Node/Playwright/Chromium versions, image IDs), `commands.txt` (exact commands),
`trace.zip` (Playwright trace), `screenshots/`, `network.json`, `browser-console.json`, `downloaded-primers.tsv`,
`logs/` (build, compose, container versions and `pip freeze`, teardown leftovers).

Exit status: `0` PASS, `1` FAIL, `2` infrastructure unavailable (**acceptance not run**, `NOT-RUN.txt` explains), `3`
**OPEN** (some required check cannot be decided yet). Unavailable infrastructure or a required check that did not run is
never reported as a pass. On another host, run the same command there; acceptance for Lerpterp3 stays open until it has
been run on Lerpterp3.

### Known OPEN item: maximum mutations per site

The form's *Max mutations/site* setting is sent as `maxMutationsPerSite`, but the backend only reads
`maxMutPerSite` (default **3**), so the form's effective limit is the legacy 3. The named fixture's expectations use the
canonical limit 1. Which mapping is intended is an **owner decision that has not been made**; nothing here maps the
setting, changes defaults, or rewrites requests to fake limit 1. Consequently the acceptance run records
`fixture.canonical-limit-1-run` as **OPEN** (result `3`), and reports the codon options it actually observed under the
effective limit 3 separately (`fixture.synonymous-alternatives-observed-under-limit-3`), never as the canonical run.
The restriction-site and processed-sequence checks do not depend on this limit.

### Controlled-failure note

No input of at least 80 bp that passes both the form and API validation makes the *generate* step fail in the worker
(the inputs that do, such as a lone stop codon, are blocked by the form's 80 bp minimum), so the controlled real-worker
failure is exercised on the primer-design task as described above.
