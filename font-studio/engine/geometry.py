"""Stroke geometry: turns skeleton strokes into clean outline contours.

Every letter is described as a few *strokes*: centre-line polylines whose
corners carry an outer corner radius. A stroke is expanded into an outline
whose thickness depends on direction — horizontal parts get the "bar"
thickness and vertical parts the "stem" thickness. Hebrew square script is
traditionally heavier on the horizontals, which the `contrast` parameter
controls.

Key invariant (needed for variable fonts): the *structure* of the output
(number of contours, segments and their types) depends only on the
skeleton, never on the numeric parameters. A sharp corner is emitted as a
degenerate curve rather than omitted, so every weight master stays
point-compatible and can be interpolated.

Contours are lists of segments:
    ("move", p) first, then ("line", p) or ("curve", c1, c2, p).
The contour is implicitly closed back to the move point.
"""

from __future__ import annotations

import math

Point = tuple[float, float]
EPS = 1e-9


def add(a: Point, b: Point) -> Point:
    return (a[0] + b[0], a[1] + b[1])


def sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1])


def mul(a: Point, s: float) -> Point:
    return (a[0] * s, a[1] * s)


def dot(a: Point, b: Point) -> float:
    return a[0] * b[0] + a[1] * b[1]


def cross(a: Point, b: Point) -> float:
    return a[0] * b[1] - a[1] * b[0]


def length(a: Point) -> float:
    return math.hypot(a[0], a[1])


def unit(a: Point) -> Point:
    n = length(a)
    if n < EPS:
        return (1.0, 0.0)
    return (a[0] / n, a[1] / n)


def lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def intersect(p: Point, d: Point, q: Point, e: Point) -> Point | None:
    """Intersection of lines p + s*d and q + u*e (None when parallel)."""
    den = cross(d, e)
    if abs(den) < 1e-7:
        return None
    s = cross(sub(q, p), e) / den
    return add(p, mul(d, s))


def stroke_width(d: Point, bar: float, stem: float) -> float:
    """Thickness for a stroke travelling in unit direction d.

    Horizontal travel -> bar thickness, vertical travel -> stem thickness,
    smoothly blended for diagonals (a broad-nib like model).
    """
    return bar * d[0] * d[0] + stem * d[1] * d[1]


# ---------------------------------------------------------------------------
# Corner filleting
# ---------------------------------------------------------------------------

def _fillet(miter: Point, d_in: Point, d_out: Point, radius: float,
            max_in: float, max_out: float):
    """Round a corner whose sides meet at `miter`.

    Returns (start, c1, c2, end) of a cubic approximating a circular arc
    tangent to both sides. radius 0 gives a degenerate curve at the miter,
    i.e. a sharp corner with an unchanged point structure.
    """
    cosang = max(-1.0, min(1.0, dot(d_in, d_out)))
    theta = math.acos(cosang)  # turning angle
    if theta < 1e-4 or radius <= 0:
        return (miter, miter, miter, miter)
    tan_half = math.tan(theta / 2)
    t = radius * tan_half
    t = max(0.0, min(t, max_in, max_out))
    r_eff = t / tan_half if tan_half > EPS else 0.0
    k = 4.0 / 3.0 * math.tan(theta / 4)
    start = sub(miter, mul(d_in, t))
    end = add(miter, mul(d_out, t))
    c1 = add(start, mul(d_in, k * r_eff))
    c2 = sub(end, mul(d_out, k * r_eff))
    return (start, c1, c2, end)


def _offset_miter(p: Point, d_a: Point, n_a: Point, h_a: float,
                  d_b: Point, n_b: Point, h_b: float, side: float) -> Point:
    """Corner point of the offset lines on one side (side=+1 left, -1 right)."""
    pa = add(p, mul(n_a, h_a * side))
    pb = add(p, mul(n_b, h_b * side))
    m = intersect(pa, d_a, pb, d_b)
    if m is None:  # collinear
        return lerp(pa, pb, 0.5)
    # Guard against extreme miters on very sharp turns.
    limit = 4.0 * max(h_a, h_b)
    if length(sub(m, p)) > limit:
        m = add(p, mul(unit(sub(m, p)), limit))
    return m


# ---------------------------------------------------------------------------
# Stroke expansion
# ---------------------------------------------------------------------------

def _cap_point(p: Point, d: Point, n: Point, h: float, side: float, mode: str) -> Point:
    base = add(p, mul(n, h * side))
    if mode == "h":
        cut = (1.0, 0.0)
    elif mode == "v":
        cut = (0.0, 1.0)
    else:
        return base
    m = intersect(base, d, p, cut)
    if m is None:
        return base
    if length(sub(m, base)) > 3 * h + 1:
        return base
    return m


