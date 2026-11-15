#!/usr/bin/env python3
"""Turn a verify-clean-stack.sh output directory into the evidence verdict files.

Usage:
  summarize_evidence.py OUT REQUIRED_FILE PLAYWRIGHT_EXIT     summarise a run
  summarize_evidence.py --not-run OUT REASON [DETAIL...]      record that acceptance did NOT run

Written files (all derived from observed facts in OUT; nothing is pre-filled as passing):
  summary.json          machine-readable verdict (>= 100 bytes)
  browser-results.json  per-test Playwright outcomes, every recorded check, and the three
                        pending / success / failure observations (>= 100 bytes)
  result.json           same verdict, kept for older consumers (NOT written for --not-run)
  SUMMARY.md            human-readable form

Verdict rules (only PASS satisfies a required check):
  FAIL  any recorded FAIL; any required check never recorded; any required check whose status is
        not PASS/OPEN (INFO, SKIP, unknown); any unrecognised status anywhere; Playwright exited
        non-zero; the Playwright report is missing/unreadable or contains a test that did not
        pass (skipped, interrupted, timed out, failed, flaky)
  OPEN  no FAIL, but a required check is recorded OPEN (cannot be decided yet)
  PASS  every required check recorded PASS and every Playwright test passed
  NOT-RUN  (--not-run) infrastructure unavailable; nothing was accepted
Exit status: 0 PASS, 3 OPEN, 1 FAIL, 2 NOT-RUN.
"""
import datetime
import fnmatch
import json
import pathlib
import sys

