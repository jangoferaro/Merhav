"""Analytics — pulls yesterday's numbers, turns them into the KPIs the CEO
actually steers on: cost per 1k views, cost per follower, ROAS and payback."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Persona, Post, Result, Task


class AnalystAgent(Agent):
    name = "analytics"
    dept = "analytics"
    title = "Head of Analytics"
    handles = ("analytics.collect", "analytics.report")

    def handle(self, task: Task) -> Result:
        return self._collect() if task.type == "analytics.collect" else self._report()

    # -- collection ---------------------------------------------------------
    def _collect(self) -> Result:
        store, day = self.ctx.store, self.ctx.day
        posts = store.live_posts(Post, since_day=max(0, day - 7))
        totals = {"views": 0, "likes": 0, "comments": 0, "shares": 0, "follows": 0, "clicks": 0}
        for post in posts:
            provider = self.ctx.providers.platform(post.platform)
            if provider is None:
                continue
            m = provider.fetch_metrics(post.external_id)
            if not m:
                continue
            store.save_metrics(post.id, day, m)
            prev = store.query("SELECT * FROM metrics WHERE post_id=? AND day=?",
                               (post.id, day - 1))
            base = dict(prev[0]) if prev else {}
            for k in totals:
                totals[k] += max(0, m.get(k, 0) - int(base.get(k, 0) or 0))

        for p in store.personas(Persona):
            if not self.ctx.world:
                continue
            for platform in self.ctx.providers.social:
                f = self.ctx.world.follower_count(p.id, platform)
                if f:
                    store.save_audience(p.id, platform, day, f, self.ctx.world.sub_count(p.id))
        self.ctx.memory["today_delta"] = totals
        return Result(output=totals)

    # -- reporting ----------------------------------------------------------
    def _report(self) -> Result:
        store, day = self.ctx.store, self.ctx.day
        d = self.ctx.memory.get("today_delta", {})
        # The report runs at the top of the day, so the closed numbers it can
        # trust are yesterday's. Everything downstream (CEO, CFO) reads it that way.
        rev, cost = store.day_pnl(day - 1)
        views = max(0, d.get("views", 0))
        follows = max(0, d.get("follows", 0))
        kpi = {
            "day": day,
            "trailing": day - 1,
            "views": views,
            "follows": follows,
            "clicks": d.get("clicks", 0),
            "revenue": round(rev, 2),
            "cost": round(cost, 2),
            "roas": round(rev / cost, 3) if cost > 0 else 0.0,
            "cpm_cost": round(cost / views * 1000, 3) if views else 0.0,
            "cost_per_follower": round(cost / follows, 3) if follows else 0.0,
            "followers_total": sum(self.ctx.world.total_followers(p.id)
                                   for p in store.personas(Persona)) if self.ctx.world else 0,
            "subs_total": sum(self.ctx.world.sub_count(p.id)
                              for p in store.personas(Persona)) if self.ctx.world else 0,
        }
        self.ctx.memory["kpi"] = kpi
        store.set_meta(f"kpi_{day}", kpi)
        self.log(f"views {views:,} · follows {follows:,} · ROAS {kpi['roas']:.2f} · "
                 f"rev ${rev:.2f}", kpi, topic="analytics")
        return Result(output=kpi)
