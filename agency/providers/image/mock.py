"""Offline image provider: writes a deterministic SVG placeholder to disk so the
pipeline has a real file to move around, with the identity seed baked in."""
from __future__ import annotations

import hashlib
import os

from ..base import ImageProvider

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="{c1}"/><stop offset="100%" stop-color="{c2}"/>
  </linearGradient></defs>
  <rect width="1080" height="1350" fill="url(#g)"/>
  <text x="60" y="1180" font-family="sans-serif" font-size="34" fill="#fff">{name}</text>
  <text x="60" y="1230" font-family="sans-serif" font-size="22" fill="#ffffffcc">seed {seed} · {tier}</text>
  <text x="60" y="1272" font-family="sans-serif" font-size="18" fill="#ffffff99">{short}</text>
  <text x="60" y="1312" font-family="sans-serif" font-size="16" fill="#ffffff88">AI-generated character</text>
</svg>"""


class MockImage(ImageProvider):
    name = "mock"

    def __init__(self, outdir: str = "agency/out/media"):
        self.outdir = outdir

    def generate(self, prompt: str, seed: int, tier: str, meta: dict) -> dict:
        os.makedirs(self.outdir, exist_ok=True)
        h = hashlib.sha1(f"{prompt}{seed}".encode()).hexdigest()
        c1 = "#" + h[0:6]
        c2 = "#" + h[6:12]
        path = os.path.join(self.outdir, f"{meta.get('persona_handle','persona')}_{h[:10]}.svg")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(TEMPLATE.format(c1=c1, c2=c2, name=meta.get("persona_name", "persona"),
                                     seed=seed, tier=tier, short=prompt[:70].replace("&", "and")))
        return {"uri": path, "provider": "mock", "cost": 0.0, "seed": seed,
                "identity_locked": True}
