import os
import sys
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(pathlib.Path(__file__).parent))


@pytest.fixture
def app(monkeypatch, tmp_path):
    """A real create_app() started from a clean cwd with no pre-existing log dirs."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.delenv("PREFILL_DATA", raising=False)
    from flask_backend.app import create_app
    return create_app()


@pytest.fixture
def client(app):
    return app.test_client()
