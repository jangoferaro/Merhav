import os
import unittest

from ..core.models import Persona
from .helpers import build_company


class TestFleetLaunch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.company, cls.store = build_company(days=1)
        cls.launch_size = int(cls.company.config.get("portfolio.launch_size", 10))

    def test_the_company_opens_with_a_fleet_not_a_single_bet(self):
        personas = self.store.personas(Persona)
        self.assertEqual(len(personas), self.launch_size)

    def test_every_persona_gets_its_own_niche(self):
        niches = [p.niche_id for p in self.store.personas(Persona)]
        self.assertEqual(len(niches), len(set(niches)))

    def test_handles_are_unique_because_they_are_account_names(self):
        handles = [p.handle for p in self.store.personas(Persona)]
        self.assertEqual(len(handles), len(set(handles)), f"duplicate handle in {handles}")

    def test_probation_is_an_equal_test(self):
        slots = {p.slots for p in self.store.personas(Persona, status="active")}
        self.assertEqual(slots, {int(self.company.config.get("portfolio.slots_probation", 2))})
        boosts = self.store.query(
            "SELECT COUNT(*) c FROM costs WHERE item='paid_boost'")[0]["c"]
        self.assertEqual(boosts, 0, "paid amplification must not run during probation")


class TestCull(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.company, cls.store = build_company(days=0)
        cls.probation = int(cls.company.config.get("portfolio.probation_days", 14))
        cls.keep = int(cls.company.config.get("portfolio.keep_top", 3))
        cls.company.run(days=cls.probation + 1, start=1)

    def test_the_cohort_is_cut_to_the_survivors(self):
        active = self.store.personas(Persona, status="active")
        launched_day_one = [p for p in active if p.created_day == 1]
        self.assertLessEqual(len(launched_day_one), self.keep)

    def test_the_cull_is_decided_on_leading_signal_not_revenue(self):
        rows = self.store.query(
            "SELECT rationale FROM decisions WHERE kind IN ('cull_persona','survives_cull')")
        self.assertTrue(rows, "no cull happened")
        for r in rows:
            self.assertIn("views/post", r["rationale"])

    def test_survivors_are_given_more_than_the_culled_ever_had(self):
        survivors = [p for p in self.store.personas(Persona, status="active")
                     if p.created_day == 1]
        probation_slots = int(self.company.config.get("portfolio.slots_probation", 2))
        for p in survivors:
            self.assertGreater(p.slots, probation_slots)

    def test_empty_seats_are_refilled_so_the_company_keeps_taking_shots(self):
        before = len(self.store.personas(Persona, status="active"))
        self.company.run(days=4)
        after = len(self.store.personas(Persona, status="active"))
        self.assertGreater(after, before)


class TestPerPersonaCredentials(unittest.TestCase):
    def setUp(self):
        from ..providers.social.live import TikTok
        self.adapter = TikTok()
        for key in list(os.environ):
            if key.startswith("TIKTOK_ACCESS_TOKEN"):
                os.environ.pop(key)

    def tearDown(self):
        for key in list(os.environ):
            if key.startswith("TIKTOK_ACCESS_TOKEN"):
                os.environ.pop(key)

    def test_a_persona_uses_its_own_account_token(self):
        os.environ["TIKTOK_ACCESS_TOKEN__talia_ford"] = "per-persona"
        os.environ["TIKTOK_ACCESS_TOKEN"] = "shared"
        self.assertEqual(self.adapter.token_for("talia.ford"), "per-persona")
        self.assertEqual(self.adapter.token_for("someone.else"), "shared")

    def test_a_persona_without_an_account_never_posts_as_another_one(self):
        os.environ["TIKTOK_ACCESS_TOKEN__talia_ford"] = "per-persona"
        res = self.adapter.publish({"handle": "iris.vale"}, {"uri": "x"}, "caption", {})
        self.assertIn("mock", res["provider"])
        self.assertIn("TIKTOK_ACCESS_TOKEN__iris_vale", res["provider"])

    def test_the_missing_variable_is_named_exactly(self):
        self.assertEqual(self.adapter.env_var_for("Talia.Ford"),
                         "TIKTOK_ACCESS_TOKEN__talia_ford")
