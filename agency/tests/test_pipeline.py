import unittest

from ..core.models import Asset, Content, Persona, Post
from .helpers import build_company


class TestPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.company, cls.store = build_company(days=6)

    def test_company_runs_without_agent_errors(self):
        errors = self.store.query("SELECT type, output FROM tasklog WHERE status='error'")
        self.assertEqual([dict(r) for r in errors], [])

    def test_every_department_did_work(self):
        agents = {r["agent"] for r in self.store.query("SELECT DISTINCT agent FROM tasklog")}
        for expected in ("ceo", "cfo", "research", "talent", "strategy", "writer", "art",
                         "studio.image", "copy", "compliance", "publisher", "revenue",
                         "analytics", "growth", "ops"):
            self.assertIn(expected, agents)

    def test_personas_are_created_and_locked_to_a_seed(self):
        personas = self.store.personas(Persona)
        self.assertGreater(len(personas), 0)
        for p in personas:
            self.assertGreaterEqual(p.age, 18)
            self.assertTrue(p.seed)
            self.assertTrue(p.look)

    def test_content_reaches_publication(self):
        posts = self.store.query("SELECT COUNT(*) c FROM posts")[0]["c"]
        assets = self.store.query("SELECT COUNT(*) c FROM assets")[0]["c"]
        self.assertGreater(posts, 0)
        self.assertGreater(assets, 0)

    def test_only_approved_platforms_receive_a_post(self):
        for post in self.store.posts_on(Post, day=3):
            content = self.store.content_row(Content, post.content_id)
            self.assertIn(post.platform, content.review["compliance"]["approved"])

    def test_assets_keep_the_persona_identity_seed(self):
        rows = self.store.query("SELECT data FROM assets")
        import json
        for r in rows:
            a = Asset(**json.loads(r["data"]))
            persona = self.store.persona(Persona, a.persona_id)
            if a.kind == "image":
                self.assertEqual(a.meta.get("seed"), persona.seed)

    def test_money_flows_and_is_double_entered(self):
        rev, cost = self.store.totals()
        self.assertGreater(cost, 0)
        self.assertGreaterEqual(rev, 0)
        booked = self.store.query("SELECT COUNT(*) c FROM revenue")[0]["c"]
        self.assertGreater(booked, 0)

    def test_run_is_deterministic_for_a_given_seed(self):
        a, sa = build_company(days=4)
        b, sb = build_company(days=4)
        self.assertEqual(sa.totals(), sb.totals())
        self.assertEqual([p.handle for p in sa.personas(Persona)],
                         [p.handle for p in sb.personas(Persona)])
