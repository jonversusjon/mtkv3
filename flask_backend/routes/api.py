from flask import (
    Blueprint,
    request,
    jsonify,
    current_app,
    Response,
    stream_with_context,
)
from functools import wraps
import time
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
    elif async_result.state == "FAILURE":
        response["error"] = str(async_result.result)

    return jsonify(response)


@api.route("/export", methods=["POST"])
@handle_errors
def export_protocol():
    """Export protocol primers to a TSV file."""
    data = request.get_json()
    primers = data.get("primers", [])
    if not primers:
        return jsonify({"error": "No primers to export"}), 400

    filename = f"primers_{int(time.time())}.tsv"
    filepath = f"static/exports/{filename}"

    try:
        with open(filepath, "w") as f:
            f.write("Primer Name\tSequence\tAmplicon\n")
            for primer in primers:
                f.write(f"{primer[0]}\t{primer[1]}\t{primer[2]}\n")
        return jsonify({"download_url": f"/static/exports/{filename}"})
    except IOError as e:
        print(e)
        # logger.error(f"Failed to write export file: {e}", exc_info=True)
        return jsonify({"error": "Failed to create export file"}), 500


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


@api.route("/design_primers", methods=["POST"])
@handle_errors
def design_primers():
    """
    API endpoint to design primers for user-selected mutations.
    """
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # logger.log_step("API", "design_primers", data)
    job_id = data.get("job_id")
    sequence_idx = data.get("sequence_idx")
    selected_mutations = data.get("selected_mutations")

    # Validate inputs
    if not job_id or not sequence_idx or not selected_mutations:
        return jsonify({"error": "Missing required parameters"}), 400

    # Start the Celery task
    celery = get_celery_instance()
    task = celery.send_task(
        "flask_backend.celery_tasks.design_primers_task",
        args=[job_id, sequence_idx, selected_mutations],
    )

    return jsonify(
        {"status": "success", "message": "Primer design started", "task_id": task.id}
    )
