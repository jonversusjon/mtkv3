#!/usr/bin/env python3
"""Turn a verify-clean-stack.sh output directory into result.json + SUMMARY.md.

Verdict rules (a skipped or missing check can never be reported as passed):
  FAIL  any recorded FAIL, or any REQUIRED check that was never recorded, or Playwright failed
  OPEN  no FAIL, but some required check is recorded OPEN (cannot be decided yet)
  PASS  every required check recorded PASS
Exit status: 0 PASS, 3 OPEN, 1 FAIL.   (2 is reserved by the harness for "infrastructure unavailable")
"""
import fnmatch
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
required_file = pathlib.Path(sys.argv[2])
pw_exit = int(sys.argv[3]) if len(sys.argv) > 3 else 0


def load_checks():
    rows = []
    p = out / "checks.jsonl"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def required():
    pats = []
    for line in required_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(line)
    return pats


rows = load_checks()
pats = required()
by_id = {}
for r in rows:
    by_id.setdefault(r["id"], []).append(r["status"])

missing = [p for p in pats if not any(fnmatch.fnmatchcase(i, p) for i in by_id)]
fails = [r for r in rows if r["status"] == "FAIL"]
opens = [r for r in rows if r["status"] == "OPEN" and any(fnmatch.fnmatchcase(r["id"], p) for p in pats)]
passes = [r for r in rows if r["status"] == "PASS"]

if fails or missing or pw_exit != 0:
    verdict = "FAIL"
elif opens:
    verdict = "OPEN"
else:
    verdict = "PASS"

meta = {}
mp = out / "environment.json"
if mp.exists():
    meta = json.loads(mp.read_text())

result = {
    "verdict": verdict,
    "playwright_exit": pw_exit,
    "counts": {"pass": len(passes), "fail": len(fails), "open": len(opens), "required_missing": len(missing)},
    "required_missing": missing,
    "open": [{"id": r["id"], "detail": r["detail"]} for r in opens],
    "fail": [{"id": r["id"], "detail": r["detail"]} for r in fails],
    "environment": meta,
}
(out / "result.json").write_text(json.dumps(result, indent=1))

L = [f"# Browser acceptance: {verdict}", ""]
L += [f"- tested SHA: `{meta.get('tested_sha')}`", f"- host: `{meta.get('host')}` ({meta.get('kernel')})",
      f"- designated host (Lerpterp3 WSL2) match: **{meta.get('designated_host_match')}**",
      f"- started: {meta.get('started_at')}  finished: {meta.get('finished_at')}",
      f"- passed {len(passes)} / failed {len(fails)} / open {len(opens)} / required-but-missing {len(missing)}", ""]
if verdict == "PASS":
    L.append("All required checks passed.")
if opens:
    L += ["## OPEN (not passed; not skipped)", ""] + [f"- **{r['id']}**: {r['detail']}" for r in opens] + [""]
if fails:
    L += ["## FAILED", ""] + [f"- **{r['id']}**: {r['detail']}" for r in fails] + [""]
if missing:
    L += ["## Required checks that never ran (counted as FAIL)", ""] + [f"- {m}" for m in missing] + [""]
if pw_exit != 0:
    L += [f"Playwright exited {pw_exit}.", ""]
L += ["## Environment", "", "```json", json.dumps(meta, indent=1), "```", "", "## All checks", ""]
L += [f"- {r['status']} `{r['id']}` — {r['detail']}" for r in rows]
(out / "SUMMARY.md").write_text("\n".join(L) + "\n")
print(f"verdict: {verdict}  pass={len(passes)} fail={len(fails)} open={len(opens)} missing={len(missing)}")
sys.exit({"PASS": 0, "OPEN": 3, "FAIL": 1}[verdict])
