from flask import (
    Blueprint,
    request,
    jsonify,
    current_app,
    Response,
    stream_with_context,
)
from functools import wraps
import os
import re
import time
import uuid
import json

from flask_backend import job_state
from flask_backend.services import GoldenGateUtils

api = Blueprint("api", __name__, url_prefix="/api")
utils = GoldenGateUtils()


def handle_errors(f):
    """Decorator to handle exceptions in API routes with standardized error responses."""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            # logger.error(e, exc_info=True)
            return jsonify({"error": str(e)}), 500

    return decorated_function


def get_celery_instance():
    """Get the Celery instance from the current Flask application."""
    return current_app.extensions["celery"]


_DNA_CHARS = set("ATGCWSMKRYBDHVN")


def validate_protocol_payload(data):
    """Return a list of ``{"field", "message"}`` problems with a submission.

    Mirrors what the form enforces so a request that bypasses (or outruns) the
    browser validation is rejected up front with an understandable message
    instead of failing later inside a worker.
    """
    problems = []

    def bad(field, message):
        problems.append({"field": field, "message": message})

    if not isinstance(data, dict):
        return [{"field": "", "message": "Request body must be a JSON object."}]

    species = data.get("species")
    if not isinstance(species, str) or not species.strip():
        bad("species", "Species is required.")
    elif utils.get_codon_usage_dict(species.strip()) is None:
        bad("species", f"Unknown species '{species}'.")

    seqs = data.get("sequencesToDomesticate", data.get("sequences_to_domesticate"))
    if not isinstance(seqs, list) or not seqs:
        bad("sequencesToDomesticate", "At least one sequence is required.")
        return problems

    part_ends = utils.get_mtk_partend_sequences() or {}
    for i, seq in enumerate(seqs):
        prefix = f"sequencesToDomesticate[{i}]"
        if not isinstance(seq, dict):
            bad(prefix, "Each sequence entry must be an object.")
            continue
        text = seq.get("sequence")
        if not isinstance(text, str) or not text.strip():
            bad(f"{prefix}.sequence", "Sequence cannot be empty.")
        elif not set(text.strip().upper()) <= _DNA_CHARS:
            bad(
                f"{prefix}.sequence",
                "Only DNA bases (A, T, G, C) or extended DNA codes "
                "(W, S, M, K, R, Y, B, D, H, V, N) are allowed.",
            )
        for side, key in (("left", "mtkPartLeft"), ("right", "mtkPartRight")):
            part = seq.get(key, seq.get(_snake(key)))
            if part is None or str(part).strip() == "":
                bad(f"{prefix}.{key}", f"MTK part {side} is required.")
            elif f"{str(part).strip()}forward" not in part_ends:
                bad(f"{prefix}.{key}", f"Unknown MTK part '{part}'.")
    return problems


def _snake(name):
    return "".join("_" + c.lower() if c.isupper() else c for c in name)


# Bounded retry (seconds before each retry) for post-dispatch job metadata writes.
METADATA_WRITE_BACKOFF = (0.05, 0.1, 0.2)


