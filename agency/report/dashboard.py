"""Renders the company's operating dashboard as a single self-contained page.

Everything on it is read back out of the database — no numbers are passed in
from the run that produced them.
"""
from __future__ import annotations

import html
import json
import os
from typing import Any

from ..core.models import Niche, Persona
from ..core.orchestrator import AGENT_CLASSES, DAY_PLAN
from .charts import area_chart, bar_row, spark

ACCENT = "#0d8b84"
ACCENT_DARK = "#3fd3c4"
GOOD = "#1f7a4d"
WARN = "#a9761b"
CRIT = "#b23a2f"
VIOLET = "#5a4b9c"

CSS = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Public+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#eef1f4; --panel:#fff; --sunk:#e4e9ee; --line:#d2dae1;
  --ink:#0f1a21; --ink-2:#46596a; --ink-3:#77899a;
  --accent:#0d8b84; --accent-soft:rgba(13,139,132,.10);
  --good:#1f7a4d; --warn:#a9761b; --crit:#b23a2f; --violet:#5a4b9c;
  --shadow:0 1px 2px rgba(15,26,33,.06), 0 8px 24px -18px rgba(15,26,33,.35);
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --ground:#0b1116; --panel:#121b22; --sunk:#0e161c; --line:#22323c;
  --ink:#e6eef3; --ink-2:#9fb2c0; --ink-3:#6b8090;
  --accent:#3fd3c4; --accent-soft:rgba(63,211,196,.12);
  --good:#54c98c; --warn:#e0b45c; --crit:#f0806f; --violet:#a493ea;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px -20px #000;
}}
:root[data-theme="dark"]{
  --ground:#0b1116; --panel:#121b22; --sunk:#0e161c; --line:#22323c;
  --ink:#e6eef3; --ink-2:#9fb2c0; --ink-3:#6b8090;
  --accent:#3fd3c4; --accent-soft:rgba(63,211,196,.12);
  --good:#54c98c; --warn:#e0b45c; --crit:#f0806f; --violet:#a493ea;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px -20px #000;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:"Public Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:40px 22px 72px;display:flex;flex-direction:column;gap:30px}
h1,h2,h3{font-family:Archivo,"Public Sans",sans-serif;margin:0;text-wrap:balance;letter-spacing:-.02em}
h1{font-size:clamp(28px,4.4vw,42px);font-weight:700;line-height:1.05}
h2{font-size:15px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-2)}
h3{font-size:17px;font-weight:600}
a{color:var(--accent)}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}

header.top{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-end;justify-content:space-between;
  border-bottom:1px solid var(--line);padding-bottom:22px}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:9px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 0 4px var(--accent-soft)}
.sub{color:var(--ink-2);max-width:62ch;margin-top:8px}
.modes{display:flex;gap:8px;flex-wrap:wrap}
.pill{font-family:"IBM Plex Mono",monospace;font-size:11.5px;letter-spacing:.06em;
  border:1px solid var(--line);border-radius:999px;padding:4px 11px;color:var(--ink-2);
  background:var(--panel);white-space:nowrap}
.pill.on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.pill.warn{border-color:var(--warn);color:var(--warn)}
.pill.violet{border-color:var(--violet);color:var(--violet)}

.kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(168px,1fr))}
@media (min-width:820px){.kpis{grid-template-columns:repeat(4,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px 16px;
  box-shadow:var(--shadow);display:flex;flex-direction:column;gap:3px}
.kpi .k{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  font-family:"IBM Plex Mono",monospace}
.kpi .v{font-family:Archivo,sans-serif;font-size:27px;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.kpi .n{font-size:12.5px;color:var(--ink-2)}
.pos{color:var(--good)} .neg{color:var(--crit)} .amb{color:var(--warn)}

.grid2{display:grid;gap:22px;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);align-items:start}
@media (max-width:880px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;
  box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px}
.panel > .head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-2);
  font-family:"IBM Plex Mono",monospace}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
svg.chart{width:100%;height:auto}
svg.chart .grid{stroke:var(--line);stroke-width:1}
svg.chart .ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
svg.chart .axis{fill:var(--ink-3);font-family:"IBM Plex Mono",monospace;font-size:11px}
svg.spark{width:110px;height:28px}
svg.spark polyline{fill:none;stroke-width:1.6}
.empty{color:var(--ink-3);font-size:13px;padding:20px 0}

