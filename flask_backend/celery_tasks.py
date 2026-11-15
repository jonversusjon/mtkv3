# celery_tasks.py
import json
import os
from typing import Optional, Any
from celery import shared_task, group
from flask_sse import sse
from flask_backend import job_state
from flask_backend.services import GoldenGateUtils, ProtocolMaker
from flask_backend.models import ProtocolRequest, DomesticationResult, FrontendFriendly

# from flask_backend.logging import logger
from flask_backend.services.utils import redis_client, get_mutation_hash

from pydantic import BaseModel
from flask_backend.models.base_models import to_camel

# Configure Redis host from environment or default to service name for Docker
REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))

# Update redis_client connection parameters in utils module
try:
    # Only modify if it's connecting to localhost
    if (
        hasattr(redis_client, "connection_pool")
        and redis_client.connection_pool.connection_kwargs.get("host") == "localhost"
    ):
        print(f"Updating Redis connection to {REDIS_HOST}:{REDIS_PORT}")
        from redis import Redis

        redis_client = Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
except Exception as e:
    print(f"Error updating Redis connection: {e}")


def process_payload_values(value: Any) -> Any:
    """
    Recursively process values to:
    1. Convert Pydantic models to dictionaries using model_dump(by_alias=True)
    2. Convert snake_case keys to camelCase in regular dictionaries
    """
    # If it's a Pydantic model, use model_dump with by_alias=True
    if isinstance(value, (BaseModel, FrontendFriendly)):
        return value.model_dump(by_alias=True)

    # If it's a list, process each item
    elif isinstance(value, list):
        return [process_payload_values(item) for item in value]

    # If it's a dictionary, process keys and values
    elif isinstance(value, dict):
        result = {}
        for k, v in value.items():
            # Convert keys to camelCase if they're snake_case
            camel_key = to_camel(k) if isinstance(k, str) and "_" in k else k
            # Process values recursively
            processed_value = process_payload_values(v)
            result[camel_key] = processed_value
        return result

    # Return other types as is
    else:
        return value


def publish_sse(
    job_id: str,
    sequence_idx: int,
    step: str,
    message: str,
    prog: Optional[float] = None,
    **kwargs,
):
    """
    Publish updates via Flask-SSE to a Redis channel.

    Handles a mix of Pydantic models and primitive types, ensuring all keys are camelCase.
    """
    channel = f"job_{job_id}_{sequence_idx}"

    # Process kwargs to handle Pydantic models and convert snake_case to camelCase
    processed_kwargs = process_payload_values(kwargs)

    # Create the base payload
    payload = {
        "jobId": job_id,
        "sequenceIdx": sequence_idx,
        "step": step,
        "message": message,
        **processed_kwargs,  # Use the processed kwargs
    }

    # Add progress if provided
    if prog is not None:
        payload["stepProgress"] = prog

    # logger.log_step(
    #     "SSE Publish",
    #     f"Publishing to channel {channel}: {json.dumps(payload, default=str)}",
    # )

    try:
        # Verify the payload is serializable
        json.dumps(payload, default=str)
    except TypeError as e:
        # Log the error and the problematic data
        print(f"Serialization Error: {e}")
        print(f"Problematic payload: {payload}")
        raise e

    # Persist before publishing: SSE is fire-and-forget, the stored copy is what a
    # late/reconnecting browser recovers.  Never let bookkeeping break the work.
    try:
        job_state.append_event(job_id, sequence_idx, json.loads(json.dumps(payload, default=str)))
    except Exception as e:
        print(f"Could not persist SSE event for {job_id}:{sequence_idx}: {e}")

    sse.publish(
        payload,
        channel=channel,
    )


class SequenceError(Exception):
    """A failure whose message is safe and useful to show to the user."""


def _user_message(index: int, exc: Exception) -> str:
    """Controlled, user-facing text for a worker failure (no tracebacks/internals)."""
    label = f"Sequence {index + 1}"
    if isinstance(exc, (SequenceError, ValueError)):
        return f"{label} could not be processed: {exc}"
    return (
        f"{label} could not be processed because of an unexpected internal error "
        f"({type(exc).__name__}). Please try again; if it persists, contact the administrator."
    )


def _publish_terminal(job_id, index, state, message, **extra):
    """Tell the browser (best effort) that this sequence reached a terminal state.
    The authoritative record is job_state; this just avoids waiting for the next poll."""
    try:
        publish_sse(
            job_id=job_id,
            sequence_idx=index,
            step="Sequence Status",
            message=message,
            status=state,
            terminal=True,
            **extra,
        )
    except Exception as e:
        print(f"Could not publish terminal event for {job_id}:{index}: {e}")


