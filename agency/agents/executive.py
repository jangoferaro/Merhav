"""Executive floor: the CEO allocates capital and headcount, the CFO controls
the purse and closes the books every night."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Niche, Persona, Result, Task

PAYBACK_DAYS = 14        # a persona gets two weeks to earn back what it costs
KILL_RATIO = 0.55        # below this revenue/cost ratio after the grace period -> pause
SCALE_RATIO = 1.35       # above this -> give it another posting slot
NEW_PERSONA_CASH = 350.0
MAX_SLOTS = 5


class CEOAgent(Agent):
    """Runs the company as a portfolio, not as one bet.

    Phase 1 — launch a fleet: one persona per niche, all on the same minimal
    spend. Nobody gets extra until the market has voted.
    Phase 2 — probation: equal footing for `probation_days`. No scaling, no
    paid amplification, no favourites.
    Phase 3 — cull: rank the cohort on *leading* signals (views per post,
    follow rate, click rate), because revenue is still zero for everyone at
    that age and would rank nothing. Keep the top `keep_top`, pause the rest.
    Phase 4 — concentrate: survivors get the slots, the budget and the paid
    boosts. Freed seats are refilled with a new wave, so the company keeps
    taking shots instead of defending its winners.
    """
    name = "ceo"
    dept = "executive"
    title = "CEO"
    handles = ("exec.review",)

    # -- portfolio settings -------------------------------------------------
    def _cfg(self, key, default):
        return self.ctx.config.get(f"portfolio.{key}", default)

    # -- leading indicators, used while revenue is still zero ---------------
    def _signal(self, persona) -> dict:
        rows = self.ctx.store.query(
            "SELECT COALESCE(SUM(v),0) v, COALESCE(SUM(f),0) f, COALESCE(SUM(c),0) c, "
            "COUNT(*) posts FROM (SELECT m.post_id, MAX(m.day) d, m.views v, m.follows f, "
            "m.clicks c FROM metrics m JOIN posts p ON p.id=m.post_id WHERE p.persona_id=? "
            "GROUP BY m.post_id)", (persona.id,))
        r = rows[0] if rows else {"v": 0, "f": 0, "c": 0, "posts": 0}
        views, posts = float(r["v"]), max(1, int(r["posts"]))
        return {"views": views, "posts": posts,
                "views_per_post": views / posts,
                "follow_rate": (float(r["f"]) / views) if views else 0.0,
                "click_rate": (float(r["c"]) / views) if views else 0.0,
                "revenue": self.ctx.store.persona_revenue(persona.id)}

    def _rank_cohort(self, personas) -> list[tuple]:
        signals = {p.id: self._signal(p) for p in personas}
        def top(key):
            return max((s[key] for s in signals.values()), default=0.0) or 1.0
        peaks = {k: top(k) for k in ("views_per_post", "follow_rate", "click_rate")}
        scored = []
        for p in personas:
            s = signals[p.id]
            score = (0.50 * s["views_per_post"] / peaks["views_per_post"]
                     + 0.30 * s["follow_rate"] / peaks["follow_rate"]
                     + 0.20 * s["click_rate"] / peaks["click_rate"])
            scored.append((round(score, 4), p, s))
        return sorted(scored, key=lambda x: x[0], reverse=True)

    # -- the daily review ---------------------------------------------------
    def handle(self, task: Task) -> Result:
        store, day = self.ctx.store, self.ctx.day
        personas = store.personas(Persona, status="active")
        emit: list[Task] = []
        kpi = self.ctx.memory.get("kpi", {})
        probation_days = int(self._cfg("probation_days", 14))
        keep_top = int(self._cfg("keep_top", 3))
        launch_size = int(self._cfg("launch_size", 10))

        # 1. no roster yet -> commission research and launch the whole fleet
        if not personas and not self.ctx.memory.get("scan_pending"):
            self.ctx.memory["scan_pending"] = True
            self.decide("launch_fleet",
                        f"No roster. Most new accounts never find an audience and which ones do "
                        f"is not knowable in advance, so the opening move is {launch_size} "
                        f"personas on equal minimal spend, not one bet.")
            emit.append(task.child("research.scan", {"k": launch_size, "seats": launch_size},
                                   stage=24))
            return Result(output={"action": "launch_fleet", "size": launch_size}, emit=emit)

        judged = set(self.ctx.memory.setdefault("judged", []))
        cohort = [p for p in personas if day - p.created_day >= probation_days
                  and p.id not in judged]

        # 2. the cull: rank everyone who finished probation together
        if cohort:
            ranked = self._rank_cohort(cohort)
            floor = float(self._cfg("min_views_post", 250))
            survivors = 0
            for rank, (score, p, sig) in enumerate(ranked, start=1):
                judged.add(p.id)
                keeps = rank <= keep_top and sig["views_per_post"] >= floor
                if keeps:
                    survivors += 1
                    p.slots = min(int(self.ctx.config.get("growth.max_roster", 12)), p.slots + 1)
                    store.save_persona(p)
                    self.decide("survives_cull",
                                f"@{p.handle} ranked {rank}/{len(ranked)} on early signal "
                                f"({sig['views_per_post']:,.0f} views/post, "
                                f"{sig['follow_rate']:.2%} follow rate). Gets the budget.",
                                {"persona": p.id, "score": score, **sig})
                else:
                    p.status = "paused"
                    store.save_persona(p)
                    reason = ("below the absolute floor" if sig["views_per_post"] < floor
                              else f"ranked {rank}/{len(ranked)}")
                    self.decide("cull_persona",
                                f"@{p.handle} paused — {reason}, {sig['views_per_post']:,.0f} "
                                f"views/post after {probation_days}d. The seat is worth more empty.",
                                {"persona": p.id, "score": score, **sig})
            self.ctx.memory["judged"] = sorted(judged)
            self.log(f"cull complete: {survivors}/{len(ranked)} kept", topic="strategy")

        # 3. per-persona review — probation is hands-off, survivors are managed
        personas = store.personas(Persona, status="active")
        for p in personas:
            age = day - p.created_day
            if age < probation_days:
                slots = int(self._cfg("slots_probation", 2))
                if p.slots != slots:
                    p.slots = slots
                    store.save_persona(p)
                emit.append(task.child("content.plan", {"persona_id": p.id}, stage=32))
                continue

            rev = store.persona_revenue(p.id, since_day=max(0, day - 7))
            cost = store.persona_cost(p.id, since_day=max(0, day - 7),
                                      n_personas=len(personas))
            ratio = rev / cost if cost > 0 else 0.0
            followers = self.ctx.world.total_followers(p.id) if self.ctx.world else 0

            if age >= probation_days + PAYBACK_DAYS and ratio < KILL_RATIO and followers < 8000:
                p.status = "paused"
                store.save_persona(p)
                self.decide("pause_persona",
                            f"@{p.handle}: survived the cull but returns {ratio:.2f}x on "
                            f"${cost:.0f} over 7 days. Capital moves on.",
                            {"persona": p.id, "ratio": round(ratio, 2)})
                continue

            if ratio > SCALE_RATIO and p.slots < MAX_SLOTS and self.ctx.ledger.cash > 200:
                p.slots += 1
                store.save_persona(p)
                self.decide("scale_persona",
                            f"@{p.handle} returns {ratio:.2f}x — adding a daily slot ({p.slots}).",
                            {"persona": p.id, "slots": p.slots})
            emit.append(task.child("content.plan", {"persona_id": p.id}, stage=32))

        # 4. keep fishing: refill the seats the cull emptied
        active = store.personas(Persona, status="active")
        open_niches = {p.niche_id for p in store.personas(Persona)}
        candidates = sorted([n for n in store.niches(Niche) if n.id not in open_niches],
                            key=lambda n: n.rank(), reverse=True)
        max_roster = int(self.ctx.config.get("growth.max_roster", 12))
        wave = int(self._cfg("refill_wave", 3))
        room = max_roster - len(active)

        culled_before = bool(self.ctx.memory.get("judged"))
        if room >= 1 and self.ctx.ledger.cash > NEW_PERSONA_CASH and culled_before:
            if not candidates and not self.ctx.memory.get("scan_pending"):
                self.ctx.memory["scan_pending"] = True
                self.decide("rescan_market",
                            f"{room} seats free after the cull and ${self.ctx.ledger.cash:.0f} in "
                            f"the bank — scanning for fresh niches.")
                emit.append(task.child("research.scan", {"k": wave + 2, "seats": min(room, wave)},
                                       stage=24))
            for n in candidates[:min(room, wave)]:
                self.decide("open_niche",
                            f"Refilling a culled seat with '{n.name}' (score {n.rank():.2f}).",
                            {"niche": n.id})
                emit.append(task.child("talent.create_persona", {"niche_id": n.id}, stage=28))

        # 5. tomorrow's budget follows today's evidence
        roas = kpi.get("roas", 0)
        trailing = float(store.query(
            "SELECT COALESCE(SUM(amount),0) s FROM revenue WHERE day>=?",
            (max(0, day - 7),))[0]["s"]) / 7.0
        reinvest = float(self.ctx.config.get("finance.reinvest_rate", 0.35))
        budget = max(self.ctx.config.daily_budget, trailing * reinvest)
        if roas > 1.5:
            budget *= 1.25
        elif roas and roas < 0.6:
            budget *= 0.75
        self.ctx.memory["next_budget"] = round(min(budget, max(20.0, self.ctx.ledger.cash * 0.3)), 2)
        share = 0.45 if roas > 1.2 else (0.30 if roas > 0.7 else 0.15)
        self.ctx.memory["amplify_budget"] = round(self.ctx.memory["next_budget"] * share, 2)
        return Result(output={"active": len(active), "culled": len(cohort),
                              "next_budget": self.ctx.memory["next_budget"]}, emit=emit)


class CFOAgent(Agent):
    name = "cfo"
    dept = "finance"
    title = "CFO"
    handles = ("finance.open_day", "finance.close_day")

    def handle(self, task: Task) -> Result:
        store, day = self.ctx.store, self.ctx.day
        if task.type == "finance.open_day":
            budget = self.ctx.memory.get("next_budget", self.ctx.config.daily_budget)
            budget = min(budget, max(10.0, self.ctx.ledger.cash * 0.35))
            self.ctx.ledger.new_day(budget)
            self.log(f"budget for day {day}: ${budget:.2f} (cash ${self.ctx.ledger.cash:.2f})",
                     {"budget": budget, "cash": self.ctx.ledger.cash}, topic="finance")
            return Result(output={"budget": round(budget, 2)})

        rev, cost = store.day_pnl(day)
        self.ctx.ledger.earn(rev)
        total_rev, total_cost = store.totals()
        runway = (self.ctx.ledger.cash / cost) if cost > 0 else float("inf")
        store.set_meta(f"pnl_{day}", {"revenue": rev, "cost": cost, "cash": self.ctx.ledger.cash})
        self.log(f"day {day} P&L: +${rev:.2f} / -${cost:.2f} = ${rev - cost:+.2f} · "
                 f"cash ${self.ctx.ledger.cash:.2f}",
                 {"revenue": rev, "cost": cost, "cash": self.ctx.ledger.cash,
                  "cumulative_profit": total_rev - total_cost}, topic="finance")
        if self.ctx.ledger.cash < 100:
            self.decide("cash_warning", f"Cash down to ${self.ctx.ledger.cash:.0f}; "
                                        f"runway {runway:.0f} days at today's burn.")
        return Result(output={"revenue": rev, "cost": cost, "cash": self.ctx.ledger.cash})
