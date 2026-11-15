#!/usr/bin/env bash
# Save the REPORTING POLICY of a committed SHA into an evidence directory, from git objects only.
#
#   freeze_policy.sh OUT [SHA]        (SHA defaults to HEAD of the repository containing this script)
#
# Writes OUT/policy/summarize_evidence.py, OUT/policy/required-checks.txt and OUT/policy/policy.json (source SHA,
# git blob ids and sha256 of each file). The content comes from `git show SHA:path`, never from the working tree, so
# uncommitted edits to the summarizer or the required-check list can never change the verdict attributed to SHA.
# The copies live in OUT, which survives the run-owned stack/cache/snapshot cleanup. summarize_evidence.py is
# standard-library-only, so the frozen copy has every dependency it needs. stdout: the SHA. Exit 0 ok, 2 error.
set -euo pipefail
OUT="${1:-}"; SHA_ARG="${2:-}"
[ -n "$OUT" ] || { echo "usage: $0 OUT [SHA]" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SHA="$(git rev-parse --verify "${SHA_ARG:-HEAD}^{commit}")"
SUMM="scripts/readiness/summarize_evidence.py"
REQ="tests/readiness/browser/required-checks.txt"
mkdir -p "$OUT/policy"
git show "$SHA:$SUMM" > "$OUT/policy/summarize_evidence.py"
git show "$SHA:$REQ"  > "$OUT/policy/required-checks.txt"
python3 -I - "$OUT/policy" "$SHA" "$(git rev-parse "$SHA:$SUMM")" "$(git rev-parse "$SHA:$REQ")" <<'E_PY'
import hashlib, json, pathlib, sys
d = pathlib.Path(sys.argv[1]); sha, b1, b2 = sys.argv[2:5]
h = lambda n: hashlib.sha256((d / n).read_bytes()).hexdigest()
(d / "policy.json").write_text(json.dumps({
    "source_sha": sha,
    "source": "git show <source_sha>:<path> (committed content; working-tree edits are never read)",
    "files": {
        "summarize_evidence.py": {"path": "scripts/readiness/summarize_evidence.py", "git_blob": b1, "sha256": h("summarize_evidence.py")},
        "required-checks.txt": {"path": "tests/readiness/browser/required-checks.txt", "git_blob": b2, "sha256": h("required-checks.txt")},
    }}, indent=1) + "\n")
E_PY
echo "$SHA"
