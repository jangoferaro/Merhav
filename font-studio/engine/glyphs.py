"""Hebrew letter skeletons.

Each glyph is a function `f(g)` receiving a metrics context and returning
a list of shapes. Coordinates are in font units (1000 per em), baseline at
y=0, the glyph's ink box spans x in [0, g.w].

Useful context values:
    g.H     letter (body) height          g.A   ascender top (lamed)
    g.D     descender depth (positive)    g.w   width of this glyph
    g.stem  vertical stroke thickness     g.bar horizontal stroke thickness
    g.L     centre x of a left stem       g.R   centre x of a right stem
    g.T     centre y of a top bar         g.B   centre y of a bottom bar
    g.soft / g.mid / g.tight   corner radii (scaled by the roundness param)

Rule for variable-font safety: a glyph's list of shapes and the number of
vertices in each must never depend on parameters — only coordinates may.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Shape:
    kind: str          # "stroke" | "closed" | "fill"
    pts: list
    radii: list
    caps: tuple = ("p", "p")


def S(*verts, caps=("p", "p")):
    """Open stroke. verts are (x, y) or (x, y, outer_radius)."""
    pts = [(v[0], v[1]) for v in verts]
    radii = [v[2] if len(v) > 2 else 0.0 for v in verts]
    return Shape("stroke", pts, radii, caps)


def C(*verts):
    """Closed stroke (a ring)."""
    pts = [(v[0], v[1]) for v in verts]
    radii = [v[2] if len(v) > 2 else 0.0 for v in verts]
    return Shape("closed", pts, radii)


def F(*verts):
    """Filled polygon with rounded corners."""
    pts = [(v[0], v[1]) for v in verts]
    radii = [v[2] if len(v) > 2 else 0.0 for v in verts]
    return Shape("fill", pts, radii)


def dot(x, y, size, r):
    h = size / 2
    return F((x - h, y - h, r), (x + h, y - h, r), (x + h, y + h, r), (x - h, y + h, r))


# ---------------------------------------------------------------------------
# Width of each glyph, relative to the base letter width.
# "narrow" glyphs (vav-like) compute their width from the head length.
# ---------------------------------------------------------------------------

WIDTH = {
    "alef": 1.00, "bet": 0.95, "gimel": 0.62, "dalet": 0.90, "he": 0.95,
    "vav": None, "zayin": 0.52, "het": 0.95, "tet": 0.95, "yod": None,
    "finalkaf": 0.84, "kaf": 0.86, "lamed": 0.86, "finalmem": 0.94,
    "mem": 1.00, "finalnun": None, "nun": 0.56, "samekh": 0.96, "ayin": 0.94,
    "finalpe": 0.88, "pe": 0.92, "finaltsadi": 0.86, "tsadi": 0.92,
    "qof": 0.95, "resh": 0.86, "shin": 1.12, "tav": 1.00,
}


# ---------------------------------------------------------------------------
# Letters
# ---------------------------------------------------------------------------

def alef(g):
    top_x, bot_x = g.w * 0.10, g.w - g.stem * 0.55
    d0, d1 = (top_x, g.H), (bot_x, 0)

    def on_diag(t):
        return (d0[0] + (d1[0] - d0[0]) * t, d0[1] + (d1[1] - d0[1]) * t)

    arm_x = g.R
    j1 = on_diag(0.47)
    j2 = on_diag(0.60)
    leg_x = g.L + g.w * 0.02
    return [
        S(d0, d1, caps=("h", "h")),
        S((arm_x, g.H), (arm_x, g.H * 0.64, g.mid), j1, caps=("p", "p")),
        S(j2, (leg_x, g.H * 0.30, g.mid), (leg_x, 0), caps=("p", "p")),
    ]


def bet(g):
    heel = g.w * 0.10 + g.stem * 0.15
    sx = g.w - heel - g.stem / 2
    return [
        S((0, g.T), (sx, g.T, g.soft * 0.8), (sx, g.B)),
        S((0, g.B), (g.w, g.B)),
    ]


def gimel(g):
    return [
        S((g.w * 0.18, g.T), (g.R, g.T, g.tight), (g.R, 0)),
        S((g.R, g.H * 0.48), (g.L * 0.6, 0), caps=("p", "h")),
    ]


def dalet(g):
    ear = g.w * 0.12 + g.stem * 0.1
    sx = g.w - ear - g.stem / 2
    return [
        S((0, g.T), (g.w, g.T)),
        S((sx, g.T), (sx, 0)),
    ]


def he(g):
    leg_top = min(g.H * 0.62, g.H - g.bar - g.H * 0.15)
    return [
        S((0, g.T), (g.R, g.T, g.tight), (g.R, 0)),
        S((g.L, leg_top), (g.L, 0)),
    ]


def vav(g):
    return [S((0, g.T), (g.R, g.T, g.tight), (g.R, 0))]


def zayin(g):
    sx = g.w * 0.5
    return [
        S((0, g.T), (g.w, g.T)),
        S((sx, g.T), (sx, 0)),
    ]


def het(g):
    return [S((g.L, 0), (g.L, g.T, g.tight), (g.R, g.T, g.tight), (g.R, 0))]


def tet(g):
    fold = g.w * 0.50
    fold_end = min(g.H * 0.56, g.H - g.bar - g.H * 0.12)
    return [S((g.R, g.H), (g.R, g.B, g.soft), (g.L, g.B, g.soft),
              (g.L, g.T, g.tight), (fold, g.T, g.tight), (fold, fold_end))]


def yod(g):
    return [S((0, g.T), (g.R, g.T, g.tight), (g.R, g.H * 0.50))]


def finalkaf(g):
    return [S((0, g.T), (g.R, g.T, g.soft * 0.8), (g.R, -g.D))]


def kaf(g):
    return [S((0, g.T), (g.R, g.T, g.soft), (g.R, g.B, g.soft), (0, g.B))]


def lamed(g):
    return [S((g.L, g.A), (g.L, g.T, g.tight), (g.R, g.T, g.mid),
              (g.R, g.H * 0.42, g.soft), (g.w * 0.28, 0), caps=("p", "h"))]


def finalmem(g):
    r = g.mid * 0.6
    return [C((g.L, g.T, g.tight), (g.R, g.T, r), (g.R, g.B, r), (g.L, g.B, r))]


def mem(g):
    lx = g.L + g.w * 0.05
    return [
        S((0, g.T), (g.R, g.T, g.soft * 0.75), (g.R, g.B, g.soft * 0.75), (g.w * 0.40, g.B)),
        S((lx, g.T), (g.L, 0), caps=("h", "h")),
    ]


def finalnun(g):
    return [S((0, g.T), (g.R, g.T, g.tight), (g.R, -g.D))]


def nun(g):
    return [S((0, g.T), (g.R, g.T, g.tight), (g.R, g.B, g.mid), (0, g.B))]


def samekh(g):
    lx = g.w * 0.06 + g.stem / 2
    return [
        C((lx, g.T, g.tight), (g.R, g.T, g.mid), (g.R, g.B, g.round), (lx, g.B, g.round)),
        S((0, g.T), (lx + g.stem / 2, g.T)),
    ]


def ayin(g):
    bend = (g.R, g.H * 0.36, g.mid)
    tail = (g.w * 0.06, 0)
    join = (g.R - g.w * 0.22, g.H * 0.22)
    return [
        S((g.R, g.H), bend, tail, caps=("p", "h")),
        S((g.L, g.H), (g.L, g.H * 0.60, g.soft), join),
    ]


def _tongue(g):
    """The inward-curling tongue hanging from pe's top-left corner."""
    y = min(g.H * 0.50, g.H - g.bar - g.H * 0.20)
    tip = g.L + g.stem / 2 + g.w * 0.16
    return [(tip, y), (g.L, y, g.mid * 0.8), (g.L, g.T, g.tight)]


