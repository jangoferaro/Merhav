"""Deterministic offline "LLM".

It is not a language model: it is a seeded generator that returns the same
shapes the real model returns for each `purpose`. That is what lets the entire
company run — and be unit tested — with no API key and no network.
"""
from __future__ import annotations

from ..base import LLMProvider
from . import banks


class MockLLM(LLMProvider):
    name = "mock"
    last_cost = 0.0

    def complete(self, system, prompt, schema, purpose, rng):
        self.last_cost = 0.0
        fn = getattr(banks, f"gen_{purpose}", None)
        if fn is None:
            return {"text": f"[{purpose}] {prompt[:120]}"}
        return fn(prompt, rng)
