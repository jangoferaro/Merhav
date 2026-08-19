"""Growth: continuous A/B testing, and the community manager who works the
comment section (which is where most of the follow-through actually comes from).
"""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Persona, Post, Result, Task, next_id, stable_hash

DIMENSIONS = [("hook", ["question-hook", "result-first"]),
              ("fmt", ["video", "image"]),
              ("hour", ["morning", "evening"])]
WINDOW = 3       # days before an experiment is called


class GrowthAgent(Agent):
    name = "growth"
    dept = "growth"
    title = "Growth Lead"
    handles = ("growth.experiment", "growth.amplify")

    def handle(self, task: Task) -> Result:
        if task.type == "growth.amplify":
            return self._amplify()
        store, day = self.ctx.store, self.ctx.day
        playbook = self.ctx.memory.setdefault("playbook", {})
        started, called = 0, 0

        for p in store.personas(Persona, status="active"):
            running = self.ctx.memory.setdefault("experiments", {}).get(p.id)
            if running and day - running["day"] >= WINDOW:
                winner = self._evaluate(p, running)
                called += 1
                if winner:
                    book = playbook.setdefault(p.id, {})
                    book[running["dimension"]] = winner["value"]
                    book["hook_strength"] = round(min(1.6, book.get("hook_strength", 1.0) + 0.06), 3)
                    p.quality = round(min(0.95, p.quality + 0.02), 3)
                    store.save_persona(p)
                    self.decide("experiment_won",
                                f"@{p.handle}: '{running['dimension']}' → {winner['value']} "
                                f"({winner['views']:.0f} avg views vs {winner['loser_views']:.0f}).",
                                winner)
                self.ctx.memory["experiments"].pop(p.id, None)
                running = None

            if not running:
                dim, values = DIMENSIONS[(day + stable_hash(p.id)) % len(DIMENSIONS)]
                exp = {"id": next_id("exp"), "day": day, "persona_id": p.id,
                       "dimension": dim, "values": values, "status": "running"}
                self.ctx.memory.setdefault("experiments", {})[p.id] = exp
                store.save_experiment(exp)
                started += 1

        return Result(output={"started": started, "called": called})

    # -- paid amplification -------------------------------------------------
    def _amplify(self) -> Result:
        """Put money behind what already works.

        This is the lever that makes the daily budget mean something: organic
        production is nearly free, so the real capital-allocation question is
        which proven post to buy reach for. Winners get topped up, unproven
        personas get a small seeding spend, and everything is booked against
        the persona so the CEO sees the true return.
        """
        store, day, world = self.ctx.store, self.ctx.day, self.ctx.world
        if world is None:
            return Result(output={"skipped": "live_mode"})
        budget = float(self.ctx.memory.get("amplify_budget",
                                           self.ctx.config.get("growth.daily_boost", 8.0)))
        step = float(self.ctx.config.get("growth.boost_step", 2.0))
        per_dollar = float(self.ctx.config.get("growth.reach_per_dollar", 0.09))
        spent, boosted = 0.0, []

        probation = int(self.ctx.config.get("portfolio.probation_days", 14))
        personas = [p for p in store.personas(Persona, status="active")
                    if day - p.created_day >= probation]
        if not personas:
            return Result(output={"skipped": "everyone_on_probation"})
        ranked = sorted(personas, key=lambda p: store.persona_revenue(p.id, max(0, day - 7)),
                        reverse=True)
        for p in ranked:
            rows = store.query(
                "SELECT p.id, p.data AS pdata, m.views AS views FROM posts p JOIN metrics m "
                "ON m.post_id=p.id AND m.day=? WHERE p.persona_id=? AND p.day>=? "
                "ORDER BY m.views DESC LIMIT 1", (day, p.id, max(0, day - 2)))
            if not rows:
                continue
            import json as _json
            post = _json.loads(rows[0]["pdata"])
            fair_share = budget / max(1, len(ranked))
            amount = round(min(max(step, fair_share), budget * 0.4, budget - spent), 2)
            if amount < 0.5:
                break
            if not self.spend("paid_boost", amount, p.id):
                break
            world.boost(post["external_id"], 1.0 + per_dollar * amount)
            spent += amount
            boosted.append((p.handle, post["platform"], amount))
            self.decide("paid_boost",
                        f"@{p.handle}: ${amount:.2f} behind the top {post['platform']} post "
                        f"({rows[0]['views']:,} views) — proven creative, not a new bet.",
                        {"persona": p.id, "post": post["id"], "amount": amount})
        if boosted:
            self.log(f"amplified {len(boosted)} posts for ${spent:.2f}",
                     {"boosted": boosted}, topic="growth")
        return Result(output={"spent": round(spent, 2), "boosted": len(boosted)})

    def _evaluate(self, persona, exp) -> dict | None:
        rows = self.ctx.store.query(
            "SELECT p.data AS pdata, m.views AS views FROM posts p JOIN metrics m "
            "ON m.post_id = p.id WHERE p.persona_id=? AND p.day>=?",
            (persona.id, exp["day"]))
        import json as _json
        buckets: dict[str, list[int]] = {}
        for r in rows:
            variant = _json.loads(r["pdata"]).get("variant", "A")
            buckets.setdefault(variant, []).append(r["views"])
        if len(buckets) < 2:
            return None
        ranked = sorted(((sum(v) / len(v), k) for k, v in buckets.items()), reverse=True)
        (best, bk), (worst, _) = ranked[0], ranked[-1]
        if best <= worst * 1.05:
            return None
        idx = 0 if bk == "A" else 1
        return {"dimension": exp["dimension"], "value": exp["values"][idx % len(exp["values"])],
                "views": best, "loser_views": worst, "variant": bk}


class CommunityAgent(Agent):
    name = "community"
    dept = "growth"
    title = "Community Manager"
    handles = ("community.engage",)

    def handle(self, task: Task) -> Result:
        store, day = self.ctx.store, self.ctx.day
        replies = 0
        for post in store.live_posts(Post, since_day=max(0, day - 2)):
            provider = self.ctx.providers.platform(post.platform)
            if provider is None:
                continue
            interactions = provider.fetch_interactions(post.external_id)
            if not interactions:
                continue
            p = store.persona(Persona, post.persona_id)
            sample = interactions[:4]
            fake = self.llm("interactions", f'{{"n": {len(sample)}}}')
            for i, item in enumerate(sample):
                text = item.get("text") or fake["comments"][i]["text"]
                out = self.llm("reply", "Reply in the persona's voice.\n"
                               f'{{"comment": "{text}", "voice": "{p.voice}"}}',
                               {"reply": "str"})
                provider.reply(post.external_id, item["id"], out["reply"])
                replies += 1
            if self.ctx.world and sample:
                # answered comments get pushed harder by every ranking system
                self.ctx.world.boost(post.external_id, 1.0 + 0.02 * len(sample))
        if replies:
            self.spend("community_ops", self.ctx.config.price("reply") * replies)
            self.log(f"{replies} replies sent", {"replies": replies}, topic="growth")
        return Result(output={"replies": replies})
