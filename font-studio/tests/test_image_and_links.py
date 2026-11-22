"""Image analysis and link parsing (offline)."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from engine.analyze import AnalyzeError  # noqa: E402
from engine.build import Params, build_variable, static_instance, to_bytes  # noqa: E402
from engine.fetch import _check_url, font_faces  # noqa: E402
from engine.image_analyze import DEFAULT_TEXT, analyze_image  # noqa: E402


def picture(p, text, jpeg=False):
    font = ImageFont.truetype(io.BytesIO(to_bytes(static_instance(build_variable(p), 400, "Regular", p))),
                              90, layout_engine=ImageFont.Layout.RAQM)
    lines = text.split("\n")
    img = Image.new("RGB", (2100, 60 + 150 * len(lines)), "white")
    d = ImageDraw.Draw(img)
    for i, t in enumerate(lines):
        d.text((2060, 30 + i * 150), t, font=font, fill="black", anchor="ra", direction="rtl")
    buf = io.BytesIO()
    img.save(buf, "JPEG" if jpeg else "PNG", quality=80)
    return buf.getvalue()


class ImageTest(unittest.TestCase):
    def test_alphabet_image_matches_parameters(self):
        p = Params.from_dict({"roundness": 0.8, "contrast": 1.5, "width": 1.1})
        r = analyze_image(picture(p, DEFAULT_TEXT, jpeg=True), DEFAULT_TEXT)
        self.assertTrue(r["matched"])
        for k, tol in {"width": 0.06, "contrast": 0.15, "roundness": 0.12, "weight_scale": 0.06}.items():
            self.assertAlmostEqual(r["params"][k], getattr(p, k), delta=tol, msg=k)

    def test_two_lines(self):
        p = Params()
        r = analyze_image(picture(p, "אבגדהוזחטיכך\nלמםנןסעפףצץקרשת"), "אבגדהוזחטיכך למםנןסעפףצץקרשת")
        self.assertTrue(r["matched"])
        self.assertEqual(r["found_letters"], 27)

    def test_wrong_text_falls_back(self):
        r = analyze_image(picture(Params(), DEFAULT_TEXT), "אבג")
        self.assertFalse(r["matched"])
        self.assertIn("contrast", r["params"])

    def test_not_an_image(self):
        with self.assertRaises(AnalyzeError):
            analyze_image(b"hello", DEFAULT_TEXT)


class LinkTest(unittest.TestCase):
    def test_blocks_internal_addresses(self):
        for u in ("http://127.0.0.1/", "http://169.254.169.254/x", "http://10.0.0.1/", "file:///etc/passwd",
                  "http://localhost:8000/"):
            with self.assertRaises(AnalyzeError):
                _check_url(u)

    def test_css_parsing_prefers_hebrew_regular(self):
        css = """
        @font-face { font-family: 'X'; font-weight: 700; src: url(b.woff2) format('woff2');
                     unicode-range: U+0590-05FF; }
        @font-face { font-family: 'X'; font-weight: 400; src: url(a.woff2) format('woff2');
                     unicode-range: U+0000-00FF; }
        @font-face { font-family: 'X'; font-weight: 400; src: url(h.woff) format('woff'), url(h.woff2) format('woff2');
                     unicode-range: U+0590-05FF, U+200C-2010; }
        """
        faces = font_faces(css, "https://example.com/css/")
        self.assertEqual(faces[0]["url"], "https://example.com/css/h.woff2")
        self.assertTrue(all(f["hebrew"] for f in faces))


if __name__ == "__main__":
    unittest.main()
