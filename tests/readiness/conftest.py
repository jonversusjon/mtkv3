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
               REPO / "flask_backend" / "static" / "react",
               REPO / "flask_backend" / "static" / "exports"]
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


# ---- lifecycle fixtures: the real app + the real worker code, fake external services ----
@pytest.fixture
def lifecycle(monkeypatch, tmp_path):
    """Real Flask app and real Celery task bodies, run inline, with in-memory
    redis/SSE.  Everything runs from a scratch cwd (the worker writes relative
    ``debug_output``; the symlink lets it find the package's static data), so the
    checkout is never touched."""
    from types import SimpleNamespace

    from fakes import FakeRedis, FakeSse

    (tmp_path / "flask_backend").symlink_to(REPO / "flask_backend")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.setenv("MTKV3_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.delenv("PREFILL_DATA", raising=False)

    from flask_backend import app as app_module
    from flask_backend import celery_tasks, job_state

    redis_fake, sse_fake = FakeRedis(), FakeSse()
    job_state.set_client(redis_fake)
    monkeypatch.setattr(celery_tasks, "redis_client", redis_fake)
    from flask_backend.services import utils as services_utils
    monkeypatch.setattr(services_utils, "redis_client", redis_fake)
    monkeypatch.setattr(celery_tasks, "sse", sse_fake)

    class InlineGroup:
        def __init__(self, sigs):
            self.sigs = list(sigs)
            self.id = "group-1"

        def apply_async(self):
            self.results = [s.apply() for s in self.sigs]  # failures are captured, not raised
            return self

    monkeypatch.setattr(celery_tasks, "group", InlineGroup)

    app = app_module.create_app()
    sent = []
    parent_results = {}

    class FakeCelery:
        """Stands in for the broker: runs the real tasks inline."""

        fail_dispatch = False

        def send_task(self, name, args=None, **kw):
            if self.fail_dispatch:
                raise ConnectionError("broker down")
            tasks_by_name = {
                "flask_backend.celery_tasks.generate_protocol_task": ("parent", celery_tasks.generate_protocol_task),
                "flask_backend.celery_tasks.design_primers_task": ("design", celery_tasks.design_primers_task),
            }
            assert name in tasks_by_name, name
            kind, task = tasks_by_name[name]
            task_id = f"{kind}-{len(sent) + 1}"
            sent.append((name, args))
            parent_results[task_id] = task.apply(args=args, task_id=task_id)
            return SimpleNamespace(id=task_id)

        def AsyncResult(self, task_id):
            r = parent_results[task_id]
            return SimpleNamespace(state=r.state, result=r.result, info=r.result)

    fake_celery = FakeCelery()
    app.extensions["celery"] = fake_celery
    yield SimpleNamespace(app=app, client=app.test_client(), redis=redis_fake, sse=sse_fake,
                          sent=sent, tasks=celery_tasks, job_state=job_state, celery=fake_celery)
    job_state.set_client(None)
    _close_log_handlers()
