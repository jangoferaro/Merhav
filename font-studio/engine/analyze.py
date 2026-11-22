"""Measure the *style* of an uploaded Hebrew font and translate it to Params.

Only numeric style characteristics are measured (height, stem and bar
thickness, width, corner roundness, slant, spacing, proportions). The
uploaded outlines are never copied: the result is rendered with Font
Studio's own skeletons, so the generated font is an original design.
"""

from __future__ import annotations

import io
import math
import statistics

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

from .build import MASTERS, Params
from .glyphs import WIDTH

MAX_FONT_BYTES = 15 * 1024 * 1024
HEB = {name: cp for name, cp in [
    ("alef", 0x05D0), ("bet", 0x05D1), ("dalet", 0x05D3), ("he", 0x05D4), ("vav", 0x05D5),
    ("het", 0x05D7), ("kaf", 0x05DB), ("lamed", 0x05DC), ("finalnun", 0x05DF),
    ("resh", 0x05E8), ("tav", 0x05EA), ("finalkaf", 0x05DA), ("qof", 0x05E7),
]}


class AnalyzeError(ValueError):
    pass


class _FlattenPen(BasePen):
    """Flattens outlines into polygons (lists of points)."""

    def __init__(self, glyphset, steps=12):
        super().__init__(glyphset)
        self.polys, self.cur, self.steps = [], None, steps

    def _moveTo(self, p):
        self.cur = [p]
        self.polys.append(self.cur)

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            mt = 1 - t
            self.cur.append((
                mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            mt = 1 - t
            self.cur.append((mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                             mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        self.cur = None

    _endPath = _closePath


class Glyph:
    def __init__(self, polys, bounds, advance, scale):
        self.polys = [[(x * scale, y * scale) for x, y in poly] for poly in polys]
        self.xmin, self.ymin, self.xmax, self.ymax = (v * scale for v in bounds)
        self.advance = advance * scale

    def deskew(self, k, y0):
        """Undo a slant (x shifted by (y - y0) * k), recomputing bounds."""
        self.polys = [[(x - (y - y0) * k, y) for x, y in poly] for poly in self.polys]
        xs = [x for poly in self.polys for x, _ in poly]
        if xs:
            self.xmin, self.xmax = min(xs), max(xs)

    @property
    def width(self):
        return self.xmax - self.xmin

    def _crossings(self, value, axis):
        """Signed crossings of the line (y=value if axis==1 else x=value)."""
        o = 1 - axis
        hits = []
        for poly in self.polys:
            n = len(poly)
            for i in range(n):
                a, b = poly[i], poly[(i + 1) % n]
                if (a[axis] <= value < b[axis]) or (b[axis] <= value < a[axis]):
                    t = (value - a[axis]) / (b[axis] - a[axis])
                    hits.append((a[o] + (b[o] - a[o]) * t, 1 if b[axis] > a[axis] else -1))
        hits.sort()
        return hits

    def runs(self, value, axis):
        """Ink runs [(start, end)] along a horizontal (axis=1) or vertical (axis=0) line."""
        out, wind, start = [], 0, None
        for pos, d in self._crossings(value, axis):
            before = wind
            wind += d
            if before == 0 and wind != 0:
                start = pos
            elif before != 0 and wind == 0 and start is not None:
                if pos - start > 0.5:
                    out.append((start, pos))
        return out

    def inside(self, x, y):
        return any(s <= x <= e for s, e in self.runs(y, 1))


def _load(data: bytes) -> TTFont:
    if len(data) > MAX_FONT_BYTES:
        raise AnalyzeError("הקובץ גדול מדי (מעל 15MB)")
    try:
        return TTFont(io.BytesIO(data), lazy=False, fontNumber=0)
    except Exception as e:
        raise AnalyzeError("לא הצלחתי לקרוא את הקובץ כפונט (TTF / OTF / WOFF / WOFF2)") from e


def _weight_of(font: TTFont) -> int:
    if "fvar" in font:
        for ax in font["fvar"].axes:
            if ax.axisTag == "wght":
                return int(ax.defaultValue)
    if "OS/2" in font:
        return int(font["OS/2"].usWeightClass or 400)
    return 400


def _stem_frac(weight: float) -> float:
    pts = sorted(MASTERS.items())
    weight = max(pts[0][0], min(pts[-1][0], weight))
    for (w0, f0), (w1, f1) in zip(pts, pts[1:]):
        if w0 <= weight <= w1:
            return f0 + (f1 - f0) * (weight - w0) / (w1 - w0)
    return pts[-1][1]


def _med(values, default=None):
    values = [v for v in values if v is not None and math.isfinite(v)]
    return statistics.median(values) if values else default


def _name(font: TTFont) -> str:
    try:
        return str(font["name"].getBestFamilyName() or "")
    except Exception:
        return ""


def analyze(data: bytes) -> dict:
    font = _load(data)
    cmap = font.getBestCmap() or {}
    missing = [n for n, cp in HEB.items() if cp not in cmap]
    if len([n for n in ("he", "resh", "vav", "dalet", "het") if HEB[n] in cmap]) < 3:
        raise AnalyzeError("בפונט הזה אין אותיות עבריות — צריך פונט שתומך בעברית")

    upm = font["head"].unitsPerEm
    scale = 1000.0 / upm
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]

    def get(name):
        cp = HEB.get(name)
        if cp not in cmap:
            return None
        gname = cmap[cp]
        bp = BoundsPen(gs)
        gs[gname].draw(bp)
        if not bp.bounds:
            return None
        fp = _FlattenPen(gs)
        gs[gname].draw(fp)
        return Glyph(fp.polys, bp.bounds, hmtx[gname][0], scale)

    g = {n: get(n) for n in HEB}
    g = {k: v for k, v in g.items() if v is not None}

    # --- letter height --------------------------------------------------
    H = _med([g[n].ymax for n in ("he", "het", "dalet", "resh", "tav", "kaf") if n in g])
    if not H or H < 150:
        raise AnalyzeError("לא הצלחתי למדוד את גובה האותיות")

    # --- slant (vav stem centre at two heights) -------------------------
    slant = 0.0
    italic_angle = float(getattr(font.get("post"), "italicAngle", 0) or 0)
    if abs(italic_angle) >= 1:
        slant = -italic_angle
    else:
        # right stems of several letters; only trust a consistent lean
        angles = []
        for n in ("vav", "he", "het", "resh", "dalet"):
            if n not in g:
                continue
            lo, hi = g[n].runs(H * 0.12, 1), g[n].runs(H * 0.52, 1)
            if lo and hi:
                c_lo = (lo[-1][0] + lo[-1][1]) / 2
                c_hi = (hi[-1][0] + hi[-1][1]) / 2
                angles.append(math.degrees(math.atan2(c_hi - c_lo, H * 0.40)))
        if len(angles) >= 3:
            m = statistics.median(angles)
            if abs(m) >= 2 and all(abs(a - m) < 2.5 for a in angles):
                slant = m
    if slant:
        k = math.tan(math.radians(slant))
        for gl in g.values():
            gl.deskew(k, H * 0.5)

    # --- vertical stem thickness ---------------------------------------
    stems = []
    if "vav" in g:
        r = g["vav"].runs(H * 0.40, 1)
        if r:
            stems.append(r[-1][1] - r[-1][0])
    for n in ("he", "het", "resh", "dalet"):
        if n in g:
            r = g[n].runs(H * 0.30, 1)
            if r:
                stems.append(r[-1][1] - r[-1][0])  # rightmost run = right stem
    stem = _med(stems)

    # --- horizontal bar thickness --------------------------------------
    bars = []
    for n in ("he", "het", "resh", "dalet", "tav"):
        if n in g:
            gl = g[n]
            r = gl.runs(gl.xmin + gl.width * 0.40, 0)
            if r:
                bars.append(r[-1][1] - r[-1][0])  # topmost run = top bar
    bar = _med(bars)
    if not stem or not bar:
        raise AnalyzeError("לא הצלחתי למדוד את עובי הקווים")

    weight = _weight_of(font)
    weight_scale = stem / (H * _stem_frac(weight))
    reg_stem = H * MASTERS[400] * weight_scale

    # --- width -----------------------------------------------------------
    widths = []
    for n in ("bet", "kaf", "resh", "he", "het", "dalet", "tav"):
        if n in g and WIDTH.get(n):
            f = WIDTH[n]
            ink = g[n].width - (stem - reg_stem) * 1.4 * f
            widths.append(ink / (f * 0.95 * H))
    width = _med(widths, 1.0)

    # --- corner roundness (outer top-right corner of resh / kaf) --------
    radii = []
    for n in ("resh", "kaf"):
        if n not in g:
            continue
        gl = g[n]
        d = None
        for i in range(0, int(H * 0.5)):
            if gl.inside(gl.xmax - i, gl.ymax - i):
                d = i * math.sqrt(2)
                break
        if d is not None:
            radii.append(d / (math.sqrt(2) - 1))
    r_soft = _med(radii, 0.0)
    roundness = r_soft / (0.55 * H)

    # --- head of vav ------------------------------------------------------
    head = (g["vav"].width - stem) / H if "vav" in g else None

    # --- ascender / descender --------------------------------------------
    asc = (g["lamed"].ymax / H - 1) if "lamed" in g else None
    desc = _med([-g[n].ymin / H for n in ("finalnun", "finalkaf", "qof") if n in g and g[n].ymin < 0])

    # --- spacing ----------------------------------------------------------
    sbs = [(g[n].advance - g[n].width) / 2 for n in ("he", "resh", "het", "dalet") if n in g]
    sb = _med(sbs)
    spacing = (sb - stem * 0.20) / (0.085 * H) if sb is not None else 1.0

    raw = {
        "height": H, "width": width, "contrast": bar / stem, "roundness": roundness,
        "slant": slant, "spacing": spacing, "weight_scale": weight_scale,
    }
    if head is not None:
        raw["head"] = head
    if asc is not None:
        raw["ascender"] = asc
    if desc is not None:
        raw["descender"] = desc
    p = Params.from_dict(raw)
    params = {k: round(getattr(p, k), 3) for k in raw}

    return {
        "params": params,
        "source": {
            "family": _name(font),
            "weight": weight,
            "variable": "fvar" in font,
        },
        "measured": {
            "letter_height": round(H), "stem": round(stem), "bar": round(bar),
            "corner_radius": round(r_soft), "slant_degrees": round(slant, 1),
        },
        "missing_letters": missing,
    }