def finalpe(g):
    return [S(*_tongue(g), (g.R, g.T, g.soft * 0.8), (g.R, -g.D))]


def pe(g):
    return [S(*_tongue(g), (g.R, g.T, g.soft), (g.R, g.B, g.soft), (0, g.B))]


def tsadi(g):
    return [
        S((g.L, g.H), (g.L, g.B, g.soft), (g.w, g.B)),
        S((g.R, g.H), (g.R, g.H * 0.62, g.mid), (g.L, g.H * 0.34), caps=("p", "p")),
    ]


def finaltsadi(g):
    sx = g.L + g.w * 0.06
    return [
        S((sx, g.H), (sx, -g.D)),
        S((g.R, g.H), (g.R, g.H * 0.62, g.mid), (sx, g.H * 0.36)),
    ]


def qof(g):
    leg_top = min(g.H * 0.60, g.H - g.bar - g.H * 0.15)
    return [
        S((0, g.T), (g.R, g.T, g.mid), (g.R, 0)),
        S((g.L, leg_top), (g.L, -g.D)),
    ]


def resh(g):
    return [S((0, g.T), (g.R, g.T, g.soft), (g.R, 0))]


def shin(g):
    mx = g.w * 0.5
    return [
        S((g.L, g.H), (g.L, g.B, g.soft), (g.R, g.B, g.soft), (g.R, g.H)),
        S((mx, g.H), (mx, g.B)),
    ]


