"""Tiny dependency-free SVG chart builders used by the dashboard."""
from __future__ import annotations

from typing import Sequence


def _scale(values: Sequence[float], lo: float, hi: float) -> list[float]:
    vmax = max(values) if values else 1.0
    vmax = vmax or 1.0
    return [lo + (hi - lo) * (1 - v / vmax) for v in values]


def area_chart(series: dict[str, Sequence[float]], colors: dict[str, str],
               width: int = 720, height: int = 220, pad: int = 28,
               normalize: bool = False) -> str:
    """Overlaid area/line chart.

    `normalize` gives each series its own y-scale — needed when two series live
    on different orders of magnitude (followers vs paying subscribers) and one
    would otherwise be a flat line on the axis. The legend carries each peak so
    the reader knows the scales differ.
    """
    n = max((len(v) for v in series.values()), default=0)
    if n < 2:
        return '<div class="empty">not enough data yet</div>'
    peak = max((max(v) if v else 0) for v in series.values()) or 1.0
    inner_w, inner_h = width - pad * 2, height - pad * 2
    step = inner_w / (n - 1)
    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" class="chart">']
    for i in range(5):
        y = pad + inner_h * i / 4
        parts.append(f'<line class="grid" x1="{pad}" y1="{y:.1f}" x2="{width - pad}" y2="{y:.1f}"/>')
    for key, values in series.items():
        col = colors.get(key, "#888")
        scale = (max(values) or 1.0) if normalize else peak
        pts = [(pad + i * step, pad + inner_h * (1 - v / scale)) for i, v in enumerate(values)]
        line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        parts.append(f'<polygon fill="{col}" fill-opacity=".10" points="{pad},{pad + inner_h} '
                     f'{line} {pad + (n - 1) * step:.1f},{pad + inner_h}"/>')
        parts.append(f'<polyline class="ln" stroke="{col}" points="{line}"/>')
        lx, ly = pts[-1]
        parts.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3.5" fill="{col}"/>')
    parts.append(f'<text class="axis" x="{pad}" y="{height - 6}">day 1</text>')
    parts.append(f'<text class="axis" text-anchor="end" x="{width - pad}" y="{height - 6}">day {n}</text>')
    if not normalize:
        parts.append(f'<text class="axis" x="{pad}" y="{pad - 10}">peak {peak:,.0f}</text>')
    parts.append("</svg>")
    return "".join(parts)


def bar_row(items: Sequence[tuple[str, float]], color: str) -> str:
    """Horizontal proportion bars — used for the revenue mix."""
    total = sum(v for _, v in items) or 1.0
    out = ['<div class="bars">']
    for label, value in items:
        pct = value / total * 100
        out.append(
            f'<div class="bar"><span class="bar-label">{label}</span>'
            f'<span class="bar-track"><span class="bar-fill" style="width:{pct:.1f}%;'
            f'background:{color}"></span></span>'
            f'<span class="bar-val">${value:,.0f}<small>{pct:.0f}%</small></span></div>')
    out.append("</div>")
    return "".join(out)


def spark(values: Sequence[float], color: str, width: int = 120, height: int = 30) -> str:
    if len(values) < 2:
        return ""
    peak = max(values) or 1.0
    step = width / (len(values) - 1)
    pts = " ".join(f"{i * step:.1f},{height - (v / peak) * (height - 4) - 2:.1f}"
                   for i, v in enumerate(values))
    return (f'<svg viewBox="0 0 {width} {height}" class="spark" role="img">'
            f'<polyline points="{pts}" stroke="{color}"/></svg>')
