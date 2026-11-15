"""Follow-ups: selected-primer design and TSV export, at their real entry points.

Everything runs the real Flask routes and the real Celery task bodies (inline) with
in-memory redis/SSE.  The selection below is what the browser sends: site keys are
the ones the browser sees in the SSE ``mutationOptions`` event (camelCased), codons
come from that same event, and expectations are checked against the independently
documented synonymous alternatives in expectations.json.
"""
import copy
import csv
import io
import json
import os

import pytest

from conftest import REPO
from test_lifecycle import EXPECTATIONS, payload, submit

FIXTURE_PATH = REPO / "react-frontend" / "src" / "test" / "fixtures" / "followups.json"
ALTERNATIVES = EXPECTATIONS["expected"]["synonymous_alternatives_by_amino_acid"]


def browser_sites(lc, job_id, idx=0):
    """The mutation options exactly as the browser receives them (SSE event on the
    sequence's own channel), keyed by the site key the browser shows."""
    events = [e for ch, e in lc.sse.published
              if ch == f"job_{job_id}_{idx}" and "mutationOptions" in e]
    assert events, "no mutationOptions event on the sequence channel"
    return events[-1]["mutationOptions"]


def codons_of(site_mutations):
    return [m["mutCodons"][0]["codon"]["codonSequence"] for m in site_mutations]


def select(lc, job_id, pick, idx=0):
    """{site_key: codon} choosing option number ``pick`` at every site."""
    return {k: codons_of(v)[pick] for k, v in browser_sites(lc, job_id, idx).items()}


def design(lc, jid, selection, idx=0, **over):
    body = {"job_id": jid, "sequence_idx": idx, "selected_mutations": selection}
    body.update(over)
    return lc.client.post("/api/design_primers", json=body)


def design_ok(lc, job_id, selection, idx=0):
    resp = design(lc, job_id, selection, idx)
    assert resp.status_code == 202, resp.get_json()
    status = lc.client.get(f"/api/task-status/{resp.get_json()['task_id']}").get_json()
    assert status["state"] == "SUCCESS", status
    return resp.get_json(), status


@pytest.fixture
def submitted(lifecycle):
    _, body = submit(lifecycle, payload())
    return lifecycle, body["job_id"]


@pytest.fixture
def two_sequences(lifecycle):
    body = payload()
    body["sequencesToDomesticate"] = [copy.deepcopy(body["sequencesToDomesticate"][0]) for _ in range(2)]
    _, resp = submit(lifecycle, body)
    return lifecycle, resp["job_id"]


# ---- the selection reaches primers, for the FIRST sequence, and its result is consumed -----------
def test_fixture_offers_the_documented_alternatives(submitted):
    lc, job_id = submitted
    sites = browser_sites(lc, job_id)
    offered = {c for v in sites.values() for c in codons_of(v)}
    documented = {c for v in ALTERNATIVES.values() for c in v}
    assert offered and offered <= documented
    assert all("_" not in k for k in sites), "the browser sees camelCased site keys"


@pytest.mark.parametrize("pick", [0, 1, -1])
def test_first_sequence_selection_yields_primers_for_exactly_that_selection(submitted, pick):
    lc, job_id = submitted
    selection = select(lc, job_id, pick)
    accepted, status = design_ok(lc, job_id, selection)  # sequence_idx == 0 is accepted

    assert accepted["sequence_idx"] == 0 and accepted["job_id"] == job_id
    assert status["jobId"] == job_id and status["sequenceIdx"] == 0
    result = status["result"]
    assert result["selectedMutations"] == [
        {"siteKey": k, "codonSequence": v} for k, v in sorted(selection.items())
    ]
    pairs = result["primerSet"]["mutPrimerPairs"]
    assert pairs
    for pair in pairs:
        site_key = pair["site"].replace("_", "")
        assert site_key in selection, pair["site"]
        # the primer's template change is the codon the user picked, not the "best" one
        (mut_codon,) = pair["mutation"]["mutCodons"]
        assert mut_codon["codon"]["codonSequence"] == selection[site_key]
        assert pair["forward"]["sequence"] and pair["reverse"]["sequence"]


