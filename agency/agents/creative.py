"""Creative department: planning, scripts, art direction and platform copy."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Content, Persona, Result, Task, next_id
from ..core.routing import route


class ContentStrategistAgent(Agent):
    name = "strategy"
    dept = "creative"
    title = "Content Strategist"
    handles = ("content.plan",)

    def handle(self, task: Task) -> Result:
        p = self.ctx.store.persona(Persona, task.payload["persona_id"])
        if p is None or p.status != "active":
            return Result(output={"skipped": "inactive"})
        playbook = self.ctx.memory.setdefault("playbook", {}).get(p.id, {})
        out = self.llm("calendar", "Plan today's slots for this persona.\n"
                       f'{{"pillars": {p.pillars!r}, "slots": {p.slots}}}'.replace("'", '"'),
                       {"slots": [{"pillar": "str", "fmt": "image|video", "slot_hour": "int"}]})
        emit = []
        for i, slot in enumerate(out.get("slots", [])[: p.slots]):
            fmt = playbook.get("fmt", slot.get("fmt", "video"))
            emit.append(task.child("content.write",
                                   {"persona_id": p.id, "pillar": slot["pillar"], "fmt": fmt,
                                    "hour": slot.get("slot_hour", 18), "index": i}, stage=36))
        self.log(f"@{p.handle}: {len(emit)} slots planned", {"slots": len(emit)}, topic="creative")
        return Result(output={"slots": len(emit)}, emit=emit)


class ScriptwriterAgent(Agent):
    name = "writer"
    dept = "creative"
    title = "Head Writer"
    handles = ("content.write",)

    def handle(self, task: Task) -> Result:
        pl = task.payload
        p = self.ctx.store.persona(Persona, pl["persona_id"])
        if p is None:
            return Result(output={"skipped": "missing_persona"})
        out = self.llm("script", "Write a short-form script.\n"
                       f'{{"pillar": "{pl["pillar"]}", "voice": "{p.voice}", '
                       f'"archetype": "{p.archetype}", "day": {self.ctx.day}, '
                       f'"slot": {pl.get("index", 0)}}}',
                       {"hook": "str", "script": "str", "beats": ["str"], "duration": "int"})
        c = Content(id=next_id("content"), persona_id=p.id, day=self.ctx.day, pillar=pl["pillar"],
                    fmt=pl.get("fmt", "video"), hook=out["hook"], script=out["script"],
                    caption="", hashtags=[], cta="")
        # A/B split inside the day: the growth team reads the outcome later,
        # nobody here knows which arm is the better one.
        book = self.ctx.memory.get("playbook", {}).get(p.id, {})
        exp = self.ctx.memory.get("experiments", {}).get(p.id, {})
        c.variant = "A" if int(pl.get("index", 0)) % 2 == 0 else "B"
        arm_effect = self.ctx.sub_rng("arm", exp.get("id", "none"), c.variant).uniform(0.82, 1.28)
        c.hook_strength = round(book.get("hook_strength", 1.0) * arm_effect, 3)
        c.review["beats"] = out.get("beats", [])
        c.review["duration"] = out.get("duration", 25)
        c.review["experiment"] = exp.get("id", "")
        self.ctx.store.save_content(c)
        return Result(output={"content_id": c.id, "hook": c.hook},
                      emit=[task.child("art.prompt", {"content_id": c.id}, stage=40)])


class ArtDirectorAgent(Agent):
    name = "art"
    dept = "creative"
    title = "Art Director"
    handles = ("art.prompt",)

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        out = self.llm("image_prompt", "Write the render prompt for this shot.\n"
                       f'{{"look": "{p.look}", "pillar": "{c.pillar}", "hook": "{c.hook[:80]}", '
                       f'"tier": "{p.tier if self.ctx.config.adult_enabled else "sfw"}"}}',
                       {"prompt": "str", "negative": "str"})

        # Gate 1: nothing reaches a generation provider unchecked.
        verdict = self.ctx.policy.check_prompt(out["prompt"], p.tier)
        if not verdict.allowed and verdict.edits.get("strip"):
            # Recoverable: the wording was too suggestive for the tier we run.
            # Rewrite it once rather than losing the slot.
            import re as _re
            clean = out["prompt"]
            for pattern in verdict.edits["strip"]:
                clean = _re.sub(pattern, "", clean, flags=_re.IGNORECASE)
            clean = _re.sub(r"\s{2,}", " ", clean).replace(" ,", ",").strip(" ,")
            retry = self.ctx.policy.check_prompt(clean, "sfw")
            if retry.allowed:
                self.log(f"prompt rewritten to clear the tier gate ({verdict.reasons})",
                         {"content": c.id}, level="warn", topic="compliance")
                out["prompt"], verdict = clean, retry
        if not verdict.allowed:
            c.status = "blocked"
            c.review["policy"] = verdict.as_dict()
            self.ctx.store.save_content(c)
            self.log(f"render prompt blocked: {verdict.reasons}", verdict.as_dict(),
                     level="warn", topic="compliance")
            return Result(output={"blocked": verdict.reasons})

        c.review["image_prompt"] = out["prompt"]
        c.review["negative"] = out.get("negative", "")
        c.review["prompt_tier"] = verdict.tier
        self.ctx.store.save_content(c)
        return Result(output={"content_id": c.id},
                      emit=[task.child("prod.image", {"content_id": c.id}, stage=44)])


class CopywriterAgent(Agent):
    name = "copy"
    dept = "creative"
    title = "Social Copywriter"
    handles = ("copy.write",)

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        targets = route(p, self.ctx.config, self.ctx.providers)
        for platform in targets:
            out = self.llm("caption", "Write the caption for one platform.\n"
                           f'{{"hook": "{c.hook[:100]}", "pillar": "{c.pillar}", '
                           f'"platform": "{platform}", "voice": "{p.voice}"}}',
                           {"caption": "str", "hashtags": ["str"], "cta": "str"})
            c.variants[platform] = {"caption": out["caption"], "hashtags": out.get("hashtags", []),
                                    "cta": out.get("cta", "")}
        c.caption = c.variants.get(targets[0], {}).get("caption", c.hook) if targets else c.hook
        c.hashtags = c.variants.get(targets[0], {}).get("hashtags", []) if targets else []
        c.status = "ready_for_review"
        self.ctx.store.save_content(c)
        return Result(output={"content_id": c.id, "platforms": targets},
                      emit=[task.child("compliance.review", {"content_id": c.id}, stage=56)])
