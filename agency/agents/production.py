"""Production studio: renders the stills, the voiceover and the cut."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Asset, Content, Persona, Result, Task, next_id


class ImageStudioAgent(Agent):
    name = "studio.image"
    dept = "production"
    title = "Image Studio"
    handles = ("prod.image",)

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        prompt = c.review.get("image_prompt", "")
        tier = c.review.get("prompt_tier", p.tier)

        unit = self.ctx.config.price("image")
        if not self.spend("image_render", unit, p.id):
            c.status = "deferred_budget"
            self.ctx.store.save_content(c)
            return Result(output={"skipped": "budget"})

        res = self.ctx.providers.image.generate(
            prompt=prompt, seed=p.seed, tier=tier,
            meta={"persona_name": p.name, "persona_handle": p.handle,
                  "character_id": p.id, "negative": c.review.get("negative", "")})
        extra = float(res.get("cost", 0.0))
        if extra:
            self.spend("image_provider", extra, p.id)

        a = Asset(id=next_id("asset"), persona_id=p.id, kind="image",
                  provider=res.get("provider", "?"), prompt=prompt, uri=res.get("uri", ""),
                  cost=unit + extra, day=self.ctx.day, tier=tier,
                  meta={"seed": p.seed, "identity_locked": res.get("identity_locked", False)})
        self.ctx.store.save_asset(a)
        c.asset_id = a.id
        self.ctx.store.save_content(c)

        nxt = "prod.video" if c.fmt == "video" else "copy.write"
        stage = 48 if c.fmt == "video" else 52
        return Result(output={"asset_id": a.id, "provider": a.provider},
                      emit=[task.child(nxt, {"content_id": c.id}, stage=stage)])


class VideoStudioAgent(Agent):
    name = "studio.video"
    dept = "production"
    title = "Video Studio"
    handles = ("prod.video",)

    def handle(self, task: Task) -> Result:
        c = self.ctx.store.content_row(Content, task.payload["content_id"])
        p = self.ctx.store.persona(Persona, c.persona_id)
        img = self.ctx.store.query("SELECT data FROM assets WHERE id=?", (c.asset_id,))
        frames = []
        if img:
            import json as _json
            frames.append(_json.loads(img[0]["data"])["uri"])

        voice = self.ctx.providers.voice.speak(c.script, p.voice_id)
        if voice.get("cost"):
            self.spend("voice", float(voice["cost"]), p.id)
        else:
            self.spend("voice", self.ctx.config.price("voice"), p.id)

        if not self.spend("video_render", self.ctx.config.price("video"), p.id):
            return Result(output={"skipped": "budget"},
                          emit=[task.child("copy.write", {"content_id": c.id}, stage=52)])

        res = self.ctx.providers.video.assemble(
            frames=frames,
            script={"beats": c.review.get("beats", []), "duration": c.review.get("duration", 25)},
            meta={"persona_handle": p.handle, "content_id": c.id, "voice_uri": voice.get("uri")})
        a = Asset(id=next_id("asset"), persona_id=p.id, kind="video",
                  provider=res.get("provider", "?"), prompt=c.script, uri=res.get("uri", ""),
                  cost=self.ctx.config.price("video"), day=self.ctx.day, tier=c.review.get("prompt_tier", p.tier),
                  meta={"duration": res.get("duration"), "voice": voice.get("uri")})
        self.ctx.store.save_asset(a)
        c.video_id = a.id
        self.ctx.store.save_content(c)
        return Result(output={"video": a.uri, "provider": a.provider},
                      emit=[task.child("copy.write", {"content_id": c.id}, stage=52)])
