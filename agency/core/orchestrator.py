"""The company itself: hires the agents, routes work, runs the day."""
from __future__ import annotations

import heapq
import itertools
import random
from typing import Iterable

from ..agents.analytics import AnalystAgent
from ..agents.compliance import ComplianceAgent
from ..agents.creative import (ArtDirectorAgent, ContentStrategistAgent, CopywriterAgent,
                               ScriptwriterAgent)
from ..agents.distribution import PublisherAgent
from ..agents.executive import CEOAgent, CFOAgent
from ..agents.growth import CommunityAgent, GrowthAgent
from ..agents.ops import OpsAgent
from ..agents.production import ImageStudioAgent, VideoStudioAgent
from ..agents.research import MarketResearchAgent
from ..agents.revenue import BizDevAgent, MonetizationAgent
from ..agents.talent import PersonaArchitectAgent
from .agent import Context, Ledger
from .bus import Bus
from . import models
from .models import Task
from .policy import PolicyEngine
from .store import Store

AGENT_CLASSES = [
    OpsAgent, CFOAgent, AnalystAgent, CEOAgent, MarketResearchAgent, PersonaArchitectAgent,
    GrowthAgent, ContentStrategistAgent, ScriptwriterAgent, ArtDirectorAgent, ImageStudioAgent,
    VideoStudioAgent, CopywriterAgent, ComplianceAgent, PublisherAgent, CommunityAgent,
    MonetizationAgent, BizDevAgent,
]

# The fixed skeleton of a working day. Agents add work inside it by emitting
# tasks at later stages; nothing else is hard-coded.
DAY_PLAN = [
    ("day.open", 5), ("finance.open_day", 8), ("analytics.collect", 12),
    ("analytics.report", 15), ("exec.review", 20), ("growth.experiment", 30),
    ("growth.amplify", 66), ("community.engage", 68), ("revenue.funnel", 72), ("revenue.deals", 76),
    ("finance.close_day", 90), ("ops.close", 95),
]

MAX_TASKS_PER_DAY = 4000


class Company:
    def __init__(self, config, store: Store, world=None):
        self.config = config
        self.store = store
        self.bus = Bus(store)
        self.world = world
        rng = random.Random(config.seed)
        providers = self._providers(config, world)
        policy = PolicyEngine(adult_enabled=config.adult_enabled,
                              age_gated_platforms=providers.age_gated_platforms())
        cash = store.get_meta("cash", config.start_capital)
        self.ctx = Context(config=config, store=store, bus=self.bus, policy=policy,
                           providers=providers, rng=rng,
                           ledger=Ledger(cash=cash, daily_budget=config.daily_budget),
                           world=world)
        self.ctx.memory = store.get_meta("memory", {}) or {}
        models.set_counter(store.get_meta("id_counter", 0))
        self.agents = [cls(self.ctx) for cls in AGENT_CLASSES]
        self.routes = {}
        for a in self.agents:
            for t in a.handles:
                self.routes[t] = a
        self._counter = itertools.count()

    @staticmethod
    def _providers(config, world):
        from ..providers import registry
        return registry.build(config, world)

    # -- roster -------------------------------------------------------------
    def org_chart(self) -> dict[str, list[tuple[str, str, tuple[str, ...]]]]:
        chart: dict[str, list] = {}
        for a in self.agents:
            chart.setdefault(a.dept, []).append((a.name, a.title, a.handles))
        return chart

    # -- execution ----------------------------------------------------------
    def run_day(self, day: int) -> dict:
        self.ctx.day = day
        self.bus.day = day
        self.ctx.memory["posted_today"] = {}
        queue: list = []
        for ttype, stage in DAY_PLAN:
            self._push(queue, Task(type=ttype, stage=stage, day=day, origin="calendar"))

        done = 0
        while queue and done < MAX_TASKS_PER_DAY:
            _, _, task = heapq.heappop(queue)
            agent = self.routes.get(task.type)
            if agent is None:
                self.bus.emit("ops", "orchestrator", f"no agent handles {task.type}", level="warn")
                continue
            result = agent.run(task)
            done += 1
            for child in result.emit:
                child.day = day
                self._push(queue, child)

        self.store.set_meta("cash", self.ctx.ledger.cash)
        self.store.set_meta("memory", self._serialisable_memory())
        self.store.set_meta("last_day", day)
        self.store.set_meta("id_counter", models.get_counter())
        self.store.commit()
        rev, cost = self.store.day_pnl(day)
        return {"day": day, "tasks": done, "revenue": rev, "cost": cost,
                "cash": self.ctx.ledger.cash, "kpi": self.ctx.memory.get("kpi", {}),
                **self.snapshot(day)}

    def snapshot(self, day: int) -> dict:
        """End-of-day state, as opposed to the KPI report which is trailing."""
        from .models import Persona
        personas = self.store.personas(Persona)
        cum = self.store.query(
            "SELECT COALESCE(SUM(MAX(0, m.views - COALESCE(p.views,0))),0) v FROM metrics m "
            "LEFT JOIN metrics p ON p.post_id=m.post_id AND p.day=m.day-1 WHERE m.day=?",
            (day,))[0]["v"]
        prev = 0
        posts = self.store.query("SELECT COUNT(*) c FROM posts WHERE day=?", (day,))[0]["c"]
        return {"posts": posts,
                "views": max(0, int(cum) - int(prev)),
                "followers": sum(self.world.total_followers(p.id) for p in personas) if self.world else 0,
                "subs": sum(self.world.sub_count(p.id) for p in personas) if self.world else 0,
                "active": len([p for p in personas if p.status == "active"])}

    def run(self, days: int, start: int | None = None, on_day=None) -> list[dict]:
        start = start if start is not None else int(self.store.get_meta("last_day", 0)) + 1
        out = []
        for day in range(start, start + days):
            summary = self.run_day(day)
            out.append(summary)
            if on_day:
                on_day(summary)
        return out

    # -- internals ----------------------------------------------------------
    def _push(self, queue, task: Task) -> None:
        heapq.heappush(queue, (task.stage, next(self._counter), task))

    def _serialisable_memory(self) -> dict:
        return {k: v for k, v in self.ctx.memory.items() if k != "posted_today"}
