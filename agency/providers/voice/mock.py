from __future__ import annotations

import hashlib
import os

from ..base import VoiceProvider


class MockVoice(VoiceProvider):
    name = "mock"

    def __init__(self, outdir: str = "agency/out/media"):
        self.outdir = outdir

    def speak(self, text: str, voice_id: str) -> dict:
        os.makedirs(self.outdir, exist_ok=True)
        h = hashlib.sha1(f"{voice_id}{text}".encode()).hexdigest()[:10]
        path = os.path.join(self.outdir, f"vo_{voice_id}_{h}.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return {"uri": path, "provider": "mock", "cost": 0.0,
                "seconds": max(6, len(text.split()) / 2.6)}