@api.route("/generate_protocol", methods=["POST"])
@handle_errors
def generate_protocol():
    """Validate a submission, register a job, and start asynchronous processing.

    The response carries the server-issued ``job_id`` (the identity every later
    status/SSE/result lookup uses) and the parent ``task_id``.  The parent task
    finishing only means the sequence tasks were dispatched; use
    ``GET /api/jobs/<job_id>`` for the real, per-sequence outcome.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    problems = validate_protocol_payload(data)
    if problems:
        return (
            jsonify(
                {
                    "error": "Invalid input: " + "; ".join(p["message"] for p in problems),
                    "errors": problems,
                }
            ),
            400,
        )

    # The server owns job identity; a client-supplied id could collide with (or
    # deliberately reuse) another submission's results.
    job_id = job_state.new_job_id()
    data = {k: v for k, v in data.items() if k not in ("job_id", "jobId")}
    data["jobId"] = job_id
    total = len(data.get("sequencesToDomesticate", data.get("sequences_to_domesticate")))
    job_state.create_job(job_id, total)

    celery = get_celery_instance()
    try:
        task = celery.send_task(
            "flask_backend.celery_tasks.generate_protocol_task", args=[data]
        )
    except Exception as e:  # broker unreachable etc.
        try:
            job_state.write_with_retry(
                job_state.mark_all_failed, job_id, f"Could not start processing: {e}", "dispatch_error",
                backoff=METADATA_WRITE_BACKOFF,
            )
        except Exception as store_err:  # keep the honest 503 + job_id; stale-pending reporting covers the record
            print(f"Could not record dispatch failure for {job_id}: {store_err}")
        return jsonify({"error": "Could not start processing; please try again.", "job_id": job_id}), 503
    # Work is already dispatched: recording the task id is optional metadata.  Retry
    # briefly, but never turn an accepted submission into an error without its job_id.
    response = {
        "job_id": job_id,
        "jobId": job_id,
        "task_id": task.id,
        "total": total,
        "message": "Protocol generation started - primers will be automatically designed",
    }
    try:
        job_state.write_with_retry(
            job_state.set_task_id, job_id, task.id, backoff=METADATA_WRITE_BACKOFF
        )
    except Exception as store_err:
        print(f"Could not record task id for {job_id}: {store_err}")
        response["warning"] = "Submission accepted; task metadata could not be recorded."

    return jsonify(response), 202


@api.route("/jobs/<job_id>", methods=["GET"])
@handle_errors
def get_job(job_id):
    """Authoritative per-sequence outcome for one submission (pending/success/failure)."""
    job = job_state.get_job(job_id)
    if job is None:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify(job)


@api.route("/jobs/<job_id>/events", methods=["GET"])
@handle_errors
def get_job_events(job_id):
    """Replay the stored progress events of one sequence (for clients that missed SSE)."""
    if job_state.get_job(job_id) is None:
        return jsonify({"error": "Unknown job"}), 404
    try:
        idx = int(request.args.get("sequenceIdx", ""))
    except ValueError:
        return jsonify({"error": "sequenceIdx must be an integer"}), 400
    return jsonify({"jobId": job_id, "sequenceIdx": idx, "events": job_state.get_events(job_id, idx)})


@api.route("/status/<job_id>")
def sse_status(job_id):
    print(f"SSE route hit for job_id={job_id}")

    def event_stream():
        while True:
            async_result = get_celery_instance().AsyncResult(job_id)
            state = async_result.state
            print(f"Current state: {state}")
            meta = async_result.info or {}

            # Ensure meta is a dictionary before processing.
            if not isinstance(meta, dict):
                # msg = "Value of KeyError:", meta.args[0]

                # logger.log_step("SSE", msg)
                # Convert non-dict meta to a dict; for example, store its string representation.
                meta = {"error": str(meta)}

            # print("Meta keys:", list(meta.keys()))

            try:
                data = json.dumps(meta)
            except TypeError as e:
                # In case any value is still not serializable, convert it.
                meta = {
                    str(k): (
                        v
                        if isinstance(v, (int, float, str, bool, list, dict))
                        else str(v)
                    )
                    for k, v in meta.items()
                }
                meta["error"] = str(e)
                data = json.dumps(meta)

            yield f"data: {data}\n\n"
            if state in ["SUCCESS", "FAILURE"]:
                break
            time.sleep(2)

    return Response(stream_with_context(event_stream()), mimetype="text/event-stream")


@api.route("/task-status/<task_id>", methods=["GET"])
@handle_errors
def get_task_status(task_id):
    """Get the state of one Celery task by its ID.

    NOTE: for the ``task_id`` returned by /generate_protocol this is the *parent*
    dispatch task: SUCCESS means "sequence tasks were started", not "sequence work
    finished".  Use /api/jobs/<job_id> for the outcome of the sequence work.
    """
    celery = get_celery_instance()
    async_result = celery.AsyncResult(task_id)
    response = {"task_id": task_id, "state": async_result.state}

    if async_result.state == "PROGRESS":
        response.update(async_result.info)
    elif async_result.state == "SUCCESS":
        res = async_result.result
        response["result"] = res.get("result") if isinstance(res, dict) else res
        if isinstance(res, dict) and "sequenceIdx" in res:
            response["jobId"] = res.get("jobId")
            response["sequenceIdx"] = res["sequenceIdx"]
    elif async_result.state == "FAILURE":
        response["error"] = str(async_result.result)

    return jsonify(response)


def _export_dir():
    """Where TSV exports are written: ``EXPORT_DIR`` if configured, else the app's
    own static/exports (anchored to the app, never to the process cwd)."""
    configured = current_app.config.get("EXPORT_DIR")
    return configured or os.path.join(current_app.root_path, "static", "exports")


def _tsv_cell(value):
    """One TSV cell; cells that would break the row/column structure are rejected."""
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValueError("each primer field must be text or a number")
    text = str(value)
    if any(c in text for c in "\t\r\n"):
        raise ValueError("primer fields must not contain tabs or line breaks")
    return text


@api.route("/export", methods=["POST"])
@handle_errors
def export_protocol():
    """Export primers (``[name, sequence, amplicon]`` rows) to a TSV file and
    return its download location (``GET`` that URL to retrieve the file)."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400
    primers = data.get("primers")
    if not primers:
        return jsonify({"error": "No primers to export"}), 400
    if not isinstance(primers, list):
        return jsonify({"error": "primers must be a list"}), 400
    rows = []
    for i, primer in enumerate(primers):
        if not isinstance(primer, (list, tuple)) or len(primer) != 3:
            return jsonify({"error": f"primers[{i}] must be [name, sequence, amplicon]"}), 400
        try:
            rows.append([_tsv_cell(v) for v in primer])
        except ValueError as e:
            return jsonify({"error": f"primers[{i}]: {e}"}), 400

    filename = f"primers_{int(time.time())}_{uuid.uuid4().hex[:8]}.tsv"
    export_dir = _export_dir()
    try:
        os.makedirs(export_dir, exist_ok=True)
        with open(os.path.join(export_dir, filename), "w", newline="") as f:
            f.write("Primer Name\tSequence\tAmplicon\n")
            for row in rows:
                f.write("\t".join(row) + "\n")
    except OSError as e:
        print(e)
        return jsonify({"error": "Failed to create export file"}), 500
    return jsonify({"download_url": f"/api/export/{filename}"})


