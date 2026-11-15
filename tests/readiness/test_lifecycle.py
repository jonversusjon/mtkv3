"""Submission lifecycle: browser job identity -> per-sequence terminal result.

These run the real Flask routes and the real Celery task bodies (inline), with
in-memory redis/SSE.  Failure injection is done here, in isolated tests, by
monkeypatching a collaborator -- the application exposes no failure endpoint.
"""
import copy
import json
import pathlib
import re
import time

import pytest

from conftest import REPO
from flask_backend.dev.prefill_data.dev_defaults import dev_config_2
from flask_backend.dev.tests import test_data

EXPECTATIONS = json.loads((REPO / "tests" / "readiness" / "expectations.json").read_text())
FX = EXPECTATIONS["fixture"]


def payload(**over):
    """Form payload exactly as the browser sends it, built from the named fixture."""
    seq = dict(dev_config_2["sequencesToDomesticate"][FX["dev_config_2_index"]])
    body = {
        "templateSequence": test_data.TEST_TEMPLATE_SEQ,
        "species": FX["settings"]["species"],
        "kozak": FX["settings"]["kozak"],
        "maxMutPerSite": FX["settings"]["maxMutPerSite"],
        "verboseMode": False,
        "sequencesToDomesticate": [seq],
    }
    body.update(over)
    return body


def submit(lc, body):
    resp = lc.client.post("/api/generate_protocol", json=body)
    return resp, resp.get_json()


def job(lc, job_id):
    return lc.client.get(f"/api/jobs/{job_id}").get_json()


# ---- named fixture: independently justified expectations -------------------------
def test_fixture_is_the_named_existing_fixture():
    seq = dev_config_2["sequencesToDomesticate"][FX["dev_config_2_index"]]
    assert seq["primerName"] == FX["primerName"]
    assert seq["mtkPartLeft"] == FX["mtkPartLeft"] and seq["mtkPartRight"] == FX["mtkPartRight"]
    assert seq["sequence"] == getattr(test_data, FX["sequence_constant"])
    assert len(seq["sequence"]) == FX["sequence_length"]


def test_expectations_match_independent_literal_scan():
    """The documented expected sites are re-derived here straight from the literal
    sequence with the published recognition sequences (not from the app)."""
    seq = getattr(test_data, FX["sequence_constant"]).upper()
    found = []
    for enzyme, site in (("BsmBI", "CGTCTC"), ("BsaI", "GGTCTC")):
        rc = site[::-1].translate(str.maketrans("ACGT", "TGCA"))
        for strand, pat in (("+", site), ("-", rc)):
            found += [dict(enzyme=enzyme, strand=strand, recognition_seq=pat,
                           position=m.start(), frame=m.start() % 3)
                      for m in re.finditer(f"(?={pat})", seq)]
    assert sorted(found, key=lambda s: s["position"]) == EXPECTATIONS["expected"]["restriction_sites"]


# ---- validation: visible, understandable, and nothing dispatched -----------------
@pytest.mark.parametrize("mutate, field, text", [
    (lambda b: b.update(species=""), "species", "Species is required"),
    (lambda b: b.update(species="klingon"), "species", "Unknown species"),
    (lambda b: b.update(sequencesToDomesticate=[]), "sequencesToDomesticate", "At least one sequence"),
    (lambda b: b["sequencesToDomesticate"][0].update(sequence="ATG!!X"), "sequence", "DNA bases"),
    (lambda b: b["sequencesToDomesticate"][0].update(sequence=""), "sequence", "cannot be empty"),
    (lambda b: b["sequencesToDomesticate"][0].update(mtkPartLeft=""), "mtkPartLeft", "required"),
    (lambda b: b["sequencesToDomesticate"][0].update(mtkPartRight="99"), "mtkPartRight", "Unknown MTK part"),
])
def test_invalid_input_is_rejected_with_field_message_and_nothing_dispatched(lifecycle, mutate, field, text):
    body = copy.deepcopy(payload())
    mutate(body)
    resp, data = submit(lifecycle, body)
    assert resp.status_code == 400
    assert any(field in p["field"] and text in p["message"] for p in data["errors"]), data
    assert text in data["error"]
    assert lifecycle.sent == [] and lifecycle.redis.kv == {}


