"""Market research — scores candidate niches on the four things that decide
whether a persona can pay for itself: demand, ad value, competition and
willingness to pay, minus compliance risk."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Niche, Result, Task, next_id

SCHEMA = {"niches": [{"name": "str", "demand": "0..1", "cpm": "usd", "competition": "0..1",
                      "monetization": "0..1", "risk": "0..1", "tier": "sfw|adult"}]}


class MarketResearchAgent(Agent):
    name = "research"
    dept = "research"
    title = "Head of Market Research"
    handles = ("research.scan",)

    def handle(self, task: Task) -> Result:
        k = int(task.payload.get("k", 6))
        allow_adult = self.ctx.config.adult_enabled
        out = self.llm("niche_scan",
                       "Score content niches for an AI-persona media company.\n"
                       f'{{"k": {k}, "allow_adult": {str(allow_adult).lower()}}}', SCHEMA)
        found = []
        for row in out.get("niches", []):
            n = Niche(id=next_id("niche"), name=row["name"], demand=float(row["demand"]),
                      cpm=float(row["cpm"]), competition=float(row["competition"]),
                      monetization=float(row["monetization"]), risk=float(row["risk"]),
                      tier=row.get("tier", "sfw"), opened_day=self.ctx.day)
            n.score = n.rank()
            self.ctx.store.save_niche(n)
            found.append(n)

        found.sort(key=lambda n: n.score, reverse=True)
        self.log(f"scanned {len(found)} niches, best: " +
                 ", ".join(f"{n.name} ({n.score:.2f})" for n in found[:3]),
                 {"niches": [(n.name, n.score) for n in found]}, topic="research")
        self.ctx.memory["scan_pending"] = False

        emit = []
        seats = int(task.payload.get("seats", 1))
        # Each launch costs a setup fee plus a fortnight of production; do not
        # open more seats than the bank can carry through probation.
        per_persona = (self.ctx.config.price("persona_setup")
                       + self.ctx.config.price("image") * 2
                       * int(self.ctx.config.get("portfolio.probation_days", 14)))
        affordable = int(self.ctx.ledger.cash * 0.5 / max(0.5, per_persona))
        seats = max(1, min(seats, len(found), affordable))
        for n in found[:seats]:
            emit.append(task.child("talent.create_persona", {"niche_id": n.id}, stage=28))
        return Result(output={"count": len(found), "launching": seats}, emit=emit)
