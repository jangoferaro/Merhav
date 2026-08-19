import unittest

from ..core.models import Persona, Post
from ..core.routing import route
from .helpers import build_company


class TestRouting(unittest.TestCase):
    def test_sfw_persona_fans_out_to_discovery_platforms(self):
        company, store = build_company(days=1)
        p = store.personas(Persona)[0]
        targets = route(p, company.config, company.ctx.providers)
        self.assertIn("tiktok", targets)
        self.assertIn("instagram", targets)

    def test_adult_tier_routes_only_to_age_gated_destinations(self):
        company, store = build_company(days=1, adult=True)
        gated = company.ctx.providers.age_gated_platforms()
        subject = Persona(id="p_adult", niche_id="n", name="X", handle="x", archetype="a",
                          tier="adult", seed=1, look="a 27-year-old fictional person",
                          bio="b", voice="v", pillars=["p"])
        targets = route(subject, company.config, company.ctx.providers)
        self.assertTrue(targets)
        self.assertTrue(set(targets) <= gated, f"adult tier leaked to {set(targets) - gated}")

    def test_publisher_refuses_an_adult_asset_aimed_at_an_open_platform(self):
        """Defence in depth: even if routing and compliance were both wrong,
        the publisher itself must not hand adult material to an open platform."""
        company, store = build_company(days=2, adult=True)
        publisher = company.routes["dist.publish"]
        persona = store.personas(Persona)[0]
        content = store.query("SELECT data FROM content LIMIT 1")
        import json

        from ..core.models import Content, Task
        c = Content(**json.loads(content[0]["data"]))
        c.persona_id = persona.id
        c.variants = {"instagram": {"caption": "x", "hashtags": [], "tier": "adult"}}
        c.review["compliance"] = {"approved": ["instagram"], "rejected": {}}
        store.save_content(c)
        before = store.query("SELECT COUNT(*) c FROM posts")[0]["c"]
        publisher.run(Task(type="dist.publish", payload={"content_id": c.id}, day=2))
        after = store.query("SELECT COUNT(*) c FROM posts")[0]["c"]
        self.assertEqual(before, after, "adult asset was published to an open platform")

    def test_the_adult_niche_never_reaches_the_board_while_the_tier_is_off(self):
        """Checked at the source: research can only surface what the tier allows."""
        import random

        from ..providers.llm.banks import gen_niche_scan
        seen_off, seen_on = set(), set()
        for seed in range(40):
            off = gen_niche_scan('{"k": 8, "allow_adult": false}', random.Random(seed))
            on = gen_niche_scan('{"k": 8, "allow_adult": true}', random.Random(seed))
            seen_off.update(n["tier"] for n in off["niches"])
            seen_on.update(n["tier"] for n in on["niches"])
        self.assertEqual(seen_off, {"sfw"})
        self.assertIn("adult", seen_on)

    def test_adult_niche_never_opens_while_the_tier_is_off(self):
        company, store = build_company(days=6, adult=False)
        self.assertEqual([p for p in store.personas(Persona) if p.tier == "adult"], [])
