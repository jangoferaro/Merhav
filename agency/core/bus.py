"""In-process event bus. Agents publish; the orchestrator, the analyst and the
console renderer subscribe. Every event is also persisted to the store."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable


class Bus:
    def __init__(self, store=None):
        self.store = store
        self._subs: dict[str, list[Callable]] = defaultdict(list)
        self.day = 0

    def on(self, topic: str, fn: Callable) -> None:
        self._subs[topic].append(fn)

    def emit(self, topic: str, actor: str, message: str, data: Any = None, level: str = "info") -> None:
        payload = {"topic": topic, "actor": actor, "message": message,
                   "data": data or {}, "level": level, "day": self.day}
        if self.store is not None:
            self.store.add_event(self.day, topic, actor, level, message, data)
        for fn in self._subs.get(topic, []) + self._subs.get("*", []):
            fn(payload)
