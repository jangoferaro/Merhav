"""Measure the style of Hebrew letters from a picture (photo / screenshot).

Pipeline: binarise -> connected components -> group into lines and letters
-> match letters (right to left) to the text the user says is in the image
-> wrap each letter as a raster glyph and run the same `measure()` used for
font files. When the letters can't be matched to the text, a rougher global
measurement (stroke thickness, width) is used instead.
"""

from __future__ import annotations

import io
import math
import statistics

import numpy as np
from PIL import Image, ImageOps

from .analyze import AnalyzeError, measure
from .build import MASTERS, Params
from .glyphs import LETTERS

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_SIDE = 2400
UNIT_H = 560.0  # letter height that measured pixels are scaled to
CHAR_NAME = {chr(cp): name for name, cp, _fn in LETTERS}
DESCENDERS = {"finalkaf", "finalnun", "finalpe", "finaltsadi", "qof"}
DEFAULT_TEXT = "אבגדהוזחטיכךלמםנןסעפףצץקרשת"


# ---------------------------------------------------------------------------
# Image -> ink mask
# ---------------------------------------------------------------------------

def _load_gray(data: bytes) -> np.ndarray:
    if len(data) > MAX_IMAGE_BYTES:
        raise AnalyzeError("התמונה גדולה מדי (מעל 15MB)")
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > 60_000_000:
            raise AnalyzeError("התמונה גדולה מדי")
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
            img = Image.alpha_composite(bg, img)
        img = img.convert("L")
    except AnalyzeError:
        raise
    except Exception as e:
        raise AnalyzeError("לא הצלחתי לפתוח את התמונה (PNG / JPG / WEBP)") from e
    scale = min(1.0, MAX_SIDE / max(img.size))
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    return np.asarray(img, dtype=np.uint8)


def _otsu(gray: np.ndarray) -> int:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    omega = np.cumsum(hist) / total
    mu = np.cumsum(hist * np.arange(256)) / total
    mu_t = mu[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma = (mu_t * omega - mu) ** 2 / (omega * (1 - omega))
    sigma = np.nan_to_num(sigma)
    return int(np.argmax(sigma))


def ink_mask(gray: np.ndarray) -> np.ndarray:
    t = _otsu(gray)
    mask = gray <= t
    if mask.mean() > 0.5:  # light letters on a dark background
        mask = ~mask
    return mask


# ---------------------------------------------------------------------------
# Connected components (run-length union-find, 8-connected)
# ---------------------------------------------------------------------------

def components(mask: np.ndarray):
    """Return list of dicts: bbox (r0, c0, r1, c1) exclusive, area, runs."""
    parent = []

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    all_runs = []  # (row, c0, c1, label)
    prev = []
    for r in range(mask.shape[0]):
        row = mask[r]
        if not row.any():
            prev = []
            continue
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1)
        cur = []
        j = 0
        for c0, c1 in zip(starts.tolist(), ends.tolist()):
            label = len(parent)
            parent.append(label)
            # overlap with previous row runs (8-connectivity: allow touching diagonally)
            while j < len(prev) and prev[j][1] < c0:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] <= c1:
                union(label, prev[k][2])
                k += 1
            cur.append((c0, c1, label))
            all_runs.append((r, c0, c1, label))
        prev = cur

    comps = {}
    for r, c0, c1, label in all_runs:
        root = find(label)
        c = comps.get(root)
        if c is None:
            comps[root] = c = {"r0": r, "r1": r + 1, "c0": c0, "c1": c1, "area": 0, "runs": []}
        c["r0"] = min(c["r0"], r)
        c["r1"] = max(c["r1"], r + 1)
        c["c0"] = min(c["c0"], c0)
        c["c1"] = max(c["c1"], c1)
        c["area"] += c1 - c0
        c["runs"].append((r, c0, c1))
    return list(comps.values())


def _merge(a, b):
    return {"r0": min(a["r0"], b["r0"]), "r1": max(a["r1"], b["r1"]),
            "c0": min(a["c0"], b["c0"]), "c1": max(a["c1"], b["c1"]),
            "area": a["area"] + b["area"], "runs": a["runs"] + b["runs"]}