.bars{display:flex;flex-direction:column;gap:9px}
.bar{display:grid;grid-template-columns:118px 1fr auto;gap:11px;align-items:center;font-size:13px}
.bar-label{color:var(--ink-2)}
.bar-track{background:var(--sunk);border-radius:3px;height:9px;overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:3px}
.bar-val{font-family:"IBM Plex Mono",monospace;font-size:12.5px;white-space:nowrap}
.bar-val small{color:var(--ink-3);margin-left:7px}

.chip{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.04em;
  border:1px solid currentColor;border-radius:999px;padding:2px 9px;white-space:nowrap}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{text-align:left;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3);font-weight:500;padding:0 12px 9px 0;
  border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
td.num{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;white-space:nowrap}

.roster{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(290px,1fr))}
.card{border:1px solid var(--line);border-radius:11px;padding:16px;background:var(--panel);
  display:flex;flex-direction:column;gap:9px}
.card.paused{opacity:.62}
.card .top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.handle{font-family:Archivo,sans-serif;font-weight:600;font-size:17px;letter-spacing:-.01em}
.who{font-size:12.5px;color:var(--ink-3)}
.look{font-size:12.5px;color:var(--ink-2);border-left:2px solid var(--accent);padding-left:10px}
.stats{display:flex;gap:16px;flex-wrap:wrap;font-family:"IBM Plex Mono",monospace;font-size:12.5px}
.stats b{font-weight:500;display:block;color:var(--ink-3);font-size:10.5px;letter-spacing:.08em;
  text-transform:uppercase}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:11.5px;border:1px solid var(--line);border-radius:5px;padding:2px 7px;color:var(--ink-2)}

ol.pipeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
ol.pipeline li{display:grid;grid-template-columns:34px 1fr;gap:12px;padding:9px 0;
  border-bottom:1px solid var(--line)}
ol.pipeline li:last-child{border-bottom:none}
.step{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink-3);padding-top:2px}
.stage-name{font-weight:600;font-size:14px}
.stage-meta{font-size:12.5px;color:var(--ink-2)}
.stage-meta code{font-family:"IBM Plex Mono",monospace;font-size:11.5px;background:var(--sunk);
  border-radius:4px;padding:1px 5px;color:var(--ink-2)}

.log{display:flex;flex-direction:column;gap:0;max-height:430px;overflow-y:auto}
.entry{display:grid;grid-template-columns:52px 96px 1fr;gap:10px;padding:9px 0;
  border-bottom:1px solid var(--line);font-size:13px}
.entry:last-child{border-bottom:none}
.entry .d{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink-3)}
.entry .a{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--accent)}
.entry.gate{grid-template-columns:46px 62px 1fr}
.entry .d.pos{color:var(--good);font-weight:500}
.entry .d.neg{color:var(--crit);font-weight:500}
.kind{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.05em;color:var(--ink-3)}

.orgchart{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.dept{border:1px solid var(--line);border-radius:10px;padding:13px 14px;background:var(--panel)}
.dept h4{margin:0 0 8px;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--accent);font-weight:500}
.dept ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dept li{font-size:13px}
.dept li span{display:block;font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3)}
.banner{border:1px solid var(--warn);border-left-width:4px;border-radius:10px;padding:14px 16px;
  background:var(--panel);font-size:14px;color:var(--ink-2)}
.banner b{color:var(--ink)}
.banner code{font-family:"IBM Plex Mono",monospace;font-size:12.5px;background:var(--sunk);
  padding:1px 6px;border-radius:4px}