# Bounded retry of terminal job-state writes (seconds to wait before each retry).
TERMINAL_WRITE_BACKOFF = (0.2, 0.5, 1.0)


def _persist_terminal(write, *args):
    """Run a job_state terminal write with bounded retry; raises the last error."""
    return job_state.write_with_retry(write, *args, backoff=TERMINAL_WRITE_BACKOFF)


def _custom_primer_payload(primers, selected_mutations):
    """JSON-safe, camelCase result of a custom primer design.

    Site keys are reported the way the browser knows them (``mutation_480`` is
    shown as ``mutation480`` because SSE payload keys are camelCased).
    Selected mutations are a list of ``{siteKey, codonSequence}`` entries (not a
    dict keyed by site) so site keys such as ``mutation_480`` survive the
    snake->camel key conversion applied to SSE payloads unchanged.
    """
    return {
        "primerSet": primers[0].model_dump(by_alias=True),
        "selectedMutations": [
            {"siteKey": to_camel(k), "codonSequence": v}
            for k, v in sorted(selected_mutations.items())
        ],
    }


@shared_task(ignore_result=False)
def process_protocol_sequence(req_dict: dict, index: int):
    """Process one sequence and record its terminal outcome (success or failure)
    under the submission's job_id.  The outcome is written here, by the code that
    did the work -- not inferred from the parent dispatch task."""
    job_id = req_dict.get("jobId") or req_dict.get("job_id")
    try:
        output = _run_sequence(req_dict, index)
    except Exception as e:
        print(f"[ERROR] Failed processing sequence {index}: {str(e)}")
        import traceback

        print(traceback.format_exc())
        if job_id:
            message = _user_message(index, e)
            try:
                _persist_terminal(job_state.mark_failure, job_id, index, message)
            except Exception as store_err:
                # Never replace the original error with a storage error.  The record
                # stays pending and get_job reports it failed once it is stale.
                print(f"[ERROR] Could not store failure for {job_id}:{index}: {store_err}")
            # Terminal feedback is attempted even if storing the failure did not work.
            _publish_terminal(job_id, index, job_state.FAILURE, message, error=message)
        # Re-raise the ORIGINAL error to mark the Celery task as failed
        raise
    if job_id:
        try:
            _persist_terminal(job_state.mark_success, job_id, index, output["result"])
        except Exception as e:
            # The computed result could not be stored, so it cannot be retrieved:
            # do not invent a success.  Record an explicit, visible failure instead.
            print(f"[ERROR] Could not store result for {job_id}:{index}: {e}")
            message = (
                f"Sequence {index + 1} finished computing but its result could not be "
                "stored. Please resubmit; if it persists, contact the administrator."
            )
            try:
                _persist_terminal(job_state.mark_failure, job_id, index, message, "storage_error")
                _publish_terminal(job_id, index, job_state.FAILURE, message, error=message)
            except Exception as e2:
                # Storage is down for failure writes too.  The record stays pending;
                # get_job reports a stale pending sequence as failed (see job_state).
                print(f"[ERROR] Could not store failure for {job_id}:{index}: {e2}")
            raise  # Celery outcome = FAILURE, consistent with the job record
        _publish_terminal(
            job_id, index, job_state.SUCCESS, f"Sequence {index + 1} complete"
        )
    return output


