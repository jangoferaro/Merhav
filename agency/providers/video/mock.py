"""Offline video assembly: writes a manifest describing the cut. When ffmpeg is
available the FFmpegVideo provider renders the same manifest to a real mp4."""
from __future__ import annotations

import json
import os

from ..base import VideoProvider


class MockVideo(VideoProvider):
    name = "mock"

    def __init__(self, outdir: str = "agency/out/media"):
        self.outdir = outdir

    def assemble(self, frames: list[str], script: dict, meta: dict) -> dict:
        os.makedirs(self.outdir, exist_ok=True)
        stem = f"{meta.get('persona_handle','persona')}_{meta.get('content_id','x')}"
        path = os.path.join(self.outdir, f"{stem}.video.json")
        manifest = {"frames": frames, "beats": script.get("beats", []),
                    "duration": script.get("duration", 25), "aspect": "9:16",
                    "captions": True, "voiceover": meta.get("voice_uri"),
                    "music": meta.get("music", "trending-neutral-01")}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
        return {"uri": path, "provider": "mock", "cost": 0.0, "duration": manifest["duration"]}
