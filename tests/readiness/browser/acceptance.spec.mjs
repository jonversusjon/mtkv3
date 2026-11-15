// Real-stack browser acceptance.  Runs against a stack built from a clean committed checkout
// (real Flask, real Redis, real Celery worker; no eager mode, no mocked API success).
//
// Check ledger: every acceptance check records PASS / FAIL / OPEN in MTK_OUTPUT/checks.jsonl.
//   PASS  the observation was made and matched
//   FAIL  the observation was made and did not match (the Playwright test also fails)
//   INFO  characterisation only (not an acceptance claim)
//   OPEN  the check cannot be decided yet (owner decision pending); never counted as a pass
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, request as pwRequest } from "@playwright/test";

const OUT = process.env.MTK_OUTPUT;
const REPO = process.env.MTK_REPO;
const BASE = process.env.MTK_BASE_URL;
const TERMINAL_BOUND_MS = 180_000;      // bounded wait for a job to finish
const CHECKS = path.join(OUT, "checks.jsonl");

const record = (id, status, detail) => {
  fs.appendFileSync(CHECKS, JSON.stringify({ id, status, detail, at: new Date().toISOString() }) + "\n");
  if (status === "FAIL") throw new Error(`${id}: ${detail}`);
};
const check = (id, cond, detail) => record(id, cond ? "PASS" : "FAIL", detail);

// ---- fixture + expectations (independent of the app's output) --------------------------
const expectations = JSON.parse(fs.readFileSync(path.join(REPO, "tests/readiness/expectations.json"), "utf8"));
const fx = expectations.fixture;
const testData = fs.readFileSync(path.join(REPO, "flask_backend/dev/tests/test_data.py"), "utf8");
const seqOf = (name) => {
  const m = testData.match(new RegExp(`^${name}\\s*=\\s*"([A-Za-z]+)"`, "m"));
  if (!m) throw new Error(`${name} not found as a literal in test_data.py`);
  return m[1];
};
const SEQ = seqOf(fx.sequence_constant);                         // TEST_SEQ_1, exactly as the repo stores it
expect(SEQ.length).toBe(fx.sequence_length);
const EXP = expectations.expected;

const looksLikeHtml = (body) => /^\s*<(!doctype|html|\?xml)/i.test(body);

// ---- shared serial state ----------------------------------------------------------------
test.describe.configure({ mode: "serial" });
let context, page, api;
const net = [];                  // every request/response the browser made
const consoleErrors = [];
const pageErrors = [];
const S = {};                    // facts carried between steps

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: BASE, acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await context.newPage();
  api = await pwRequest.newContext({ baseURL: BASE });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("request", (r) => net.push({ t: Date.now(), kind: "request", method: r.method(), url: r.url(), type: r.resourceType(), body: r.postData() }));
  page.on("response", async (r) => {
    net.push({ t: Date.now(), kind: "response", method: r.request().method(), url: r.url(), status: r.status(), contentType: r.headers()["content-type"] || "" });
  });
});

test.afterAll(async () => {
  const shot = (n) => path.join(OUT, "screenshots", n);
  fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });
  try { await page.screenshot({ path: shot("99-final-state.png"), fullPage: true }); } catch { /* page may be closed */ }
  await context.tracing.stop({ path: path.join(OUT, "trace.zip") });
  fs.writeFileSync(path.join(OUT, "network.json"), JSON.stringify(net, null, 1));
  fs.writeFileSync(path.join(OUT, "browser-console.json"), JSON.stringify({ consoleErrors, pageErrors }, null, 1));
  await api.dispose();
  await context.close();
});

const shot = async (name) => {
  fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(OUT, "screenshots", name), fullPage: true });
};

