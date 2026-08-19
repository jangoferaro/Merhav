"""Base agent + the shared context every agent works against."""
from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .models import Result, Task, stable_hash


@dataclass
class Ledger:
    """Cash. The CFO is the only agent allowed to approve a spend, and every
    spend is checked against the remaining daily budget and the bank."""
    cash: float
    daily_budget: float
    spent_today: float = 0.0
    invested: float = 0.0          # lifetime capital deployed into acquisitions

    def can_spend(self, amount: float) -> bool:
        return amount <= self.cash and (self.spent_today + amount) <= self.daily_budget

    def spend(self, amount: float) -> bool:
        if not self.can_spend(amount):
            return False
        self.cash -= amount
        self.spent_today += amount
        return True

    def invest(self, amount: float, reserve: float = 0.0) -> bool:
        """Capital expenditure. Buying a branch is not marketing spend: it does
        not compete with the daily operating budget and is not capped by it. It
        is capped by the balance sheet and by the reserve the company refuses
        to breach."""
        if amount <= 0 or amount > (self.cash - reserve):
            return False
        self.cash -= amount
        self.invested += amount
        return True

    def earn(self, amount: float) -> None:
        self.cash += amount

    def new_day(self, daily_budget: Optional[float] = None) -> None:
        self.spent_today = 0.0
        if daily_budget is not None:
            self.daily_budget = daily_budget


@dataclass
class Context:
    config: Any
    store: Any
    bus: Any
    policy: Any
    providers: Any
    ledger: Ledger
    rng: random.Random
    day: int = 0
    world: Any = None
    memory: dict[str, Any] = field(default_factory=dict)

    def sub_rng(self, *parts: Any) -> random.Random:
        """Deterministic per-subject RNG so reruns reproduce byte for byte."""
        return random.Random(stable_hash(self.config.seed, self.day, *parts) & 0xFFFFFFFF)


class Agent:
    """An employee. `dept` is its department, `handles` the task types it owns."""
    name: str = "agent"
    dept: str = "general"
    title: str = ""
    handles: tuple[str, ...] = ()

    def __init__(self, ctx: Context):
        self.ctx = ctx

    # -- convenience --------------------------------------------------------
    def log(self, message: str, data: Any = None, level: str = "info", topic: str = "work") -> None:
        self.ctx.bus.emit(topic, self.name, message, data, level)

    def decide(self, kind: str, rationale: str, data: Any = None) -> None:
        self.ctx.store.add_decision(self.ctx.day, self.name, kind, rationale, data)
        self.ctx.bus.emit("decision", self.name, f"{kind}: {rationale}", data)

    def spend(self, item: str, amount: float, persona_id: str = "") -> bool:
        """Book a cost against the ledger (and, when known, against a persona).
        Returns False when the CFO's daily budget says no."""
        if amount <= 0:
            return True
        if not self.ctx.ledger.spend(amount):
            self.log(f"budget denied: {item} (${amount:.2f})", level="warn", topic="finance")
            return False
        self.ctx.store.add_cost(self.ctx.day, self.dept, item, amount, persona_id)
        return True

    def invest(self, item: str, amount: float, reserve: float = 0.0,
               persona_id: str = "") -> bool:
        """Book a capital expenditure against the balance sheet."""
        if not self.ctx.ledger.invest(amount, reserve):
            self.log(f"cannot fund {item}: ${amount:,.2f} against ${self.ctx.ledger.cash:,.2f} "
                     f"cash with a ${reserve:,.0f} reserve", level="warn", topic="finance")
            return False
        self.ctx.store.add_cost(self.ctx.day, self.dept, item, amount, persona_id, kind="capex")
        return True

    def llm(self, purpose: str, prompt: str, schema: dict | None = None,
            system: str | None = None) -> Any:
        out = self.ctx.providers.llm.complete(
            system=system or f"You are the {self.title or self.name} of an AI-native media company.",
            prompt=prompt, schema=schema, purpose=purpose,
            rng=self.ctx.sub_rng(self.name, purpose, prompt[:64]))
        cost = self.ctx.providers.llm.last_cost
        if cost:
            self.spend(f"llm:{purpose}", cost)
        return out

    # -- to implement -------------------------------------------------------
    def handle(self, task: Task) -> Result:  # pragma: no cover - abstract
        raise NotImplementedError

    # -- runner -------------------------------------------------------------
    def run(self, task: Task) -> Result:
        t0 = time.time()
        try:
            res = self.handle(task) or Result()
            status = "ok"
        except Exception as exc:  # an agent failing must not kill the company
            res = Result(output={"error": str(exc)}, note="exception")
            status = "error"
            self.log(f"task {task.type} failed: {exc}", level="error", topic="ops")
        self.ctx.store.log_task(task, self.name, status, int((time.time() - t0) * 1000), res.output)
        return res
