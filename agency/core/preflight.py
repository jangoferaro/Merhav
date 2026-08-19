"""Go-live preflight.

Answers one question: what is still standing between this company and a real
dollar? Every item is either satisfied by an environment variable this process
can see, or it is something only a human with an identity can do — and the
check says which, because that distinction is the whole plan.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Check:
    key: str
    label: str
    blocking: bool
    ready: bool
    detail: str = ""
    how: str = ""
    human_only: bool = False


@dataclass
class Preflight:
    checks: list[Check] = field(default_factory=list)

    @property
    def blocking_gaps(self) -> list[Check]:
        return [c for c in self.checks if c.blocking and not c.ready]

    @property
    def ready(self) -> bool:
        return not self.blocking_gaps

    def score(self) -> tuple[int, int]:
        blocking = [c for c in self.checks if c.blocking]
        return sum(1 for c in blocking if c.ready), len(blocking)


def _env(key: str) -> bool:
    return bool(os.environ.get(key, "").strip())


def accounts(config, providers, personas) -> dict:
    """Which personas hold real publishing credentials, and the exact variable
    each one is missing. Answered from the environment rather than from the
    active providers, so it tells the truth even while the company is still
    running against mocks.
    """
    from ..providers.social.live import LIVE, slug

    out = {"ready": [], "missing": {}}
    platforms = [p for p in config.platforms("sfw") + config.platforms("funnel") if p in LIVE]
    for p in personas:
        live_on, needs = [], []
        for platform in platforms:
            key = LIVE[platform].env_key
            if _env(f"{key}__{slug(p.handle)}") or _env(key):
                live_on.append(platform)
            else:
                needs.append(f"{key}__{slug(p.handle)}")
        if live_on:
            out["ready"].append((p.handle, live_on))
        else:
            out["missing"][p.handle] = needs
    return out


def run(config, providers, policy) -> Preflight:
    from ..report.redteam import run as redteam

    gate = redteam(tuple(sorted(providers.age_gated_platforms())))
    gate_ok = all(g["pass"] for g in gate)

    social_platforms = config.platforms("sfw")
    tokens = {"tiktok": "TIKTOK_ACCESS_TOKEN", "instagram": "IG_ACCESS_TOKEN",
              "youtube": "YOUTUBE_ACCESS_TOKEN", "x": "X_BEARER_TOKEN",
              "reddit": "REDDIT_ACCESS_TOKEN", "fanvue": "FANVUE_API_KEY"}
    live_platforms = [p for p in social_platforms if _env(tokens.get(p, ""))]

    checks = [
        Check("compliance", "compliance gate passes its red-team set", True, gate_ok,
              f"{sum(1 for g in gate if g['pass'])}/{len(gate)} cases",
              "python3 -m agency audit"),
        Check("image", "image generation can render a real frame", True,
              _env("EROMIFY_API_KEY") or _env("IMAGE_API_KEY"),
              "eromify or any OpenAI-style endpoint",
              "set EROMIFY_API_KEY (eromify.com account) or IMAGE_API_KEY, then "
              "providers.image in config/company.toml"),
        Check("llm", "content is written by a real model, not the offline generator", False,
              _env("ANTHROPIC_API_KEY"), "captions, scripts, comment replies",
              "set ANTHROPIC_API_KEY and providers.llm = \"anthropic\""),
        Check("voice", "voiceover for video slots", False, _env("ELEVENLABS_API_KEY"),
              "optional — image slots need no voice", "set ELEVENLABS_API_KEY"),
        Check("distribution", "at least one platform can actually receive a post", True,
              bool(live_platforms),
              f"live: {', '.join(live_platforms) or 'none'}",
              "create the account, then get a publishing token; start with one platform",
              human_only=True),
        Check("social_mode", "config is switched to live publishing", True,
              config.provider("social") == "live",
              f"providers.social = \"{config.provider('social')}\"",
              "set providers.social = \"live\" in agency/config/company.toml"),
        Check("payments", "a processor that can receive money", True,
              _env("STRIPE_API_KEY") or _env("FANVUE_API_KEY"),
              "Stripe (own checkout) or Fanvue (hosted subscriptions)",
              "Stripe account + KYC (bank account, ID) — 1-2 days to approve",
              human_only=True),
        Check("funnel", "somewhere for a click to convert", True,
              _env("FUNNEL_URL"), os.environ.get("FUNNEL_URL", "no link-in-bio target set"),
              "set FUNNEL_URL to the page the CTA sends people to",
              human_only=True),
        Check("affiliate", "fastest first dollar: an affiliate program to point at", False,
              _env("AFFILIATE_URL"), os.environ.get("AFFILIATE_URL", "none"),
              "join a program in the persona's niche, put the link behind FUNNEL_URL",
              human_only=True),
    ]
    return Preflight(checks=checks)