def test_non_json_body_is_a_400_not_a_500(lifecycle):
    resp = lifecycle.client.post("/api/generate_protocol", data="nope", content_type="text/plain")
    assert resp.status_code == 400


# ---- success: terminal result is the sequence work, not the parent dispatch ------
def test_success_is_recorded_per_sequence_and_matches_expectations(lifecycle):
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 202
    job_id = data["job_id"]
    status = job(lifecycle, job_id)
    assert status["jobId"] == job_id and status["taskId"] == data["task_id"]
    assert status["state"] == "success"
    (seq,) = status["sequences"]
    assert seq["state"] == "success"

    exp = EXPECTATIONS["expected"]
    res = seq["result"]
    assert res["processedSequence"] == getattr(test_data, FX["sequence_constant"]).upper()
    sites = [{k: s[k] for k in ("enzyme", "strand", "position", "frame")} | {"recognition_seq": s["recognitionSeq"]}
             for s in res["restrictionSites"]]
    assert sites == exp["restriction_sites"]
    got = {}
    for m in res["mutationOptions"]:
        got.setdefault(m["codon"]["aminoAcid"], set()).add(m["codon"]["codonSequence"])
    assert {k: sorted(v) for k, v in got.items()} == exp["synonymous_alternatives_by_amino_acid"]


def test_real_worker_return_is_serializable_by_the_celery_result_serializer(lifecycle, monkeypatch):
    """The fake Redis tolerates default=str; the real Celery JSON result serializer does not
    get that leniency, so the real worker return must serialize on its own."""
    from kombu.serialization import dumps, loads

    outputs = []
    real = lifecycle.tasks._run_sequence

    def spy(req_dict, index):
        out = real(req_dict, index)
        outputs.append(out)
        return out

    monkeypatch.setattr(lifecycle.tasks, "_run_sequence", spy)
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 202
    assert job(lifecycle, data["job_id"])["state"] == "success"
    (out,) = outputs
    json.dumps(out, allow_nan=False)  # strict: no default=str, no NaN/Infinity
    content_type, encoding, wire = dumps(out, serializer="json")  # what Celery would store
    assert loads(wire, content_type, encoding, accept=["application/json"]) == json.loads(json.dumps(out))


def test_parent_success_only_means_dispatched_not_finished(lifecycle, monkeypatch):
    """The parent task reports SUCCESS ('started') even when the sequence work failed."""

    class Boom:
        def __init__(self, *a, **k):
            raise ValueError("synthetic worker failure")

    monkeypatch.setattr(lifecycle.tasks, "ProtocolMaker", Boom)
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 202
    parent = lifecycle.app.extensions["celery"].AsyncResult(data["task_id"])
    assert parent.state == "SUCCESS" and parent.result["status"] == "started"
    status = job(lifecycle, data["job_id"])
    assert status["state"] == "failure"
    assert status["sequences"][0]["state"] == "failure"