def letters_from_mask(mask: np.ndarray):
    """Group components into lines (top->bottom) of letters (right->left)."""
    comps = components(mask)
    if not comps:
        raise AnalyzeError("לא נמצאו אותיות בתמונה")
    H, W = mask.shape
    comps = [c for c in comps if (c["r1"] - c["r0"]) < H * 0.95 or (c["c1"] - c["c0"]) < W * 0.95]
    areas = sorted(c["area"] for c in comps)
    big = areas[len(areas) // 2:] or areas
    ref_area = statistics.median(big)
    comps = [c for c in comps if c["area"] >= max(8, ref_area * 0.03)]
    if not comps:
        raise AnalyzeError("לא נמצאו אותיות בתמונה")
    heights = sorted(c["r1"] - c["r0"] for c in comps)
    h_med = statistics.median(heights[len(heights) // 3:] or heights)

    # lines: cluster by vertical centre
    comps.sort(key=lambda c: (c["r0"] + c["r1"]) / 2)
    lines = []
    for c in comps:
        cy = (c["r0"] + c["r1"]) / 2
        if lines and abs(cy - lines[-1]["cy"]) < h_med * 0.65:
            ln = lines[-1]
            ln["items"].append(c)
            ln["cy"] = statistics.median((i["r0"] + i["r1"]) / 2 for i in ln["items"])
        else:
            lines.append({"cy": cy, "items": [c]})

    out = []
    for ln in lines:
        items = sorted(ln["items"], key=lambda c: c["c0"])
        merged = []
        for c in items:
            if merged:
                m = merged[-1]
                overlap = min(m["c1"], c["c1"]) - max(m["c0"], c["c0"])
                narrow = min(m["c1"] - m["c0"], c["c1"] - c["c0"])
                if overlap > narrow * 0.35:
                    merged[-1] = _merge(m, c)
                    continue
            merged.append(c)
        merged.sort(key=lambda c: -c["c1"])  # right to left
        out.append(merged)
    return out, h_med


# ---------------------------------------------------------------------------
# Raster glyph with the same interface as analyze.Glyph
# ---------------------------------------------------------------------------

class RasterGlyph:
    advance = None

    def __init__(self, comp, baseline_row: float, s: float):
        self.r0, self.c0 = comp["r0"], comp["c0"]
        h, w = comp["r1"] - comp["r0"], comp["c1"] - comp["c0"]
        self.mask = np.zeros((h, w), dtype=bool)
        for r, a, b in comp["runs"]:
            self.mask[r - self.r0, a - self.c0:b - self.c0] = True
        self.b, self.s = baseline_row, s
        self.k, self.y0 = 0.0, 0.0
        self.ymax = (self.b - self.r0) * s
        self.ymin = (self.b - comp["r1"]) * s
        self._bounds()

    def _y(self, r):  # row centre (absolute row) -> units
        return (self.b - r - 0.5) * self.s

    def _bounds(self):
        rows, cols = np.nonzero(self.mask)
        ys = (self.b - (rows + self.r0) - 0.5) * self.s
        xs = (cols + self.c0 + 0.5) * self.s - (ys - self.y0) * self.k
        self.xmin, self.xmax = float(xs.min()) - self.s / 2, float(xs.max()) + self.s / 2

    @property
    def width(self):
        return self.xmax - self.xmin

    def deskew(self, k, y0):
        self.k, self.y0 = k, y0
        self._bounds()

    def runs(self, value, axis):
        s = self.s
        if axis == 1:  # horizontal line at y=value
            r = int(math.floor(self.b - value / s)) - self.r0
            if not 0 <= r < self.mask.shape[0]:
                return []
            row = self.mask[r]
            shift = (value - self.y0) * self.k
            d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
            starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
            return [((a + self.c0) * s - shift, (e + self.c0) * s - shift)
                    for a, e in zip(starts.tolist(), ends.tolist())]
        # vertical line at x=value (in de-skewed space)
        hits = []
        for r in range(self.mask.shape[0]):
            y = self._y(r + self.r0)
            c = int(math.floor((value + (y - self.y0) * self.k) / s)) - self.c0
            hits.append(0 <= c < self.mask.shape[1] and bool(self.mask[r, c]))
        out, start = [], None
        for r, on in enumerate(hits + [False]):
            if on and start is None:
                start = r
            elif not on and start is not None:
                top_y = (self.b - (start + self.r0)) * s
                bot_y = (self.b - (r + self.r0)) * s
                out.append((bot_y, top_y))
                start = None
        out.sort()
        return out

    def inside(self, x, y):
        r = int(math.floor(self.b - y / self.s)) - self.r0
        c = int(math.floor((x + (y - self.y0) * self.k) / self.s)) - self.c0
        return 0 <= r < self.mask.shape[0] and 0 <= c < self.mask.shape[1] and bool(self.mask[r, c])


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def _hebrew_letters(text: str) -> list[str]:
    return [ch for ch in text if ch in CHAR_NAME]


def analyze_image(data: bytes, text: str = "") -> dict:
    gray = _load_gray(data)
    mask = ink_mask(gray)
    lines, _h_med = letters_from_mask(mask)
    found = [c for ln in lines for c in ln]
    chars = _hebrew_letters(text or "")
    img_h, img_w = mask.shape

    def boxes(labels=None):
        out = []
        for i, c in enumerate(found):
            out.append({"x": c["c0"] / img_w, "y": c["r0"] / img_h,
                        "w": (c["c1"] - c["c0"]) / img_w, "h": (c["r1"] - c["r0"]) / img_h,
                        "label": labels[i] if labels else ""})
        return out

    if chars and len(chars) == len(found):
        result = _matched(lines, chars)
        result["boxes"] = boxes(chars)
        result["matched"] = True
    else:
        result = _global(lines)
        result["boxes"] = boxes()
        result["matched"] = False
        if chars:
            result["note"] = (f"זיהיתי בתמונה {len(found)} אותיות, אבל בטקסט שכתבתם יש {len(chars)}. "
                              "המדידה היא הערכה כללית. כדי לקבל מדידה מדויקת, תקנו את הטקסט "
                              "כך שיתאים בדיוק למה שכתוב בתמונה.")
        else:
            result["note"] = "לא נכתב מה מופיע בתמונה, אז המדידה היא הערכה כללית."
    result["source"] = {"kind": "image", "family": "", "weight": 400, "variable": False}
    result["found_letters"] = len(found)
    return result


def _line_baseline(items, names):
    bottoms = [c["r1"] for c, n in zip(items, names) if n not in DESCENDERS]
    if not bottoms:
        bottoms = [c["r1"] for c in items]
    return statistics.median(bottoms)


def _matched(lines, chars):
    names = [CHAR_NAME[ch] for ch in chars]
    g = {}
    pairs = []
    i = 0
    for ln in lines:
        ln_names = names[i:i + len(ln)]
        base = _line_baseline(ln, ln_names)
        tops = [base - c["r0"] for c, n in zip(ln, ln_names)
                if n in ("he", "het", "dalet", "resh", "tav", "kaf", "bet", "mem", "samekh")]
        if not tops:
            tops = [base - c["r0"] for c, n in zip(ln, ln_names) if n != "lamed"]
        h_px = statistics.median(tops) if tops else None
        if h_px and h_px > 4:
            s = UNIT_H / h_px
            line_glyphs = []
            for c, n in zip(ln, ln_names):
                rg = RasterGlyph(c, base, s)
                line_glyphs.append(rg)
                g.setdefault(n, rg)
            pairs.extend(zip(line_glyphs, line_glyphs[1:]))
        i += len(ln)
    if len(g) < 3:
        raise AnalyzeError("לא הצלחתי לזהות מספיק אותיות בתמונה")
    # first pass finds the slant; de-skew every letter before measuring gaps
    _p, first = measure(g, weight=400, with_height=False)
    if first["slant_degrees"]:
        k = math.tan(math.radians(first["slant_degrees"]))
        for a, b in pairs:
            a.deskew(k, UNIT_H * 0.5)
            b.deskew(k, UNIT_H * 0.5)
    gaps = [a.xmin - b.xmax for a, b in pairs]
    for gl in g.values():  # measure() detects and applies the slant itself
        gl.deskew(0.0, 0.0)
    sb = None
    if len(gaps) >= 3:
        med = statistics.median(gaps)
        # gaps much larger than the median are word spaces
        tight = [x for x in gaps if x < med * 1.8]
        sb = statistics.median(tight) / 2 if tight else None
        # letters typed with spaces between them: spacing can't be measured
        if sb is not None and sb > UNIT_H * 0.35:
            sb = None
    params, measured = measure(g, weight=400, sb_override=sb, with_height=False)
    return {"params": params, "measured": measured,
            "missing_letters": [n for n, _cp, _f in LETTERS if n not in g]}


def _global(lines):
    """Rough style estimate when letters can't be identified."""
    stems, bars, widths, hs = [], [], [], []
    for ln in lines:
        base = statistics.median(c["r1"] for c in ln)
        h_px = statistics.median(base - c["r0"] for c in ln)
        if h_px <= 4:
            continue
        s = UNIT_H / h_px
        for c in ln:
            g = RasterGlyph(c, base, s)
            hs.append(g.ymax)
            r = g.runs(UNIT_H * 0.45, 1)
            if r:
                stems.extend(e - a for a, e in r)
            v = g.runs(g.xmin + g.width * 0.5, 0)
            if v and v[-1][1] > UNIT_H * 0.8:
                bars.append(v[-1][1] - v[-1][0])
            widths.append(g.width)
    if not stems or not widths:
        raise AnalyzeError("לא הצלחתי למדוד את האותיות בתמונה")
    stems = sorted(stems)
    stem = statistics.median(stems[: max(1, len(stems) * 2 // 3)])  # drop merged blobs
    bar = statistics.median(bars) if bars else stem
    width = statistics.median(widths) / (0.9 * 0.95 * UNIT_H)
    raw = {"width": width, "contrast": bar / stem,
           "weight_scale": stem / (UNIT_H * MASTERS[400])}
    p = Params.from_dict(raw)
    params = {k: round(getattr(p, k), 3) for k in raw}
    measured = {"letter_height": round(UNIT_H), "stem": round(stem), "bar": round(bar),
                "corner_radius": None, "slant_degrees": None}
    return {"params": params, "measured": measured, "missing_letters": []}
