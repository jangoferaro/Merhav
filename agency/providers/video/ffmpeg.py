"""Renders the shot list to a real vertical mp4 with ffmpeg when it exists."""
from __future__ import annotations

import os
import shutil
import subprocess

from ..base import VideoProvider
from .mock import MockVideo


class FFmpegVideo(VideoProvider):
    name = "ffmpeg"

    def __init__(self, outdir: str = "agency/out/media"):
        self.outdir = outdir
        self.fallback = MockVideo(outdir)

    def assemble(self, frames: list[str], script: dict, meta: dict) -> dict:
        exe = shutil.which("ffmpeg")
        usable = [f for f in frames if f and os.path.exists(f) and not f.endswith(".svg")]
        if not exe or not usable:
            out = self.fallback.assemble(frames, script, meta)
            out["provider"] = "ffmpeg:fallback" + ("" if exe else " (ffmpeg missing)")
            return out
        os.makedirs(self.outdir, exist_ok=True)
        stem = f"{meta.get('persona_handle','persona')}_{meta.get('content_id','x')}"
        path = os.path.join(self.outdir, f"{stem}.mp4")
        per = max(2, int(script.get("duration", 25) / max(1, len(usable))))
        listfile = os.path.join(self.outdir, f"{stem}.txt")
        with open(listfile, "w", encoding="utf-8") as fh:
            for f in usable:
                fh.write(f"file '{os.path.abspath(f)}'\nduration {per}\n")
            fh.write(f"file '{os.path.abspath(usable[-1])}'\n")
        cmd = [exe, "-y", "-f", "concat", "-safe", "0", "-i", listfile,
               "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
               "-pix_fmt", "yuv420p", "-r", "30", path]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=180)
        except Exception:
            return self.fallback.assemble(frames, script, meta)
        return {"uri": path, "provider": "ffmpeg", "cost": 0.0,
                "duration": script.get("duration", 25)}
