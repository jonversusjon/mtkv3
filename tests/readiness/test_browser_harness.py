"""Fast (no Docker, no browser) tests of the real-stack acceptance harness itself.

They prove the harness configuration is sound and that its verdict logic cannot report a
skipped, missing or undecided check as passed.  They do NOT run browser acceptance.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/readiness/verify-clean-stack.sh"
SUMMARIZE = REPO / "scripts/readiness/summarize_evidence.py"
REQUIRED = REPO / "tests/readiness/browser/required-checks.txt"


def run(*args, env=None, timeout=300):
    return subprocess.run(list(args), capture_output=True, text=True, timeout=timeout, env=env)


def test_check_mode_validates_configuration_and_claims_no_acceptance():
    r = run("bash", str(SCRIPT), "--check")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "CHECK OK" in r.stdout
    assert "Browser acceptance was NOT run" in r.stdout
    assert "PASS" not in r.stdout.replace("CHECK OK", "")


def test_unknown_or_missing_arguments_are_rejected():
    assert run("bash", str(SCRIPT)).returncode == 2
    assert run("bash", str(SCRIPT), "--bogus").returncode == 2


def test_full_run_without_docker_hard_fails_and_never_reports_pass(tmp_path):
    # PATH with everything the preflight needs EXCEPT docker.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("bash", "git", "python3", "node", "npm", "dirname", "mkdir", "ls", "date", "tee", "cat", "sed", "env"):
        src = shutil.which(tool)
        assert src, tool
        (bin_dir / tool).symlink_to(src)
    out = tmp_path / "evidence"
    env = {"PATH": str(bin_dir), "HOME": str(tmp_path)}
    r = run(str(bin_dir / "bash"), str(SCRIPT), "--output", str(out), env=env)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "ACCEPTANCE NOT RUN" in r.stderr
    assert (out / "NOT-RUN.txt").exists()
    assert not (out / "result.json").exists()
    summary = json.loads((out / "summary.json").read_text())
    assert summary["verdict"] == "NOT-RUN" and summary["acceptance_run"] is False
    assert json.loads((out / "browser-results.json").read_text())["tests"] == []
    for name in ("summary.json", "browser-results.json"):
        assert (out / name).stat().st_size >= 100


def test_full_run_refuses_a_non_empty_output_dir(tmp_path):
    (tmp_path / "x").write_text("stale")
    r = run("bash", str(SCRIPT), "--output", str(tmp_path))
    assert r.returncode == 2 and "not empty" in r.stderr


def pw_report(*statuses):
    """A Playwright JSON report (same shape the real json reporter writes) with one test per status."""
    specs = []
    for i, st in enumerate(statuses):
        tst_status = {"passed": "expected", "skipped": "skipped", "failed": "unexpected"}.get(st, "unexpected")
        specs.append({"title": f"t{i}", "tests": [{"status": tst_status, "results": [{"status": st, "duration": 5}]}]})
    return {"suites": [{"title": "acceptance.spec.mjs", "specs": specs}]}


def _summ(tmp_path, rows, pw_exit=0, required=("a.one", "b.two*"), report="default"):
    if report == "default":
        report = pw_report("passed", "passed")
    if report is not None:
        (tmp_path / "playwright-report.json").write_text(json.dumps(report))
    (tmp_path / "checks.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    req = tmp_path / "req.txt"
    req.write_text("# c\n" + "\n".join(required) + "\n")
    r = run(sys.executable, str(SUMMARIZE), str(tmp_path), str(req), str(pw_exit))
    return r.returncode, json.loads((tmp_path / "result.json").read_text())


def row(i, s):
    return {"id": i, "status": s, "detail": "d"}


def test_verdict_pass_only_when_every_required_check_passed(tmp_path):
    rc, res = _summ(tmp_path, [row("a.one", "PASS"), row("b.two.x", "PASS")])
    assert (rc, res["verdict"]) == (0, "PASS")


def test_missing_required_check_is_a_failure_not_a_pass(tmp_path):
    rc, res = _summ(tmp_path, [row("a.one", "PASS")])
    assert (rc, res["verdict"]) == (1, "FAIL") and res["required_missing"] == ["b.two*"]


def test_open_check_keeps_run_open_never_pass(tmp_path):
    rc, res = _summ(tmp_path, [row("a.one", "OPEN"), row("b.two.x", "PASS")])
    assert (rc, res["verdict"]) == (3, "OPEN")


def test_fail_beats_open_and_playwright_failure_fails(tmp_path):
    assert _summ(tmp_path, [row("a.one", "OPEN"), row("b.two", "FAIL")])[1]["verdict"] == "FAIL"
    assert _summ(tmp_path, [row("a.one", "PASS"), row("b.two", "PASS")], pw_exit=1)[1]["verdict"] == "FAIL"


def test_info_rows_do_not_count_as_passes_or_opens(tmp_path):
    rc, res = _summ(tmp_path, [row("a.one", "PASS"), row("b.two", "PASS"), row("note", "INFO")])
    assert res["counts"]["pass"] == 2 and rc == 0


def test_canonical_limit_1_fixture_is_required_and_guarded_by_real_observations():
    """The form's 1/2/3 selection is honored, so the canonical limit-1 run can PASS -- but only through
    check() calls that depend on observed values, never a hardcoded PASS/OPEN record."""
    req = REQUIRED.read_text()
    for cid in ("fixture.canonical-limit-1-run", "setting.max-mutations-request", "worker.persisted-limit"):
        assert cid in req
    spec = (REPO / "tests/readiness/browser/acceptance.spec.mjs").read_text()
    assert "page.route(" not in spec
    assert 'record("fixture.canonical-limit-1-run"' not in spec and "legacy" not in spec
    # real selection through the settings selector, then the observed request and worker-persisted limit
    assert 'locator("#mutations-select").selectOption("1")' in spec
    assert 'check("setting.max-mutations-request", sent.maxMutPerSite === fx.settings.maxMutPerSite' in spec
    assert 'check("worker.persisted-limit", persistedLimit === 1' in spec
    m = re.search(r'check\("fixture\.canonical-limit-1-run",\s*([^\n]*)', spec)
    assert m and "S.canonicalLimitObserved === true" in m.group(1) and "byAa" in m.group(1)
    assert "S.canonicalLimitObserved = sent.maxMutPerSite === 1 && persistedLimit === 1" in spec


# ---- regressions for the confirmed false-PASS cases (browser-verdict-probe: PASS/INFO/SKIP all -> PASS) ----
@pytest.mark.parametrize("status,verdict,rc", [("PASS", "PASS", 0), ("INFO", "FAIL", 1), ("SKIP", "FAIL", 1),
                                                ("skip", "FAIL", 1), ("MAYBE", "FAIL", 1), ("OPEN", "OPEN", 3)])
def test_only_pass_satisfies_a_required_check(tmp_path, status, verdict, rc):
    got_rc, res = _summ(tmp_path, [row("a.one", status), row("b.two.x", "PASS")])
    assert (got_rc, res["verdict"]) == (rc, verdict)


def test_info_or_skip_on_a_wildcard_required_check_fails(tmp_path):
    for bad in ("INFO", "SKIP"):
        d = tmp_path / bad
        d.mkdir()
        rc, res = _summ(d, [row("a.one", "PASS"), row("b.two.x", "PASS"), row("b.two.y", bad)])
        assert (rc, res["verdict"]) == (1, "FAIL") and res["required_non_pass"][0]["status"] == bad


def test_info_note_for_a_non_required_check_is_still_allowed_but_unknown_status_is_not(tmp_path):
    assert _summ(tmp_path, [row("a.one", "PASS"), row("b.two", "PASS"), row("note", "INFO")])[0] == 0
    d = tmp_path / "u"
    d.mkdir()
    assert _summ(d, [row("a.one", "PASS"), row("b.two", "PASS"), row("note", "WEIRD")])[1]["verdict"] == "FAIL"


def test_real_playwright_skipped_test_cannot_pass(tmp_path):
    """Run REAL Playwright on a spec with a skipped test: exit code 0, yet the verdict must be FAIL."""
    runner = REPO / "tests/readiness/browser/node_modules/.bin/playwright"
    assert runner.exists(), "Playwright runner missing (test-fast.sh browser installs it)"
    work = tmp_path / "pw"
    (work).mkdir()
    (work / "node_modules").symlink_to(REPO / "tests/readiness/browser/node_modules")
    (work / "demo.spec.mjs").write_text(
        'import { test, expect } from "@playwright/test";\n'
        'test("runs", async () => { expect(1).toBe(1); });\n'
        'test("is skipped", async () => { test.skip(true, "deliberately skipped"); });\n')
    out = tmp_path / "out"
    out.mkdir()
    (work / "playwright.config.mjs").write_text(
        f'export default {{ testDir: ".", reporter: [["json", {{ outputFile: {json.dumps(str(out / "playwright-report.json"))} }}]] }};\n')
    r = subprocess.run([str(runner), "test", "-c", "playwright.config.mjs"], cwd=work, capture_output=True, text=True, timeout=240)
    assert r.returncode == 0, r.stdout + r.stderr          # Playwright itself calls this a success
    report = json.loads((out / "playwright-report.json").read_text())
    assert report["stats"]["skipped"] == 1 and report["stats"]["expected"] == 1
    (out / "checks.jsonl").write_text(json.dumps(row("a.one", "PASS")) + "\n")
    req = tmp_path / "req.txt"
    req.write_text("a.one\n")
    s = run(sys.executable, str(SUMMARIZE), str(out), str(req), "0")
    res = json.loads((out / "result.json").read_text())
    assert s.returncode == 1 and res["verdict"] == "FAIL"
    assert res["counts"]["playwright_not_passed"] == 1 and "is skipped [skipped]" in " ".join(res["failure_reasons"])


def test_skipped_failed_or_missing_playwright_report_cannot_pass(tmp_path):
    ok = [row("a.one", "PASS"), row("b.two", "PASS")]
    assert _summ(tmp_path, ok)[1]["verdict"] == "PASS"
    for i, rep in enumerate((pw_report("passed", "skipped"), pw_report("passed", "failed"), {"suites": []}, None)):
        d = tmp_path / f"r{i}"
        d.mkdir()
        rc, res = _summ(d, ok, report=rep)
        assert (rc, res["verdict"]) == (1, "FAIL"), rep


# ---- output contract: the exact artifacts the approved job requires -------------------------------
def test_summary_and_browser_results_are_written_from_observed_facts(tmp_path):
    rows = [row("a.one", "PASS"), row("b.two.x", "OPEN"), row("pending.api-state", "PASS"), row("results.job-api", "PASS"),
            row("failure.message", "PASS")]
    rc, res = _summ(tmp_path, rows)
    assert rc == 3
    for name in ("summary.json", "browser-results.json"):
        assert (tmp_path / name).stat().st_size >= 100, name
    summary = json.loads((tmp_path / "summary.json").read_text())
    br = json.loads((tmp_path / "browser-results.json").read_text())
    assert summary["verdict"] == br["verdict"] == "OPEN"
    assert [t["status"] for t in br["tests"]] == ["passed", "passed"]
    assert br["observations"]["pending"]["observed"] and br["observations"]["success"]["observed"] and br["observations"]["failure"]["observed"]
    assert {c["id"]: c["status"] for c in br["checks"]}["b.two.x"] == "OPEN"


def test_unsuccessful_runs_write_truthful_files_never_a_passing_placeholder(tmp_path):
    rc, res = _summ(tmp_path, [row("a.one", "FAIL")], pw_exit=1, report=None)
    assert rc == 1
    summary = json.loads((tmp_path / "summary.json").read_text())
    br = json.loads((tmp_path / "browser-results.json").read_text())
    assert summary["verdict"] == "FAIL" and br["tests"] == []
    assert br["observations"]["pending"]["observed"] is False and br["observations"]["failure"]["observed"] is False
    assert "PASS" not in (tmp_path / "SUMMARY.md").read_text().split("\n")[0]


def test_not_run_mode_is_distinct_and_writes_no_result_json(tmp_path):
    r = run(sys.executable, str(SUMMARIZE), "--not-run", str(tmp_path), "docker not found")
    assert r.returncode == 2
    s = json.loads((tmp_path / "summary.json").read_text())
    assert s["verdict"] == "NOT-RUN" and s["reason"] == "docker not found" and not (tmp_path / "result.json").exists()
    assert (tmp_path / "summary.json").stat().st_size >= 100 and (tmp_path / "browser-results.json").stat().st_size >= 100


# ---- source isolation without Docker --------------------------------------------------------------
def _git(cwd, *a):
    return subprocess.run(["git", "-C", str(cwd), *a], capture_output=True, text=True, check=True,
                          env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                               "GIT_COMMITTER_EMAIL": "t@t"}).stdout.strip()


def test_snapshot_tests_committed_head_and_records_but_never_copies_dirty_changes(tmp_path):
    repo = tmp_path / "repo"
    (repo / "scripts/readiness").mkdir(parents=True)
    (repo / "react-frontend").mkdir()
    shutil.copy(REPO / "scripts/readiness/snapshot_source.sh", repo / "scripts/readiness/snapshot_source.sh")
    (repo / "react-frontend/package-lock.json").write_text("committed-lock\n")
    (repo / "app.py").write_text("print('committed')\n")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c1")
    sha = _git(repo, "rev-parse", "HEAD")
    # dirty working tree: tracked edit, untracked file, stale bundle and dependencies
    (repo / "react-frontend/package-lock.json").write_text("USER EDIT\n")
    (repo / "environment.yml").write_text("name: user-env\n")
    (repo / "flask_backend/static/react").mkdir(parents=True)
    (repo / "flask_backend/static/react/stale.js").write_text("stale")
    (repo / "react-frontend/node_modules").mkdir()
    (repo / "react-frontend/node_modules/dep.js").write_text("dep")
    before = {p: p.read_bytes() for p in [repo / "react-frontend/package-lock.json", repo / "environment.yml"]}
    snap, evid = tmp_path / "snap", tmp_path / "evidence.txt"
    r = run("bash", str(repo / "scripts/readiness/snapshot_source.sh"), str(snap), str(evid))
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == sha
    assert (snap / "react-frontend/package-lock.json").read_text() == "committed-lock\n"      # committed, not the user's edit
    assert not (snap / "environment.yml").exists()
    assert not (snap / "flask_backend/static/react").exists() and not (snap / "react-frontend/node_modules").exists()
    text = evid.read_text()
    assert sha in text and "package-lock.json" in text and "environment.yml" in text and "isolation check: ok" in text
    # the main checkout's edits are preserved byte for byte
    assert all(p.read_bytes() == b for p, b in before.items())


def test_harness_no_longer_refuses_a_dirty_tree_but_records_exclusions():
    text = SCRIPT.read_text()
    assert "uncommitted changes; commit first" not in text and "snapshot_source.sh" in text
    assert "source-exclusions.txt" in text and "stack.source-isolation" in text and "git archive" in text


# ---- readiness probe, caches, prerequisites, README ----------------------------------------------
def test_worker_ping_is_captured_whole_not_piped_into_grep_q():
    text = SCRIPT.read_text()
    assert not re.search(r"inspect ping[^\n]*\|\s*grep", text), "piping ping into grep -q SIGPIPEs a healthy worker (141)"
    assert 'PING="$(compose exec' in text and "logs/worker-ping.txt" in text and "stack.worker-ping" in text
    assert "seq 1 30" in text and "while true" not in text           # bounded


def test_sigpipe_behaviour_that_motivated_the_ping_fix():
    """A command that keeps writing after grep -q matches dies with 141 under pipefail; capturing first does not."""
    cmd = 'set -o pipefail; yes pong | head -c 2000000 | grep -q pong'
    assert subprocess.run(["bash", "-c", cmd], capture_output=True).returncode != 0
    cap = 'set -o pipefail; out="$(yes pong | head -c 2000000)"; case "$out" in *pong*) exit 0;; esac; exit 1'
    assert subprocess.run(["bash", "-c", cap], capture_output=True).returncode == 0


def test_downloads_are_run_owned_and_prerequisites_are_declared():
    text = SCRIPT.read_text()
    assert 'npm_config_cache="$TMP/npm-cache"' in text and 'PLAYWRIGHT_BROWSERS_PATH="$TMP/pw-browsers"' in text
    assert "ldd" in text and "install-deps" not in text and "sudo" not in text
    readme = (REPO / "README.md").read_text()
    for lib in ("libnss3", "libgbm1", "libatk-bridge2.0-0", "libxkbcommon0", "libasound2"):
        assert lib in readme, lib


def test_readme_uses_the_real_repository_url_branch_and_artifact_names():
    readme = (REPO / "README.md").read_text()
    assert "git clone --branch logger-overhaul https://github.com/jonversusjon/mtkv3.git mtkv3" in readme
    assert "cd mtkv3" in readme and "<repo-url>" not in readme and "tested-sha.txt" in readme
    for name in ("summary.json", "browser-results.json", "source-exclusions.txt", "worker-ping.txt"):
        assert name in readme, name
    assert "No input of at least 80 bp" not in readme


def test_spec_pauses_only_the_run_owned_worker_and_resumes_in_finally():
    spec = (REPO / "tests/readiness/browser/acceptance.spec.mjs").read_text()
    assert "assertRunOwnedWorker" in spec and "} finally {" in spec and "resumeWorker()" in spec
    assert 'docker("pause", WORKER)' in spec and "sequence-status-pending" in spec
    for cid in ("pending.worker-paused", "pending.api-state", "pending.ui-feedback", "pending.worker-resumed", "pending.then-success"):
        assert cid in spec and cid in REQUIRED.read_text()


# ---- reporting policy is the COMMITTED one, frozen, and immune to working-tree edits (review F1) --------------
PERMISSIVE_SUMMARIZER = (
    'import json, pathlib, sys\n'
    'out = pathlib.Path(sys.argv[1])\n'
    '(out / "summary.json").write_text(json.dumps({"verdict": "PASS", "note": "working-tree summarizer ran" + "." * 100}))\n'
    '(out / "browser-results.json").write_text(json.dumps({"verdict": "PASS", "pad": "." * 100}))\n'
    'sys.exit(0)\n')


def test_uncommitted_edits_to_summarizer_and_required_checks_do_not_affect_committed_reporting(tmp_path):
    repo = tmp_path / "repo"
    (repo / "scripts/readiness").mkdir(parents=True)
    (repo / "tests/readiness/browser").mkdir(parents=True)
    shutil.copy(SUMMARIZE, repo / "scripts/readiness/summarize_evidence.py")
    shutil.copy(REPO / "scripts/readiness/freeze_policy.sh", repo / "scripts/readiness/freeze_policy.sh")
    shutil.copy(REQUIRED, repo / "tests/readiness/browser/required-checks.txt")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c1")
    sha = _git(repo, "rev-parse", "HEAD")
    committed_summ = (repo / "scripts/readiness/summarize_evidence.py").read_bytes()
    committed_req = (repo / "tests/readiness/browser/required-checks.txt").read_bytes()

    # uncommitted edits to BOTH policy files: an always-PASS summarizer and an empty required list
    (repo / "scripts/readiness/summarize_evidence.py").write_text(PERMISSIVE_SUMMARIZER)
    (repo / "tests/readiness/browser/required-checks.txt").write_text("# nothing required\n")
    dirty = {p: p.read_bytes() for p in (repo / "scripts/readiness/summarize_evidence.py",
                                         repo / "tests/readiness/browser/required-checks.txt")}

    out = tmp_path / "evidence"
    out.mkdir()
    r = run("bash", str(repo / "scripts/readiness/freeze_policy.sh"), str(out))
    assert r.returncode == 0 and r.stdout.strip() == sha, r.stderr
    frozen_summ, frozen_req = out / "policy/summarize_evidence.py", out / "policy/required-checks.txt"
    assert frozen_summ.read_bytes() == committed_summ and frozen_req.read_bytes() == committed_req
    meta = json.loads((out / "policy/policy.json").read_text())
    assert meta["source_sha"] == sha
    import hashlib
    assert meta["files"]["summarize_evidence.py"]["sha256"] == hashlib.sha256(committed_summ).hexdigest()
    assert meta["files"]["required-checks.txt"]["sha256"] == hashlib.sha256(committed_req).hexdigest()
    assert meta["files"]["summarize_evidence.py"]["git_blob"] == _git(repo, "rev-parse", f"{sha}:scripts/readiness/summarize_evidence.py")

    # the repo's real run-owned cleanup deletes the checkout, caches and snapshot: reporting must still work from
    # OUT alone. Evidence of a run with NOTHING recorded: the committed policy must say FAIL, not PASS.
    (out / "checks.jsonl").write_text(json.dumps(row("stack.worker-ping", "PASS")) + "\n")
    rc = run("python3", "-I", str(frozen_summ), str(out), str(frozen_req), "0").returncode
    summary = json.loads((out / "summary.json").read_text())
    br = json.loads((out / "browser-results.json").read_text())
    assert rc == 1 and summary["verdict"] == br["verdict"] == "FAIL"
    assert summary["counts"]["required_missing"] > 0 and "working-tree" not in json.dumps(summary)
    assert (out / "summary.json").stat().st_size >= 100 and (out / "browser-results.json").stat().st_size >= 100

    # negative control: the working-tree policy WOULD have changed the verdict (so the test can fail)
    other = tmp_path / "wt"
    other.mkdir()
    (other / "checks.jsonl").write_text("")
    run("python3", "-I", str(repo / "scripts/readiness/summarize_evidence.py"), str(other), str(repo / "tests/readiness/browser/required-checks.txt"), "0")
    assert json.loads((other / "summary.json").read_text())["verdict"] == "PASS"

    # main checkout edits are preserved byte for byte
    assert all(p.read_bytes() == b for p, b in dirty.items())


def test_harness_final_reporting_uses_frozen_policy_not_working_tree_or_deleted_checkout():
    text = SCRIPT.read_text()
    assert "freeze_policy.sh" in text and "stack.reporting-policy" in text
    final = text.split("# final reporting", 1)[1]
    assert '"$OUT/policy/summarize_evidence.py"' in final and '"$OUT/policy/required-checks.txt"' in final
    assert "$ROOT/$BROWSER_DIR/required-checks.txt" not in final and "scripts/readiness/summarize_evidence.py" not in final
    # the not-run path also uses the frozen committed summarizer
    assert 'python3 -I "$ROOT/scripts/readiness/summarize_evidence.py"' not in text


# ---- port allocation / discovery contract (Docker-assigned ports, no pre-picked ports) ----------
PORTS = REPO / "scripts/readiness/ports.sh"


def _bash(snippet, env=None):
    return subprocess.run(["bash", "-c", f"source {PORTS}; {snippet}"], capture_output=True, text=True, timeout=60, env=env)


@pytest.mark.parametrize("text,expected", [
    ("127.0.0.1:49153\n", "49153"),
    ("127.0.0.1:49153\r\n", "49153"),
    ("127.0.0.1:49153\n127.0.0.1:49153\n", "49153"),
    ("127.0.0.1:65535", "65535"),
])
def test_parse_published_port_accepts_loopback_mappings(text, expected):
    r = subprocess.run(["bash", "-c", f'source {PORTS}; parse_published_port "$1"', "x", text], capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == expected


@pytest.mark.parametrize("text", [
    "", "\n", "0.0.0.0:49153", "[::]:49153", "localhost:49153", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:abc",
    "127.0.0.1:", "49153", "127.0.0.1:49153\n127.0.0.1:49154", "127.0.0.1:49153\n0.0.0.0:49153",
    "no container for service backend", "Error response from daemon: port not found",
])
def test_parse_published_port_rejects_malformed_missing_or_non_loopback(text):
    r = subprocess.run(["bash", "-c", f'source {PORTS}; parse_published_port "$1"', "x", text], capture_output=True, text=True)
    assert r.returncode == 1 and r.stdout == ""


def test_resolve_is_bounded_and_fails_honestly_on_bad_output(tmp_path):
    counter = tmp_path / "calls"
    snippet = f'fake() {{ echo x >> {counter}; echo "garbage"; return 1; }}; resolve_published_port fake backend 5000 4 0'
    r = _bash(snippet)
    assert r.returncode == 1 and r.stdout == ""
    assert "could not discover" in r.stderr and "backend:5000" in r.stderr and "4 attempts" in r.stderr
    assert len(counter.read_text().split()) == 4


def test_resolve_retries_until_the_port_is_published(tmp_path):
    counter = tmp_path / "calls"
    snippet = (f'fake() {{ echo x >> {counter}; if [ "$(wc -l < {counter})" -lt 3 ]; then return 1; fi; echo 127.0.0.1:40123; }}; '
               f'resolve_published_port fake redis 6379 5 0')
    r = _bash(snippet)
    assert r.returncode == 0 and r.stdout.strip() == "40123"
    assert len(counter.read_text().split()) == 3


def test_five_services_with_distinct_assigned_ports_all_resolve_uniquely():
    snippet = ('fake() { case "$2" in backend) echo 127.0.0.1:41001;; redis) echo 127.0.0.1:41002;; frontend) echo 127.0.0.1:41003;; esac; }; '
               'for s in "backend 5000" "redis 6379" "frontend 3000"; do resolve_published_port fake $s 1 0; done')
    r = _bash(snippet)
    assert r.returncode == 0
    ports = r.stdout.split()
    assert ports == ["41001", "41002", "41003"] and len(set(ports)) == 3


def test_runner_lets_docker_assign_ports_and_never_picks_them_itself():
    t = SCRIPT.read_text()
    assert ("free_" + "port") not in t and ("s." + "bind") not in t and (".bind" + "((") not in t
    assert "MTK_BACKEND_PORT=0 MTK_REDIS_PORT=0 docker compose" in t
    assert "MTK_BACKEND_PORT=0 MTK_REDIS_PORT=0 MTK_FRONTEND_PORT=0 docker compose" in t
    for svc, cport in (("backend", "5000"), ("redis", "6379"), ("frontend", "3000")):
        assert f"resolve_published_port devcompose {svc} {cport}" in t or f"resolve_published_port compose {svc} {cport}" in t
    # discovery failure is an infrastructure failure, and ports are recorded as evidence
    assert "not discoverable" in t and "resolved_ports" in t and "resolved: backend=" in t
    # dev discovery failure never PASSes the dev checks
    assert "dev stack failed to start or its host ports were not discoverable" in t


def test_compose_files_keep_user_defaults_and_loopback_binds():
    for name, expect in (("docker-compose.yaml", ("5000", "6379")), ("docker-compose.dev.yaml", ("5000", "6379", "3000"))):
        text = (REPO / name).read_text()
        for port in expect:
            assert f":-{port}}}:{port}\"" in text
        for line in re.findall(r'-\s*"(\$?[^"]*MTK_[A-Z]+_PORT[^"]*)"', text):
            assert line.startswith("127.0.0.1:"), line
