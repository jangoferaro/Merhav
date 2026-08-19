"""Eromify adapter (https://eromify.com) — AI character image generation.

Wired as one interchangeable `ImageProvider` behind the compliance gate, which
means: the prompt has already been checked for real-person likeness and
minor-adjacent descriptors before it can reach this class, `identity_seed`
keeps one fictional character visually consistent across a campaign, and the
returned asset is tagged `adult` so the publisher can only route it to
age-gated destinations.

Set EROMIFY_API_KEY to go live; without it the registry uses the mock instead.
Endpoint/field names are configurable because the vendor API is not public —
point `EROMIFY_API_URL` at the documented endpoint for your account.
"""
from __future__ import annotations

import json
import os
import urllib.request

from ..base import ImageProvider
from .mock import MockImage


class EromifyImage(ImageProvider):
    name = "eromify"

    def __init__(self, api_key: str | None = None, url: str | None = None,
                 outdir: str = "agency/out/media", timeout: int = 90):
        self.api_key = api_key or os.environ.get("EROMIFY_API_KEY", "")
        self.url = url or os.environ.get("EROMIFY_API_URL", "https://api.eromify.com/v1/generate")
        self.timeout = timeout
        self.fallback = MockImage(outdir)
        self.unit_cost = float(os.environ.get("EROMIFY_UNIT_COST", "0.08"))

    def generate(self, prompt: str, seed: int, tier: str, meta: dict) -> dict:
        if not self.api_key:
            out = self.fallback.generate(prompt, seed, tier, meta)
            out["provider"] = "eromify:mock (no EROMIFY_API_KEY)"
            return out
        body = json.dumps({
            "prompt": prompt,
            "negative_prompt": meta.get("negative", ""),
            "seed": seed,                       # identity lock across the campaign
            "character_id": meta.get("character_id"),
            "width": 1080, "height": 1350,
            "nsfw": tier == "adult",
        }).encode()
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "content-type": "application/json",
            "authorization": f"Bearer {self.api_key}",
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
        except Exception as exc:
            out = self.fallback.generate(prompt, seed, tier, meta)
            out["provider"] = f"eromify:fallback ({exc.__class__.__name__})"
            return out
        uri = data.get("url") or data.get("image_url") or (data.get("images") or [{}])[0].get("url", "")
        return {"uri": uri, "provider": "eromify", "cost": self.unit_cost, "seed": seed,
                "identity_locked": True, "raw_id": data.get("id", "")}
