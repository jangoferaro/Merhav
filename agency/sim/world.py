"""The market simulator.

Live mode reads real metrics from the platform APIs. Without those credentials
the company still needs an environment to learn against, so this module models
one: reach depends on the platform, the persona's follower base, content
quality and a hook/format multiplier; views convert to follows, follows to
funnel clicks, clicks to subscribers, and every cohort decays. Nothing here is
a forecast of any real platform — it is a feedback loop with the right shape,
so the strategy agents have something to actually optimise against.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from ..providers.social.mock import PROFILES


@dataclass
class PostState:
    external_id: str
    persona_id: str
    platform: str
    day: int
    quality: float
    tier: str
    variant: str
    base_reach: float
    viral: float
    age: int = 0
    boosted: float = 1.0
    cum: dict = field(default_factory=lambda: {"views": 0, "likes": 0, "comments": 0,
                                               "shares": 0, "follows": 0, "clicks": 0})


class World:
    """Audience state per persona, plus the decay curve of every live post."""

    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.posts: dict[str, PostState] = {}
        self.followers: dict[tuple[str, str], float] = {}   # (persona, platform) -> count
        self.subs: dict[str, float] = {}                    # persona -> paying subscribers
        self.day = 0
        self.pending: dict[str, list[dict]] = {}

    # -- publishing ---------------------------------------------------------
    def register_post(self, external_id: str, persona_id: str, platform: str, day: int,
                      quality: float, tier: str, variant: str, hook_strength: float) -> None:
        prof = PROFILES.get(platform, (False, 3, 0.5, 0.01, 0.01))
        followers = self.followers.get((persona_id, platform), 0.0)
        # Cold-start reach exists on discovery-first platforms even at zero followers.
        cold = {"tiktok": 900, "instagram": 260, "youtube": 220, "x": 90,
                "reddit": 400, "fanvue": 20, "patreon": 15}.get(platform, 120)
        base = (cold + followers * 0.35) * prof[2]
        viral = 1.0
        if self.rng.random() < 0.06 * quality * hook_strength:      # the occasional breakout
            viral = self.rng.uniform(4.0, 18.0)
        self.posts[external_id] = PostState(
            external_id, persona_id, platform, day, quality, tier, variant,
            base_reach=base * (0.55 + quality) * hook_strength, viral=viral)

    # -- daily tick ---------------------------------------------------------
    def tick(self, day: int) -> None:
        self.day = day
        for st in self.posts.values():
            if st.day > day:
                continue
            st.age = day - st.day
            if st.age > 6:
                continue
            decay = math.exp(-0.75 * st.age)
            noise = self.rng.uniform(0.75, 1.30)
            views = st.base_reach * st.viral * decay * noise
            prof = PROFILES.get(st.platform, (False, 3, 0.5, 0.01, 0.01))
            likes = views * 0.055 * (0.6 + st.quality)
            comments = views * 0.006 * (0.6 + st.quality)
            shares = views * 0.004 * (0.5 + st.quality)
            follows = views * prof[3] * (0.5 + st.quality)
            clicks = views * prof[4] * (0.5 + st.quality)
            for k, v in (("views", views), ("likes", likes), ("comments", comments),
                         ("shares", shares), ("follows", follows), ("clicks", clicks)):
                st.cum[k] += v
            key = (st.persona_id, st.platform)
            self.followers[key] = self.followers.get(key, 0.0) + follows
            self.pending.setdefault(st.external_id, [])

        # organic churn: audiences bleed if you stop feeding them
        for key in list(self.followers):
            self.followers[key] *= 0.998
        for pid in list(self.subs):
            self.subs[pid] *= 0.97

    # -- reads --------------------------------------------------------------
    def metrics_for(self, external_id: str) -> dict:
        st = self.posts.get(external_id)
        if not st:
            return {}
        return {k: int(v) for k, v in st.cum.items()}

    def daily_metrics(self, external_id: str) -> dict:
        return self.metrics_for(external_id)

    def interactions_for(self, external_id: str) -> list[dict]:
        st = self.posts.get(external_id)
        if not st:
            return []
        n = min(6, int(st.cum["comments"] / 40))
        return [{"id": f"{external_id}#c{i}", "text": ""} for i in range(n)]

    def boost(self, external_id: str, factor: float) -> None:
        """Extra reach bought with money or earned by working the comments.

        Capped: platforms do not sell unlimited distribution on one post, and
        a model without diminishing returns would let the agency buy its way to
        infinity.
        """
        st = self.posts.get(external_id)
        if not st:
            return
        applied = 1.0 + min(0.85, (factor - 1.0) ** 0.75 if factor > 1 else 0.0)
        st.base_reach *= applied
        st.boosted = round(st.boosted * applied, 4)

    def follower_count(self, persona_id: str, platform: str) -> int:
        return int(self.followers.get((persona_id, platform), 0))

    def total_followers(self, persona_id: str) -> int:
        return int(sum(v for (p, _), v in self.followers.items() if p == persona_id))

    # -- monetisation -------------------------------------------------------
    def convert_subscribers(self, persona_id: str, clicks: int, price: float,
                            trust: float) -> int:
        """Clicks -> paying subscribers. Higher price converts worse; a persona
        with a longer track record converts better."""
        if clicks <= 0:
            return 0
        base = 0.045 * trust * (9.99 / max(price, 1.0)) ** 0.6
        new = 0
        for _ in range(min(clicks, 4000)):
            if self.rng.random() < base:
                new += 1
        self.subs[persona_id] = self.subs.get(persona_id, 0.0) + new
        return new

    def sub_count(self, persona_id: str) -> int:
        return int(self.subs.get(persona_id, 0))
