import unittest

from ..core.policy import PolicyEngine
from ..report import redteam


class TestPolicy(unittest.TestCase):
    def setUp(self):
        self.off = PolicyEngine(False, {"fanvue"})
        self.on = PolicyEngine(True, {"fanvue"})

    def test_red_team_set_behaves_as_specified(self):
        failures = [r for r in redteam.run(("fanvue", "patreon")) if not r["pass"]]
        self.assertEqual(failures, [], f"compliance gate regressions: {failures}")

    def test_minor_terms_blocked_in_every_configuration(self):
        for engine in (self.off, self.on):
            for text in ("teen model portrait", "schoolgirl outfit", "she is 15 years old"):
                self.assertFalse(engine.check_prompt(text, "sfw").allowed, text)

    def test_real_person_likeness_blocked(self):
        for text in ("undress this photo", "deepfake of the actress", "face swap onto a celebrity"):
            self.assertFalse(self.on.check_prompt(text, "adult").allowed, text)

    def test_adult_tier_requires_both_config_and_gated_destination(self):
        self.assertFalse(self.off.check_publication("lingerie set", "adult", "fanvue").allowed)
        self.assertFalse(self.on.check_publication("lingerie set", "adult", "instagram").allowed)
        self.assertTrue(self.on.check_publication("lingerie set", "adult", "fanvue").allowed)

    def test_persona_must_be_an_adult(self):
        self.assertFalse(self.on.check_persona("A", "a person", "bio", 17).allowed)
        self.assertTrue(self.on.check_persona("A", "a 27-year-old person", "bio", 27).allowed)

    def test_disclosure_is_appended_to_everything_published(self):
        v = self.off.check_publication("normal caption", "sfw", "instagram")
        self.assertIn("append_disclosure", v.edits)