def test_different_selections_give_different_primers(submitted):
    lc, job_id = submitted
    a = design_ok(lc, job_id, select(lc, job_id, 0))[1]["result"]["primerSet"]["mutPrimerPairs"]
    b = design_ok(lc, job_id, select(lc, job_id, -1))[1]["result"]["primerSet"]["mutPrimerPairs"]
    assert {p["mutation"]["mutContext"] for p in a}.isdisjoint({p["mutation"]["mutContext"] for p in b})


def test_result_is_published_to_the_sequence_channel_and_recoverable(submitted):
    lc, job_id = submitted
    selection = select(lc, job_id, 1)
    _, status = design_ok(lc, job_id, selection)
    live = [e for ch, e in lc.sse.published
            if ch == f"job_{job_id}_0" and e.get("customPrimers", {}).get("taskId") == status["task_id"]]
    assert len(live) == 1
    assert live[0]["jobId"] == job_id and live[0]["sequenceIdx"] == 0 and live[0]["step"] == "Primer Design"
    assert live[0]["customPrimers"] == status["result"]
    # a browser that missed the live event recovers the identical event from storage
    stored = lc.client.get(f"/api/jobs/{job_id}/events?sequenceIdx=0").get_json()["events"]
    assert [e for e in stored if e.get("customPrimers", {}).get("taskId") == status["task_id"]] == live


def test_second_sequence_result_is_attributed_to_the_second_sequence(two_sequences):
    lc, job_id = two_sequences
    selection = select(lc, job_id, 1, idx=1)
    _, status = design_ok(lc, job_id, selection, idx=1)
    assert status["sequenceIdx"] == 1
    on_1 = [e for ch, e in lc.sse.published if ch == f"job_{job_id}_1" and "customPrimers" in e
            and e["customPrimers"].get("taskId")]
    on_0 = [e for ch, e in lc.sse.published if ch == f"job_{job_id}_0" and "customPrimers" in e
            and e["customPrimers"].get("taskId")]
    assert len(on_1) == 1 and on_1[0]["sequenceIdx"] == 1
    assert on_0 == []


def test_two_submissions_do_not_cross(lifecycle):
    _, a = submit(lifecycle, payload())
    _, b = submit(lifecycle, payload())
    sel_a = select(lifecycle, a["job_id"], 1)
    design_ok(lifecycle, a["job_id"], sel_a)
    assert not [e for ch, e in lifecycle.sse.published
                if ch == f"job_{b['job_id']}_0" and e.get("customPrimers", {}).get("taskId")]


def test_task_result_survives_the_celery_result_serializer(submitted):
    from kombu.serialization import dumps, loads

    lc, job_id = submitted
    _, status = design_ok(lc, job_id, select(lc, job_id, 0))
    ctype, enc, data = dumps({"result": status["result"]}, serializer="json")
    assert loads(data, ctype, enc)["result"] == status["result"]


def test_automatic_best_mutation_primers_are_now_designed(submitted):
    lc, job_id = submitted
    res = lc.client.get(f"/api/jobs/{job_id}").get_json()["sequences"][0]["result"]
    assert not res.get("errors"), res.get("errors")
    custom = res["customPrimers"]
    assert custom["primerSet"]["mutPrimerPairs"] and custom["selectedMutations"]


# ---- the request is validated at the handler; nothing is dispatched for bad input ---------------
@pytest.mark.parametrize("over, status", [
    ({"sequence_idx": -1}, 400),
    ({"sequence_idx": "abc"}, 400),
    ({"sequence_idx": True}, 400),
    ({"sequence_idx": 1.5}, 400),
    ({"sequence_idx": None}, 400),
    ({"sequence_idx": 1}, 400),            # out of range for a one-sequence job
    ({"job_id": ""}, 400),
    ({"job_id": "no-such-job"}, 404),
    ({"selected_mutations": {}}, 400),
    ({"selected_mutations": ["mutation480"]}, 400),
    ({"selected_mutations": {"mutation480": ""}}, 400),
    ({"selected_mutations": {"mutation480": 7}}, 400),
])
def test_invalid_design_requests_are_rejected_and_not_dispatched(submitted, over, status):
    lc, job_id = submitted
    before = len(lc.sent)
    resp = design(lc, job_id, select(lc, job_id, 1), **over)
    assert resp.status_code == status, resp.get_json()
    assert resp.get_json()["error"]
    assert len(lc.sent) == before