// =========================================================================================
test("01 built frontend: form, JS and CSS load with correct MIME and real bodies", async () => {
  const resp = await page.goto("/");
  check("page.index", resp.status() === 200 && /text\/html/.test(resp.headers()["content-type"] || ""),
    `GET / -> ${resp.status()} ${resp.headers()["content-type"]}`);
  await expect(page.getByRole("heading", { name: "Primer Design Form" })).toBeVisible();   // JS ran and rendered the form
  await expect(page.locator("#primer-form")).toBeVisible();
  await shot("01-form-loaded.png");

  const assets = net.filter((e) => e.kind === "response" && /\/static\/react\/assets\//.test(e.url));
  const js = assets.filter((a) => /\.js(\?|$)/.test(a.url));
  const css = assets.filter((a) => /\.css(\?|$)/.test(a.url));
  check("assets.present", js.length >= 1 && css.length >= 1, `scripts=${js.length} stylesheets=${css.length} (served from /static/react/assets/)`);
  for (const a of js) {
    check(`assets.js.mime ${path.basename(a.url)}`, a.status === 200 && /javascript/.test(a.contentType), `${a.status} ${a.contentType}`);
    const body = await (await api.get(new URL(a.url).pathname)).text();
    check(`assets.js.body ${path.basename(a.url)}`, body.length > 1000 && !looksLikeHtml(body), `${body.length} bytes, not HTML`);
  }
  for (const a of css) {
    check(`assets.css.mime ${path.basename(a.url)}`, a.status === 200 && /text\/css/.test(a.contentType), `${a.status} ${a.contentType}`);
    const body = await (await api.get(new URL(a.url).pathname)).text();
    check(`assets.css.body ${path.basename(a.url)}`, body.length > 500 && !looksLikeHtml(body), `${body.length} bytes, not HTML`);
  }
  // The stylesheet is actually applied (a loaded-but-ignored sheet would leave a default button).
  const bg = await page.getByRole("button", { name: "Generate Protocol" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  check("assets.css.applied", !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "rgb(239, 239, 239)", `Generate Protocol background-color=${bg}`);
});

test("02 negative: missing assets and HTML-as-JS are detected, not served as app HTML", async () => {
  // detector self-test: the body check used above really does recognise HTML posing as JS.
  check("neg.detector", looksLikeHtml("<!doctype html><html></html>") && looksLikeHtml("  <html>") && !looksLikeHtml("import{a}from'./x.js';"),
    "looksLikeHtml() flags an HTML document and passes real JS");
  const bust = Math.random().toString(36).slice(2);
  for (const p of [`/static/react/assets/missing-${bust}.js`, `/static/react/assets/missing-${bust}.css`, `/assets/index-${bust}.js`, `/${bust}.js`]) {
    const r = await api.get(p);
    const body = await r.text();
    check(`neg.missing ${p}`, r.status() === 404 && !/text\/html/.test(r.headers()["content-type"] || "") && !looksLikeHtml(body),
      `${r.status()} ${r.headers()["content-type"]} body=${JSON.stringify(body.slice(0, 60))}`);
  }
  // a client route still falls back to the app shell (positive control for the 404 rule above)
  const r = await api.get("/results");
  check("neg.spa-fallback-control", r.status() === 200 && /text\/html/.test(r.headers()["content-type"] || ""), `GET /results -> ${r.status()}`);
});

test("03 backend species populate the form's species list", async () => {
  const fromApi = (await (await api.get("/api/species")).json()).species;
  check("species.api", Array.isArray(fromApi) && fromApi.includes(fx.settings.species), `GET /api/species -> ${JSON.stringify(fromApi)}`);
  const browserCall = net.find((e) => e.kind === "response" && /\/api\/species$/.test(new URL(e.url).pathname));
  check("species.browser-request", browserCall && browserCall.status === 200, `browser GET /api/species -> ${browserCall?.status}`);
  await page.getByRole("button", { name: "Open settings" }).click();
  const options = await page.locator("#species-select option").evaluateAll((os) => os.map((o) => o.value));
  check("species.form-options", JSON.stringify(options) === JSON.stringify(fromApi), `form options ${JSON.stringify(options)} == API ${JSON.stringify(fromApi)}`);
  S.speciesSelected = await page.locator("#species-select").inputValue();
  await shot("03-settings-species.png");
  // characterise the effective max-mutations setting WITHOUT changing it (owner decision pending)
  S.maxMutSelectShows = await page.locator("#mutations-select").inputValue();
  await page.getByRole("button", { name: "Close settings" }).first().click().catch(() => page.keyboard.press("Escape"));
});

test("04 invalid input: visible validation, submission blocked, no request sent", async () => {
  await page.goto("/");
  await expect(page.locator("#sequence-0")).toBeVisible();
  const before = net.filter((e) => e.kind === "request" && /generate_protocol/.test(e.url)).length;
  await page.locator("#sequence-0").fill("ATGC!!!XYZ-123");
  const msg = page.getByText(/Only valid DNA bases/i).first();
  await expect(msg).toBeVisible();
  const text = await msg.innerText();
  await expect(page.getByRole("button", { name: "Generate Protocol" })).toBeDisabled();   // validation is debounced; retry
  const disabled = true;
  check("invalid.message-visible", true, `visible message: ${JSON.stringify(text)}`);
  check("invalid.submit-disabled", disabled, "Generate Protocol is disabled for the invalid sequence");
  await shot("04-invalid-input.png");
  const after = net.filter((e) => e.kind === "request" && /generate_protocol/.test(e.url)).length;
  check("invalid.no-request", after === before, `generate_protocol requests before=${before} after=${after}`);
});

// -- the named fixture, through the form ----------------------------------------------------
const fillForm = async (seq, name, left, right) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/");
  await expect(page.locator("#sequence-0")).toBeVisible();
  await page.locator("#primer-name-0").fill(name);
  await page.locator("#sequence-0").fill(seq);
  await page.locator("#mtk-part-left-0").selectOption(left);     // "MTK Part Number" drives left and right together
  await expect(page.locator("#mtk-part-left-0")).toHaveValue(left);
  S.submitLeft = left; S.submitRight = right;
};

test("05 submit the named fixture via the form; correlate with expectations.json and this submission", async () => {
  await fillForm(SEQ, fx.primerName, fx.mtkPartLeft, fx.mtkPartRight);
  // the template sequence is the fixture's, to match dev_config_2
  const tmpl = seqOf("TEST_TEMPLATE_SEQ");
  await page.locator("#templateSequence").fill(tmpl);
  await shot("05a-form-filled.png");
  const submit = page.getByRole("button", { name: "Generate Protocol" });
  await expect(submit).toBeEnabled();
  const [reqEv] = await Promise.all([
    page.waitForRequest((r) => /\/api\/generate_protocol$/.test(r.url()) && r.method() === "POST"),
    submit.click(),
  ]);
  const sent = JSON.parse(reqEv.postData());
  const resp = await reqEv.response();
  const accepted = await resp.json();
  check("submit.accepted", resp.status() < 300 && !!accepted.job_id, `POST /api/generate_protocol -> ${resp.status()} job_id=${accepted.job_id}`);
  S.jobId = accepted.job_id; S.sent = sent;
  fs.writeFileSync(path.join(OUT, "submitted-request.json"), JSON.stringify({ sent, accepted }, null, 1));

  // what the form actually sent (network assertion against the fixture)
  const s0 = sent.sequencesToDomesticate[0];
  check("submit.sequence", s0.sequence.toUpperCase() === SEQ.toUpperCase(), "sent sequence equals TEST_SEQ_1");
  check("submit.parts", s0.mtkPartLeft === fx.mtkPartLeft && s0.mtkPartRight === fx.mtkPartRight, `parts ${s0.mtkPartLeft}/${s0.mtkPartRight}`);
  check("submit.primerName", s0.primerName === fx.primerName, `primerName ${s0.primerName}`);
  check("submit.species", sent.species === fx.settings.species, `species ${sent.species}`);
  check("submit.kozak", sent.kozak === fx.settings.kozak, `kozak ${sent.kozak}`);
  // OWNER DECISION PENDING: record the effective limit honestly; do not alter or fake it.
  S.sentMax = sent.maxMutationsPerSite; S.sentMaxAlias = sent.maxMutPerSite;
  record("setting.max-mutations-effective", "INFO",
    `form sent maxMutationsPerSite=${JSON.stringify(sent.maxMutationsPerSite)} and maxMutPerSite=${JSON.stringify(sent.maxMutPerSite)} (the prefill-driven 'one' is only present when /api/dummy supplies it; this stack's /api/dummy returned no prefill); ` +
    `the backend reads only maxMutPerSite and defaults it to 3, so the effective limit is 3 (legacy), NOT the canonical 1 used in expectations.json. ` +
    `Characterisation only: no mapping was implemented or faked.`);
  record("fixture.canonical-limit-1-run", "OPEN",
    "OWNER DECISION PENDING (map one/two/three to backend limits, or keep legacy 3). The browser cannot currently run the canonical maxMutPerSite=1 fixture without changing the form behaviour or rewriting its request, both prohibited. " +
    "Checks that depend on limit 1 are recorded OPEN, not PASS; the restriction-site and processed-sequence checks below do not depend on the limit.");

  await expect(page).toHaveURL(/\/results$/);
  await expect(page.getByTestId("sequence-status-success")).toBeVisible({ timeout: TERMINAL_BOUND_MS });
  await shot("05b-results-success.png");
  const stored = await page.evaluate(() => sessionStorage.getItem("jobId"));
  check("results.job-identity", stored === S.jobId, `page jobId=${stored} == submitted job_id=${S.jobId}`);

  // displayed fields vs expectations.json
  const dna = (await page.getByTestId("durable-processed-dna").locator("code").innerText()).trim();
  check("results.processed-sequence", dna === SEQ.toUpperCase() && dna.length === fx.sequence_length,
    `displayed processed DNA (${dna.length} nt) equals expectations.json processed_sequence (TEST_SEQ_1 upper-cased)`);
  const sitesText = await page.getByTestId("durable-restriction-sites").innerText();
  const want = EXP.restriction_sites[0];
  check("results.restriction-site", sitesText.includes(`${want.enzyme} · recognition ${want.recognition_seq} · position ${want.position} · frame ${want.frame} · strand ${want.strand}`) &&
    /Restriction sites \(1\)/.test(sitesText), `displayed: ${sitesText.replace(/\s+/g, " ")}`);
  const parts = await page.getByText(/^Left \d+ \/ Right \d+$/).first().innerText();
  check("results.parts", parts === `Left ${fx.mtkPartLeft} / Right ${fx.mtkPartRight}`, parts);
  // and the same record is what the API holds for THIS job (not a stale or other job)
  const job = await (await api.get(`/api/jobs/${S.jobId}`)).json();
  S.job = job;
  check("results.job-api", job.jobId === S.jobId && job.state === "success" && job.sequences[0].state === "success",
    `GET /api/jobs/${S.jobId} -> state=${job.state}`);
  check("results.display-equals-api", job.sequences[0].result.processedSequence === dna, "displayed DNA equals the stored job result");
  fs.writeFileSync(path.join(OUT, "job-result.json"), JSON.stringify(job, null, 1));
});

test("06 synonymous alternatives shown for the site vs expectations.json (observed under effective limit 3)", async () => {
  // Characterise what the browser actually offers under the effective limit.
  await page.getByText("Mutation Analysis").first().click();
  await expect(page.locator("h5:has-text('Alternative codons')").first()).toBeVisible({ timeout: 30_000 });
  const picks = await page.evaluate(() => [...document.querySelectorAll("h5")].map((h) => h.textContent.trim()));
  const codons = await page.locator("h5:has-text('Alternative codons') + div").evaluateAll(
    (els) => els.map((e) => [...e.querySelectorAll("span.font-mono")].map((s) => s.textContent.trim())));
  const headingsAndOptions = picks.map((h, i) => [h, codons[i]]);
  fs.writeFileSync(path.join(OUT, "observed-codon-options.json"), JSON.stringify({ headings: picks, options: codons, effectiveLimit: "legacy 3 (form sends maxMutationsPerSite; backend reads only maxMutPerSite, default 3)" }, null, 1));
  const byAa = {};
  headingsAndOptions.forEach(([h, opts]) => { byAa[h.match(/aa: (\w)/)[1]] = [...opts].sort(); });
  const wantAa = Object.fromEntries(Object.entries(EXP.synonymous_alternatives_by_amino_acid).map(([k, v]) => [k, [...v].sort()]));
  check("fixture.synonymous-alternatives-observed-under-limit-3", JSON.stringify(byAa) === JSON.stringify(wantAa),
    `observed ${JSON.stringify(byAa)} == expectations.json ${JSON.stringify(wantAa)}. NOTE: observed under the form's effective legacy limit 3, ` +
    `so this is NOT the canonical limit-1 fixture run (that stays OPEN: fixture.canonical-limit-1-run).`);
});

test("07 user-selected primer action on the first sequence and its consumed result", async () => {
  // locate the first codon option of the first site's picker and choose it like a user
  await page.getByText("Mutation Analysis").first().click();
  const rows = page.locator("h5:has-text('Alternative codons') + div > div");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  // the app pre-selects its recommended codon; choose a DIFFERENT option so the click is a real user choice
  const rowInfo = await rows.evaluateAll((els) => els.map((e) => ({ codon: e.querySelector("span.font-mono").textContent.trim(), selected: /bg-blue-100/.test(e.className) })));
  const idx = rowInfo.findIndex((r) => !r.selected);
  check("primers.alternative-available", idx >= 0, `option rows ${JSON.stringify(rowInfo)}`);
  const chosenCodon = rowInfo[idx].codon;
  const optionRow = rows.nth(idx);
  const designBtn = page.getByRole("button", { name: "Design Primers" });
  await optionRow.click();
  await expect(optionRow).toHaveClass(/bg-blue-100/);
  await expect(designBtn).toBeEnabled();
  await shot("07a-codon-selected.png");
  const [designReq] = await Promise.all([
    page.waitForRequest((r) => /\/api\/design_primers$/.test(r.url()) && r.method() === "POST"),
    designBtn.click(),
  ]);
  const body = JSON.parse(designReq.postData());
  const accepted = await (await designReq.response()).json();
  check("primers.request", body.job_id === S.jobId && Number(body.sequence_idx) === 0, `design_primers job_id=${body.job_id} sequence_idx=${body.sequence_idx} (first sequence, this submission)`);
  const selected = Object.values(body.selected_mutations);
  check("primers.selection-sent", selected.length >= 1 && selected.includes(chosenCodon), `selected_mutations=${JSON.stringify(body.selected_mutations)} contains chosen codon ${chosenCodon}`);
  S.designBody = body; S.designTask = accepted.task_id;
  // the consumed result: a custom set labelled with exactly the selection that was sent
  await page.getByText("Primer Design", { exact: true }).first().click();
  const label = page.getByTestId("selected-mutations").last();
  await expect(label).toBeVisible({ timeout: TERMINAL_BOUND_MS });
  const shown = await label.innerText();
  for (const [k, v] of Object.entries(body.selected_mutations)) {
    check(`primers.displayed-selection ${k}`, shown.includes(`${k}=${v}`), `displayed "${shown.replace(/\s+/g, " ")}"`);
  }
  await expect(page.getByText("Custom Design").first()).toBeVisible();
  await shot("07b-custom-primers.png");
  // API-only follow-up for the same task
  const task = await (await api.get(`/api/task-status/${S.designTask}`)).json();
  check("primers.task-api", /success/i.test(task.state || task.status || ""), `GET /api/task-status/${S.designTask} -> ${JSON.stringify(task).slice(0, 200)}`);
  S.taskApi = task;
  fs.writeFileSync(path.join(OUT, "design-primers-task.json"), JSON.stringify({ request: body, accepted, task }, null, 1));
  // primers displayed for the selected set, to compare with the download
  const pairs = await page.locator("div.border-l-4").evaluateAll((els) =>
    els.map((e) => ({ label: e.querySelector("strong")?.textContent.trim(), seq: e.querySelector("div.font-mono")?.textContent.trim(),
      name: [...e.querySelectorAll("span.font-medium")].map((s) => s.textContent.trim())[0] })));
  S.displayedPrimers = pairs.filter((p) => p.seq);
  check("primers.displayed", S.displayedPrimers.length >= 2, `${S.displayedPrimers.length} primers displayed`);
});

test("08 browser TSV download is parsed and matches the displayed selected primer set", async () => {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download TSV" }).click(),
  ]);
  const file = path.join(OUT, "downloaded-primers.tsv");
  await download.saveAs(file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
  check("download.name", /^primers_\d+_[0-9a-f]{8}\.tsv$/.test(download.suggestedFilename()), download.suggestedFilename());
  check("download.header", lines[0].join("\t") === "Primer Name\tSequence\tAmplicon", `header ${JSON.stringify(lines[0])}`);
  const rows = lines.slice(1);
  check("download.rowcount", rows.length === S.displayedPrimers.length, `${rows.length} TSV rows vs ${S.displayedPrimers.length} displayed primers`);
  check("download.columns", rows.every((r) => r.length === 3 && r[2] === ""), "3 columns; Amplicon honestly empty (no amplicon length is computed)");
  // sequences in the file == sequences displayed (order: forward, reverse per pair)
  const fileSeqs = rows.map((r) => r[1]);
  const shownSeqs = S.displayedPrimers.map((p) => p.seq);
  check("download.sequences", JSON.stringify(fileSeqs) === JSON.stringify(shownSeqs), `TSV sequences ${JSON.stringify(fileSeqs)}`);
  // and the file's sequences are exactly the primers of the API task result for the selection that was sent
  const flat = JSON.stringify(S.taskApi);
  check("download.matches-task-result", fileSeqs.every((s) => flat.includes(s)), "every downloaded primer sequence appears in GET /api/task-status result");
  // the server-side export is also retrievable by API only
  const exp = await api.post("/api/export", { data: { primers: rows } });
  const expUrl = (await exp.json()).download_url;
  const again = await (await api.get(expUrl)).text();
  check("download.api-roundtrip", again === text, `API-only export of the same rows reproduces the downloaded file (${expUrl})`);
});

test("09 API-only follow-ups: unknown/invalid requests are rejected with bounded errors", async () => {
  const unknown = await api.get("/api/jobs/not-a-real-job");
  check("api.unknown-job", unknown.status() === 404, `GET /api/jobs/not-a-real-job -> ${unknown.status()}`);
  const bad = await api.post("/api/generate_protocol", { data: { species: "homo_sapiens", sequencesToDomesticate: [{ sequence: "ATGC!!", mtkPartLeft: "5", mtkPartRight: "5" }] } });
  check("api.invalid-submission", bad.status() === 400, `POST invalid -> ${bad.status()} ${(await bad.text()).slice(0, 120)}`);
  const noSel = await api.post("/api/design_primers", { data: { job_id: S.jobId, sequence_idx: 0, selected_mutations: {} } });
  check("api.empty-selection", noSel.status() === 400, `POST design_primers with empty selection -> ${noSel.status()}`);
  const outOfRange = await api.post("/api/design_primers", { data: { job_id: S.jobId, sequence_idx: 9, selected_mutations: { x: "GAA" } } });
  check("api.sequence-out-of-range", outOfRange.status() === 400, `-> ${outOfRange.status()}`);
});

test("10 controlled real-worker failure reaches a bounded terminal error in the browser", async () => {
  // Fault injection on RUN-OWNED infrastructure: a fresh submission is processed normally, then
  // its request record is deleted from this run's own Redis.  The user's primer-design action is
  // then rejected by the REAL Celery worker ("submission no longer available"): a genuine
  // worker-side failure, not a mocked API response.  (No >=80 bp input that passes the form and API
  // validation makes the generate step itself fail in the worker; the lone-stop-codon inputs that do
  // are blocked by the form's 80 bp minimum, so this is the reachable worker-failure path.)
  const redisCli = JSON.parse(process.env.MTK_REDIS_CLI_JSON || "null");
  if (!redisCli) throw new Error("MTK_REDIS_CLI_JSON is required for the controlled-failure check");
  await fillForm(SEQ, "worker-failure-probe", fx.mtkPartLeft, fx.mtkPartRight);
  const submit = page.getByRole("button", { name: "Generate Protocol" });
  await expect(submit).toBeEnabled();
  const [reqEv] = await Promise.all([
    page.waitForRequest((r) => /\/api\/generate_protocol$/.test(r.url())),
    submit.click(),
  ]);
  const acc = await (await reqEv.response()).json();
  check("failure.accepted", !!acc.job_id, `job ${acc.job_id} accepted and processed normally`);
  await expect(page.getByTestId("sequence-status-success")).toBeVisible({ timeout: TERMINAL_BOUND_MS });
  const key = `req:${acc.job_id}:0`;
  const del = execFileSync(redisCli[0], [...redisCli.slice(1), "DEL", key], { encoding: "utf8", timeout: 30_000 }).trim();
  check("failure.injected", del === "1", `redis DEL ${key} -> ${del} (run-owned Redis)`);
  await page.getByText("Mutation Analysis").first().click();
  const optionRow = page.locator("h5:has-text('Alternative codons') + div > div").first();
  await expect(optionRow).toBeVisible({ timeout: 60_000 });
  await optionRow.click();
  await expect(page.getByRole("button", { name: "Design Primers" })).toBeEnabled();
  const started = Date.now();
  const [designReq] = await Promise.all([
    page.waitForRequest((r) => /\/api\/design_primers$/.test(r.url())),
    page.getByRole("button", { name: "Design Primers" }).click(),
  ]);
  const accepted = await (await designReq.response()).json();
  await page.getByText("Primer Design", { exact: true }).first().click();
  const alert = page.getByTestId("custom-primer-failure").first();
  await expect(alert).toBeVisible({ timeout: TERMINAL_BOUND_MS });
  const shownMs = Date.now() - started;
  const text = (await alert.innerText()).trim();
  await shot("10-worker-failure.png");
  check("failure.bounded", shownMs < TERMINAL_BOUND_MS, `terminal error visible after ${shownMs} ms (< ${TERMINAL_BOUND_MS} ms)`);
  check("failure.message", /Primer design failed: the submission is no longer available/.test(text) && !/Traceback|File "/.test(text), `message: ${JSON.stringify(text)}`);
  await page.getByText("Mutation Analysis").first().click();
  await expect(page.getByRole("button", { name: "Design Primers" })).toBeEnabled();   // not stuck in "Designing..."
  const task = await (await api.get(`/api/task-status/${accepted.task_id}`)).json();
  check("failure.task-api", /fail/i.test(JSON.stringify(task)), `GET /api/task-status -> ${JSON.stringify(task).slice(0, 200)}`);
  fs.writeFileSync(path.join(OUT, "failure-task.json"), JSON.stringify({ jobId: acc.job_id, task, displayed: text }, null, 1));
});

test("11 no uncaught page errors", async () => {
  check("browser.no-pageerrors", pageErrors.length === 0, `pageerror count=${pageErrors.length} ${pageErrors.slice(0, 2).join(" | ")}`);
});
