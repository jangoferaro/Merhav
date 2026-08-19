"""ElevenLabs TTS. Each persona keeps one fixed voice_id so the voice stays
consistent the way the face does."""
from __future__ import annotations

import json
import os
import urllib.request

from ..base import VoiceProvider
from .mock import MockVoice


class ElevenLabsVoice(VoiceProvider):
    name = "elevenlabs"

    def __init__(self, outdir: str = "agency/out/media"):
        self.key = os.environ.get("ELEVENLABS_API_KEY", "")
        self.outdir = outdir
        self.fallback = MockVoice(outdir)
        self.unit_cost = float(os.environ.get("VOICE_UNIT_COST", "0.02"))

    def speak(self, text: str, voice_id: str) -> dict:
        if not self.key:
            return self.fallback.speak(text, voice_id)
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        req = urllib.request.Request(url, method="POST", data=json.dumps(
            {"text": text, "model_id": "eleven_multilingual_v2"}).encode(), headers={
            "content-type": "application/json", "xi-api-key": self.key})
        os.makedirs(self.outdir, exist_ok=True)
        import hashlib
        stamp = hashlib.sha1(text.encode()).hexdigest()[:10]
        path = os.path.join(self.outdir, f"vo_{voice_id}_{stamp}.mp3")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp, open(path, "wb") as fh:
                fh.write(resp.read())
        except Exception:
            return self.fallback.speak(text, voice_id)
        return {"uri": path, "provider": "elevenlabs", "cost": self.unit_cost,
                "seconds": max(6, len(text.split()) / 2.6)}
