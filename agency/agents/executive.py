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
    name = "ceo"
    dept = "executive"
    title = "CEO"
    handles = ("exec.review",)

    def handle(self, task: Task) -> Result:
        store, day = self.ctx.store, self.ctx.day
        personas = store.personas(Persona, status="active")
        emit: list[Task] = []
        kpi = self.ctx.memory.get("kpi", {})

        # 1. no roster yet -> commission market research
        if not personas and not self.ctx.memory.get("scan_pending"):
            self.ctx.memory["scan_pending"] = True
            self.decide("bootstrap", "No roster. Commissioning a niche scan before spending a dollar.")
            emit.append(task.child("research.scan", {"k": 6}, stage=24))
            return Result(output={"action": "scan"}, emit=emit)

        # 2. per-persona portfolio review
        for p in personas:
            age = day - p.created_day
            rev = store.persona_revenue(p.id, since_day=max(0, day - 7))
            cost = store.persona_cost(p.id, since_day=max(0, day - 7),
                                      n_personas=len(personas))
            ratio = rev / cost if cost > 0 else 0.0
            followers = self.ctx.world.total_followers(p.id) if self.ctx.world else 0

            if age >= PAYBACK_DAYS and ratio < KILL_RATIO and followers < 8000:
                p.status = "paused"
                store.save_persona(p)
                self.decide("pause_persona",
                            f"{p.name}: {age}d old, 7d revenue ${rev:.0f} vs ${cost:.0f} cost "
                            f"(ratio {ratio:.2f}), {followers} followers. Capital moves on.",
                            {"persona": p.id, "ratio": round(ratio, 2)})
                continue

            if ratio > SCALE_RATIO and p.slots < MAX_SLOTS and self.ctx.ledger.cash > 200:
                p.slots += 1
                p.budget = round(p.budget + 5, 2)
                store.save_persona(p)
                self.decide("scale_persona",
                            f"{p.name} returns {ratio:.2f}x — adding a daily slot ({p.slots}).",
                            {"persona": p.id, "slots": p.slots})

            emit.append(task.child("content.plan", {"persona_id": p.id}, stage=32))

        # 3. expand the roster when the balance sheet allows it
        active = [p for p in store.personas(Persona, status="active")]
        open_niches = {p.niche_id for p in active}
        candidates = sorted([n for n in store.niches(Niche) if n.id not in open_niches],
                            key=lambda n: n.rank(), reverse=True)
        healthy = all(store.persona_revenue(p.id, max(0, day - 7)) > 0 for p in active) if active else False
        max_roster = int(self.ctx.config.get("growth.max_roster", 8))
        room = len(active) < max_roster

        if not candidates and room and self.ctx.ledger.cash > NEW_PERSONA_CASH * 2 \
                and not self.ctx.memory.get("scan_pending"):
            self.ctx.memory["scan_pending"] = True
            self.decide("rescan_market",
                        f"Niche board exhausted with ${self.ctx.ledger.cash:.0f} in the bank — "
                        f"commissioning a fresh scan.")
            emit.append(task.child("research.scan", {"k": 5}, stage=24))

        if candidates and room and self.ctx.ledger.cash > NEW_PERSONA_CASH and (healthy or len(active) < 2):
            pick = candidates[0]
            self.decide("open_niche",
                        f"Cash ${self.ctx.ledger.cash:.0f} and a healthy roster. Opening "
                        f"'{pick.name}' (score {pick.rank():.2f}).", {"niche": pick.id})
            emit.append(task.child("talent.create_persona", {"niche_id": pick.id}, stage=28))

        # 4. tomorrow's budget follows today's evidence: a floor from the
        #    config, plus a share of what the last seven days actually earned.
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
        # How much of it goes to paid amplification rather than production.
        share = 0.45 if roas > 1.2 else (0.30 if roas > 0.7 else 0.15)
        self.ctx.memory["amplify_budget"] = round(self.ctx.memory["next_budget"] * share, 2)
        return Result(output={"active": len(active), "next_budget": self.ctx.memory["next_budget"]},
                      emit=emit)


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