def expand_stroke(points, radii, bar: float, stem: float, closed: bool = False,
                  caps=("p", "p")):
    """Expand a skeleton polyline into outline contour(s).

    points : list of (x, y) centre-line vertices
    radii  : outer corner radius per vertex (end vertices ignored if open)
    caps   : cut mode at the start/end: "p" perpendicular, "h" horizontal,
             "v" vertical.
    Returns a list of contours (1 for open strokes, 2 for closed ones).
    """
    n = len(points)
    nseg = n if closed else n - 1
    dirs, norms, halfs, lens = [], [], [], []
    for i in range(nseg):
        a, b = points[i], points[(i + 1) % n]
        d = unit(sub(b, a))
        dirs.append(d)
        norms.append((-d[1], d[0]))
        halfs.append(stroke_width(d, bar, stem) / 2)
        lens.append(length(sub(b, a)))

    corner_ids = range(n) if closed else range(1, n - 1)
    left, right = [], []  # lists of fillet tuples per corner
    for j in corner_ids:
        ia = (j - 1) % nseg
        ib = j % nseg
        d_a, d_b = dirs[ia], dirs[ib]
        n_a, n_b = norms[ia], norms[ib]
        h_a, h_b = halfs[ia], halfs[ib]
        # available length for the fillet along each adjacent segment
        a_shared = closed or ia > 0
        b_shared = closed or ib < nseg - 1
        max_in = lens[ia] * (0.5 if a_shared else 0.95)
        max_out = lens[ib] * (0.5 if b_shared else 0.95)
        turn = cross(d_a, d_b)
        r_outer = radii[j]
        r_inner = max(0.0, r_outer - (h_a + h_b))
        ml = _offset_miter(points[j], d_a, n_a, h_a, d_b, n_b, h_b, +1)
        mr = _offset_miter(points[j], d_a, n_a, h_a, d_b, n_b, h_b, -1)
        # left turn -> left side is the inner side
        rl, rr = (r_inner, r_outer) if turn > 0 else (r_outer, r_inner)
        left.append(_fillet(ml, d_a, d_b, rl, max_in, max_out))
        right.append(_fillet(mr, d_a, d_b, rr, max_in, max_out))

    if closed:
        return [_loop(left), _loop(right)]

    s_l = _cap_point(points[0], dirs[0], norms[0], halfs[0], +1, caps[0])
    s_r = _cap_point(points[0], dirs[0], norms[0], halfs[0], -1, caps[0])
    e_l = _cap_point(points[-1], dirs[-1], norms[-1], halfs[-1], +1, caps[1])
    e_r = _cap_point(points[-1], dirs[-1], norms[-1], halfs[-1], -1, caps[1])

    contour = [("move", s_l)]
    for (s, c1, c2, e) in left:
        contour.append(("line", s))
        contour.append(("curve", c1, c2, e))
    contour.append(("line", e_l))
    contour.append(("line", e_r))
    for (s, c1, c2, e) in reversed(right):
        contour.append(("line", e))
        contour.append(("curve", c2, c1, s))
    contour.append(("line", s_r))
    return [contour]


def _loop(fillets):
    s0 = fillets[0][0]
    contour = [("move", s0)]
    first = True
    for (s, c1, c2, e) in fillets:
        if not first:
            contour.append(("line", s))
        first = False
        contour.append(("curve", c1, c2, e))
    return contour


def filled_polygon(points, radii):
    """A filled shape (no stroke expansion) with rounded corners."""
    n = len(points)
    fillets = []
    for j in range(n):
        p_prev, p, p_next = points[j - 1], points[j], points[(j + 1) % n]
        d_a = unit(sub(p, p_prev))
        d_b = unit(sub(p_next, p))
        max_in = length(sub(p, p_prev)) * 0.5
        max_out = length(sub(p_next, p)) * 0.5
        fillets.append(_fillet(p, d_a, d_b, radii[j], max_in, max_out))
    return _loop(fillets)


# ---------------------------------------------------------------------------
# Contour utilities
# ---------------------------------------------------------------------------

def contour_points(contour):
    pts = []
    for seg in contour:
        pts.extend(seg[1:])
    return pts


def signed_area(contour) -> float:
    pts = contour_points(contour)
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def reverse_contour(contour):
    """Reverse direction, keeping an equivalent segment structure."""
    start = contour[0][1]
    # Build list of (from, seg) pairs
    pieces = []
    cur = start
    for seg in contour[1:]:
        pieces.append((cur, seg))
        cur = seg[-1]
    end = cur
    if not pieces:
        return list(contour)
    # the implied closing segment end->start becomes an explicit start->end
    out = [("move", start), ("line", end)]
    for frm, seg in reversed(pieces):
        if seg[0] == "line":
            out.append(("line", frm))
        else:
            out.append(("curve", seg[2], seg[1], frm))
    # last appended point equals start; drop it as closing is implicit
    last = out.pop()
    if last[0] == "curve":
        # keep the curve; closing back to start is then a zero-length line
        out.append(last)
    return out


def transform_contour(contour, fn):
    out = []
    for seg in contour:
        out.append((seg[0],) + tuple(fn(p) for p in seg[1:]))
    return out