def test_controlled_worker_failure_has_understandable_message_and_terminal_sse(lifecycle, monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise ValueError("codon table is unusable")

    monkeypatch.setattr(lifecycle.tasks, "ProtocolMaker", Boom)
    _, data = submit(lifecycle, payload())
    seq = job(lifecycle, data["job_id"])["sequences"][0]
    assert seq["state"] == "failure"
    assert seq["error"] == "Sequence 1 could not be processed: codon table is unusable"
    assert "Traceback" not in seq["error"]
    terminal = [p for _, p in lifecycle.sse.published if p.get("terminal")]
    assert terminal and terminal[-1]["status"] == "failure" and terminal[-1]["jobId"] == data["job_id"]


def test_unexpected_exception_does_not_leak_internals(lifecycle, monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise KeyError("/secret/path/or/internal")

    monkeypatch.setattr(lifecycle.tasks, "ProtocolMaker", Boom)
    _, data = submit(lifecycle, payload())
    err = job(lifecycle, data["job_id"])["sequences"][0]["error"]
    assert "unexpected internal error (KeyError)" in err and "secret" not in err


def test_sequence_rejected_in_preprocessing_is_a_failure_not_an_empty_success(lifecycle, monkeypatch):
    real = lifecycle.tasks.ProtocolMaker.create_gg_protocol

    def rejected(self, send_update):
        send_update(step="Preprocessing", message="rejected", prog=0)
        from flask_backend.models import DomesticationResult
        return DomesticationResult(sequence_index=self.request_idx).__dict__

    monkeypatch.setattr(lifecycle.tasks.ProtocolMaker, "create_gg_protocol", rejected)
    _, data = submit(lifecycle, payload())
    status = job(lifecycle, data["job_id"])
    assert status["state"] == "failure"
    assert "rejected during preprocessing" in status["sequences"][0]["error"]


def test_dispatch_failure_marks_job_failed(lifecycle, monkeypatch):
    """Parent task crashes before any child starts -> job is failed, not pending forever."""
    monkeypatch.setattr(lifecycle.tasks, "group", lambda sigs: (_ for _ in ()).throw(RuntimeError("broker gone")))
    _, data = submit(lifecycle, payload())
    status = job(lifecycle, data["job_id"])
    assert status["state"] == "failure"
    assert status["sequences"][0]["errorCode"] == "dispatch_error"


def test_broker_unreachable_at_submit_is_a_503_with_a_failed_job(lifecycle):
    class Down:
        def send_task(self, *a, **k):
            raise ConnectionError("no broker")

    lifecycle.app.extensions["celery"] = Down()
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 503 and "try again" in data["error"]
    assert job(lifecycle, data["job_id"])["state"] == "failure"


# ---- pending / unknown / recovery ------------------------------------------------
def test_pending_until_the_sequence_work_reports(lifecycle):
    js = lifecycle.job_state
    js.create_job("j-pending", 2)
    js.mark_success("j-pending", 0, {"ok": True})
    status = job(lifecycle, "j-pending")
    assert status["state"] == "pending"
    assert [s["state"] for s in status["sequences"]] == ["success", "pending"]
    js.mark_failure("j-pending", 1, "x")
    assert job(lifecycle, "j-pending")["state"] == "failure"


def test_old_pending_job_stays_pending_then_becomes_successful(lifecycle):
    js = lifecycle.job_state
    js.create_job("j-old", 1)
    js._put(js._job_key("j-old"), {"jobId": "j-old", "total": 1, "createdAt": time.time() - 30 * 24 * 3600})
    status = job(lifecycle, "j-old")
    assert status["state"] == "pending" and status["sequences"][0]["state"] == "pending"
    assert "stalled" not in json.dumps(status)
    js.mark_success("j-old", 0, {"ok": True})
    status = job(lifecycle, "j-old")
    assert status["state"] == "success" and status["sequences"][0]["result"] == {"ok": True}


def test_unknown_job_is_404(lifecycle):
    assert lifecycle.client.get("/api/jobs/does-not-exist").status_code == 404
    assert lifecycle.client.get("/api/jobs/does-not-exist/events?sequenceIdx=0").status_code == 404


def test_progress_events_are_recoverable_after_sse_is_missed(lifecycle):
    _, data = submit(lifecycle, payload())
    live = [p for _, p in lifecycle.sse.published]            # what a connected browser would have seen
    lifecycle.sse.published.clear()                            # ... a late/reconnecting browser sees none
    replay = lifecycle.client.get(f"/api/jobs/{data['job_id']}/events?sequenceIdx=0").get_json()["events"]
    assert replay and len(replay) == len(live)
    assert {e["jobId"] for e in replay} == {data["job_id"]}
    assert replay[-1]["terminal"] and replay[-1]["status"] == "success"
    steps = [e["step"] for e in replay]
    assert {"Preprocessing", "Restriction Sites", "Mutation Analysis", "Primer Design"} <= set(steps)
    assert lifecycle.client.get(f"/api/jobs/{data['job_id']}/events?sequenceIdx=x").status_code == 400


# ---- two distinct submissions cannot satisfy each other --------------------------
def test_two_submissions_have_distinct_identities_and_independent_outcomes(lifecycle, monkeypatch):
    real = lifecycle.tasks.ProtocolMaker

    class FailsOnlyForB:
        def __new__(cls, *a, **k):
            if k["sequence_to_domesticate"].primer_name == "submission-B":
                raise ValueError("B is broken")
            return real(*a, **k)

    monkeypatch.setattr(lifecycle.tasks, "ProtocolMaker", FailsOnlyForB)
    _, a = submit(lifecycle, payload())
    b_body = payload()
    b_body["sequencesToDomesticate"][0]["primerName"] = "submission-B"
    # a client trying to reuse A's id must not be able to alias onto A's results
    b_body["jobId"] = a["job_id"]
    _, b = submit(lifecycle, b_body)

    assert a["job_id"] != b["job_id"] and a["task_id"] != b["task_id"]
    sa, sb = job(lifecycle, a["job_id"]), job(lifecycle, b["job_id"])
    assert sa["state"] == "success" and sb["state"] == "failure"
    assert sa["sequences"][0]["result"]["processedSequence"]
    assert "result" not in sb["sequences"][0]
    # events are keyed by job: B's replay never contains A's events, and vice versa
    ea = lifecycle.client.get(f"/api/jobs/{a['job_id']}/events?sequenceIdx=0").get_json()["events"]
    eb = lifecycle.client.get(f"/api/jobs/{b['job_id']}/events?sequenceIdx=0").get_json()["events"]
    assert {e["jobId"] for e in ea} == {a["job_id"]} and {e["jobId"] for e in eb} == {b["job_id"]}


def test_no_public_failure_injection_surface(lifecycle):
    rules = {r.rule for r in lifecycle.app.url_map.iter_rules()}
    assert not [r for r in rules if re.search(r"fail|inject|chaos|crash|debug|reset|cleanup|flush", r, re.I)], rules


def test_optional_custom_primer_step_failure_keeps_finished_work_and_is_reported(lifecycle, monkeypatch):
    """The core protocol finished; a problem in the optional automatic custom-primer
    step must neither discard it nor be silent."""
    def boom(self, selected):
        raise RuntimeError("primer3 exploded")

    monkeypatch.setattr("flask_backend.services.primer_designer.PrimerDesigner.design_custom_primers", boom)
    _, data = submit(lifecycle, payload())
    status = job(lifecycle, data["job_id"])
    assert status["state"] == "success"
    res = status["sequences"][0]["result"]
    assert res["restrictionSites"] and "RuntimeError" in res["errors"]["customPrimers"]
    assert "primer3 exploded" not in json.dumps(res["errors"])


# ---- F1: terminal persistence is part of the controlled worker flow ----------------
def _flaky_mark_success(monkeypatch, lifecycle, fail_times):
    from flask_backend import job_state as js

    real = js.mark_success
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise ConnectionError("redis down")
        return real(*a, **k)

    monkeypatch.setattr(js, "mark_success", flaky)
    monkeypatch.setattr(lifecycle.tasks, "TERMINAL_WRITE_BACKOFF", (0, 0, 0))
    return calls


def test_transient_terminal_write_failure_is_retried_and_success_recovered(lifecycle, monkeypatch):
    calls = _flaky_mark_success(monkeypatch, lifecycle, fail_times=2)
    _, data = submit(lifecycle, payload())
    seq = job(lifecycle, data["job_id"])["sequences"][0]
    assert seq["state"] == "success" and seq["result"]
    assert calls["n"] == 3


def test_persistent_terminal_write_failure_is_explicit_failure_consistent_with_celery(lifecycle, monkeypatch):
    _flaky_mark_success(monkeypatch, lifecycle, fail_times=10**6)
    _, data = submit(lifecycle, payload())
    status = job(lifecycle, data["job_id"])
    seq = status["sequences"][0]
    assert status["state"] == "failure" and seq["state"] == "failure"
    assert seq["errorCode"] == "storage_error" and "result could not be stored" in seq["error"]
    terminal = [p for _, p in lifecycle.sse.published if p.get("terminal")]
    assert terminal[-1]["status"] == "failure"


def _direct_child(lifecycle):
    """Create a job, then run the real child task directly so its Celery outcome is visible."""
    from flask_backend.models import ProtocolRequest  # noqa: F401  (validates the payload shape)

    js = lifecycle.job_state
    js.create_job("j-direct", 1)
    body = {**payload(), "jobId": "j-direct"}
    return lifecycle.tasks.process_protocol_sequence.apply(args=(body, 0))


def test_persistent_failure_celery_outcome_matches_job_record(lifecycle, monkeypatch):
    _flaky_mark_success(monkeypatch, lifecycle, fail_times=10**6)
    res = _direct_child(lifecycle)
    assert res.state == "FAILURE"
    assert job(lifecycle, "j-direct")["sequences"][0]["state"] == "failure"


def test_failure_write_also_failing_leaves_bounded_honest_state(lifecycle, monkeypatch):
    js = lifecycle.job_state
    _flaky_mark_success(monkeypatch, lifecycle, fail_times=10**6)

    def down(*a, **k):
        raise ConnectionError("down")

    monkeypatch.setattr(js, "mark_failure", down)
    res = _direct_child(lifecycle)
    assert res.state == "FAILURE"  # never a Celery success without a retrievable result
    assert job(lifecycle, "j-direct")["state"] == "pending"
    # Storage loss cannot justify inventing a worker failure from elapsed time.
    js._put(js._job_key("j-direct"), {"jobId": "j-direct", "total": 1, "createdAt": 0})
    old = job(lifecycle, "j-direct")
    assert old["state"] == "pending" and old["sequences"][0]["state"] == "pending"


# ---- round 2: post-dispatch metadata + worker-error persistence ------------------
def _fast_metadata_backoff(monkeypatch):
    import importlib

    api_routes = importlib.import_module("flask_backend.routes.api")  # the module, not the Blueprint
    monkeypatch.setattr(api_routes, "METADATA_WRITE_BACKOFF", (0, 0, 0))


def test_transient_task_id_write_failure_after_dispatch_still_returns_job_identity(lifecycle, monkeypatch):
    _fast_metadata_backoff(monkeypatch)
    js = lifecycle.job_state
    real, calls = js.set_task_id, {"n": 0}

    def flaky(*a):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("metadata temporarily unavailable")
        return real(*a)

    monkeypatch.setattr(js, "set_task_id", flaky)
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 202 and data["job_id"] and data["task_id"] == "parent-1"
    assert len(lifecycle.sent) == 1 and calls["n"] == 2 and "warning" not in data
    assert job(lifecycle, data["job_id"])["taskId"] == "parent-1"


def test_persistent_task_id_write_failure_after_dispatch_degrades_honestly(lifecycle, monkeypatch):
    _fast_metadata_backoff(monkeypatch)

    def down(*a):
        raise ConnectionError("down")

    monkeypatch.setattr(lifecycle.job_state, "set_task_id", down)
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 202 and data["job_id"] and data["task_id"] == "parent-1"
    assert "could not be recorded" in data["warning"]
    assert job(lifecycle, data["job_id"])["sequences"]  # work remains reachable by job_id


def test_dispatch_error_metadata_failure_does_not_mask_the_503(lifecycle, monkeypatch):
    _fast_metadata_backoff(monkeypatch)

    class Down:
        def send_task(self, *a, **k):
            raise ConnectionError("no broker")

    def down(*a, **k):
        raise ConnectionError("redis down")

    lifecycle.app.extensions["celery"] = Down()
    monkeypatch.setattr(lifecycle.job_state, "mark_all_failed", down)
    resp, data = submit(lifecycle, payload())
    assert resp.status_code == 503 and data["job_id"] and "try again" in data["error"]


def _controlled_failure(lifecycle, monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise ValueError("codon table is unusable")

    monkeypatch.setattr(lifecycle.tasks, "ProtocolMaker", Boom)
    monkeypatch.setattr(lifecycle.tasks, "TERMINAL_WRITE_BACKOFF", (0, 0, 0))


def test_worker_error_failure_write_is_retried_and_recovers(lifecycle, monkeypatch):
    _controlled_failure(lifecycle, monkeypatch)
    js = lifecycle.job_state
    real, calls = js.mark_failure, {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("redis blip")
        return real(*a, **k)

    monkeypatch.setattr(js, "mark_failure", flaky)
    res = _direct_child(lifecycle)
    assert res.state == "FAILURE" and isinstance(res.result, ValueError)
    seq = job(lifecycle, "j-direct")["sequences"][0]
    assert seq["state"] == "failure" and "codon table is unusable" in seq["error"]
    assert calls["n"] == 2


def test_worker_error_permanent_storage_failure_keeps_original_error_and_publishes_terminal(lifecycle, monkeypatch):
    _controlled_failure(lifecycle, monkeypatch)
    calls = {"n": 0}

    def down(*a, **k):
        calls["n"] += 1
        raise ConnectionError("redis down")

    monkeypatch.setattr(lifecycle.job_state, "mark_failure", down)
    res = _direct_child(lifecycle)
    assert res.state == "FAILURE"
    assert isinstance(res.result, ValueError) and "codon table" in str(res.result)  # not the ConnectionError
    assert calls["n"] == 4  # 1 try + 3 bounded retries
    terminal = [p for _, p in lifecycle.sse.published if p.get("terminal")]
    assert terminal and terminal[-1]["status"] == "failure" and "codon table" in terminal[-1]["message"]
    assert job(lifecycle, "j-direct")["state"] == "pending"  # bounded: stale-pending reports it later


def test_parent_dispatch_error_retries_storage_and_publishes_terminal(lifecycle, monkeypatch):
    monkeypatch.setattr(lifecycle.tasks, "group", lambda sigs: (_ for _ in ()).throw(RuntimeError("broker gone")))
    monkeypatch.setattr(lifecycle.tasks, "TERMINAL_WRITE_BACKOFF", (0, 0, 0))
    js = lifecycle.job_state
    real, calls = js.mark_all_failed, {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("blip")
        return real(*a, **k)

    monkeypatch.setattr(js, "mark_all_failed", flaky)
    _, data = submit(lifecycle, payload())
    assert job(lifecycle, data["job_id"])["sequences"][0]["errorCode"] == "dispatch_error"
    terminal = [p for _, p in lifecycle.sse.published if p.get("terminal")]
    assert terminal and terminal[-1]["status"] == "failure"


def test_parent_dispatch_error_permanent_storage_failure_keeps_original_error(lifecycle, monkeypatch):
    monkeypatch.setattr(lifecycle.tasks, "group", lambda sigs: (_ for _ in ()).throw(RuntimeError("broker gone")))
    monkeypatch.setattr(lifecycle.tasks, "TERMINAL_WRITE_BACKOFF", (0, 0, 0))

    def down(*a, **k):
        raise ConnectionError("down")

    monkeypatch.setattr(lifecycle.job_state, "mark_all_failed", down)
    _, data = submit(lifecycle, payload())
    parent = lifecycle.app.extensions["celery"].AsyncResult(data["task_id"])
    assert parent.state == "FAILURE" and isinstance(parent.result, RuntimeError)
    terminal = [p for _, p in lifecycle.sse.published if p.get("terminal")]
    assert terminal and terminal[-1]["status"] == "failure"