def _run_sequence(req_dict: dict, index: int):
    print(f"[START] Process protocol sequence {index}")
    req = ProtocolRequest.model_validate(req_dict)
    print(f"Processing sequence {index} with request: {req}")

    if req.job_id is None:
        raise ValueError(f"job_id cannot be None for sequence {index}")
    if not 0 <= index < len(req.sequences_to_domesticate):
        raise ValueError(f"sequence index {index} is out of range")

    # Cache the request dict for downstream primer design tasks
    try:
        redis_client.set(f"req:{req.job_id}:{index}", json.dumps(req_dict), ex=3600)
        print(f"Cached request for job {req.job_id} and sequence {index}")
    except Exception as e:
        print(f"Redis caching error for request {req.job_id}:{index}: {str(e)}")
        # Continue even if caching fails

    def progress_callback(
        step: str, message: str, prog: Optional[float] = None, **kwargs
    ):
        publish_sse(
            job_id=req.job_id,
            sequence_idx=index,
            step=step,
            message=message,
            prog=prog,
            **kwargs,
        )

    codon_usage_dict = GoldenGateUtils().get_codon_usage_dict(req.species)
    if codon_usage_dict is None:
        raise SequenceError(f"no codon usage table for species '{req.species}'")

    protocol_maker = ProtocolMaker(
        request_idx=index,
        sequence_to_domesticate=req.sequences_to_domesticate[index],
        codon_usage_dict=codon_usage_dict,
        max_mutations=req.max_mut_per_site,
        template_seq=req.template_sequence,
        kozak=req.kozak,
        verbose=req.verbose_mode,
        job_id=f"{req.job_id}_{index}",
    )

    print(f"Starting protocol creation for sequence {index}")
    protocol_result = protocol_maker.create_gg_protocol(send_update=progress_callback)
    if isinstance(protocol_result, dict):
        result = DomesticationResult.model_validate(protocol_result)
    else:
        result = protocol_result
    print(f"Completed protocol creation for sequence {index}")

    # A sequence rejected during preprocessing is a user-visible failure, not a
    # "successful" empty result.
    if not result.processed_sequence:
        raise SequenceError(
            "the sequence was rejected during preprocessing (check the sequence "
            "and the MTK part settings)"
        )

    # Automatically design custom primers for the best mutations.  The core
    # protocol (sites, mutations, primers) is already complete here, so a problem in
    # this optional convenience step is reported on the result rather than
    # discarding finished work.
    best_mutations = getattr(protocol_maker, "best_mutations", None)
    if best_mutations:
        try:
            selected_mutations = {
                site_key: mutation.mut_codons[0].codon.codon_sequence
                for site_key, mutation in best_mutations.items()
                if mutation.mut_codons
            }
            if selected_mutations:
                mutation_hash = get_mutation_hash(selected_mutations)
                primers = protocol_maker.primer_designer.design_custom_primers(
                    selected_mutations, protocol_maker.mutation_options
                )
                custom = _custom_primer_payload(primers, selected_mutations)
                redis_client.set(
                    f"primers:{req.job_id}:{index}:{mutation_hash}",
                    json.dumps(custom),
                    ex=3600,
                )
                result.custom_primers = custom
                progress_callback(
                    step="Primer Design",
                    message="Automatically designed custom primers for best mutations",
                    prog=100,
                    customPrimers={"status": "success", **custom},
                )
        except Exception as e:
            print(f"Automatic custom primer design failed for sequence {index}: {e}")
            result.errors = {
                "customPrimers": "Automatic custom primer design was not completed "
                f"({type(e).__name__})."
            }

    print(f"Result for sequence {index}: {result}")
    return {"sequenceIdx": index, "result": result.model_dump(by_alias=True)}


@shared_task(ignore_result=False)
def generate_protocol_task(req_dict: dict):
    print(
        f"[START] Generate protocol task with {len(req_dict.get('sequences_to_domesticate', [])) + 1} sequences"
    )
    try:
        req = ProtocolRequest.model_validate(req_dict)
        total_sequences = len(req.sequences_to_domesticate)
        print(f"Creating task group for {total_sequences} sequences")

        task_signatures = [
            process_protocol_sequence.s(req_dict, idx)  # fixed: pass args as tuple
            for idx in range(total_sequences)
        ]
        tasks = group(task_signatures)
        group_result = tasks.apply_async()

        print(f"Task group created with ID: {group_result.id}")

        # NOTE: this only reports that the sequence tasks were dispatched.  Sequence
        # outcomes are recorded per job by process_protocol_sequence (see job_state).
        return {
            "status": "started",
            "group_task_id": group_result.id,
            "total": total_sequences,
        }
    except Exception as e:
        print(f"[ERROR] Failed to generate protocol: {str(e)}")
        import traceback

        print(traceback.format_exc())
        job_id = req_dict.get("jobId") or req_dict.get("job_id")
        if job_id:
            message = "The request could not be started: " + (
                str(e) if isinstance(e, ValueError) else f"internal error ({type(e).__name__})"
            )
            try:
                _persist_terminal(job_state.mark_all_failed, job_id, message)
            except Exception as store_err:
                print(f"[ERROR] Could not store dispatch failure for {job_id}: {store_err}")
            seqs = req_dict.get("sequencesToDomesticate", req_dict.get("sequences_to_domesticate"))
            for idx in range(len(seqs) if isinstance(seqs, list) else 0):
                _publish_terminal(job_id, idx, job_state.FAILURE, message, error=message)
        raise


