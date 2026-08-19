"""Distribution — the only agent allowed to talk to a platform.

Enforces the routing rules a third time (defence in depth), respects each
platform's per-day cap, and records every live post so analytics can attribute
what happened to it.
"""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Asset, Content, Persona, Post, Result, Task, next_id


class PublisherAgent(Agent):
    name = "publisher"
    dept = "distribution"
    title = "Head of Distribution"
    handles = ("dist.publish",)

    def _asset(self, content: Content) -> dict:
        aid = content.video_id or content.asset_id
        rows = self.ctx.store.query("SELECT data FROM assets WHERE id=?", (aid,))
        if not rows:
            return {"uri": ""}
        import json as _json
        return _json.loads(rows[0]["data"])

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        media = self._asset(c)
        approved = c.review.get("compliance", {}).get("approved", [])
        counters = self.ctx.memory.setdefault("posted_today", {})
        published = []

        for platform in approved:
            provider = self.ctx.providers.platform(platform)
            if provider is None:
                continue
            tier = c.variants[platform].get("tier", "sfw")
            if tier == "adult" and not getattr(provider, "age_gated", False):
                self.log(f"refused: adult tier -> {platform}", level="warn", topic="compliance")
                continue
            key = (p.id, platform)
            if counters.get(str(key), 0) >= getattr(provider, "max_per_day", 3):
                continue

            bundle = c.variants[platform]
            if self.ctx.memory.get("dry_run"):
                self.log(f"DRY RUN would post to {platform}",
                         {"platform": platform, "provider": provider.name,
                          "media": media.get("uri"), "tier": tier,
                          "caption": bundle["caption"], "hashtags": bundle.get("hashtags", [])},
                         topic="distribution")
                published.append(platform + " (dry)")
                continue
            res = provider.publish(
                persona={"handle": p.handle, "name": p.name, "id": p.id},
                media=media, caption=bundle["caption"],
                meta={"content_id": c.id, "hashtags": bundle.get("hashtags", []),
                      "subreddit": self.ctx.config.get("distribution.subreddit", "test"),
                      "visibility": "subscribers" if tier == "adult" else "public"})
            if not res.get("ok"):
                self.log(f"publish failed on {platform}: {res.get('error')}",
                         res, level="error", topic="distribution")
                continue

            counters[str(key)] = counters.get(str(key), 0) + 1
            post = Post(id=next_id("post"), content_id=c.id, persona_id=p.id, platform=platform,
                        external_id=res["external_id"], day=self.ctx.day, tier=tier,
                        variant=c.variant)
            self.ctx.store.save_post(post)
            published.append(platform)
            if self.ctx.world:
                self.ctx.world.register_post(res["external_id"], p.id, platform, self.ctx.day,
                                             quality=p.quality, tier=tier, variant=c.variant,
                                             hook_strength=c.hook_strength)

        if self.ctx.memory.get("dry_run"):
            c.status = "dry_run"
        else:
            c.status = "published" if published else "unpublished"
        self.ctx.store.save_content(c)
        if published:
            self.log(f"@{p.handle} → {', '.join(published)} · {c.hook[:60]}",
                     {"platforms": published, "content": c.id}, topic="distribution")
        return Result(output={"published": published})