def tav(g):
    foot = g.w * 0.11 + g.stem * 0.1
    lx = foot + g.stem / 2
    return [
        S((g.R, 0), (g.R, g.T, g.tight), (lx, g.T, g.tight), (lx, 0)),
        S((0, g.B), (lx + g.stem / 2, g.B)),
    ]


# ---------------------------------------------------------------------------
# Punctuation (shared by RTL and LTR text)
# ---------------------------------------------------------------------------

def _dot_size(g):
    return max(g.stem, g.bar) * 1.12


def period(g):
    s = _dot_size(g)
    return [dot(g.w / 2, s / 2, s, g.dotr)]


def comma(g):
    s = _dot_size(g)
    cx = g.w / 2
    return [
        dot(cx, s / 2, s, g.dotr),
        S((cx + s * 0.25, s * 0.5), (cx - s * 0.25, -s * 0.85), caps=("p", "h")),
    ]


def colon(g):
    s = _dot_size(g)
    return [dot(g.w / 2, s / 2, s, g.dotr), dot(g.w / 2, g.H * 0.72 - s / 2, s, g.dotr)]


def hyphen(g):
    return [S((0, g.H * 0.42), (g.w, g.H * 0.42))]


def maqaf(g):
    return [S((0, g.T), (g.w, g.T))]


def geresh(g):
    return [S((g.w * 0.75, g.H), (g.w * 0.25, g.H * 0.62), caps=("h", "h"))]


def gershayim(g):
    gap = g.w * 0.5
    return [
        S((g.w * 0.38 + gap, g.H), (gap, g.H * 0.62), caps=("h", "h")),
        S((g.w * 0.38, g.H), (0, g.H * 0.62), caps=("h", "h")),
    ]


def quotesingle(g):
    return [S((g.w / 2, g.H + g.H * 0.08), (g.w / 2, g.H * 0.66))]


def quotedbl(g):
    return [
        S((g.stem / 2, g.H + g.H * 0.08), (g.stem / 2, g.H * 0.66)),
        S((g.w - g.stem / 2, g.H + g.H * 0.08), (g.w - g.stem / 2, g.H * 0.66)),
    ]


def exclam(g):
    s = _dot_size(g)
    cx = g.w / 2
    return [S((cx, g.H + g.H * 0.08), (cx, s * 1.9)), dot(cx, s / 2, s, g.dotr)]


def question(g):
    s = _dot_size(g)
    mx = g.w * 0.5
    top = g.H + g.H * 0.08 - g.bar / 2
    return [
        S((g.L, g.H * 0.74), (g.L, top, g.mid), (g.R, top, g.mid),
          (g.R, g.H * 0.46, g.mid), (mx, g.H * 0.46, g.tight), (mx, s * 1.9)),
        dot(mx, s / 2, s, g.dotr),
    ]


# name -> (unicode codepoints, function, width factor or None)
LETTERS = [
    ("alef", 0x05D0, alef), ("bet", 0x05D1, bet), ("gimel", 0x05D2, gimel),
    ("dalet", 0x05D3, dalet), ("he", 0x05D4, he), ("vav", 0x05D5, vav),
    ("zayin", 0x05D6, zayin), ("het", 0x05D7, het), ("tet", 0x05D8, tet),
    ("yod", 0x05D9, yod), ("finalkaf", 0x05DA, finalkaf), ("kaf", 0x05DB, kaf),
    ("lamed", 0x05DC, lamed), ("finalmem", 0x05DD, finalmem), ("mem", 0x05DE, mem),
    ("finalnun", 0x05DF, finalnun), ("nun", 0x05E0, nun), ("samekh", 0x05E1, samekh),
    ("ayin", 0x05E2, ayin), ("finalpe", 0x05E3, finalpe), ("pe", 0x05E4, pe),
    ("finaltsadi", 0x05E5, finaltsadi), ("tsadi", 0x05E6, tsadi), ("qof", 0x05E7, qof),
    ("resh", 0x05E8, resh), ("shin", 0x05E9, shin), ("tav", 0x05EA, tav),
]

# name -> (codepoints, fn, width in units of H)
PUNCT = [
    ("period", [0x002E], period, "dot"),
    ("comma", [0x002C], comma, "dot"),
    ("colon", [0x003A], colon, "dot"),
    ("hyphen", [0x002D], hyphen, 0.42),
    ("maqaf", [0x05BE], maqaf, 0.50),
    ("geresh", [0x05F3], geresh, 0.24),
    ("gershayim", [0x05F4], gershayim, 0.50),
    ("quotesingle", [0x0027], quotesingle, "dot"),
    ("quotedbl", [0x0022], quotedbl, 0.40),
    ("exclam", [0x0021], exclam, "dot"),
    ("question", [0x003F], question, 0.62),
]
