"""Fuzz test: every parameter combination must build a valid variable font."""
import io
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fontTools.ttLib import TTFont  # noqa: E402

from engine.build import Params, build_variable, static_instance, to_bytes  # noqa: E402

RANGES = {
    "height": (420, 680), "width": (0.7, 1.4), "contrast": (0.6, 2.0),
    "roundness": (0.0, 1.0), "slant": (-14, 14), "spacing": (0.5, 1.8),
    "head": (0.12, 0.40), "ascender": (0.25, 0.60), "descender": (0.25, 0.60),
    "weight_scale": (0.6, 1.25),
}


class BuildTest(unittest.TestCase):
    def test_default(self):
        vf = build_variable(Params())
        data = to_bytes(vf, "woff2")
        f = TTFont(io.BytesIO(data))
        self.assertIn("fvar", f)
        self.assertEqual(f["fvar"].axes[0].axisTag, "wght")
        cmap = f.getBestCmap()
        for cp in range(0x05D0, 0x05EB):
            self.assertIn(cp, cmap)

    def test_random_params(self):
        rnd = random.Random(1234)
        for _ in range(60):
            d = {k: rnd.uniform(*r) for k, r in RANGES.items()}
            # include the extremes now and then
            for k, r in RANGES.items():
                if rnd.random() < 0.15:
                    d[k] = rnd.choice(r)
            p = Params.from_dict(d)
            with self.subTest(params=d):
                vf = build_variable(p)
                static_instance(vf, 700, "Bold", p)

    def test_family_name_sanitised(self):
        p = Params.from_dict({"family": "<script>אותיות</script>"})
        self.assertNotIn("<", p.family)
        build_variable(p)


if __name__ == "__main__":
    unittest.main()