def _design_selected_primers(job_id, sequence_idx, selected_mutations):
    """Design primers for the user's selection against *this* submission's sequence."""
    if not isinstance(selected_mutations, dict) or not selected_mutations:
        raise SequenceError("no mutations were selected")
    req_key = f"req:{job_id}:{sequence_idx}"
    try:
        req_json = redis_client.get(req_key)
    except Exception as e:
        print(f"Redis retrieval error for {req_key}: {e}")
        raise SequenceError("the submission could not be loaded; please try again")
    if not req_json:
        raise SequenceError(
            "the submission is no longer available (it expired or the job id is "
            "unknown); please resubmit the sequence"
        )
    req = ProtocolRequest.model_validate(json.loads(req_json))
    if not 0 <= sequence_idx < len(req.sequences_to_domesticate):
        raise SequenceError(f"sequence index {sequence_idx} is out of range")

    seq = req.sequences_to_domesticate[sequence_idx]
    protocol_maker = ProtocolMaker(
        request_idx=sequence_idx,
        sequence_to_domesticate=seq,
        codon_usage_dict=GoldenGateUtils().get_codon_usage_dict(req.species),
        max_mutations=req.max_mut_per_site,
        template_seq=req.template_sequence,
        kozak=req.kozak,
        verbose=req.verbose_mode,
        job_id=f"{job_id}:{sequence_idx}",
    )

    # Re-derive the (deterministic) mutation options of this sequence with the same
    # stages the original run used, so selections are matched to real options.
    quiet = lambda *_a, **_k: None  # noqa: E731
    processed_seq, _msg, is_valid = protocol_maker.sequence_preparator.preprocess_sequence(
        seq.sequence, seq.mtk_part_left, quiet
    )
    if not is_valid:
        raise SequenceError("the sequence is not valid")
    sites = protocol_maker.rs_analyzer.find_restriction_sites(processed_seq, quiet)
    options = protocol_maker.mutation_analyzer.get_all_mutations(sites, quiet)

    # The browser knows site keys in their camelCased SSE form ("mutation480");
    # the analyzer's own keys are "mutation_480".  Accept either, reject unknowns.
    canonical = {}
    for key in options:
        canonical[key] = key
        canonical[to_camel(key)] = key
    resolved = {}
    for key, codon in selected_mutations.items():
        if key not in canonical:
            raise SequenceError(f"unknown restriction site {key!r}")
        if canonical[key] in resolved:
            raise SequenceError(f"restriction site {key!r} was selected twice")
        resolved[canonical[key]] = codon

    try:
        primers = protocol_maker.primer_designer.design_custom_primers(resolved, options)
    except ValueError as e:
        raise SequenceError(str(e))
    return _custom_primer_payload(primers, resolved)


@shared_task(bind=True, ignore_result=False)
def design_primers_task(self, job_id: str, sequence_idx: int, selected_mutations: dict):
    """
    Celery task to design custom primers for the user's selected mutations.

    The outcome is published on the sequence's SSE channel (and stored with the
    sequence's events, so a reload recovers it) and returned as the task result.
    """
    task_id = getattr(self.request, "id", None)
    try:
        payload = _design_selected_primers(job_id, sequence_idx, selected_mutations)
    except Exception as e:
        message = (
            f"Primer design failed: {e}"
            if isinstance(e, (SequenceError, ValueError))
            else f"Primer design failed because of an unexpected internal error ({type(e).__name__})."
        )
        print(f"[ERROR] design_primers_task {job_id}:{sequence_idx}: {e!r}")
        try:
            publish_sse(
                job_id=job_id,
                sequence_idx=sequence_idx,
                step="Primer Design",
                message=message,
                customPrimers={
                    "status": "failure",
                    "error": message,
                    "taskId": task_id,
                    "selectedMutations": [
                        {"siteKey": to_camel(str(k)), "codonSequence": v}
                        for k, v in sorted((selected_mutations or {}).items())
                    ],
                },
            )
        except Exception as pub_err:
            print(f"Could not publish primer design failure: {pub_err}")
        raise SequenceError(message)

    try:
        mutation_hash = get_mutation_hash(selected_mutations)
        redis_client.set(
            f"primers:{job_id}:{sequence_idx}:{mutation_hash}",
            json.dumps(payload),
            ex=3600,
        )
    except Exception as e:
        print(f"Redis caching error for primers: {str(e)}")  # cache only; result still delivered

    result = {"status": "success", "taskId": task_id, **payload}
    publish_sse(
        job_id=job_id,
        sequence_idx=sequence_idx,
        step="Primer Design",
        message="Custom primers designed for the selected mutations",
        prog=100,
        customPrimers=result,
    )
    return {"jobId": job_id, "sequenceIdx": sequence_idx, "result": result}
