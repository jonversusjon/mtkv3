"""In-memory stand-ins for the external services the lifecycle needs (redis, SSE, celery)."""
import json


class FakeRedis:
    """Just the redis commands the application uses (strings + capped lists)."""

    def __init__(self):
        self.kv = {}

    def get(self, key):
        return self.kv.get(key)

    def set(self, key, value, ex=None):
        self.kv[key] = value
        return True

    def rpush(self, key, value):
        self.kv.setdefault(key, []).append(value)

    def ltrim(self, key, start, stop):
        lst = self.kv.get(key, [])
        n = len(lst)
        start = max(n + start, 0) if start < 0 else start
        stop = n + stop if stop < 0 else stop
        self.kv[key] = lst[start : stop + 1]

    def expire(self, key, seconds):
        return True

    def lrange(self, key, start, stop):
        lst = self.kv.get(key, [])
        stop = len(lst) if stop == -1 else stop + 1
        return lst[start:stop]


class FakeSse:
    """Records what flask-sse would have published (transient, like the real one)."""

    def __init__(self):
        self.published = []

    def publish(self, payload, channel=None):
        self.published.append((channel, json.loads(json.dumps(payload, default=str))))