KNOWN = {"PASS", "FAIL", "OPEN", "INFO"}
OBSERVATION_GROUPS = {          # the three distinct outcomes that must each be observed
    "pending": "pending.*",
    "success": "results.*",
    "failure": "failure.*",
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load_checks(out):
    rows = []
    p = out / "checks.jsonl"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_required(required_file):
    pats = []
    for line in pathlib.Path(required_file).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(line)
    return pats


def load_env(out):
    mp = out / "environment.json"
    env = json.loads(mp.read_text()) if mp.exists() else {}
    sp = out / "tested-sha.txt"
    if not env.get("tested_sha") and sp.exists():
        env["tested_sha"] = sp.read_text().strip()
    return env


def read_playwright(out):
    """Return (tests, problem). tests: list of {title, status, duration_ms}; problem: str|None."""
    p = out / "playwright-report.json"
    if not p.exists():
        return [], "playwright-report.json is missing (Playwright did not produce a report)"
    try:
        rep = json.loads(p.read_text())
    except ValueError as e:
        return [], f"playwright-report.json is unreadable: {e}"
    tests = []

    def walk(suite, trail):
        t = trail + ([suite["title"]] if suite.get("title") else [])
        for spec in suite.get("specs", []):
            for tst in spec.get("tests", []):
                results = tst.get("results", [])
                status = results[-1].get("status") if results else "skipped"
                # Playwright marks the whole test "skipped" via its own status as well
                if tst.get("status") in ("skipped", "flaky", "unexpected"):
                    status = status if tst.get("status") == "unexpected" else tst["status"]
                tests.append({"title": " > ".join(t + [spec.get("title", "")]).strip(" >"),
                              "status": status,
                              "duration_ms": sum(r.get("duration", 0) for r in results)})
        for sub in suite.get("suites", []):
            walk(sub, t)

    for s in rep.get("suites", []):
        walk(s, [])
    problem = None
    if not tests:
        problem = "Playwright report contains no tests"
    return tests, problem


def classify(rows, pats):
    by_pat = {p: [r for r in rows if fnmatch.fnmatchcase(r["id"], p)] for p in pats}
    missing = [p for p, rs in by_pat.items() if not rs]
    required_bad = []                  # recorded, but not PASS/OPEN/FAIL: INFO, SKIP, unknown
    for p, rs in by_pat.items():
        for r in rs:
            if r["status"] not in ("PASS", "OPEN", "FAIL"):
                required_bad.append({"pattern": p, "id": r["id"], "status": r["status"], "detail": r.get("detail", "")})
    fails = [r for r in rows if r["status"] == "FAIL"]
    opens = [r for r in rows if r["status"] == "OPEN" and any(fnmatch.fnmatchcase(r["id"], p) for p in pats)]
    passes = [r for r in rows if r["status"] == "PASS"]
    unknown = [r for r in rows if r["status"] not in KNOWN]
    return missing, required_bad, fails, opens, passes, unknown


def observations(rows):
    obs = {}
    for name, pat in OBSERVATION_GROUPS.items():
        rs = [r for r in rows if fnmatch.fnmatchcase(r["id"], pat)]
        obs[name] = {
            "observed": bool(rs) and all(r["status"] == "PASS" for r in rs),
            "checks": [{"id": r["id"], "status": r["status"], "detail": r.get("detail", "")} for r in rs],
        }
    return obs


def write_all(out, summary, browser_results, md_lines, with_result=True):
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    (out / "browser-results.json").write_text(json.dumps(browser_results, indent=1) + "\n")
    if with_result:                       # result.json exists only when a real verdict was reached
        (out / "result.json").write_text(json.dumps(summary, indent=1) + "\n")
    (out / "SUMMARY.md").write_text("\n".join(md_lines) + "\n")


def summarise(out, required_file, pw_exit):
    rows = load_checks(out)
    pats = load_required(required_file)
    missing, required_bad, fails, opens, passes, unknown = classify(rows, pats)
    tests, pw_problem = read_playwright(out)
    not_passed = [t for t in tests if t["status"] != "passed"]

    reasons = []
    if fails:
        reasons.append(f"{len(fails)} check(s) recorded FAIL")
    if missing:
        reasons.append(f"{len(missing)} required check(s) never recorded")
    if required_bad:
        reasons.append(f"{len(required_bad)} required check(s) recorded a non-PASS status (INFO/SKIP/unknown)")
    if unknown:
        reasons.append(f"{len(unknown)} check(s) with an unrecognised status")
    if pw_exit != 0:
        reasons.append(f"Playwright exited {pw_exit}")
    if pw_problem:
        reasons.append(pw_problem)
    if not_passed:
        reasons.append(f"{len(not_passed)} Playwright test(s) did not pass: " +
                       ", ".join(f"{t['title']} [{t['status']}]" for t in not_passed))

    if reasons:
        verdict = "FAIL"
    elif opens:
        verdict = "OPEN"
    else:
        verdict = "PASS"

    env = load_env(out)
    summary = {
        "verdict": verdict,
        "exit_status": {"PASS": 0, "OPEN": 3, "FAIL": 1}[verdict],
        "generated_at": now(),
        "tested_sha": env.get("tested_sha"),
        "playwright_exit": pw_exit,
        "failure_reasons": reasons,
        "counts": {"pass": len(passes), "fail": len(fails), "open": len(opens),
                   "required_missing": len(missing), "required_non_pass": len(required_bad),
                   "playwright_tests": len(tests), "playwright_not_passed": len(not_passed)},
        "required_missing": missing,
        "required_non_pass": required_bad,
        "open": [{"id": r["id"], "detail": r.get("detail", "")} for r in opens],
        "fail": [{"id": r["id"], "detail": r.get("detail", "")} for r in fails],
        "environment": env,
    }
    browser_results = {
        "verdict": verdict,
        "tested_sha": env.get("tested_sha"),
        "playwright_exit": pw_exit,
        "playwright_report_problem": pw_problem,
        "tests": tests,
        "observations": observations(rows),
        "checks": [{"id": r["id"], "status": r["status"], "detail": r.get("detail", "")} for r in rows],
    }

    L = [f"# Browser acceptance: {verdict}", ""]
    L += [f"- tested SHA: `{env.get('tested_sha')}`", f"- host: `{env.get('host')}` ({env.get('kernel')})",
          f"- designated host (Lerpterp3 WSL2) match: **{env.get('designated_host_match')}**",
          f"- started: {env.get('started_at')}  finished: {env.get('finished_at')}",
          f"- passed {len(passes)} / failed {len(fails)} / open {len(opens)} / required-but-missing {len(missing)} / "
          f"required-non-PASS {len(required_bad)}",
          f"- Playwright tests: {len(tests)} ({len(tests) - len(not_passed)} passed, {len(not_passed)} not passed)", ""]
    if verdict == "PASS":
        L.append("All required checks passed.")
    if reasons:
        L += ["## Why this is not a PASS", ""] + [f"- {x}" for x in reasons] + [""]
    if opens:
        L += ["## OPEN (not passed; not skipped)", ""] + [f"- **{r['id']}**: {r.get('detail', '')}" for r in opens] + [""]
    if fails:
        L += ["## FAILED", ""] + [f"- **{r['id']}**: {r.get('detail', '')}" for r in fails] + [""]
    if missing:
        L += ["## Required checks that never ran (counted as FAIL)", ""] + [f"- {m}" for m in missing] + [""]
    if required_bad:
        L += ["## Required checks recorded INFO/SKIP/unknown (counted as FAIL)", ""] + \
             [f"- **{r['id']}** [{r['status']}]" for r in required_bad] + [""]
    L += ["## Pending / success / failure observations", ""]
    for name, o in browser_results["observations"].items():
        L.append(f"- {name}: {'observed' if o['observed'] else 'NOT fully observed'} ({len(o['checks'])} checks)")
    L += ["", "## Environment", "", "```json", json.dumps(env, indent=1), "```", "", "## All checks", ""]
    L += [f"- {r['status']} `{r['id']}` — {r.get('detail', '')}" for r in rows]
    write_all(out, summary, browser_results, L)
    print(f"verdict: {verdict}  pass={len(passes)} fail={len(fails)} open={len(opens)} missing={len(missing)} "
          f"required_non_pass={len(required_bad)} playwright_not_passed={len(not_passed)}")
    return summary["exit_status"]


def not_run(out, reason, detail):
    env = load_env(out)
    summary = {
        "verdict": "NOT-RUN",
        "exit_status": 2,
        "generated_at": now(),
        "acceptance_run": False,
        "reason": reason,
        "detail": detail,
        "tested_sha": env.get("tested_sha"),
        "note": "Infrastructure was unavailable or setup failed; no browser acceptance verdict exists for this directory.",
    }
    browser_results = {
        "verdict": "NOT-RUN",
        "acceptance_run": False,
        "reason": reason,
        "tests": [],
        "observations": {k: {"observed": False, "checks": []} for k in OBSERVATION_GROUPS},
        "checks": [{"id": r["id"], "status": r["status"], "detail": r.get("detail", "")} for r in load_checks(out)],
        "note": "No Playwright test ran to completion; nothing here is a passing result.",
    }
    L = ["# Browser acceptance: NOT RUN", "", f"- reason: {reason}", *([f"- detail: {d}" for d in detail]),
         "", "No acceptance verdict exists for this run."]
    write_all(out, summary, browser_results, L, with_result=False)
    return 2


def main(argv):
    if len(argv) >= 3 and argv[1] == "--not-run":
        return not_run(pathlib.Path(argv[2]), argv[3] if len(argv) > 3 else "unspecified", argv[4:])
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 64
    return summarise(pathlib.Path(argv[1]), argv[2], int(argv[3]) if len(argv) > 3 else 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
