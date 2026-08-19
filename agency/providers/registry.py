"""Builds the provider set from config + environment.

One rule: a live provider is only selected when its credential is actually
present. Everything else degrades to the deterministic mock, which is why
`run --days 30` works on a clean checkout and why the tests are hermetic.
"""
from __future__ import annotations

import os

from .base import Providers
from .image.eromify import EromifyImage
from .image.generic_http import GenericHTTPImage
from .image.mock import MockImage
from .llm.anthropic import AnthropicLLM
from .llm.mock import MockLLM
from .payments.mock import MockPayments, StripePayments
from .social import live as social_live
from .video.ffmpeg import FFmpegVideo
from .video.mock import MockVideo
from .voice.elevenlabs import ElevenLabsVoice
from .voice.mock import MockVoice


def build(config, world=None) -> Providers:
    outdir = config.get("paths.media", "agency/out/media")

    llm_name = config.provider("llm")
    llm = AnthropicLLM(model=config.get("providers.llm_model", "claude-sonnet-5")) \
        if llm_name == "anthropic" else MockLLM()

    img_name = config.provider("image")
    image = {"eromify": lambda: EromifyImage(outdir=outdir),
             "http": lambda: GenericHTTPImage(outdir=outdir),
             "mock": lambda: MockImage(outdir)}.get(img_name, lambda: MockImage(outdir))()

    vid_name = config.provider("video")
    video = FFmpegVideo(outdir) if vid_name == "ffmpeg" else MockVideo(outdir)

    voice_name = config.provider("voice")
    voice = ElevenLabsVoice(outdir) if voice_name == "elevenlabs" else MockVoice(outdir)

    social_mode = config.provider("social")
    platforms = config.get("distribution.platforms", social_live.ALL_PLATFORMS)
    social = {p: social_live.build(p, world, social_mode) for p in platforms}

    payments = StripePayments() if os.environ.get("STRIPE_API_KEY") else MockPayments()
    return Providers(llm=llm, image=image, video=video, voice=voice,
                     social=social, payments=payments)


def describe(providers: Providers) -> dict:
    return {"llm": providers.llm.name, "image": providers.image.name,
            "video": providers.video.name, "voice": providers.voice.name,
            "payments": providers.payments.name,
            "social": {k: v.name for k, v in providers.social.items()}}
