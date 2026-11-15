import importlib
import os
import pathlib
import shutil
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(pathlib.Path(__file__).parent))

# Generated/runtime state that must never be copied into, or affect, a sandbox.
_SANDBOX_IGNORE = shutil.ignore_patterns(
    "__pycache__", "*.pyc", "logs", "log_utils", "react", "*.log")


class Sandbox:
    """A disposable copy of the backend package.

    Everything destructive (removing log dirs, building/removing the bundle)
    happens here, never in the caller's checkout.  The code under test is the
    real flask_backend source, just rooted in a temp directory.
    """

    def __init__(self, root: pathlib.Path):
        self.root = root
        shutil.copytree(REPO / "flask_backend", root / "flask_backend", ignore=_SANDBOX_IGNORE)
        self.pkg = root / "flask_backend"
        self.log_dir = self.pkg / "log_utils" / "logs"
        self.bundle = self.pkg / "static" / "react"

    def create_app(self):
        """Import the sandbox copy of flask_backend (not the checkout's) and build the app."""
        saved = {k: v for k, v in sys.modules.items()
                 if k == "flask_backend" or k.startswith("flask_backend.")}
        for k in saved:
            del sys.modules[k]
        sys.path.insert(0, str(self.root))
        importlib.invalidate_caches()
        try:
            mod = importlib.import_module("flask_backend.app")
            assert pathlib.Path(mod.__file__).resolve().is_relative_to(self.root.resolve()), mod.__file__
            return mod.create_app()
        finally:
            sys.path.remove(str(self.root))
            for k in [k for k in sys.modules
                      if k == "flask_backend" or k.startswith("flask_backend.")]:
                del sys.modules[k]
            sys.modules.update(saved)
            _close_log_handlers()


def _close_log_handlers():
    """Release file handlers opened by a sandbox app so temp dirs delete cleanly."""
    import logging
    for lg in [logging.getLogger()] + [logging.getLogger(n) for n in list(logging.root.manager.loggerDict)]:
        for h in list(getattr(lg, "handlers", [])):
            if isinstance(h, logging.FileHandler):
                lg.removeHandler(h)
                h.close()


def _snapshot(paths):
    snap = {}
    for root in paths:
        if root.exists():
            for f in sorted(root.rglob("*")):
                if f.is_file():
                    st = f.stat()
                    snap[str(f)] = (st.st_size, st.st_mtime_ns)
        else:
            snap[str(root)] = None
    return snap


@pytest.fixture(autouse=True)
def caller_state_untouched():
    """Guard: no test may create, modify or delete the caller checkout's existing
    logs or bundle.  Runs on teardown whether the test passed or failed."""
    watched = [REPO / "flask_backend" / "log_utils" / "logs",
               REPO / "flask_backend" / "static" / "react"]
    before = _snapshot(watched)
    yield
    assert _snapshot(watched) == before, "test mutated caller logs/bundle"


@pytest.fixture
def sandbox(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.delenv("PREFILL_DATA", raising=False)
    sb_root = tmp_path / "sandbox"
    sb_root.mkdir()
    return Sandbox(sb_root)


@pytest.fixture
def app(sandbox):
    """A real create_app() from a sandbox copy, with no pre-existing log dirs."""
    return sandbox.create_app()


@pytest.fixture
def client(app):
    return app.test_client()
