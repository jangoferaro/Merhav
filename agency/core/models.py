"""Core data structures shared by every department of the agency."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

def stable_hash(*parts: Any) -> int:
    """Process-independent hash. Python's built-in hash() is salted per process,
    which would make "same seed, same run" false across machines and restarts."""
    blob = "|".join(str(p) for p in parts).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(blob, digest_size=8).digest(), "big")


# Ids are handed out from a counter that is restored from the database at
# startup, so a resumed run never re-issues an id and two runs of the same seed
# produce identical ids.
_counter = 0


def next_id(prefix: str) -> str:
    global _counter
    _counter += 1
    return f"{prefix}_{_counter:06d}"


def set_counter(value: int) -> None:
    global _counter
    _counter = int(value)


def get_counter() -> int:
    return _counter


# --------------------------------------------------------------------------
# Work items
# --------------------------------------------------------------------------

@dataclass(order=False)
class Task:
    """A unit of work routed by the orchestrator to whichever agent handles it.

    `stage` doubles as the priority: the day's pipeline is ordered by stage, so
    an agent can emit follow-up work for a later stage of the same day (or for
    tomorrow, by emitting with a bigger `day`).
    """
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    stage: int = 50
    day: int = 0
    origin: str = "system"
    id: str = field(default_factory=lambda: next_id("task"))

    def child(self, type: str, payload: dict[str, Any], stage: int) -> "Task":
        return Task(type=type, payload=payload, stage=stage, day=self.day, origin=self.type)


@dataclass
class Result:
    """What an agent hands back: some output data plus follow-up tasks."""
    output: dict[str, Any] = field(default_factory=dict)
    emit: list[Task] = field(default_factory=list)
    cost: float = 0.0
    note: str = ""


# --------------------------------------------------------------------------
# Business objects
# --------------------------------------------------------------------------

@dataclass
class Niche:
    id: str
    name: str
    demand: float          # 0..1  audience size / search volume
    cpm: float             # $ per 1000 views, brand/ad value
    competition: float     # 0..1  higher = harder
    monetization: float    # 0..1  willingness to pay for a subscription
    risk: float            # 0..1  platform/compliance risk
    tier: str              # "sfw" | "adult"
    score: float = 0.0
    status: str = "candidate"
    opened_day: int = 0

    def rank(self) -> float:
        """Expected-value score used by the CEO to allocate budget."""
        upside = (self.demand * 0.30) + (self.monetization * 0.40) + (min(self.cpm, 30) / 30 * 0.15)
        drag = (self.competition * 0.10) + (self.risk * 0.05)
        return round(max(0.0, upside - drag), 4)


@dataclass
class Persona:
    id: str
    niche_id: str
    name: str
    handle: str
    archetype: str
    tier: str                       # sfw | adult
    seed: int                       # locks the visual identity across renders
    look: str                       # canonical appearance sentence, reused verbatim
    bio: str
    voice: str                      # tone of voice for captions/DMs
    pillars: list[str]
    price: float = 9.99             # subscription price, tuned by monetization
    status: str = "active"
    created_day: int = 0
    quality: float = 0.5            # learned content quality, moves with results
    budget: float = 0.0
    slots: int = 2                  # posts produced per day, scaled by the CEO
    voice_id: str = "v-default"
    age: int = 25
    origin: str = "built"           # built | bought
    acquired_price: float = 0.0     # what the holding company paid for it
    acquired_day: int = 0
    inherited_profit: float = 0.0   # monthly profit it was producing at purchase


@dataclass
class Content:
    id: str
    persona_id: str
    day: int
    pillar: str
    fmt: str                        # image | video
    hook: str
    script: str
    caption: str
    hashtags: list[str]
    cta: str
    asset_id: Optional[str] = None
    video_id: Optional[str] = None
    status: str = "draft"
    variant: str = "A"
    hook_strength: float = 1.0
    variants: dict[str, Any] = field(default_factory=dict)   # per-platform caption bundles
    review: dict[str, Any] = field(default_factory=dict)


@dataclass
class Asset:
    id: str
    persona_id: str
    kind: str                       # image | video | voice
    provider: str
    prompt: str
    uri: str
    cost: float
    day: int
    tier: str = "sfw"
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Post:
    id: str
    content_id: str
    persona_id: str
    platform: str
    external_id: str
    day: int
    tier: str
    status: str = "live"
    variant: str = "A"


def to_json(obj: Any) -> str:
    if hasattr(obj, "__dataclass_fields__"):
        obj = asdict(obj)
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)
