"""Offline social destination.

It accepts posts, hands back an external id and (via the simulated world)
returns metrics and interactions, so distribution, engagement and analytics can
be exercised without touching a real platform.
"""
from __future__ import annotations

from ..base import SocialProvider

# platform -> (age_gated, max posts/day, reach multiplier, follow rate, click rate)
PROFILES = {
    "tiktok":    (False, 4, 1.00, 0.012, 0.010),
    "instagram": (False, 3, 0.62, 0.010, 0.014),
    "youtube":   (False, 2, 0.55, 0.008, 0.016),
    "x":         (False, 5, 0.35, 0.006, 0.020),
    "reddit":    (False, 2, 0.40, 0.004, 0.030),
    "fanvue":    (True,  3, 0.10, 0.020, 0.090),
    "patreon":   (True,  2, 0.08, 0.018, 0.080),
}


class MockSocial(SocialProvider):
    name = "mock"

    def __init__(self, platform: str, world=None):
        self.platform = platform
        gated, cap, reach, follow, click = PROFILES.get(platform, (False, 3, 0.5, 0.01, 0.01))
        self.age_gated = gated
        self.max_per_day = cap
        self.reach = reach
        self.follow_rate = follow
        self.click_rate = click
        self.world = world

    def publish(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:
        eid = f"{self.platform}:{persona.get('handle','x')}:{meta.get('content_id','0')}"
        return {"ok": True, "external_id": eid, "url": f"https://{self.platform}.example/{eid}",
                "provider": "mock"}

    def fetch_metrics(self, external_id: str) -> dict:
        return self.world.metrics_for(external_id) if self.world else {}

    def fetch_interactions(self, external_id: str) -> list[dict]:
        return self.world.interactions_for(external_id) if self.world else []
