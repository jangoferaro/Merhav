"""Talent — designs the AI influencers themselves.

The important output is not the biography, it is the *identity lock*: one seed,
one canonical look sentence and one voice id, reused verbatim on every render
so the character stays recognisably the same person for months.
"""
from __future__ import annotations

from ..core.models import Niche, Persona, Result, Task, next_id
from ..core.agent import Agent

SCHEMA = {"name": "str", "handle": "str", "archetype": "str", "age": "int>=18",
          "look": "one sentence, fictional", "bio": "str", "voice": "str", "pillars": ["str"]}


class PersonaArchitectAgent(Agent):
    name = "talent"
    dept = "talent"
    title = "Persona Architect"
    handles = ("talent.create_persona",)

    def handle(self, task: Task) -> Result:
        niche = next((n for n in self.ctx.store.niches(Niche)
                      if n.id == task.payload.get("niche_id")), None)
        if niche is None:
            return Result(output={"error": "niche_not_found"})
        if not self.spend("persona_setup", self.ctx.config.price("persona_setup")):
            return Result(output={"skipped": "budget"})

        spec = self.llm("persona", "Design one fictional AI influencer for this niche.\n"
                        f'{{"niche": "{niche.name}", "tier": "{niche.tier}"}}', SCHEMA)

        verdict = self.ctx.policy.check_persona(spec["name"], spec["look"], spec["bio"],
                                                int(spec.get("age", 25)))
        if not verdict.allowed:
            self.log(f"persona rejected at design stage: {verdict.reasons}",
                     verdict.as_dict(), level="warn", topic="compliance")
            return Result(output={"rejected": verdict.reasons})

        pid = next_id("persona")
        seed = self.ctx.sub_rng(pid, niche.name).randrange(10_000, 9_999_999)
        p = Persona(id=pid, niche_id=niche.id, name=spec["name"], handle=spec["handle"],
                    archetype=spec["archetype"], tier=niche.tier, seed=seed,
                    look=spec["look"], bio=spec["bio"], voice=spec["voice"],
                    pillars=list(spec["pillars"])[:5], created_day=self.ctx.day,
                    quality=0.45 + self.ctx.rng.random() * 0.2,
                    voice_id=f"v-{spec['handle'].replace('.', '-')}",
                    age=int(spec.get("age", 25)), price=9.99 if niche.tier == "sfw" else 14.99)
        self.ctx.store.save_persona(p)
        niche.status = "open"
        self.ctx.store.save_niche(niche)

        self.decide("launch_persona",
                    f"{p.name} (@{p.handle}) launched into '{niche.name}' — seed {p.seed} locks "
                    f"the look, pillars: {', '.join(p.pillars[:3])}.",
                    {"persona": p.id, "niche": niche.name, "tier": p.tier})
        return Result(output={"persona_id": p.id, "name": p.name, "handle": p.handle},
                      emit=[task.child("content.plan", {"persona_id": p.id}, stage=32)])