footer{color:var(--ink-3);font-size:12.5px;border-top:1px solid var(--line);padding-top:18px}
</style>
"""


def _esc(s: Any) -> str:
    return html.escape(str(s))


def _money(v: float) -> str:
    return f"${v:,.2f}"


def render(store, cfg, path: str) -> str:
    last = int(store.get_meta("last_day", 0))
    days = list(range(1, last + 1))

    pnl = [store.get_meta(f"pnl_{d}", {"revenue": 0, "cost": 0, "cash": cfg.start_capital})
           for d in days]
    revenue = [float(x.get("revenue", 0)) for x in pnl]
    costs = [float(x.get("cost", 0)) for x in pnl]
    cash = [float(x.get("cash", cfg.start_capital)) for x in pnl]

    followers, subs, views, posts_per_day = [], [], [], []
    for d in days:
        followers.append(float(store.query(
            "SELECT COALESCE(SUM(followers),0) f FROM audience WHERE day=?", (d,))[0]["f"]))
        subs.append(float(store.query(
            "SELECT COALESCE(MAX(subs),0) s FROM audience WHERE day=?", (d,))[0]["s"]))
        views.append(float(store.query(
            "SELECT COALESCE(SUM(MAX(0, m.views - COALESCE(p.views,0))),0) v FROM metrics m "
            "LEFT JOIN metrics p ON p.post_id=m.post_id AND p.day=m.day-1 WHERE m.day=?",
            (d,))[0]["v"]))
        posts_per_day.append(float(store.query(
            "SELECT COUNT(*) c FROM posts WHERE day=?", (d,))[0]["c"]))

    total_rev, total_cost = store.totals()
    by_source = store.revenue_by_source()
    real_money = by_source.get("real", 0.0)
    modelled = by_source.get("modelled", 0.0)
    profit = total_rev - total_cost
    personas = store.personas(Persona)
    niches = {n.id: n for n in store.niches(Niche)}
    total_posts = store.query("SELECT COUNT(*) c FROM posts")[0]["c"]
    total_assets = store.query("SELECT COUNT(*) c FROM assets")[0]["c"]
    total_tasks = store.query("SELECT COUNT(*) c FROM tasklog")[0]["c"]
    errors = store.query("SELECT COUNT(*) c FROM tasklog WHERE status='error'")[0]["c"]
    streams = [(r["stream"], float(r["s"])) for r in store.query(
        "SELECT stream, SUM(amount) s FROM revenue GROUP BY stream ORDER BY s DESC")]
    blocks = store.query("SELECT * FROM events WHERE topic='compliance' ORDER BY id DESC LIMIT 40")
    from .redteam import run as run_redteam
    gate = run_redteam(("fanvue", "patreon"))
    gate_passed = sum(1 for g in gate if g["pass"])
    decisions = store.query("SELECT * FROM decisions ORDER BY day DESC, id DESC LIMIT 60")

    roas = (total_rev / total_cost) if total_cost else 0.0
    cpm_cost = (total_cost / sum(views) * 1000) if sum(views) else 0.0
    final_cash = cash[-1] if cash else cfg.start_capital

    # ---- head -------------------------------------------------------------
    pills = [f'<span class="pill on">seed {cfg.seed}</span>',
             f'<span class="pill">{_esc(cfg.provider("llm"))} · llm</span>',
             f'<span class="pill">{_esc(cfg.provider("image"))} · image</span>',
             f'<span class="pill">{_esc(cfg.provider("social"))} · distribution</span>']
    pills.append('<span class="pill violet">adult tier on</span>' if cfg.adult_enabled
                 else '<span class="pill">adult tier off</span>')

    kpis = [
        ("cash on hand", _money(final_cash), f"opened at {_money(cfg.start_capital)}",
         "pos" if final_cash >= cfg.start_capital else "neg"),
        ("net asset value", _money(store.nav(cfg.start_capital)["nav"]),
         "cash plus what the branches are worth", ""),
        ("real money banked", _money(real_money),
         "settled receipts + imported payouts" if real_money else "nothing has settled yet",
         "pos" if real_money else "amb"),
        ("modelled revenue", _money(modelled), f"{len(streams)} streams, simulated", ""),
        ("total cost", _money(total_cost), f"{_money(total_cost / max(1, len(days)))}/day", "amb"),
        ("modelled profit", _money(profit), f"ROAS {roas:.2f}x", "pos" if profit >= 0 else "neg"),
        ("followers", f"{followers[-1]:,.0f}" if followers else "0",
         f"{subs[-1]:,.0f} paying subscribers" if subs else "", ""),
        ("posts published", f"{total_posts:,}", f"{total_assets:,} assets rendered", ""),
        ("agent tasks", f"{total_tasks:,}", f"{errors} errors", "pos" if not errors else "amb"),
        ("cost per 1k views", f"${cpm_cost:,.2f}", f"{sum(views):,.0f} views total", ""),
    ]
    kpi_html = "".join(
        f'<div class="kpi"><span class="k">{_esc(k)}</span>'
        f'<span class="v {cls}">{_esc(v)}</span><span class="n">{_esc(n)}</span></div>'
        for k, v, n, cls in kpis)

    banner = ("" if real_money else
              '<div class="banner"><b>No real money has moved.</b> Audience response and every '
              'revenue figure below come from the market simulator, because no live platform or '
              'payment credential is configured. Run <code>agency golive</code> for the gap list; '
              'money that actually settles is booked separately and shown as “real money banked”.'
              '</div>')

    # ---- charts -----------------------------------------------------------
    pnl_chart = area_chart({"revenue": revenue, "cost": costs},
                           {"revenue": ACCENT, "cost": WARN})
    growth_chart = area_chart({"followers": followers, "subscribers": subs},
                              {"followers": ACCENT, "subscribers": VIOLET}, normalize=True)
    streams = [(k.replace("_", " "), v) for k, v in streams]
    mix = bar_row(streams, ACCENT) if streams else '<div class="empty">no revenue booked yet</div>'

    # ---- roster -----------------------------------------------------------
    cards = []
    for p in sorted(personas, key=lambda x: store.persona_revenue(x.id), reverse=True):
        f = store.query("SELECT COALESCE(SUM(followers),0) f FROM audience WHERE persona_id=? "
                        "AND day=(SELECT MAX(day) FROM audience WHERE persona_id=?)",
                        (p.id, p.id))[0]["f"]
        rev = store.persona_revenue(p.id)
        cost = store.persona_cost(p.id, 0, max(1, len(personas)))
        hist = [float(r["f"]) for r in store.query(
            "SELECT day, SUM(followers) f FROM audience WHERE persona_id=? GROUP BY day ORDER BY day",
            (p.id,))]
        niche = niches.get(p.niche_id)
        tier_pill = ('<span class="pill violet">age-gated tier</span>' if p.tier == "adult"
                     else '<span class="pill">general audience</span>')
        cards.append(f"""
        <div class="card{' paused' if p.status != 'active' else ''}">
          <div class="top">
            <div><div class="handle">@{_esc(p.handle)}</div>
              <div class="who">{_esc(p.name)} · {_esc(niche.name if niche else '')}</div></div>
            <div style="text-align:right">{tier_pill}
              <div class="who mono" style="margin-top:6px">seed {p.seed}</div></div>
          </div>
          <div class="look">{_esc(p.look)}</div>
          <div class="tags">{''.join(f'<span class="tag">{_esc(x)}</span>' for x in p.pillars)}</div>
          <div class="stats">
            <span><b>followers</b>{f:,.0f}</span>
            <span><b>revenue</b>{_money(rev)}</span>
            <span><b>cost</b>{_money(cost)}</span>
            <span><b>price</b>${p.price}</span>
            <span><b>slots/day</b>{p.slots}</span>
            <span><b>status</b>{_esc(p.status)}</span>
          </div>
          {spark(hist, ACCENT)}
        </div>""")

    # ---- portfolio: what each shot returned -------------------------------
    verdicts = {}
    for r in store.query("SELECT * FROM decisions WHERE kind IN ('survives_cull','cull_persona') "
                         "ORDER BY id"):
        data = json.loads(r["data"] or "{}")
        if data.get("persona"):
            verdicts[data["persona"]] = {"kind": r["kind"], "day": r["day"], **data}
    probation = int(cfg.get("portfolio.probation_days", 14))
    portfolio_rows = []
    for p in sorted(personas, key=lambda x: (verdicts.get(x.id, {}).get("score", -1)), reverse=True):
        v = verdicts.get(p.id)
        if v is None:
            age = last - p.created_day
            label, cls = ("on probation", "amb") if age < probation else ("running", "pos")
            vpp = fr = None
        else:
            label = "survived the cull" if v["kind"] == "survives_cull" else "culled"
            cls = "pos" if v["kind"] == "survives_cull" else "neg"
            vpp, fr = v.get("views_per_post"), v.get("follow_rate")
        rev = store.persona_revenue(p.id)
        portfolio_rows.append(
            f'<tr><td>@{_esc(p.handle)}</td><td>{_esc(niches.get(p.niche_id, ""))}</td>'
            f'<td class="num">{p.created_day}</td>'
            f'<td><span class="chip {cls}">{_esc(label)}</span></td>'
            f'<td class="num">{vpp:,.0f}</td>' if vpp is not None else
            f'<tr><td>@{_esc(p.handle)}</td><td>{_esc(niches.get(p.niche_id, ""))}</td>'
            f'<td class="num">{p.created_day}</td>'
            f'<td><span class="chip {cls}">{_esc(label)}</span></td><td class="num">—</td>')
        portfolio_rows[-1] += (f'<td class="num">{fr:.2%}</td>' if fr is not None
                               else '<td class="num">—</td>')
        portfolio_rows[-1] += f'<td class="num">{_money(rev)}</td></tr>'
    culled = sum(1 for v in verdicts.values() if v["kind"] == "cull_persona")
    kept = sum(1 for v in verdicts.values() if v["kind"] == "survives_cull")

    # ---- holdings: the company as a balance sheet, not a content feed ------
    nav = store.nav(cfg.start_capital)
    vals = store.latest_valuations()
    deals = store.deals()
    split = store.revenue_split()
    owned = [p for p in personas if p.status == "active"]
    holding_rows, flags = [], []
    for p in sorted(owned, key=lambda x: vals.get(x.id, 0), reverse=True)[:12]:
        row = store.query("SELECT data FROM valuations WHERE persona_id=? ORDER BY day DESC "
                          "LIMIT 1", (p.id,))
        vd = json.loads(row[0]["data"]) if row else {}
        note = vd.get("note", "")
        if note and vals.get(p.id, 0) > 100:
            flags.append((p.handle, note))
        holding_rows.append(
            f'<tr><td>@{_esc(p.handle)}</td>'
            f'<td><span class="chip {"amb" if p.origin == "bought" else ""}">'
            f'{_esc(p.origin)}</span></td>'
            f'<td class="num">{_money(p.acquired_price) if p.acquired_price else "—"}</td>'
            f'<td class="num">{_money(vd.get("monthly_profit", 0))}</td>'
            f'<td class="num">{vd.get("multiple", 0):.0f}x</td>'
            f'<td class="num">{_money(vals.get(p.id, 0))}</td></tr>')
    deal_rows = "".join(
        f'<tr><td class="num">{d["day"]}</td>'
        f'<td><span class="chip {"pos" if d["kind"] == "sell" else "amb"}">{_esc(d["kind"])}</span></td>'
        f'<td class="num">{_money(d["price"])}</td><td class="num">{d["multiple"]:.0f}x</td>'
        f'<td>{_esc(d["rationale"])}</td></tr>' for d in deals) or \
        '<tr><td colspan="5" class="who">no deals yet</td></tr>'
    passed = [l for l in store.listings() if l.get("verdict") and not l["verdict"].get("buy")]
    passed_rows = "".join(
        f'<tr><td class="num">{_money(l.get("asking_price", 0))}</td>'
        f'<td>{_esc(l.get("kind", ""))}</td>'
        f'<td class="who">{_esc(l["verdict"].get("reason", ""))}</td></tr>'
        for l in passed[:6])
    flag_html = "".join(
        f'<div class="banner"><b>@{_esc(h)}</b> {_esc(n)}</div>' for h, n in flags[:3])

    # ---- pipeline ---------------------------------------------------------
    routes = {}
    for cls in AGENT_CLASSES:
        for t in cls.handles:
            routes[t] = cls
    steps = []
    for i, (ttype, stage) in enumerate(sorted(DAY_PLAN, key=lambda x: x[1]), start=1):
        cls = routes.get(ttype)
        steps.append(f'<li><span class="step">{i:02d}</span><div>'
                     f'<div class="stage-name">{_esc(cls.title if cls else ttype)}</div>'
                     f'<div class="stage-meta"><code>{_esc(ttype)}</code> handled by '
                     f'<code>{_esc(cls.name if cls else "?")}</code> · '
                     f'{_esc(cls.dept if cls else "")}</div></div></li>')
    # tasks that only exist because an agent emitted them
    emitted = [("research.scan", "market research, on demand from the CEO"),
               ("talent.create_persona", "a new AI influencer is designed"),
               ("content.plan", "one calendar per active persona"),
               ("content.write", "one script per slot"),
               ("art.prompt", "render prompt, identity-locked"),
               ("prod.image", "still frames"),
               ("prod.video", "voiceover + cut"),
               ("copy.write", "one caption per destination"),
               ("compliance.review", "gate, per destination"),
               ("dist.publish", "publish + register the post")]
    emitted_html = "".join(
        f'<li><span class="step">↳</span><div><div class="stage-name">'
        f'{_esc(routes[t].title if t in routes else t)}</div>'
        f'<div class="stage-meta"><code>{_esc(t)}</code> · {_esc(d)}</div></div></li>'
        for t, d in emitted)

    # ---- org chart --------------------------------------------------------
    depts: dict[str, list] = {}
    for cls in AGENT_CLASSES:
        depts.setdefault(cls.dept, []).append(cls)
    org_html = "".join(
        f'<div class="dept"><h4>{_esc(dept)}</h4><ul>' +
        "".join(f'<li>{_esc(c.title)}<span>{_esc(c.name)}</span></li>' for c in members) +
        "</ul></div>" for dept, members in depts.items())

    # ---- logs -------------------------------------------------------------
    dec_html = "".join(
        f'<div class="entry"><span class="d">d{r["day"]:02d}</span>'
        f'<span class="a">{_esc(r["agent"])}</span>'
        f'<span><span class="kind">{_esc(r["kind"])}</span><br>{_esc(r["rationale"])}</span></div>'
        for r in decisions) or '<div class="empty">no decisions logged</div>'
    gate_html = "".join(
        f'<div class="entry gate"><span class="d {"pos" if g["pass"] else "neg"}">'
        f'{"PASS" if g["pass"] else "FAIL"}</span>'
        f'<span class="a">{"tier on" if g["adult_tier"] else "tier off"}</span>'
        f'<span>{_esc(g["label"])}<br><span class="kind">'
        f'{"allowed" if g["allowed"] else "blocked"} → {_esc(g["platform"])}'
        f'{" · " + _esc(", ".join(g["reasons"])) if g["reasons"] else ""}</span></span></div>'
        for g in gate)
    comp_html = "".join(
        f'<div class="entry"><span class="d">d{r["day"]:02d}</span>'
        f'<span class="a">{_esc(r["actor"])}</span><span>{_esc(r["message"])}</span></div>'
        for r in blocks) or ('<div class="empty">nothing was blocked in this run — the gate ran on '
                             'every item before it shipped</div>')

    daily_table = "".join(
        f'<tr><td class="num">{d}</td><td class="num">{posts_per_day[i]:,.0f}</td>'
        f'<td class="num">{views[i]:,.0f}</td><td class="num">{followers[i]:,.0f}</td>'
        f'<td class="num">{subs[i]:,.0f}</td><td class="num">{_money(revenue[i])}</td>'
        f'<td class="num">{_money(costs[i])}</td>'
        f'<td class="num {"pos" if revenue[i] >= costs[i] else "neg"}">'
        f'{_money(revenue[i] - costs[i])}</td><td class="num">{_money(cash[i])}</td></tr>'
        for i, d in enumerate(days))

    body = f"""<meta charset="utf-8">
