"""Generic OpenAI-/Replicate-style image endpoint, for SFW niches."""
from __future__ import annotations

import json
import os
import urllib.request

from ..base import ImageProvider
from .mock import MockImage


class GenericHTTPImage(ImageProvider):
    name = "generic_http"

    def __init__(self, outdir: str = "agency/out/media"):
        self.url = os.environ.get("IMAGE_API_URL", "")
        self.key = os.environ.get("IMAGE_API_KEY", "")
        self.model = os.environ.get("IMAGE_API_MODEL", "flux-1.1-pro")
        self.unit_cost = float(os.environ.get("IMAGE_UNIT_COST", "0.04"))
        self.fallback = MockImage(outdir)

    def generate(self, prompt: str, seed: int, tier: str, meta: dict) -> dict:
        if not (self.url and self.key):
            out = self.fallback.generate(prompt, seed, tier, meta)
            out["provider"] = "generic_http:mock"
            return out
        body = json.dumps({"model": self.model, "prompt": prompt, "seed": seed,
                           "size": "1080x1350"}).encode()
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "content-type": "application/json", "authorization": f"Bearer {self.key}"})
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode())
            uri = (data.get("data") or [{}])[0].get("url", "") or data.get("output", "")
        except Exception:
            return self.fallback.generate(prompt, seed, tier, meta)
        return {"uri": uri, "provider": self.model, "cost": self.unit_cost, "seed": seed,
                "identity_locked": True}
