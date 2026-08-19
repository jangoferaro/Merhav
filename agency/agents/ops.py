"""Operations — opens and closes the working day, watches quotas and failures."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Result, Task


class OpsAgent(Agent):
    name = "ops"
    dept = "operations"
    title = "Head of Operations"
    handles = ("day.open", "ops.close")

    def handle(self, task: Task) -> Result:
        if task.type == "day.open":
            if self.ctx.world:
                self.ctx.world.tick(self.ctx.day)
            self.log(f"day {self.ctx.day} opened", topic="ops")
            return Result(output={"day": self.ctx.day})

        errors = self.ctx.store.query(
            "SELECT COUNT(*) c FROM tasklog WHERE day=? AND status='error'", (self.ctx.day,))[0]["c"]
        tasks = self.ctx.store.query(
            "SELECT COUNT(*) c FROM tasklog WHERE day=?", (self.ctx.day,))[0]["c"]
        blocked = self.ctx.store.query(
            "SELECT COUNT(*) c FROM events WHERE day=? AND topic='compliance' AND level='warn'",
            (self.ctx.day,))[0]["c"]
        health = "green" if errors == 0 else ("amber" if errors < 3 else "red")
        self.log(f"health {health} — {tasks} tasks, {errors} errors, {blocked} compliance blocks",
                 {"tasks": tasks, "errors": errors, "blocked": blocked}, topic="ops")
        return Result(output={"health": health, "tasks": tasks, "errors": errors})
