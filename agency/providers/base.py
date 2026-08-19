"""Provider interfaces + the registry that wires live/mock implementations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


class LLMProvider:
    name = "llm"
    last_cost = 0.0

    def complete(self, system: str, prompt: str, schema: Optional[dict],
                 purpose: str, rng) -> Any:  # pragma: no cover - interface
        raise NotImplementedError


class ImageProvider:
    name = "image"

    def generate(self, prompt: str, seed: int, tier: str, meta: dict) -> dict:  # pragma: no cover
        raise NotImplementedError


class VideoProvider:
    name = "video"

    def assemble(self, frames: list[str], script: dict, meta: dict) -> dict:  # pragma: no cover
        raise NotImplementedError


class VoiceProvider:
    name = "voice"

    def speak(self, text: str, voice_id: str) -> dict:  # pragma: no cover
        raise NotImplementedError


class SocialProvider:
    """One social destination. `age_gated` decides whether adult-tier material
    may ever be routed here."""
    name = "social"
    platform = "generic"
    age_gated = False
    max_per_day = 3

    def publish(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    def fetch_metrics(self, external_id: str) -> dict:
        return {}

    def fetch_interactions(self, external_id: str) -> list[dict]:
        return []

    def reply(self, external_id: str, comment_id: str, text: str) -> dict:
        return {"ok": True}


@dataclass
class Providers:
    llm: Any
    image: Any
    video: Any
    voice: Any
    social: dict[str, Any]
    payments: Any

    def platform(self, name: str):
        return self.social.get(name)

    def age_gated_platforms(self) -> set[str]:
        return {k for k, v in self.social.items() if getattr(v, "age_gated", False)}
