"""Modify an existing font file: weight, contrast, width, height, slant,
spacing, corner rounding, line height and an outline effect.

All glyphs are decomposed and converted to TrueType quadratic outlines once
(`prepare`), then every edit is a fast transform of those point arrays.
Emboldening follows FreeType's FT_Outline_EmboldenXY, so horizontal and
vertical strokes can be thickened independently (that is the "contrast"
control). Mark anchors (niqqud) and kerning are transformed along with the
outlines so diacritics stay in place.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import asdict, dataclass

import numpy as np
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import otBase, otTables, ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.varLib.instancer import instantiateVariableFont

from .analyze import MAX_FONT_BYTES, AnalyzeError

HINTING_TABLES = ("fpgm", "prep", "cvt ", "hdmx", "VDMX", "LTSH", "gasp", "cvar")


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

@dataclass
class EditParams:
    family: str = ""            # new family name (required on export)
    base_wght: float = 0        # for variable fonts: starting weight (0 = default)
    weight: float = 0           # overall stroke change, units per 1000 em
    contrast: float = 0         # >0 thicker horizontals, <0 thicker verticals
    width: float = 1.0          # horizontal scale
    height: float = 1.0         # vertical scale
    keep_strokes: bool = True   # compensate stroke thickness when scaling
    slant: float = 0.0          # degrees, positive leans right
    tracking: float = 0         # extra letter spacing, units per 1000 em
    corners: float = 0          # corner rounding radius, units per 1000 em
    outline: float = 0          # >0: hollow letters with this line thickness
    line_height: float = 1.0    # line spacing multiplier

    LIMITS = {
        "base_wght": (0, 1000), "weight": (-60, 140), "contrast": (-80, 80),
        "width": (0.6, 1.6), "height": (0.75, 1.3), "slant": (-15, 15),
        "tracking": (-80, 250), "corners": (0, 120), "outline": (0, 60),
        "line_height": (1.0, 2.0),
    }

    @classmethod
    def from_dict(cls, d: dict | None) -> "EditParams":
        p = cls()
        for k, v in (d or {}).items():
            if k == "family":
                p.family = re.sub(r"[^\w \-]", "", str(v), flags=re.ASCII)[:40].strip()
            elif k == "keep_strokes":
                p.keep_strokes = bool(v)
            elif k in cls.LIMITS:
                lo, hi = cls.LIMITS[k]
                try:
                    p.__setattr__(k, max(lo, min(hi, float(v))))
                except (TypeError, ValueError):
                    pass
        return p

    def key(self):
        d = asdict(self)
        d.pop("family")
        return tuple(sorted(d.items()))


# ---------------------------------------------------------------------------
# Licence check
# ---------------------------------------------------------------------------

FREE_PATTERNS = [
    (r"open font licen[cs]e|scripts\.sil\.org/ofl|openfontlicense\.org|\bofl\b", "OFL"),
    (r"apache licen[cs]e|apache\.org/licenses", "Apache"),
    (r"ubuntu font licen[cs]e", "Ubuntu Font License"),
    (r"creative commons zero|\bcc0\b|public domain", "Public domain / CC0"),
    (r"gnu general public licen[cs]e.*font exception|gpl.*font exception", "GPL + font exception"),
    (r"\bmit licen[cs]e\b", "MIT"),
]


def _name(font, nid):
    try:
        rec = font["name"].getDebugName(nid)
        return str(rec) if rec else ""
    except Exception:
        return ""


def license_info(font: TTFont) -> dict:
    text = " ".join(_name(font, i) for i in (0, 13, 14))
    low = text.lower()
    kind = None
    for pat, label in FREE_PATTERNS:
        if re.search(pat, low, re.S):
            kind = label
            break
    reserved = re.findall(r"reserved font names?\s*[\"“']([^\"”']+)[\"”']", text, re.I)
    fs_type = int(getattr(font.get("OS/2"), "fsType", 0) or 0)
    return {
        "kind": kind,
        "free": kind is not None,
        "text": _name(font, 13)[:600],
        "url": _name(font, 14),
        "copyright": _name(font, 0)[:300],
        "reserved_names": reserved,
        "restricted_embedding": bool(fs_type & 0x0002),
    }


# ---------------------------------------------------------------------------
# Preparation: decompose + convert to quadratic point arrays
# ---------------------------------------------------------------------------

class Prepared:
    """A font converted to a TrueType template + per-glyph point arrays."""

    def __init__(self, template: bytes, glyphs: dict, info: dict, stem: float, bar: float):
        self.template = template
        self.glyphs = glyphs          # name -> (coords float array, oncurve bool array, endPts)
        self.info = info
        self.stem, self.bar = stem, bar   # in font units


def _load(data: bytes) -> TTFont:
    if len(data) > MAX_FONT_BYTES:
        raise AnalyzeError("הקובץ גדול מדי (מעל 15MB)")
    try:
        return TTFont(io.BytesIO(data), fontNumber=0)
    except Exception as e:
        raise AnalyzeError("לא הצלחתי לקרוא את הקובץ כפונט (TTF / OTF / WOFF / WOFF2)") from e


def font_summary(data: bytes) -> dict:
    font = _load(data)
    axes = []
    if "fvar" in font:
        axes = [{"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue}
                for a in font["fvar"].axes]
    cmap = font.getBestCmap() or {}
    return {
        "family": _name(font, 16) or _name(font, 1),
        "style": _name(font, 17) or _name(font, 2),
        "glyphs": len(font.getGlyphOrder()),
        "hebrew": any(0x05D0 <= cp <= 0x05EA for cp in cmap),
        "niqqud": any(0x05B0 <= cp <= 0x05C7 for cp in cmap),
        "latin": any(0x41 <= cp <= 0x7A for cp in cmap),
        "axes": axes,
        "license": license_info(font),
        "upm": font["head"].unitsPerEm,
    }


def prepare(data: bytes, base_wght: float = 0) -> Prepared:
    font = _load(data)
    if "fvar" in font:
        loc = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        for a in font["fvar"].axes:
            if a.axisTag == "wght" and base_wght:
                loc["wght"] = max(a.minValue, min(a.maxValue, base_wght))
        font = instantiateVariableFont(font, loc, inplace=False)
    upm = font["head"].unitsPerEm
    is_cff = "CFF " in font or "CFF2" in font
    gs = font.getGlyphSet()
    order = font.getGlyphOrder()

    ttglyphs, arrays = {}, {}
    for name in order:
        rec = DecomposingRecordingPen(gs, skipMissingComponents=True)
        try:
            gs[name].draw(rec)
        except Exception:
            rec.value = []
        ttpen = TTGlyphPen(None)
        rec.replay(Cu2QuPen(ttpen, max_err=upm / 1000, reverse_direction=is_cff))
        g = ttpen.glyph()
        ttglyphs[name] = g
        if g.numberOfContours > 0:
            arrays[name] = (np.array(g.coordinates, dtype=np.float64),
                            np.array([bool(f & 1) for f in g.flags]),
                            list(g.endPtsOfContours))
        else:
            arrays[name] = None

    _to_truetype(font, ttglyphs, is_cff)
    for t in HINTING_TABLES:
        if t in font:
            del font[t]
    buf = io.BytesIO()
    font.save(buf)

    stem, bar = _stroke_estimate(data, upm)
    return Prepared(buf.getvalue(), arrays, {"upm": upm}, stem, bar)


def _stroke_estimate(data, upm):
    """Stem/bar thickness of the Hebrew letters (font units), for compensation."""
    try:
        from .analyze import analyze
        m = analyze(data)["measured"]
        return m["stem"] * upm / 1000, m["bar"] * upm / 1000
    except Exception:
        return 0.09 * upm, 0.08 * upm


def _to_truetype(font: TTFont, ttglyphs: dict, is_cff: bool):
    glyf = newTable("glyf")
    glyf.glyphOrder = font.getGlyphOrder()
    glyf.glyphs = ttglyphs
    for g in ttglyphs.values():
        g.program = ttProgram.Program()
        g.program.fromBytecode(b"")
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    if is_cff:
        for t in ("CFF ", "CFF2", "VORG"):
            if t in font:
                del font[t]
        font.sfntVersion = "\x00\x01\x00\x00"
        font["head"].glyphDataFormat = 0
        post = font["post"]
        post.formatType = 2.0
        post.extraNames = []
        post.mapping = {}
        post.glyphOrder = font.getGlyphOrder()
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr, val in (("maxZones", 1), ("maxTwilightPoints", 0), ("maxStorage", 0),
                      ("maxFunctionDefs", 0), ("maxInstructionDefs", 0), ("maxStackElements", 0),
                      ("maxSizeOfInstructions", 0), ("maxComponentElements", 0),
                      ("maxComponentDepth", 0)):
        setattr(maxp, attr, val)


# ---------------------------------------------------------------------------
# Outline transforms
# ---------------------------------------------------------------------------

def _contours(endpts):
    start = 0
    for e in endpts:
        yield start, e + 1
        start = e + 1


def _signed_area(coords):
    x, y = coords[:, 0], coords[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def embolden(coords, endpts, xs, ys):
    """FreeType-style FT_Outline_EmboldenXY on raw TrueType points."""
    if not xs and not ys:
        return coords
    out_coords = coords.copy()
    total = sum(_signed_area(coords[a:b]) for a, b in _contours(endpts))
    tt = total <= 0  # clockwise outer contours (TrueType orientation)
    xs, ys = xs / 2.0, ys / 2.0
    for a, b in _contours(endpts):
        p = coords[a:b]
        if len(p) < 2:
            continue
        nxt = np.roll(p, -1, axis=0)
        out = nxt - p
        l_out = np.hypot(out[:, 0], out[:, 1])
        # coincident points: borrow the next non-zero edge direction
        if np.any(l_out < 1e-9):
            idx = np.flatnonzero(l_out >= 1e-9)
            if idx.size == 0:
                continue
            fill = np.searchsorted(idx, np.arange(len(p))) % idx.size
            out = out[idx[fill]]
            l_out = l_out[idx[fill]]
        u_out = out / l_out[:, None]
        u_in = np.roll(u_out, 1, axis=0)
        l_in = np.roll(l_out, 1)
        d = np.sum(u_in * u_out, axis=1)
        ok = d > -0.9375
        dd = d + 1.0
        sx = -(u_in[:, 1] + u_out[:, 1]) if tt else (u_in[:, 1] + u_out[:, 1])
        sy = (u_in[:, 0] + u_out[:, 0]) if tt else -(u_in[:, 0] + u_out[:, 0])
        q = u_out[:, 0] * u_in[:, 1] - u_out[:, 1] * u_in[:, 0]
        if tt:
            q = -q
        lim = np.minimum(l_in, l_out)
        with np.errstate(divide="ignore", invalid="ignore"):
            shx = np.where(xs * q <= lim * dd, sx * xs / dd, sx * lim / q)
            shy = np.where(ys * q <= lim * dd, sy * ys / dd, sy * lim / q)
        shx = np.where(ok, np.nan_to_num(shx), 0.0)
        shy = np.where(ok, np.nan_to_num(shy), 0.0)
        out_coords[a:b, 0] += shx
        out_coords[a:b, 1] += shy
    return out_coords


def round_corners(coords, oncurve, endpts, radius):
    """Round sharp corners between two straight segments."""
    if radius <= 0:
        return coords, oncurve, endpts
    new_c, new_on, new_end = [], [], []
    for a, b in _contours(endpts):
        p, on = coords[a:b], oncurve[a:b]
        n = len(p)
        for i in range(n):
            prev_i, next_i = (i - 1) % n, (i + 1) % n
            if n >= 3 and on[i] and on[prev_i] and on[next_i]:
                v1, v2 = p[prev_i] - p[i], p[next_i] - p[i]
                l1, l2 = math.hypot(*v1), math.hypot(*v2)
                if l1 > 1e-6 and l2 > 1e-6:
                    cosang = float(np.dot(v1, v2) / (l1 * l2))
                    if cosang > -0.96:  # a real corner (< ~164 degrees)
                        t = min(radius, l1 * 0.45, l2 * 0.45)
                        new_c += [p[i] + v1 / l1 * t, p[i], p[i] + v2 / l2 * t]
                        new_on += [True, False, True]
                        continue
            new_c.append(p[i])
            new_on.append(bool(on[i]))
        new_end.append(len(new_c) - 1)
    return np.array(new_c), np.array(new_on), new_end


def _glyph_from(coords, oncurve, endpts):
    g = Glyph()
    g.numberOfContours = len(endpts)
    g.coordinates = GlyphCoordinates([(round(x), round(y)) for x, y in coords])
    g.flags = bytearray(1 if o else 0 for o in oncurve)
    g.endPtsOfContours = list(endpts)
    g.program = ttProgram.Program()
    g.program.fromBytecode(b"")
    return g


def _hollow(glyph, thickness, glyf):
    """Outline effect: keep a band of `thickness` around the outline."""
    import pathops
    coords = np.array(glyph.coordinates, dtype=np.float64)
    endpts = glyph.endPtsOfContours
    on = np.array([bool(f & 1) for f in glyph.flags])
    outer = _glyph_from(embolden(coords, endpts, thickness, thickness), on, endpts)
    inner = _glyph_from(embolden(coords, endpts, -thickness, -thickness), on, endpts)
    pa, pb = pathops.Path(), pathops.Path()
    outer.draw(pa.getPen(), glyf)
    inner.draw(pb.getPen(), glyf)
    pa.simplify()
    pb.simplify()
    res = pathops.op(pa, pb, pathops.PathOp.DIFFERENCE)
    pen = TTGlyphPen(None)
    res.draw(Cu2QuPen(pen, max_err=1.0))
    return pen.glyph()


def _walk_gpos(table, fx, fy, sx, sy):
    """Transform anchors and positioning values in GPOS."""
    seen = set()

    def visit(obj):
        if obj is None or id(obj) in seen:
            return
        seen.add(id(obj))
        if isinstance(obj, otTables.Anchor):
            x, y = obj.XCoordinate, obj.YCoordinate
            obj.XCoordinate, obj.YCoordinate = round(fx(x, y)), round(fy(x, y))
            if obj.Format == 2:
                obj.Format = 1
                if hasattr(obj, "AnchorPoint"):
                    del obj.AnchorPoint
            return
        if isinstance(obj, otBase.ValueRecord):
            for attr, s in (("XPlacement", sx), ("XAdvance", sx), ("YPlacement", sy), ("YAdvance", sy)):
                if hasattr(obj, attr):
                    setattr(obj, attr, round(getattr(obj, attr) * s))
            return
        if isinstance(obj, (list, tuple)):
            for v in obj:
                visit(v)
            return
        if isinstance(obj, dict):
            for v in obj.values():
                visit(v)
            return
        if isinstance(obj, otBase.BaseTable):
            for v in list(vars(obj).values()):
                if isinstance(v, (otBase.BaseTable, otBase.ValueRecord, list, tuple, dict)):
                    visit(v)

    visit(table)


# ---------------------------------------------------------------------------
# Apply an edit
# ---------------------------------------------------------------------------

def apply_edit(prep: Prepared, p: EditParams, remove_overlaps: bool = False,
               subset_codepoints=None) -> TTFont:
    font = TTFont(io.BytesIO(prep.template))
    upm = prep.info["upm"]
    u = upm / 1000.0
    sx, sy = p.width, p.height
    k = math.tan(math.radians(p.slant))

    ex = p.weight * u - p.contrast * u / 2
    ey = p.weight * u + p.contrast * u / 2
    if p.keep_strokes:
        ex += prep.stem * (1 - sx)
        ey += prep.bar * (1 - sy)
    ex = max(ex, -prep.stem * 0.8)
    ey = max(ey, -prep.bar * 0.8)
    shift = ex / 2
    track = p.tracking * u
    radius = p.corners * u

    glyf = font["glyf"]
    hmtx = font["hmtx"]
    for name, arr in prep.glyphs.items():
        adv, _lsb = hmtx[name]
        new_adv = adv * sx + ex + track if adv > 0 else adv
        if arr is None:
            hmtx[name] = (max(0, round(new_adv)), 0)
            continue
        coords, on, endpts = arr
        c = coords * np.array([sx, sy])
        on2, end2 = on, endpts
        if radius:
            c, on2, end2 = round_corners(c, on, endpts, radius)
        c = embolden(c, end2, ex, ey)
        c[:, 0] += shift + c[:, 1] * k
        g = _glyph_from(c, on2, end2)
        if p.outline > 0:
            g = _hollow(g, p.outline * u, glyf)
            g.program = ttProgram.Program()
            g.program.fromBytecode(b"")
        glyf[name] = g
        g.recalcBounds(glyf)
        hmtx[name] = (max(0, round(new_adv)), getattr(g, "xMin", 0))

    # positioning: anchors follow the outline transform, kerning scales
    if "GPOS" in font:
        _walk_gpos(font["GPOS"].table,
                   lambda x, y: x * sx + shift + y * sy * k,
                   lambda x, y: y * sy, sx, sy)
    if "kern" in font:
        for st in font["kern"].kernTables:
            if hasattr(st, "kernTable"):
                st.kernTable = {pair: round(v * sx) for pair, v in st.kernTable.items()}
    if "GDEF" in font and getattr(font["GDEF"].table, "LigCaretList", None):
        font["GDEF"].table.LigCaretList = None

    _metrics(font, p, sy, ey)
    if remove_overlaps:
        from fontTools.ttLib.removeOverlaps import removeOverlaps
        removeOverlaps(font, ignoreErrors=True)
    if subset_codepoints:
        from fontTools import subset
        opts = subset.Options()
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.glyph_names = False
        s = subset.Subsetter(opts)
        s.populate(unicodes=subset_codepoints)
        s.subset(font)
    return font


def _metrics(font, p, sy, ey):
    hhea, os2, head = font["hhea"], font["OS/2"], font["head"]
    grow = max(ey, 0) / 2
    asc = round(hhea.ascent * sy + grow)
    desc = round(hhea.descent * sy - grow)
    gap = max(0, hhea.lineGap)
    extra = round((asc - desc + gap) * (p.line_height - 1))
    hhea.ascent, hhea.descent, hhea.lineGap = asc, desc, gap + extra
    os2.sTypoAscender = round(os2.sTypoAscender * sy + grow)
    os2.sTypoDescender = round(os2.sTypoDescender * sy - grow)
    os2.sTypoLineGap = max(0, os2.sTypoLineGap) + round(
        (os2.sTypoAscender - os2.sTypoDescender + max(0, os2.sTypoLineGap)) * (p.line_height - 1))
    ymax = max((g.yMax for g in (font["glyf"][n] for n in font.getGlyphOrder())
                if g.numberOfContours > 0), default=asc)
    ymin = min((g.yMin for g in (font["glyf"][n] for n in font.getGlyphOrder())
                if g.numberOfContours > 0), default=desc)
    os2.usWinAscent = max(round(os2.usWinAscent * sy + grow), ymax)
    os2.usWinDescent = max(round(os2.usWinDescent * sy + grow), -ymin)
    if hasattr(os2, "sxHeight"):
        os2.sxHeight = round(os2.sxHeight * sy)
        os2.sCapHeight = round(os2.sCapHeight * sy)
    post = font["post"]
    post.italicAngle = float(post.italicAngle) - p.slant
    if p.slant:
        hhea.caretSlopeRise, hhea.caretSlopeRun = 1000, round(1000 * math.tan(math.radians(p.slant)))
    head.flags |= 0  # keep


def rename(font: TTFont, family: str):
    """Give the modified font its own name (required by OFL and good practice)."""
    name = font["name"]
    style = _name(font, 17) or _name(font, 2) or "Regular"
    ps_family = re.sub(r"[^A-Za-z0-9]", "", family) or "EditedFont"
    ps_style = re.sub(r"[^A-Za-z0-9]", "", style) or "Regular"
    ribbi = style in ("Regular", "Bold", "Italic", "Bold Italic")
    for nid in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
        name.removeNames(nameID=nid)
    name.setName(family if ribbi else f"{family} {style}", 1, 3, 1, 0x409)
    name.setName(style if ribbi else "Regular", 2, 3, 1, 0x409)
    name.setName(f"{ps_family}-{ps_style};FontStudio", 3, 3, 1, 0x409)
    name.setName(f"{family} {style}", 4, 3, 1, 0x409)
    name.setName(f"{ps_family}-{ps_style}", 6, 3, 1, 0x409)
    if not ribbi:
        name.setName(family, 16, 3, 1, 0x409)
        name.setName(style, 17, 3, 1, 0x409)
    old = _name(font, 0)
    note = "Modified with Font Studio."
    if note not in old:
        name.setName((old + " " + note).strip(), 0, 3, 1, 0x409)
    return ps_family, ps_style


def to_bytes(font: TTFont, flavor=None) -> bytes:
    buf = io.BytesIO()
    font.flavor = flavor
    font.save(buf)
    font.flavor = None
    return buf.getvalue()


PREVIEW_CODEPOINTS = (list(range(0x20, 0x7F)) + [0xA0] + list(range(0x0591, 0x05F5))
                      + list(range(0xFB1D, 0xFB50)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x20AA])
