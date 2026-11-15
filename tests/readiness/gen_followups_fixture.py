"""Regenerate react-frontend/src/test/fixtures/followups.json from the REAL backend
(real routes + task bodies, in-memory redis/SSE).  The frontend tests use it so the UI
is exercised with the shapes the server really produces; test_followups.py fails if the
committed file drifts from what the backend produces.

    PYTHONPATH=. scripts/readiness/.venv/bin/python -m pytest tests/readiness/gen_followups_fixture.py -p no:cacheprovider
"""
import json

from conftest import REPO
from test_followups import browser_sites, design_ok, payload, select, submit, FIXTURE_PATH, build_fixture


def test_write_fixture(lifecycle):
    FIXTURE_PATH.write_text(json.dumps(build_fixture(lifecycle), indent=1, sort_keys=True) + "\n")
