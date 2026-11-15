"""Fast (no Docker, no browser) tests of the real-stack acceptance harness itself.

They prove the harness configuration is sound and that its verdict logic cannot report a
skipped, missing or undecided check as passed.  They do NOT run browser acceptance.
"""
import json
import os
import pathlib
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


def test_full_run_refuses_a_non_empty_output_dir(tmp_path):
    (tmp_path / "x").write_text("stale")
    r = run("bash", str(SCRIPT), "--output", str(tmp_path))
    assert r.returncode == 2 and "not empty" in r.stderr


def _summ(tmp_path, rows, pw_exit=0, required=("a.one", "b.two*")):
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


def test_canonical_limit_1_fixture_is_required_and_recorded_open_by_the_spec():
    """Owner decision pending (form sends maxMutationsPerSite; backend reads maxMutPerSite, default 3):
    the canonical limit-1 browser run is not decidable, so it must stay OPEN, never silently PASS."""
    assert "fixture.canonical-limit-1-run" in REQUIRED.read_text()
    spec = (REPO / "tests/readiness/browser/acceptance.spec.mjs").read_text()
    assert 'record("fixture.canonical-limit-1-run", "OPEN"' in spec
    assert 'maxMutPerSite' in spec and "page.route(" not in spec