def test_missing_body_is_rejected(submitted):
    lc, _ = submitted
    assert lc.client.post("/api/design_primers").status_code == 400
    assert lc.client.post("/api/design_primers", data="not json",
                          content_type="application/json").status_code == 400


def test_string_zero_index_from_browser_storage_is_the_first_sequence(submitted):
    lc, job_id = submitted
    resp = design(lc, job_id, select(lc, job_id, 1), sequence_idx="0")
    assert resp.status_code == 202 and resp.get_json()["sequence_idx"] == 0


def test_broker_failure_is_a_clear_503(submitted):
    lc, job_id = submitted
    lc.celery.fail_dispatch = True
    resp = design(lc, job_id, select(lc, job_id, 1))
    assert resp.status_code == 503 and "try again" in resp.get_json()["error"]


# ---- worker failures are reported (task state + sequence channel), not swallowed ---------------
def failed(lc, job_id, selection, idx=0):
    resp = design(lc, job_id, selection, idx)
    assert resp.status_code == 202
    status = lc.client.get(f"/api/task-status/{resp.get_json()['task_id']}").get_json()
    assert status["state"] == "FAILURE", status
    events = [e["customPrimers"] for ch, e in lc.sse.published
              if ch == f"job_{job_id}_{idx}" and e.get("customPrimers", {}).get("status") == "failure"
              and e["customPrimers"].get("taskId") == status["task_id"]]
    assert len(events) == 1 and events[0]["error"] == status["error"]
    return status["error"]


def test_unknown_site_and_unknown_codon_fail_visibly(submitted):
    lc, job_id = submitted
    site = next(iter(select(lc, job_id, 0)))
    assert "unknown restriction site" in failed(lc, job_id, {"mutation999": "GAA"})
    assert "No mutation found" in failed(lc, job_id, {site: "TTT"})


def test_expired_submission_fails_visibly(submitted):
    lc, job_id = submitted
    selection = select(lc, job_id, 1)
    lc.redis.kv.pop(f"req:{job_id}:0")
    assert "no longer available" in failed(lc, job_id, selection)


# ---- API export: written under the app, served by the API, parsed back -------------------------
@pytest.fixture
def exports(lifecycle, tmp_path, monkeypatch):
    """Export directory isolated from the checkout/user data; cwd is elsewhere too."""
    target = tmp_path / "exports-under-test"
    lifecycle.app.config["EXPORT_DIR"] = str(target)
    other = tmp_path / "elsewhere"
    other.mkdir()
    monkeypatch.chdir(other)
    return lifecycle, target


def parse_tsv(text):
    return list(csv.reader(io.StringIO(text), delimiter="\t"))


def test_export_round_trip_matches_the_selected_result(submitted, tmp_path, monkeypatch):
    lc, job_id = submitted
    target = tmp_path / "exports-under-test"
    lc.app.config["EXPORT_DIR"] = str(target)
    monkeypatch.chdir(tmp_path)
    selection = select(lc, job_id, 1)
    _, status = design_ok(lc, job_id, selection)
    pairs = status["result"]["primerSet"]["mutPrimerPairs"]
    # The design result carries no amplicon length (its "position" is the restriction-site
    # position), so the browser exports an empty Amplicon cell rather than inventing one.
    rows = [[p[d]["name"], p[d]["sequence"], ""]
            for p in pairs for d in ("forward", "reverse")]

    resp = lc.client.post("/api/export", json={"primers": rows})
    assert resp.status_code == 200, resp.get_json()
    url = resp.get_json()["download_url"]
    assert url.startswith("/api/export/") and "//" not in url.replace("://", "")

    files = list(target.iterdir())
    assert len(files) == 1 and files[0].name == url.rsplit("/", 1)[1]

    dl = lc.client.get(url)
    assert dl.status_code == 200
    assert dl.mimetype == "text/tab-separated-values"
    assert "attachment" in dl.headers["Content-Disposition"]
    table = parse_tsv(dl.get_data(as_text=True))
    assert table[0] == ["Primer Name", "Sequence", "Amplicon"]
    assert table[1:] == [[n, s, str(a)] for n, s, a in rows]
    # representative values straight from the selected result
    first = pairs[0]
    assert table[1][:2] == [first["forward"]["name"], first["forward"]["sequence"]]
    assert table[2][:2] == [first["reverse"]["name"], first["reverse"]["sequence"]]
    assert len(table) - 1 == 2 * len(pairs) > 0


