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
    """Audience state per persona, plus the decay curve of every live post.

    Growth is logistic, not exponential: every account has an addressable
    ceiling on each platform, reach from an existing following has diminishing
    returns, and follows slow down as the account approaches its ceiling. An
    uncapped model compounds into numbers that are not merely optimistic but
    meaningless, and those numbers would be steering real spending decisions.
    """

    def __init__(self, seed: int, audience_cap: float = 120_000.0,
                 cold_start: dict | None = None, follow_rate: dict | None = None,
                 click_rate: dict | None = None, luck_sigma: float = 0.65,
                 viral_chance: float = 0.04):
        self.rng = random.Random(seed)
        self.cap = float(audience_cap)
        self.cold_start = cold_start or {}
        self.follow_rate = follow_rate or {}
        self.click_rate = click_rate or {}
        self.luck_sigma = float(luck_sigma)
        self.viral_chance = float(viral_chance)
        self.posts: dict[str, PostState] = {}
        self.followers: dict[tuple[str, str], float] = {}   # (persona, platform) -> count
        self.subs: dict[str, float] = {}                    # persona -> paying subscribers
        self.day = 0
        self.pending: dict[str, list[dict]] = {}

    @classmethod
    def from_config(cls, config) -> "World":
        """Every assumption comes from [simulation] in company.toml, so the
        numbers on the dashboard can be traced to a line an operator can edit."""
        return cls(seed=config.seed,
                   audience_cap=float(config.get("simulation.audience_cap", 120_000.0)),
                   cold_start=config.get("simulation.cold_start", {}) or {},
                   follow_rate=config.get("simulation.follow_rate", {}) or {},
                   click_rate=config.get("simulation.click_rate", {}) or {},
                   luck_sigma=float(config.get("simulation.luck_sigma", 0.65)),
                   viral_chance=float(config.get("simulation.viral_chance", 0.04)))

    # -- publishing ---------------------------------------------------------
    def register_post(self, external_id: str, persona_id: str, platform: str, day: int,
                      quality: float, tier: str, variant: str, hook_strength: float) -> None:
        prof = PROFILES.get(platform, (False, 3, 0.5, 0.01, 0.01))
        followers = self.followers.get((persona_id, platform), 0.0)
        # Cold-start reach exists on discovery-first platforms even at zero followers.
        cold = float(self.cold_start.get(platform, 120))
        # Reach from an existing audience has diminishing returns: a following
        # ten times larger does not get ten times the impressions.
        earned = (followers ** 0.82) * 1.6 if followers > 0 else 0.0
        base = (cold + earned) * prof[2]
        viral = 1.0
        if self.rng.random() < self.viral_chance * quality * hook_strength:   # rare breakout
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
            # The per-post lottery is log-normal, not uniform: the median post
            # underperforms the mean and a few carry everything.
            luck = math.exp(self.rng.gauss(0.0, self.luck_sigma))
            views = st.base_reach * st.viral * decay * luck
            prof = PROFILES.get(st.platform, (False, 3, 0.5, 0.01, 0.01))
            likes = views * 0.055 * (0.6 + st.quality)
            comments = views * 0.006 * (0.6 + st.quality)
            shares = views * 0.004 * (0.5 + st.quality)
            # Logistic damping: the closer to the ceiling, the harder every
            # additional follower is to win.
            reached = self.followers.get((st.persona_id, st.platform), 0.0)
            headroom = max(0.02, 1.0 - reached / self.cap)
            follows = (views * float(self.follow_rate.get(st.platform, prof[3]))
                       * (0.5 + st.quality) * headroom)
            clicks = views * float(self.click_rate.get(st.platform, prof[4])) * (0.5 + st.quality)
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
        # Subscription conversion also saturates: the people most likely to pay
        # convert early, and the pool of remaining willing buyers thins out.
        already = self.subs.get(persona_id, 0.0)
        audience = max(1.0, self.total_followers(persona_id))
        thinning = max(0.15, 1.0 - (already / (audience * 0.05 + 1.0)))
        base = 0.045 * trust * (9.99 / max(price, 1.0)) ** 0.6 * thinning
        new = 0
        for _ in range(min(clicks, 4000)):
            if self.rng.random() < base:
                new += 1
        self.subs[persona_id] = self.subs.get(persona_id, 0.0) + new
        return new

    def sub_count(self, persona_id: str) -> int:
        return int(self.subs.get(persona_id, 0))
