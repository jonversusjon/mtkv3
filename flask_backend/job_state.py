"""Durable per-submission / per-sequence job state.

Why this exists: Celery's *parent* task (``generate_protocol_task``) finishes as
soon as it has dispatched the per-sequence child tasks, and SSE events are
transient (a browser that connects late, reconnects, or reloads misses them).
Neither tells the browser whether the sequence work actually finished.

Every submission therefore gets a server-issued ``job_id`` and one record per
sequence, written by the code that actually does (or fails) the work:

    pending  -> the sequence has been accepted but its work has not finished
    success  -> the sequence work finished; ``result`` holds the output
    failure  -> the sequence work failed; ``error`` holds a controlled message

``GET /api/jobs/<job_id>`` reads these records, so a result can always be
recovered after a missed SSE event, and the identity of every record is the
``job_id`` the browser was given.
"""
import json
import time
import uuid
from typing import Any, Dict, List, Optional

PENDING = "pending"
SUCCESS = "success"
FAILURE = "failure"
TERMINAL = (SUCCESS, FAILURE)

TTL_SECONDS = 24 * 3600

_client_override = None


def set_client(client) -> None:
    """Use ``client`` (a redis-like object) instead of the shared redis client.

    Only tests call this; production always uses ``services.utils.redis_client``.
    """
    global _client_override
    _client_override = client


def _client():
    if _client_override is not None:
        return _client_override
    from flask_backend.services.utils import redis_client

    return redis_client


def new_job_id() -> str:
    return uuid.uuid4().hex


def _job_key(job_id: str) -> str:
    return f"job:{job_id}"


def _seq_key(job_id: str, idx: int) -> str:
    return f"job:{job_id}:seq:{idx}"


def _put(key: str, value: Dict[str, Any]) -> None:
    _client().set(key, json.dumps(value, default=str), ex=TTL_SECONDS)


def _get(key: str) -> Optional[Dict[str, Any]]:
    raw = _client().get(key)
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def create_job(job_id: str, total: int) -> None:
    """Record a new submission with every sequence pending."""
    _put(_job_key(job_id), {"jobId": job_id, "total": total, "createdAt": time.time()})
    for idx in range(total):
        _put(_seq_key(job_id, idx), {"sequenceIdx": idx, "state": PENDING})


def set_task_id(job_id: str, task_id: str) -> None:
    job = _get(_job_key(job_id)) or {"jobId": job_id}
    job["taskId"] = task_id
    _put(_job_key(job_id), job)


def mark_success(job_id: str, idx: int, result: Dict[str, Any]) -> None:
    _put(_seq_key(job_id, idx), {"sequenceIdx": idx, "state": SUCCESS, "result": result})


def mark_failure(job_id: str, idx: int, error: str, code: str = "worker_error") -> None:
    _put(
        _seq_key(job_id, idx),
        {"sequenceIdx": idx, "state": FAILURE, "error": error, "errorCode": code},
    )


def mark_all_failed(job_id: str, error: str, code: str = "dispatch_error") -> None:
    """Fail every still-pending sequence (e.g. the dispatching parent task crashed)."""
    job = _get(_job_key(job_id))
    if job is None:
        return
    for idx in range(job.get("total", 0)):
        rec = _get(_seq_key(job_id, idx))
        if rec is None or rec.get("state") == PENDING:
            mark_failure(job_id, idx, error, code)


def aggregate_state(states: List[str]) -> str:
    """Whole-job state: pending until every sequence is terminal."""
    if any(s == PENDING for s in states):
        return PENDING
    if any(s == FAILURE for s in states):
        return FAILURE
    return SUCCESS


MAX_EVENTS = 500


def _events_key(job_id: str, idx: int) -> str:
    return f"job:{job_id}:seq:{idx}:events"


def append_event(job_id: str, idx: int, payload: Dict[str, Any]) -> None:
    """Persist a progress event so it can be replayed if the SSE delivery is missed."""
    c = _client()
    key = _events_key(job_id, idx)
    c.rpush(key, json.dumps(payload, default=str))
    c.ltrim(key, -MAX_EVENTS, -1)
    c.expire(key, TTL_SECONDS)


def get_events(job_id: str, idx: int) -> List[Dict[str, Any]]:
    out = []
    for raw in _client().lrange(_events_key(job_id, idx), 0, -1):
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        out.append(json.loads(raw))
    return out


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    job = _get(_job_key(job_id))
    if job is None:
        return None
    sequences = []
    for idx in range(job.get("total", 0)):
        sequences.append(
            _get(_seq_key(job_id, idx)) or {"sequenceIdx": idx, "state": PENDING}
        )
    return {
        "jobId": job_id,
        "taskId": job.get("taskId"),
        "state": aggregate_state([s["state"] for s in sequences]),
        "sequences": sequences,
    }
