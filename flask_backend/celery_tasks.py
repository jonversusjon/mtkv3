# celery_tasks.py
import json
from functools import partial
from typing import Optional, Any
from celery import shared_task, group
from flask_sse import sse
from flask_backend.services import GoldenGateUtils, ProtocolMaker
from flask_backend.models import ProtocolRequest, DomesticationResult, FrontendFriendly
# from flask_backend.logging import logger
from flask_backend.services.utils import redis_client, get_mutation_hash

from pydantic import BaseModel
from flask_backend.models.base_models import to_camel


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

    sse.publish(
        payload,
        channel=channel,
    )


@shared_task(ignore_result=False)
def process_protocol_sequence(req_dict: dict, index: int):
    print(f"Processing sequence {index} with request: {req_dict}")
    # logger.log_step("TaskStart", f"processing sequence {index}", data=req_dict)
    req = ProtocolRequest.model_validate(req_dict)
    # Cache the request dict for downstream primer design tasks
    redis_client.set(f"req:{req.job_id}:{index}", json.dumps(req_dict), ex=3600)
    seq = req.sequences_to_domesticate[index]

    progress_callback = partial(publish_sse, job_id=req.job_id, sequence_idx=index)
    # if index == 1:
    #     logger.log_step(
    #         "SSE Publish",
    #         f"Setting up task for channel 1 job_{req.job_id}_{index}: {json.dumps({'jobId': req.job_id, 'sequenceIdx': index, 'step': 'start', 'message': 'Starting protocol generation'})}",
    #     )

    protocol_maker = ProtocolMaker(
        request_idx=index,
        sequence_to_domesticate=seq,
        codon_usage_dict=GoldenGateUtils().get_codon_usage_dict(req.species),
        max_mutations=req.max_mut_per_site,
        template_seq=req.template_sequence,
        kozak=req.kozak,
        max_results=req.max_results,
        verbose=req.verbose_mode,
        job_id=f"{req.job_id}_{index}",
    )

    # Execute protocol and explicitly serialize result.
    result: DomesticationResult = protocol_maker.create_gg_protocol(
        send_update=progress_callback
    )

    # Automatically design custom primers for the best mutations
    if result.mutation_options:
        # Select best mutations based on codon usage
        best_mutations = protocol_maker._select_best_mutations(result.mutation_options)

        # Convert the mutation objects to selected_mutations format {site_key: codon_sequence}
        selected_mutations = {}
        for site_key, mutation in best_mutations.items():
            if mutation.get("mutCodons") and len(mutation["mutCodons"]) > 0:
                selected_mutations[site_key] = mutation["mutCodons"][
                    0
                ].codon.codonSequence

        # Design custom primers for these mutations if we found any
        if selected_mutations:
            # Generate a hash for the selected mutations for caching
            mutation_hash = get_mutation_hash(selected_mutations)

            # Design primers
            primers = protocol_maker.primer_designer.design_custom_primers(
                selected_mutations
            )

            # Cache the designed primers
            primers_cache_key = f"primers:{req.job_id}:{index}:{mutation_hash}"
            redis_client.set(primers_cache_key, json.dumps(primers), ex=3600)

            # Include in result
            result.custom_primers = {
                "primer_set": primers,
                "selected_mutations": selected_mutations,
            }

            # Publish update
            progress_callback(
                step="custom_primers_step",  # Change from "Custom Primers" to a specific step name
                message="Automatically designed custom primers for best mutations",
                prog=100,
                custom_primers={
                    "primer_set": primers,
                    "selected_mutations": selected_mutations,
                },
            )

    print(f"Result for sequence {index}: {result}")
    return {"sequenceIdx": index, "result": result.model_dump(by_alias=True)}


@shared_task(ignore_result=False)
def generate_protocol_task(req_dict: dict):
    req = ProtocolRequest.model_validate(req_dict)
    total_sequences = len(req.sequences_to_domesticate)

    tasks = group(
        process_protocol_sequence.s(req_dict, idx) for idx in range(total_sequences)
    )
    group_result = tasks.apply_async()

    return {
        "status": "started",
        "group_task_id": group_result.id,
        "total": total_sequences,
    }


@shared_task(ignore_result=False)
def design_primers_task(job_id: str, sequence_idx: int, selected_mutations: dict):
    """
    Celery task to design custom primers for given selected mutations.
    """
    # Retrieve stored request context
    req_key = f"req:{job_id}:{sequence_idx}"
    req_json = redis_client.get(req_key)
    if not req_json:
        raise ValueError(f"No request found for key {req_key}")
    req_dict = json.loads(req_json)
    req = ProtocolRequest.model_validate(req_dict)
    # Initialize ProtocolMaker with original request context
    protocol_maker = ProtocolMaker(
        request_idx=sequence_idx,
        sequence_to_domesticate=req.sequences_to_domesticate[sequence_idx],
        codon_usage_dict=GoldenGateUtils().get_codon_usage_dict(req.species),
        max_mutations=req.max_mut_per_site,
        template_seq=req.template_sequence,
        kozak=req.kozak,
        max_results=req.max_results,
        verbose=req.verbose_mode,
        job_id=f"{job_id}:{sequence_idx}",
    )
    # Design custom primers
    primers = protocol_maker.primer_designer.design_custom_primers(selected_mutations)
    # Cache the designed primers
    mutation_hash = get_mutation_hash(selected_mutations)
    primers_cache_key = f"primers:{job_id}:{sequence_idx}:{mutation_hash}"
    redis_client.set(primers_cache_key, json.dumps(primers), ex=3600)
    return {
        "jobId": job_id,
        "sequenceIdx": sequence_idx,
        "primers": primers,
        "selectedMutations": selected_mutations,
    }
