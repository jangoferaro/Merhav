"""Font building: parameters -> weight masters -> variable font -> files."""

from __future__ import annotations

import io
import json
import math
import re
import zipfile
from dataclasses import dataclass, asdict, field

from fontTools.cu2qu import curves_to_quadratic
from fontTools.designspaceLib import (AxisDescriptor, DesignSpaceDocument,
                                      InstanceDescriptor, SourceDescriptor)
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import flagOverlapSimple
from fontTools import varLib
from fontTools.varLib.instancer import OverlapMode, instantiateVariableFont

from . import geometry as geo
from .glyphs import LETTERS, PUNCT, WIDTH

UPM = 1000
WEIGHTS = [(100, "Thin"), (200, "ExtraLight"), (300, "Light"), (400, "Regular"),
           (500, "Medium"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold"),
           (900, "Black")]
# stem thickness (as a fraction of letter height) for each master
MASTERS = {100: 0.040, 400: 0.145, 900: 0.275}


@dataclass
class Params:
    family: str = "Otiyot"
    height: float = 540       # letter height in units (of 1000/em)
    width: float = 1.0        # overall letter width multiplier
    contrast: float = 1.2     # horizontal / vertical thickness ratio
    roundness: float = 0.5    # 0 = square corners, 1 = very soft
    slant: float = 0.0        # degrees, positive leans right
    spacing: float = 1.0      # letter spacing multiplier
    head: float = 0.24        # length of the vav/yod/nun head (x height)
    ascender: float = 0.42    # lamed ascender (x height)
    descender: float = 0.45   # final-letter descender (x height)
    weight_scale: float = 1.0  # scales the whole weight range thinner/heavier

    @classmethod
    def from_dict(cls, d: dict | None) -> "Params":
        p = cls()
        if not d:
            return p
        for k, v in d.items():
            if not hasattr(p, k):
                continue
            if k == "family":
                p.family = str(v)[:40]
            else:
                setattr(p, k, float(v))
        p.clamp()
        return p

    def clamp(self):
        def c(v, lo, hi):
            return max(lo, min(hi, v))
        self.height = c(self.height, 420, 680)
        self.width = c(self.width, 0.7, 1.4)
        self.contrast = c(self.contrast, 0.6, 2.0)
        self.roundness = c(self.roundness, 0.0, 1.0)
        self.slant = c(self.slant, -14, 14)
        self.spacing = c(self.spacing, 0.3, 1.8)
        self.head = c(self.head, 0.05, 0.40)
        self.ascender = c(self.ascender, 0.15, 0.60)
        self.descender = c(self.descender, 0.15, 0.60)
        self.weight_scale = c(self.weight_scale, 0.6, 1.25)
        name = re.sub(r"[^\w \-֐-׿]", "", self.family).strip()
        self.family = name or "Otiyot"

    def key(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)


@dataclass
class Ctx:
    H: float
    A: float
    D: float
    stem: float
    bar: float
    w: float = 0.0
    soft: float = 0.0
    mid: float = 0.0
    tight: float = 0.0
    dotr: float = 0.0
    round: float = 0.0

    @property
    def L(self):
        return self.stem / 2

    @property
    def R(self):
        return self.w - self.stem / 2

    @property
    def T(self):
        return self.H - self.bar / 2

    @property
    def B(self):
        return self.bar / 2


# ---------------------------------------------------------------------------
# Geometry for one master
# ---------------------------------------------------------------------------

def _shape_contours(shape, ctx):
    if shape.kind == "fill":
        c = geo.filled_polygon(shape.pts, shape.radii)
        return [c if geo.signed_area(c) < 0 else geo.reverse_contour(c)]
    contours = geo.expand_stroke(shape.pts, shape.radii, ctx.bar, ctx.stem,
                                 closed=(shape.kind == "closed"), caps=shape.caps)
    if len(contours) == 1:
        c = contours[0]
        return [c if geo.signed_area(c) < 0 else geo.reverse_contour(c)]
    a, b = contours
    if abs(geo.signed_area(a)) < abs(geo.signed_area(b)):
        a, b = b, a
    outer = a if geo.signed_area(a) < 0 else geo.reverse_contour(a)
    inner = b if geo.signed_area(b) > 0 else geo.reverse_contour(b)
    return [outer, inner]


def master_outlines(p: Params, stem_frac: float):
    """Return {glyph: (advance, [contours])} for one weight master."""
    H = p.height
    stem = H * stem_frac * p.weight_scale
    # cap horizontals so three stacked bars (e.g. pe) still leave counters
    bar = min(stem * p.contrast, H * 0.25)
    reg_stem = H * MASTERS[400] * p.weight_scale
    ctx = Ctx(H=H, A=H * (1 + p.ascender), D=H * p.descender, stem=stem, bar=bar)
    rho = p.roundness
    ctx.soft = rho * H * 0.55
    ctx.mid = rho * H * 0.28
    ctx.tight = rho * H * 0.08
    ctx.round = H * (0.20 + 0.22 * rho)
    ctx.dotr = rho * max(stem, bar) * 0.56
    base_w = H * 0.95 * p.width
    sb = p.spacing * H * 0.085 + stem * 0.20
    skew = math.tan(math.radians(p.slant))

    out = {}

    def place(name, fn, w, side):
        ctx.w = w
        contours = []
        for shape in fn(ctx):
            contours.extend(_shape_contours(shape, ctx))

        def tf(pt):
            x, y = pt
            return (x + side + y * skew - H * 0.5 * skew, y)
        out[name] = (w + 2 * side, [geo.transform_contour(c, tf) for c in contours])

    for name, _cp, fn in LETTERS:
        f = WIDTH[name]
        if f is None:
            w = p.head * H + stem
        else:
            w = f * base_w + (stem - reg_stem) * 1.4 * f
        place(name, fn, w, sb)

    dot_size = max(stem, bar) * 1.12
    for name, _cps, fn, wf in PUNCT:
        w = dot_size if wf == "dot" else wf * H + (stem - reg_stem) * 0.5
        place(name, fn, w, sb * 1.1)

    # .notdef: an empty box
    nw = H * 0.6
    t = max(stem * 0.5, 20)
    outer = geo.filled_polygon([(0, 0), (nw, 0), (nw, H), (0, H)], [0] * 4)
    inner = geo.filled_polygon([(t, t), (nw - t, t), (nw - t, H - t), (t, H - t)], [0] * 4)
    outer = outer if geo.signed_area(outer) < 0 else geo.reverse_contour(outer)
    inner = inner if geo.signed_area(inner) > 0 else geo.reverse_contour(inner)
    out[".notdef"] = (nw + 2 * sb, [geo.transform_contour(c, lambda q: (q[0] + sb, q[1]))
                                    for c in (outer, inner)])
    space = H * 0.44 * p.spacing + stem * 0.3
    out["space"] = (space, [])
    out["nbspace"] = (space, [])
    return out


# ---------------------------------------------------------------------------
# Compatible cubic -> quadratic conversion and TTF master building
# ---------------------------------------------------------------------------

def _to_tt_glyphs(masters_outlines):
    """masters_outlines: list of [contours] (one per master) -> list of Glyph."""
    pens = [TTGlyphPen(None, outputImpliedClosingLine=True) for _ in masters_outlines]
    ncont = len(masters_outlines[0])
    for ci in range(ncont):
        conts = [m[ci] for m in masters_outlines]
        cur = [c[0][1] for c in conts]
        for pen, pt in zip(pens, cur):
            pen.moveTo(_r(pt))
        for si in range(1, len(conts[0])):
            segs = [c[si] for c in conts]
            if segs[0][0] == "line":
                for pen, s in zip(pens, segs):
                    pen.lineTo(_r(s[1]))
            else:
                curves = [[cur[k], s[1], s[2], s[3]] for k, s in enumerate(segs)]
                if all(_degenerate(cv) for cv in curves):
                    splines = [[cv[0], cv[3]] for cv in curves]
                    for pen, sp in zip(pens, splines):
                        pen.lineTo(_r(sp[-1]))
                else:
                    splines = curves_to_quadratic(curves, [1.0] * len(curves))
                    for pen, sp in zip(pens, splines):
                        pen.qCurveTo(*[_r(q) for q in sp[1:]])
            cur = [s[-1] for s in segs]
        for pen in pens:
            pen.closePath()
    return [pen.glyph() for pen in pens]


def _degenerate(cv):
    return all(abs(q[0] - cv[0][0]) < 1e-6 and abs(q[1] - cv[0][1]) < 1e-6 for q in cv)


def _r(pt):
    return (round(pt[0]), round(pt[1]))


def _cmap():
    cmap = {cp: name for name, cp, _ in LETTERS}
    for name, cps, _fn, _w in PUNCT:
        for cp in cps:
            cmap[cp] = name
    cmap[0x20] = "space"
    cmap[0xA0] = "nbspace"
    return cmap


def glyph_order():
    return [".notdef", "space", "nbspace"] + [n for n, _, _ in LETTERS] + [n for n, *_ in PUNCT]


def _ps_name(family):
    s = re.sub(r"[^A-Za-z0-9\-]", "", family)
    return s or "HebrewFont"


def _vertical_metrics(p: Params):
    asc = round(p.height * (1 + p.ascender) + p.height * 0.10)
    desc = round(p.height * p.descender + p.height * 0.12)
    return asc, desc


def _build_master(p: Params, glyphs: dict, advances: dict, weight: int):
    order = glyph_order()
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(_cmap())
    fb.setupGlyf(glyphs)
    glyf = fb.font["glyf"]
    metrics = {}
    for name in order:
        g = glyf[name]
        g.recalcBounds(glyf)
        lsb = getattr(g, "xMin", 0) if g.numberOfContours else 0
        metrics[name] = (round(advances[name]), lsb)
    fb.setupHorizontalMetrics(metrics)
    asc, desc = _vertical_metrics(p)
    rise, run = (1, 0)
    if p.slant:
        rise, run = 1000, round(1000 * math.tan(math.radians(p.slant)))
    fb.setupHorizontalHeader(ascent=asc, descent=-desc, caretSlopeRise=rise,
                             caretSlopeRun=run)
    fam = p.family
    fb.setupNameTable({
        "familyName": fam,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{_ps_name(fam)}-{weight}",
        "fullName": f"{fam} Regular",
        "psName": f"{_ps_name(fam)}-Regular",
        "version": "Version 1.000",
        "copyright": f"Copyright (c) {fam} authors. Generated with Font Studio.",
        "designer": "Font Studio",
    })
    fb.setupOS2(
        usWeightClass=weight, sTypoAscender=asc, sTypoDescender=-desc, sTypoLineGap=0,
        usWinAscent=asc + 40, usWinDescent=desc + 40,
        sxHeight=round(p.height), sCapHeight=round(p.height),
        fsSelection=0x40 | 0x80, achVendID="NONE", fsType=0, version=4,
    )
    os2 = fb.font["OS/2"]
    os2.recalcUnicodeRanges(fb.font)
    os2.recalcCodePageRanges(fb.font)
    fb.setupPost(italicAngle=-p.slant)
    fb.font["head"].fontRevision = 1.0
    return fb.font


def build_variable(p: Params) -> TTFont:
    order = glyph_order()
    per_master = {w: master_outlines(p, f) for w, f in MASTERS.items()}
    weights = list(MASTERS)
    tt = {w: {} for w in weights}
    for name in order:
        conv = _to_tt_glyphs([per_master[w][name][1] for w in weights])
        for w, g in zip(weights, conv):
            tt[w][name] = g
    ds = DesignSpaceDocument()
    ax = AxisDescriptor()
    ax.tag, ax.name, ax.minimum, ax.default, ax.maximum = "wght", "Weight", 100, 400, 900
    ds.addAxis(ax)
    for w in weights:
        font = _build_master(p, tt[w], {n: per_master[w][n][0] for n in order}, w)
        s = SourceDescriptor()
        s.font = font
        s.name = f"master-{w}"
        s.location = {"Weight": w}
        s.familyName = p.family
        s.styleName = "Regular"
        ds.addSource(s)
    for w, style in WEIGHTS:
        inst = InstanceDescriptor()
        inst.familyName = p.family
        inst.styleName = style
        inst.location = {"Weight": w}
        inst.postScriptFontName = f"{_ps_name(p.family)}-{style}"
        ds.addInstance(inst)
    vf, _, _ = varLib.build(ds, optimize=True)
    for name in order:
        g = vf["glyf"][name]
        if g.numberOfContours > 0:
            g.flags[0] |= flagOverlapSimple
    _add_stat(vf)
    return vf


def _add_stat(vf):
    from fontTools.otlLib.builder import buildStatTable
    values = []
    for w, style in WEIGHTS:
        v = {"value": w, "name": style}
        if w == 400:
            v["flags"] = 0x2
            v["linkedValue"] = 700
        values.append(v)
    buildStatTable(vf, [{"tag": "wght", "name": "Weight", "values": values}],
                   elidedFallbackName="Regular")


def static_instance(vf: TTFont, weight: int, style: str, p: Params) -> TTFont:
    f = instantiateVariableFont(vf, {"wght": weight}, inplace=False,
                                overlap=OverlapMode.REMOVE)
    for t in ("STAT",):
        if t in f:
            del f[t]
    name = f["name"]
    fam = p.family
    ps = _ps_name(fam)
    rib = style in ("Regular", "Bold")
    name.removeNames(nameID=1)
    name.removeNames(nameID=2)
    name.removeNames(nameID=4)
    name.removeNames(nameID=6)
    name.removeNames(nameID=16)
    name.removeNames(nameID=17)
    name.removeNames(nameID=25)
    name.setName(fam if rib else f"{fam} {style}", 1, 3, 1, 0x409)
    name.setName(style if rib else "Regular", 2, 3, 1, 0x409)
    name.setName(f"{fam} {style}", 4, 3, 1, 0x409)
    name.setName(f"{ps}-{style}", 6, 3, 1, 0x409)
    if not rib:
        name.setName(fam, 16, 3, 1, 0x409)
        name.setName(style, 17, 3, 1, 0x409)
    os2 = f["OS/2"]
    os2.usWeightClass = weight
    sel = os2.fsSelection & ~(0x1 | 0x20 | 0x40)
    if style == "Bold":
        sel |= 0x20
    elif style == "Regular":
        sel |= 0x40
    os2.fsSelection = sel | 0x80
    f["head"].macStyle = 0x1 if style == "Bold" else 0
    return f


def to_bytes(font: TTFont, flavor: str | None = None) -> bytes:
    buf = io.BytesIO()
    font.flavor = flavor
    font.save(buf)
    font.flavor = None
    return buf.getvalue()


def export_zip(p: Params) -> bytes:
    vf = build_variable(p)
    ps = _ps_name(p.family)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"variable/{ps}[wght].ttf", to_bytes(vf))
        z.writestr(f"web/{ps}[wght].woff2", to_bytes(vf, "woff2"))
        for w, style in WEIGHTS:
            st = static_instance(vf, w, style, p)
            z.writestr(f"static/{ps}-{style}.ttf", to_bytes(st))
            z.writestr(f"web/static/{ps}-{style}.woff2", to_bytes(st, "woff2"))
        z.writestr("web/font.css", _css(p, ps))
        z.writestr("params.json", json.dumps(asdict(p), ensure_ascii=False, indent=2))
        z.writestr("README.txt", _readme(p, ps))
    return buf.getvalue()


def _css(p, ps):
    style = "oblique" if p.slant else "normal"
    return f"""/* Variable font: one file, every weight from 100 to 900 */
@font-face {{
  font-family: "{p.family}";
  src: url("./{ps}[wght].woff2") format("woff2-variations"),
       url("./{ps}[wght].woff2") format("woff2");
  font-weight: 100 900;
  font-style: {style};
  font-display: swap;
  unicode-range: U+0590-05FF, U+0020-0040, U+00A0;
}}

/* Usage:
   body {{ font-family: "{p.family}", system-ui, sans-serif; font-weight: 400; }}
   h1   {{ font-weight: 800; }}
*/
"""


def _readme(p, ps):
    return f"""{p.family} — Hebrew font generated with Font Studio
==========================================================

variable/{ps}[wght].ttf   Variable font (weights 100–900). Install on your computer
                          or use in apps (iOS / Android / desktop).
web/{ps}[wght].woff2      The same variable font, compressed for websites.
web/font.css              Ready-made @font-face rule.
static/*.ttf              Nine fixed weights (Thin … Black), for programs that
                          don't support variable fonts.
params.json               The exact settings used. Load it back into Font Studio
                          to keep editing this design.

This font was generated from your own parameters; the outlines are original.
"""