_EXPORT_NAME = re.compile(r"^primers_\d+_[0-9a-f]{8}\.tsv$")


@api.route("/export/<filename>", methods=["GET"])
def download_export(filename):
    """Serve a previously created TSV export directly from the API."""
    if not _EXPORT_NAME.match(filename):
        return jsonify({"error": "Unknown export"}), 404
    from flask import send_from_directory

    return send_from_directory(
        os.path.abspath(_export_dir()),
        filename,
        mimetype="text/tab-separated-values",
        as_attachment=True,
    )


@api.route("/species", methods=["GET"])
@handle_errors
def get_species():
    """Get available species for codon optimization."""
    return jsonify({"species": utils.get_available_species()})


@api.route("/dummy", methods=["GET"])
@handle_errors
def get_dummy_data():
    """Get dummy data for development and testing."""
    # logger.log_step("DummyHit", "dummy endpoint was called", data=None)

    prefill_module = current_app.config.get("PREFILL_DATA")
    if prefill_module:
        # If it's a string (module path), try to import it
        if isinstance(prefill_module, str):
            try:
                import importlib

                module = importlib.import_module(prefill_module)
                # Return dev_config from the module if it exists
                if hasattr(module, "dev_config"):
                    return jsonify(module.dev_config)
                return jsonify({})
            except ImportError as e:
                # logger.error(f"Failed to import module {prefill_module}: {e}")
                print(e)
                return jsonify({"error": f"Failed to import module: {e}"})
        # If it's already a module (imported earlier)
        elif hasattr(prefill_module, "dev_config"):
            return jsonify(prefill_module.dev_config)

    # Default empty response if no valid PREFILL_DATA is found
    return jsonify({})


def _parse_sequence_idx(value):
    """A non-negative integer index (0 is the first sequence). Returns None if invalid."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


@api.route("/design_primers", methods=["POST"])
@handle_errors
def design_primers():
    """
    API endpoint to design primers for user-selected mutations.

    The work is asynchronous: the response carries the Celery ``task_id``; the
    result is published on the sequence's SSE channel and is available from
    ``GET /api/task-status/<task_id>``.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify({"error": "No data provided"}), 400

    job_id = data.get("job_id")
    sequence_idx = _parse_sequence_idx(data.get("sequence_idx"))
    selected_mutations = data.get("selected_mutations")

    if not isinstance(job_id, str) or not job_id.strip():
        return jsonify({"error": "job_id is required"}), 400
    if sequence_idx is None:
        return jsonify({"error": "sequence_idx must be a non-negative integer"}), 400
    if (
        not isinstance(selected_mutations, dict)
        or not selected_mutations
        or not all(
            isinstance(k, str) and isinstance(v, str) and v
            for k, v in selected_mutations.items()
        )
    ):
        return jsonify({"error": "selected_mutations must map site keys to codon sequences"}), 400

    job = job_state.get_job(job_id)
    if job is None:
        return jsonify({"error": "Unknown job"}), 404
    if sequence_idx >= len(job.get("sequences", [])):
        return jsonify({"error": "sequence_idx is out of range for this job"}), 400

    celery = get_celery_instance()
    try:
        task = celery.send_task(
            "flask_backend.celery_tasks.design_primers_task",
            args=[job_id, sequence_idx, selected_mutations],
        )
    except Exception as e:  # broker unreachable etc.
        print(f"Could not dispatch primer design: {e}")
        return jsonify({"error": "Could not start primer design; please try again."}), 503

    return jsonify(
        {
            "status": "success",
            "message": "Primer design started",
            "task_id": task.id,
            "job_id": job_id,
            "sequence_idx": sequence_idx,
        }
    ), 202