def test_export_does_not_depend_on_cwd_or_touch_the_checkout(exports):
    lc, target = exports
    resp = lc.client.post("/api/export", json={"primers": [["p1", "ACGT", 4]]})
    assert resp.status_code == 200
    assert [p.name for p in target.iterdir()] == [resp.get_json()["download_url"].rsplit("/", 1)[1]]
    assert not os.path.exists("static")  # nothing written relative to the cwd
    # (conftest's autouse guard also proves flask_backend/static/exports is untouched)


def test_default_export_location_is_anchored_to_the_app(lifecycle, tmp_path):
    with lifecycle.app.app_context():
        import importlib

        api_module = importlib.import_module("flask_backend.routes.api")

        assert api_module._export_dir() == os.path.join(lifecycle.app.root_path, "static", "exports")


def test_two_exports_in_the_same_second_do_not_collide(exports):
    lc, target = exports
    urls = {lc.client.post("/api/export", json={"primers": [["p", "A", 1]]}).get_json()["download_url"]
            for _ in range(3)}
    assert len(urls) == 3 and len(list(target.iterdir())) == 3


@pytest.mark.parametrize("body, text", [
    (None, "JSON object"),
    ({}, "No primers"),
    ({"primers": []}, "No primers"),
    ({"primers": "ACGT"}, "must be a list"),
    ({"primers": [["only", "two"]]}, "primers[0]"),
    ({"primers": [["n", "ACGT", 1, "extra"]]}, "primers[0]"),
    ({"primers": [{"name": "n"}]}, "primers[0]"),
    ({"primers": [["ok", "ACGT", 4], ["bad\tname", "ACGT", 4]]}, "primers[1]"),
    ({"primers": [["n", "AC\nGT", 4]]}, "line breaks"),
    ({"primers": [["n", None, 4]]}, "text or a number"),
    ({"primers": [["n", True, 4]]}, "text or a number"),
])
def test_invalid_export_requests_are_rejected_and_write_nothing(exports, body, text):
    lc, target = exports
    kwargs = {"json": body} if body is not None else {"data": "nope", "content_type": "application/json"}
    resp = lc.client.post("/api/export", **kwargs)
    assert resp.status_code == 400 and text in resp.get_json()["error"]
    assert not target.exists() or list(target.iterdir()) == []


@pytest.mark.parametrize("name", ["../../etc/passwd", "primers_1_deadbeef.tsv", "x.tsv", "..%2Fsecret",
                                  "primers_1_ABCDEFGH.tsv"])
def test_export_download_only_serves_files_it_created(exports, name):
    lc, _ = exports
    assert lc.client.get(f"/api/export/{name}").status_code == 404


# ---- the frontend fixture is what the backend really produces -----------------------------------
def build_fixture(lc):
    _, body = submit(lc, payload())
    job_id = body["job_id"]
    selection = select(lc, job_id, 1)
    _, status = design_ok(lc, job_id, selection)
    return {
        "jobId": job_id,
        "mutationEvent": [e for ch, e in lc.sse.published
                          if ch == f"job_{job_id}_0" and "mutationOptions" in e][-1],
        "selection": selection,
        "designResult": status["result"],
    }


def _canon(fx):
    """Drop what legitimately differs per run (ids, timestamps, pair order)."""
    fx = json.loads(json.dumps(fx))
    jid = fx.pop("jobId")
    text = json.dumps(fx, sort_keys=True).replace(jid, "JOB")
    fx = json.loads(text)
    fx["designResult"]["taskId"] = "TASK"
    fx["designResult"]["primerSet"]["mutPrimerPairs"].sort(key=lambda p: json.dumps(p, sort_keys=True))
    fx["mutationEvent"].pop("timestamp", None)
    return fx


def test_frontend_fixture_matches_the_live_backend(lifecycle):
    committed = json.loads(FIXTURE_PATH.read_text())
    assert _canon(committed) == _canon(build_fixture(lifecycle)), (
        "fixture drifted: regenerate with tests/readiness/gen_followups_fixture.py")
