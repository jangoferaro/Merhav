"""Live LLM provider — Anthropic Messages API over stdlib urllib.

Falls back to the offline generator on any failure so a network blip degrades
content quality instead of stopping the company.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from ..base import LLMProvider
from .mock import MockLLM

API_URL = os.environ.get("ANTHROPIC_API_BASE_URL", "https://api.anthropic.com") + "/v1/messages"
VERSION = "2023-06-01"

# Rough blended $/1k tokens, used for the cost ledger.
PRICES = {"claude-opus-5": 0.012, "claude-sonnet-5": 0.004, "claude-haiku-4-5-20251001": 0.0012}


class AnthropicLLM(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str = "claude-sonnet-5", api_key: str | None = None,
                 max_tokens: int = 1200, timeout: int = 45):
        self.model = os.environ.get("AGENCY_LLM_MODEL", model)
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.fallback = MockLLM()
        self.last_cost = 0.0

    def complete(self, system, prompt, schema, purpose, rng):
        if not self.api_key:
            return self.fallback.complete(system, prompt, schema, purpose, rng)
        instruction = prompt
        if schema:
            instruction += ("\n\nReturn ONLY a JSON object matching this schema, no prose:\n"
                            + json.dumps(schema, ensure_ascii=False))
        body = json.dumps({
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": instruction}],
        }).encode()
        req = urllib.request.Request(API_URL, data=body, method="POST", headers={
            "content-type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": VERSION,
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
        except Exception:
            self.last_cost = 0.0
            return self.fallback.complete(system, prompt, schema, purpose, rng)

        usage = data.get("usage", {})
        tokens = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        self.last_cost = round(tokens / 1000 * PRICES.get(self.model, 0.004), 5)
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        if not schema:
            return {"text": text}
        try:
            start, end = text.index("{"), text.rindex("}") + 1
            return json.loads(text[start:end])
        except Exception:
            return self.fallback.complete(system, prompt, schema, purpose, rng)
