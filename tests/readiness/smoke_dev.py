"""Smoke check for the separate development entry point.

Starts the Flask dev server (explicit --app factory, dev config) and the Vite
dev server (HMR, proxy to Flask) on free ports, then verifies:
  * Flask /api/species answers JSON,
  * Vite serves index.html and /src/main.jsx as JavaScript (not HTML),
  * Vite's /api proxy reaches Flask and returns the same species list.
Exits non-zero (never skips) on any failure.
"""
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import time

import requests

REPO = pathlib.Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url, proc, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        if proc.poll() is not None:
            raise SystemExit(f"process for {url} exited early with {proc.returncode}")
        try:
            if requests.get(url, timeout=2).status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise SystemExit(f"timed out waiting for {url}")


def main():
    fport, vport = free_port(), free_port()
    flask_url, vite_url = f"http://127.0.0.1:{fport}", f"http://127.0.0.1:{vport}"
    env = {**os.environ, "PYTHONPATH": str(REPO), "FLASK_ENV": "development"}
    env.pop("FLASK_APP", None)
    procs = []
    with tempfile.TemporaryDirectory() as logdir:
        env["MTKV3_LOG_DIR"] = f"{logdir}/app-logs"  # keep the caller's logs untouched
        try:
            flask = subprocess.Popen(
                [sys.executable, "-m", "flask", "--app", "flask_backend.app:create_app",
                 "run", "--debug", "--no-reload", "--host", "127.0.0.1", "--port", str(fport)],
                cwd=REPO, env=env, stdout=open(f"{logdir}/flask.log", "w"), stderr=subprocess.STDOUT)
            procs.append(flask)
            vite = subprocess.Popen(
                ["npm", "run", "dev", "--", "--port", str(vport), "--strictPort"],
                cwd=REPO / "react-frontend",
                env={**os.environ, "VITE_PROXY_TARGET": flask_url},
                stdout=open(f"{logdir}/vite.log", "w"), stderr=subprocess.STDOUT,
                start_new_session=True)
            procs.append(vite)
            wait_for(f"{flask_url}/api/species", flask)
            wait_for(vite_url + "/", vite)

            r = requests.get(f"{flask_url}/api/species", timeout=10)
            assert r.status_code == 200 and "json" in r.headers["content-type"], r.text[:200]
            species = r.json()["species"]
            assert species, "backend reports no species"

            r = requests.get(vite_url + "/", timeout=10)
            assert r.status_code == 200 and "/src/main.jsx" in r.text, "vite index.html"

            r = requests.get(vite_url + "/src/main.jsx", timeout=30)
            ctype = r.headers.get("content-type", "")
            assert r.status_code == 200 and "javascript" in ctype, f"main.jsx: {r.status_code} {ctype}"
            assert not r.text.lstrip().lower().startswith("<!doctype"), "main.jsx returned HTML"

            r = requests.get(vite_url + "/api/species", timeout=10)
            assert r.status_code == 200 and r.json()["species"] == species, "vite proxy to flask"
            print("DEV SMOKE OK: flask", flask_url, "vite", vite_url, "species", species)
        except (AssertionError, SystemExit) as e:
            for name in ("flask", "vite"):
                p = pathlib.Path(logdir) / f"{name}.log"
                print(f"--- {name}.log ---\n{p.read_text()[-2000:]}", file=sys.stderr)
            print(f"DEV SMOKE FAILED: {e}", file=sys.stderr)
            sys.exit(1)
        finally:
            for p in procs:
                try:
                    os.killpg(p.pid, signal.SIGTERM) if p.args[0] == "npm" else p.terminate()
                except ProcessLookupError:
                    pass
            for p in procs:
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()


if __name__ == "__main__":
    main()