<title>{_esc(cfg.company)} Control Room</title>
{CSS}
<div class="wrap">
  <header class="top">
    <div>
      <div class="eyebrow"><span class="dot"></span>autonomous media company · day {last}</div>
      <h1>{_esc(cfg.company)}</h1>
      <p class="sub">Eighteen agents across ten departments run the whole loop: pick the niche,
      design the AI influencer, write it, render it, clear it through compliance, publish it,
      work the comments, price the subscription, and re-allocate tomorrow's budget against what
      today actually returned.</p>
    </div>
    <div class="modes">{''.join(pills)}</div>
  </header>

  {banner}
  <section class="kpis">{kpi_html}</section>

  <section class="grid2">
    <div class="panel">
      <div class="head"><h2>revenue vs cost</h2>
        <div class="legend"><span><i style="background:{ACCENT}"></i>revenue</span>
          <span><i style="background:{WARN}"></i>cost</span></div></div>
      {pnl_chart}
    </div>
    <div class="panel">
      <div class="head"><h2>revenue mix</h2></div>
      {mix}
      <p class="who">Subscriptions bill monthly and are booked as a daily slice; affiliate income
      follows outbound clicks; brand deals arrive once a persona has an audience worth renting.</p>
    </div>
  </section>

  <section class="grid2">
    <div class="panel">
      <div class="head"><h2>audience</h2>
        <div class="legend"><span><i style="background:{ACCENT}"></i>followers ·
          peak {followers[-1] if followers else 0:,.0f}</span>
          <span><i style="background:{VIOLET}"></i>subscribers ·
          peak {subs[-1] if subs else 0:,.0f}</span>
          <span class="who">independent scales</span></div></div>
      {growth_chart}
    </div>
    <div class="panel">
      <div class="head"><h2>compliance gate</h2>
        <span class="pill {'on' if gate_passed == len(gate) else 'warn'}">{gate_passed}/{len(gate)}
        cases behave as specified</span></div>
      <div class="log">{gate_html}</div>
      <div class="head"><h2>runtime interventions</h2></div>
      <div class="log">{comp_html}</div>
    </div>
  </section>

  <section class="panel">
    <div class="head"><h2>the balance sheet</h2>
      <span class="who">NAV {_money(nav["nav"])} = cash {_money(nav["cash"])} +
      branches {_money(nav["holdings"])} · {_money(nav["capital_deployed"])} deployed into
      acquisitions</span></div>
    <p class="who" style="margin:0">Operating revenue {_money(split["operating"])} and capital
    events {_money(split["capital"])} are shown apart on purpose: selling a branch is not a month
    of trading, and adding them into one headline would flatter the business into meaninglessness.</p>
    {flag_html}
    <div class="scroll"><table>
      <thead><tr><th>branch</th><th>origin</th><th>paid</th><th>monthly profit</th>
      <th>multiple</th><th>value</th></tr></thead>
      <tbody>{"".join(holding_rows) or '<tr><td colspan="6" class="who">no branches</td></tr>'}</tbody>
    </table></div>
    <div class="head"><h2>deal book</h2></div>
    <div class="scroll"><table>
      <thead><tr><th>day</th><th></th><th>price</th><th>multiple</th><th>reasoning</th></tr></thead>
      <tbody>{deal_rows}</tbody></table></div>
    {'<div class="head"><h2>passed on</h2><span class="who">' + str(len(passed)) + ' listings reviewed and declined</span></div><div class="scroll"><table><thead><tr><th>ask</th><th>asset</th><th>why not</th></tr></thead><tbody>' + passed_rows + '</tbody></table></div>' if passed_rows else ''}
  </section>

  <section class="panel">
    <div class="head"><h2>portfolio — every shot taken</h2>
      <span class="who">{len(personas)} launched · {kept} kept · {culled} culled ·
      probation {probation} days</span></div>
    <p class="who" style="margin:0">Most new accounts never find an audience, and which ones will
    is not knowable in advance — so the company launches a fleet on equal minimal spend and only
    concentrates capital after the market has voted. The cull is decided on leading signal
    (views per post, follow rate), because at that age revenue is still zero for everyone.</p>
    <div class="scroll"><table>
      <thead><tr><th>persona</th><th>niche</th><th>launched</th><th>verdict</th>
      <th>views / post</th><th>follow rate</th><th>revenue</th></tr></thead>
      <tbody>{''.join(portfolio_rows)}</tbody></table></div>
  </section>

  <section class="panel">
    <div class="head"><h2>the roster</h2>
      <span class="who">{len([p for p in personas if p.status == 'active'])} active ·
      {len(personas)} created</span></div>
    <div class="roster">{''.join(cards) or '<div class="empty">no personas yet</div>'}</div>
  </section>

  <section class="grid2">
    <div class="panel">
      <div class="head"><h2>the working day</h2><span class="who">fixed skeleton</span></div>
      <ol class="pipeline">{''.join(steps)}</ol>
    </div>
    <div class="panel">
      <div class="head"><h2>work agents create</h2><span class="who">emitted, not scheduled</span></div>
      <ol class="pipeline">{emitted_html}</ol>
    </div>
  </section>

  <section class="panel">
    <div class="head"><h2>decision log</h2><span class="who">every judgement call, with its reason</span></div>
    <div class="log">{dec_html}</div>
  </section>

  <section class="panel">
    <div class="head"><h2>org chart</h2><span class="who">{len(AGENT_CLASSES)} agents</span></div>
    <div class="orgchart">{org_html}</div>
  </section>

  <section class="panel">
    <div class="head"><h2>day by day</h2></div>
    <div class="scroll"><table>
      <thead><tr><th>day</th><th>posts</th><th>views</th><th>followers</th><th>subs</th>
      <th>revenue</th><th>cost</th><th>net</th><th>cash</th></tr></thead>
      <tbody>{daily_table}</tbody></table></div>
  </section>

  <footer>
    Generated from {_esc(os.path.basename(cfg.get('paths.db', 'agency.db')))} ·
    {total_tasks:,} agent tasks · seed {cfg.seed} · every figure on this page was read back out of
    the run database. Audience response is modelled, not measured: swap the providers for live
    credentials and the same agents run against real platforms.
  </footer>
</div>
"""
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    return path
