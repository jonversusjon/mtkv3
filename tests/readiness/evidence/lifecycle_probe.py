"""Run the real worker code for the named fixture and print what a browser could learn.

Works against any checkout (pass its root as argv[1]); used to compare the baseline
(before this work order) with the repaired tree.  In-memory redis/SSE only.
"""
import json
import os
import sys
import tempfile
from types import SimpleNamespace

root = os.path.abspath(sys.argv[1])
work = tempfile.mkdtemp()
os.symlink(os.path.join(root, "flask_backend"), os.path.join(work, "flask_backend"))
os.chdir(work)                      # worker writes relative debug_output; keep it out of the checkout
sys.path.insert(0, root)
os.environ["MTKV3_LOG_DIR"] = os.path.join(work, "logs")
sys.path.insert(1, os.path.join(root, "tests", "readiness"))
from fakes import FakeRedis, FakeSse  # noqa: E402

from flask_backend import celery_tasks as ct  # noqa: E402
from flask_backend.dev.prefill_data.dev_defaults import dev_config_2  # noqa: E402
from flask_backend.dev.tests.test_data import TEST_TEMPLATE_SEQ  # noqa: E402

redis, sse = FakeRedis(), FakeSse()
ct.redis_client, ct.sse = redis, sse
import flask_backend.services.utils as su  # noqa: E402
su.redis_client = redis
try:
    from flask_backend import job_state
    job_state.set_client(redis)
except ImportError:
    job_state = None

req = {"templateSequence": TEST_TEMPLATE_SEQ, "species": "homo_sapiens", "kozak": "MTK",
       "maxMutPerSite": 1, "verboseMode": False, "jobId": "probe-job",
       "sequencesToDomesticate": [dev_config_2["sequencesToDomesticate"][0]]}
if job_state:
    job_state.create_job("probe-job", 1)

class InlineGroup:
    def __init__(self, sigs): self.sigs, self.id = list(sigs), "g"
    def apply_async(self):
        self.results = [s.apply() for s in self.sigs]
        return self
ct.group = InlineGroup
import celery.result as _cr  # a real deployment has a result backend; this harness does not
_cr.GroupResult.restore = classmethod(lambda cls, *a, **k: None)

sys.stdout = open(os.devnull, "w")  # silence the application's own prints
parent = ct.generate_protocol_task.apply(args=[req])
child = ct.process_protocol_sequence.apply(args=[req, 0])
sys.stdout = sys.__stdout__

print("parent dispatch task state :", parent.state, "->", parent.result if parent.state == "SUCCESS" else repr(parent.result))
print("child sequence task state  :", child.state, "->", (type(child.result).__name__ + ": " + str(child.result)) if child.state != "SUCCESS" else "ok")
steps = [p.get("step") for _, p in sse.published]
print("SSE steps published        :", sorted(set(steps)))
print("terminal SSE event         :", any(p.get("terminal") for _, p in sse.published))
if job_state:
    j = job_state.get_job("probe-job")
    print("durable job record         :", j["state"], [s["state"] for s in j["sequences"]])
else:
    print("durable job record         : none (no way to ask the server whether the sequence finished)")
