"""Editing an existing font file."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.analyze import analyze  # noqa: E402
from engine.build import Params, build_variable, static_instance  # noqa: E402
from engine.build import to_bytes as build_bytes  # noqa: E402
from engine.edit import EditParams, apply_edit, font_summary, prepare, rename, to_bytes  # noqa: E402


def source_font():
    p = Params()
    return build_bytes(static_instance(build_variable(p), 400, "Regular", p))


class EditTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = source_font()
        cls.prep = prepare(cls.data)
        cls.base = analyze(cls.data)["measured"]

    def measured(self, **kw):
        font = apply_edit(self.prep, EditParams.from_dict(kw), remove_overlaps=True)
        return analyze(to_bytes(font))["measured"]

    def test_no_change_is_identity(self):
        m = self.measured()
        self.assertAlmostEqual(m["stem"], self.base["stem"], delta=2)
        self.assertAlmostEqual(m["bar"], self.base["bar"], delta=2)

    def test_weight_thickens_strokes(self):
        m = self.measured(weight=40)
        self.assertAlmostEqual(m["stem"], self.base["stem"] + 40, delta=4)
        self.assertAlmostEqual(m["bar"], self.base["bar"] + 40, delta=4)

    def test_contrast_moves_thickness_to_horizontals(self):
        m = self.measured(contrast=40)
        self.assertAlmostEqual(m["stem"], self.base["stem"] - 20, delta=4)
        self.assertAlmostEqual(m["bar"], self.base["bar"] + 20, delta=4)

    def test_width_keeps_stroke_thickness(self):
        m = self.measured(width=0.8, keep_strokes=True)
        self.assertAlmostEqual(m["stem"], self.base["stem"], delta=4)

    def test_slant_and_other_effects_build(self):
        m = self.measured(slant=8, corners=40, tracking=50, line_height=1.3)
        self.assertAlmostEqual(m["slant_degrees"], 8, delta=1)
        font = apply_edit(self.prep, EditParams.from_dict({"outline": 20}), remove_overlaps=True)
        rename(font, "Hollow Test")
        self.assertGreater(len(to_bytes(font, "woff2")), 1000)

    def test_licence_detection(self):
        lic = font_summary(self.data)["license"]
        self.assertFalse(lic["free"])  # generated test font carries no licence text


if __name__ == "__main__":
    unittest.main()
