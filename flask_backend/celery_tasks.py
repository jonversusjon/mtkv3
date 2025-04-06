# celery_tasks.py
import json
from functools import partial
from typing import Optional, Any
from celery import shared_task, group
from flask_sse import sse
from flask_backend.services import GoldenGateUtils, ProtocolMaker
from flask_backend.models import ProtocolRequest, DomesticationResult, FrontendFriendly
from flask_backend.logging import logger
from flask_backend.services.utils import redis_client, get_mutation_hash

from pydantic import BaseModel

# Import your existing to_camel function
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

    logger.log_step(
        "SSE Publish",
        f"Publishing to channel {channel}: {json.dumps(payload, default=str)}",
    )

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
    req = ProtocolRequest.model_validate(req_dict)
    seq = req.sequences_to_domesticate[index]

    progress_callback = partial(publish_sse, job_id=req.job_id, sequence_idx=index)
    if index == 1:
        logger.log_step(
            "SSE Publish",
            f"Setting up task for channel 1 job_{req.job_id}_{index}: {json.dumps({'jobId': req.job_id, 'sequenceIdx': index, 'step': 'start', 'message': 'Starting protocol generation'})}",
        )

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


@shared_task(bind=True)
def recommend_primers_task(self, job_id, sequence_idx, cache_key):
    """
    Stage 2: Recommend primers based on best mutation options.
    """
    # Retrieve mutation options from cache
    mutation_options = json.loads(redis_client.get(cache_key))

    # Initialize ProtocolMaker
    protocol_maker = ProtocolMaker(...)

    # Select best mutations and recommend primers
    best_mutations = protocol_maker._select_best_mutations(mutation_options)
    recommended_primers = protocol_maker.primer_designer.design_best_primers(
        best_mutations, None
    )

    # Cache recommended primers
    primers_cache_key = f"recommended_primers:{job_id}:{sequence_idx}"
    redis_client.set(primers_cache_key, json.dumps(recommended_primers), ex=3600)

    return {"status": "success", "recommended_primers": recommended_primers}


@shared_task(bind=True)
def design_custom_primers_task(self, job_id, sequence_idx, selected_mutations):
    """
    Stage 3: Design primers for user-selected mutations.
    """
    # Generate a hash for the selected mutations
    mutation_hash = get_mutation_hash(selected_mutations)

    # Check if primers are already cached
    primers_cache_key = f"primers:{job_id}:{sequence_idx}:{mutation_hash}"
    cached_primers = redis_client.get(primers_cache_key)
    if cached_primers:
        return {"status": "success", "primers": json.loads(cached_primers)}

    # Initialize ProtocolMaker
    protocol_maker = ProtocolMaker(
        request_idx=sequence_idx,
        sequence_to_domesticate=None,  # Retrieve from storage/database
        codon_usage_dict={},  # Retrieve from storage/database
        max_mutations=1,
        verbose=True,
        debug=True,
    )

    # Design primers for the selected mutations
    primers = protocol_maker.primer_designer.design_custom_primers(selected_mutations)

    # Cache the designed primers
    redis_client.set(primers_cache_key, json.dumps(primers), ex=3600)

    return {"status": "success", "primers": primers}
