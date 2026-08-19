"""Compliance & Legal — the last gate before anything leaves the building.

Checks each platform variant separately, because what is fine on one
destination is not fine on another; strips or blocks what fails and appends the
AI-disclosure label that every published item must carry.
"""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Content, Persona, Result, Task


class ComplianceAgent(Agent):
    name = "compliance"
    dept = "compliance"
    title = "Compliance Officer"
    handles = ("compliance.review",)

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        approved: list[str] = []
        rejected: dict[str, list[str]] = {}

        for platform, bundle in c.variants.items():
            text = " ".join([c.hook, bundle.get("caption", ""), c.review.get("image_prompt", "")])
            v = self.ctx.policy.check_publication(text, c.review.get("prompt_tier", p.tier), platform)
            if not v.allowed:
                rejected[platform] = v.reasons
                continue
            if v.edits.get("append_disclosure"):
                bundle["caption"] = bundle["caption"].rstrip() + "\n\n" + v.edits["append_disclosure"]
            bundle["tier"] = v.tier
            approved.append(platform)

        c.review["compliance"] = {"approved": approved, "rejected": rejected}
        c.status = "approved" if approved else "blocked"
        self.ctx.store.save_content(c)

        if rejected:
            self.log(f"blocked on {list(rejected)} — {rejected}", {"content": c.id, **rejected},
                     level="warn", topic="compliance")
        if not approved:
            return Result(output={"blocked": rejected})
        return Result(output={"approved": approved},
                      emit=[task.child("dist.publish", {"content_id": c.id}, stage=60)])
