"""Round trip: analysing a font we generated must recover its parameters."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.analyze import AnalyzeError, analyze  # noqa: E402
from engine.build import Params, build_variable, static_instance, to_bytes  # noqa: E402

TOL = {"height": 3, "width": 0.05, "contrast": 0.08, "roundness": 0.1, "slant": 0.5,
       "spacing": 0.08, "weight_scale": 0.05, "head": 0.03, "ascender": 0.02, "descender": 0.02}


class AnalyzeTest(unittest.TestCase):
    def check(self, d, weight=400, style="Regular"):
        p = Params.from_dict(d)
        data = to_bytes(static_instance(build_variable(p), weight, style, p), "woff2")
        got = analyze(data)["params"]
        for k, tol in TOL.items():
            with self.subTest(param=k, params=d):
                self.assertAlmostEqual(got[k], getattr(p, k), delta=tol)

    def test_default(self):
        self.check({})

    def test_varied(self):
        self.check({"roundness": 0.9, "contrast": 1.5, "width": 1.15, "height": 600})
        self.check({"roundness": 0.0, "contrast": 0.8, "width": 0.8, "spacing": 1.4, "head": 0.35})

    def test_slanted(self):
        self.check({"slant": 8, "roundness": 0.4})

    def test_rejects_garbage(self):
        with self.assertRaises(AnalyzeError):
            analyze(b"not a font at all")


if __name__ == "__main__":
    unittest.main()
