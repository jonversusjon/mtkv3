"""Startup regression tests: app discovery, clean start, species API, built bundle."""
import os
import pathlib
import shutil
import subprocess
import sys

import pytest
import yaml

import asset_check as ac
from conftest import REPO

BUNDLE = REPO / "flask_backend" / "static" / "react"


# ---- application discovery / clean start -----------------------------------
def test_flask_discovers_factory_explicitly(tmp_path):
    env = {**os.environ, "PYTHONPATH": str(REPO), "FLASK_ENV": "development"}
    env.pop("FLASK_APP", None)
    out = subprocess.run(
        [sys.executable, "-m", "flask", "--app", "flask_backend.app:create_app", "routes"],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert "/api/species" in out.stdout


def test_bare_flask_run_is_not_the_default_any_more():
    """The container must not depend on implicit discovery (the baseline failure)."""
    text = (REPO / "flask_backend" / "Dockerfile").read_text()
    assert "FLASK_APP=flask_backend.app:create_app" in text
    cmd = [l for l in text.splitlines() if l.startswith("CMD")][-1]
    assert "--app" in cmd and "flask_backend.app:create_app" in cmd


def test_create_app_starts_without_preexisting_log_dirs(monkeypatch, tmp_path):
    log_dir = REPO / "flask_backend" / "log_utils" / "logs"
    shutil.rmtree(log_dir, ignore_errors=True)  # simulate a clean checkout/container
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLASK_ENV", "development")
    from flask_backend.app import create_app
    create_app()
    assert log_dir.is_dir()


# ---- species API -----------------------------------------------------------
def test_species_endpoint_matches_codon_tables_on_disk(client):
    tables = REPO / "flask_backend" / "static" / "data" / "codon_usage_tables"
    expected = sorted(p.stem for p in tables.glob("*.json"))
    assert expected, "no codon usage tables found"
    r = client.get("/api/species")
    assert r.status_code == 200
    assert r.is_json
    assert sorted(r.get_json()["species"]) == expected
    assert {"homo_sapiens", "mus_musculus"} <= set(expected)


def test_species_redirect_alias(client):
    r = client.get("/species")
    assert r.status_code == 302 and r.headers["Location"].endswith("/api/species")


def test_unknown_api_and_file_paths_return_json_404_not_html(client):
    for path in ("/api/nope", "/assets/missing.js", "/missing.css", "/sse/nope"):
        r = client.get(path)
        assert r.status_code == 404, path
        assert r.is_json, f"{path} returned {r.content_type}"


# ---- asset checker must reject bad serving ---------------------------------
INDEX = b'<!doctype html><script type="module" src="/static/react/assets/a.js"></script><link rel="stylesheet" href="/static/react/assets/a.css">'


def _fetcher(table):
    def fetch(path):
        return table.get(path, (404, "application/json", b"{}"))
    return fetch


GOOD = {
    "/": (200, "text/html; charset=utf-8", INDEX),
    "/static/react/assets/a.js": (200, "text/javascript; charset=utf-8", b"console.log(1)"),
    "/static/react/assets/a.css": (200, "text/css; charset=utf-8", b"a{}"),
}


def test_asset_checker_accepts_good_bundle():
    assert len(ac.check_assets(_fetcher(GOOD))) == 2


def test_asset_checker_rejects_missing_asset():
    bad = {k: v for k, v in GOOD.items() if k != "/static/react/assets/a.js"}
    with pytest.raises(ac.AssetCheckError, match="missing asset"):
        ac.check_assets(_fetcher(bad))


def test_asset_checker_rejects_html_masquerading_as_javascript():
    # Status 200 AND a JS content-type, but the body is the SPA index page.
    bad = {**GOOD, "/static/react/assets/a.js": (200, "text/javascript", INDEX)}
    with pytest.raises(ac.AssetCheckError, match="HTML document"):
        ac.check_assets(_fetcher(bad))


def test_asset_checker_rejects_html_content_type_for_javascript():
    bad = {**GOOD, "/static/react/assets/a.js": (200, "text/html", b"console.log(1)")}
    with pytest.raises(ac.AssetCheckError, match="Content-Type"):
        ac.check_assets(_fetcher(bad))


# ---- built bundle served by the real Flask app ------------------------------
@pytest.fixture
def built_bundle():
    """Build the bundle with the project's own npm script; fail (never skip) if it can't."""
    if BUNDLE.exists():
        shutil.rmtree(BUNDLE)
    r = subprocess.run(["npm", "run", "build"], cwd=REPO / "react-frontend",
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stdout + r.stderr
    yield BUNDLE
    shutil.rmtree(BUNDLE, ignore_errors=True)


def test_flask_serves_fresh_bundle_with_correct_assets(client, built_bundle):
    assets = ac.check_assets(ac.flask_fetch(client))
    assert all(a.startswith("/static/react/assets/") for a in assets)
    # client-side route falls back to index.html
    r = client.get("/results")
    assert r.status_code == 200 and "text/html" in r.content_type


def test_flask_rejects_removed_asset_from_built_bundle(client, built_bundle):
    js = next(p for p in (built_bundle / "assets").glob("*.js"))
    js.unlink()
    with pytest.raises(ac.AssetCheckError, match="missing asset"):
        ac.check_assets(ac.flask_fetch(client))


# ---- compose / image static checks (docker daemon not needed) ---------------
def _compose(name):
    return yaml.safe_load((REPO / name).read_text())


def test_default_compose_has_no_bind_mount_hiding_the_bundle():
    c = _compose("docker-compose.yaml")
    for name in ("backend", "worker"):
        svc = c["services"][name]
        assert svc["build"]["dockerfile"] == "flask_backend/Dockerfile"
        for v in svc.get("volumes", []):
            assert not str(v).startswith((".:", "./:")), f"{name} bind-mounts the repo over /app"
    cmd = c["services"]["backend"]["command"]
    assert "flask_backend.app:create_app" in " ".join(cmd)


def test_dockerfile_builds_bundle_in_image():
    text = (REPO / "flask_backend" / "Dockerfile").read_text()
    assert "npm ci" in text and "npm run build" in text
    assert "COPY --from=frontend" in text and "flask_backend/static/react" in text


def test_dockerignore_excludes_stale_artifacts_and_has_no_inline_comments():
    lines = [l for l in (REPO / ".dockerignore").read_text().splitlines() if l and not l.startswith("#")]
    assert "node_modules/" in lines and "flask_backend/static/react/" in lines
    assert not any("#" in l for l in lines), "inline comments are treated as part of the pattern"


def test_dev_compose_is_a_separate_entry_point_with_explicit_app():
    c = _compose("docker-compose.dev.yaml")
    assert "flask_backend.app:create_app" in c["services"]["backend"]["command"]
    assert "frontend" in c["services"]
