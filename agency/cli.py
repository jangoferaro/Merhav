"""Command line for the company: `python -m agency <command>`."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

from .core import config as configmod
from .core.models import Niche, Persona
from .core.orchestrator import Company
from .core.store import Store
from .providers import registry
from .sim.world import World

C = {"b": "\033[1m", "d": "\033[2m", "g": "\033[32m", "y": "\033[33m", "r": "\033[31m",
     "c": "\033[36m", "m": "\033[35m", "0": "\033[0m"}


def paint(s: str, *keys: str) -> str:
    if not sys.stdout.isatty():
        return s
    return "".join(C[k] for k in keys) + s + C["0"]


def _open(cfg, fresh: bool = False, live: bool = False):
    db = cfg.get("paths.db", "agency/out/agency.db")
    if fresh and os.path.exists(db):
        os.remove(db)
    store = Store(db)
    world = None if live else World(cfg.seed)
    company = Company(cfg, store, world)
    return store, company


# --------------------------------------------------------------------------
def cmd_org(args, cfg):
    store, company = _open(cfg)
    print(paint(f"\n{cfg.company} — org chart\n", "b"))
    for dept, members in company.org_chart().items():
        print(paint(f"  {dept.upper()}", "c"))
        for name, title, handles in members:
            print(f"    {paint(title.ljust(24), 'b')} {paint(name.ljust(16), 'd')} "
                  f"{paint(' '.join(handles), 'd')}")
    print(paint("\n  providers", "c"))
    for k, v in registry.describe(company.ctx.providers).items():
        print(f"    {str(k).ljust(10)} {paint(json.dumps(v) if isinstance(v, dict) else v, 'y')}")
    print(f"\n  adult tier: {paint('ENABLED' if cfg.adult_enabled else 'disabled', 'y')}"
          f"   age-gated destinations: {sorted(company.ctx.providers.age_gated_platforms())}\n")
    store.close()


def cmd_run(args, cfg):
    store, company = _open(cfg, fresh=args.fresh, live=args.live)

    if args.verbose:
        def show(ev):
            colour = {"warn": "y", "error": "r"}.get(ev["level"], "d")
            print(f"  {paint(ev['actor'].ljust(14), 'c')} {paint(ev['message'], colour)}")
        company.bus.on("*", show)

    print(paint(f"\n{cfg.company} — running {args.days} day(s) "
                f"[{'LIVE' if args.live else 'simulated market'}]\n", "b"))
    header = f"{'day':>4} {'tasks':>6} {'posts':>6} {'views':>10} {'followers':>10} " \
             f"{'subs':>6} {'revenue':>9} {'cost':>8} {'cash':>10}"
    print(paint(header, "b"))
    print(paint("-" * len(header), "d"))

    for day in range(int(store.get_meta("last_day", 0)) + 1,
                     int(store.get_meta("last_day", 0)) + 1 + args.days):
        s = company.run_day(day)
        line = (f"{day:>4} {s['tasks']:>6} {s['posts']:>6} {s['views']:>10,} "
                f"{s['followers']:>10,} {s['subs']:>6,} "
                f"{s['revenue']:>9.2f} {s['cost']:>8.2f} {s['cash']:>10.2f}")
        print(paint(line, "g" if s["revenue"] >= s["cost"] else "d"))

    rev, cost = store.totals()
    print(paint("-" * len(header), "d"))
    print(f"\n  gross revenue {paint(f'${rev:,.2f}', 'g')}   total cost "
          f"{paint(f'${cost:,.2f}', 'y')}   profit "
          f"{paint(f'${rev - cost:,.2f}', 'g' if rev >= cost else 'r')}   "
          f"cash {paint(f'${company.ctx.ledger.cash:,.2f}', 'b')}\n")
    store.close()


def cmd_status(args, cfg):
    store, company = _open(cfg)
    day = int(store.get_meta("last_day", 0))
    rev, cost = store.totals()
    personas = store.personas(Persona)
    posts = store.query("SELECT COUNT(*) c FROM posts")[0]["c"]
    print(paint(f"\n{cfg.company} — day {day}\n", "b"))
    print(f"  cash            ${store.get_meta('cash', cfg.start_capital):,.2f}")
    print(f"  revenue / cost  ${rev:,.2f} / ${cost:,.2f}  ({paint(f'{rev - cost:+,.2f}', 'g' if rev >= cost else 'r')})")
    print(f"  roster          {len([p for p in personas if p.status == 'active'])} active "
          f"/ {len(personas)} total")
    print(f"  published       {posts} posts")
    for row in store.query("SELECT stream, SUM(amount) s FROM revenue GROUP BY stream ORDER BY s DESC"):
        print(f"    {row['stream'].ljust(14)} ${row['s']:>10,.2f}")
    print()
    store.close()


def cmd_personas(args, cfg):
    store, company = _open(cfg)
    world = company.world
    print(paint(f"\nroster\n", "b"))
    for p in store.personas(Persona):
        followers = store.query(
            "SELECT COALESCE(SUM(followers),0) f FROM audience WHERE persona_id=? AND day="
            "(SELECT MAX(day) FROM audience WHERE persona_id=?)", (p.id, p.id))[0]["f"]
        rev = store.persona_revenue(p.id)
        tag = paint("active", "g") if p.status == "active" else paint(p.status, "d")
        print(f"  {paint('@' + p.handle.ljust(18), 'b')} {tag}  {p.tier}  seed {p.seed}")
        print(f"     {paint(p.archetype, 'd')}")
        print(f"     look     {paint(p.look[:96], 'd')}")
        print(f"     pillars  {', '.join(p.pillars)}")
        print(f"     price ${p.price} · slots/day {p.slots} · followers {followers:,} · "
              f"revenue ${rev:,.2f}\n")
    store.close()


def cmd_niches(args, cfg):
    store, _ = _open(cfg)
    rows = sorted(store.niches(Niche), key=lambda n: n.rank(), reverse=True)
    print(paint("\nniche board\n", "b"))
    print(f"  {'score':>6}  {'tier':<6} {'demand':>7} {'cpm':>7} {'comp':>6} {'monet':>6} "
          f"{'risk':>6}  name")
    for n in rows:
        print(f"  {n.rank():>6.2f}  {n.tier:<6} {n.demand:>7.2f} {n.cpm:>7.1f} {n.competition:>6.2f} "
              f"{n.monetization:>6.2f} {n.risk:>6.2f}  {n.name}  {paint(n.status, 'd')}")
    print()
    store.close()


def cmd_feed(args, cfg):
    store, _ = _open(cfg)
    day = args.day if args.day is not None else int(store.get_meta("last_day", 0))
    rows = store.query("SELECT * FROM events WHERE day=? ORDER BY id", (day,))
    print(paint(f"\nevent feed — day {day} ({len(rows)} events)\n", "b"))
    for r in rows:
        colour = {"warn": "y", "error": "r"}.get(r["level"], "d")
        print(f"  {paint(r['topic'].ljust(13), 'm')} {paint(r['actor'].ljust(14), 'c')} "
              f"{paint(r['message'], colour)}")
    print()
    store.close()


def cmd_decisions(args, cfg):
    store, _ = _open(cfg)
    rows = store.query("SELECT * FROM decisions ORDER BY day, id")
    print(paint("\ndecision log\n", "b"))
    for r in rows:
        print(f"  day {str(r['day']).rjust(3)}  {paint(r['agent'].ljust(12), 'c')} "
              f"{paint(r['kind'].ljust(18), 'y')} {r['rationale']}")
    print()
    store.close()


def cmd_report(args, cfg):
    from .report.dashboard import render
    store, company = _open(cfg)
    out = args.out or "agency/out/dashboard.html"
    path = render(store, cfg, out)
    print(f"\n  dashboard → {paint(path, 'b')}\n")
    store.close()


def cmd_audit(args, cfg):
    from .report.redteam import run
    store, company = _open(cfg)
    rows = run(sorted(company.ctx.providers.age_gated_platforms()))
    print(paint("\ncompliance gate — red team\n", "b"))
    for r in rows:
        mark = paint("PASS", "g") if r["pass"] else paint("FAIL", "r")
        verdict = "allowed" if r["allowed"] else "blocked"
        tier = "tier:on " if r["adult_tier"] else "tier:off"
        print(f"  {mark}  {r['label'].ljust(44)} {paint(tier, 'd')} {paint(verdict.ljust(8), 'd')} "
              f"→ {r['platform'].ljust(10)} {paint(', '.join(r['reasons']), 'y')}")
    failed = [r for r in rows if not r["pass"]]
    print(f"\n  {len(rows) - len(failed)}/{len(rows)} cases behaved as specified"
          f"{'' if not failed else paint('  — GATE IS NOT SOUND', 'r')}\n")
    store.close()
    return 1 if failed else 0


def cmd_reset(args, cfg):
    db = cfg.get("paths.db", "agency/out/agency.db")
    media = cfg.get("paths.media", "agency/out/media")
    for target in (db,):
        if os.path.exists(target):
            os.remove(target)
    if os.path.isdir(media):
        shutil.rmtree(media)
    print("  state cleared\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agency", description="AI-persona media company")
    ap.add_argument("--config", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("org", help="show the org chart and provider wiring").set_defaults(fn=cmd_org)
    r = sub.add_parser("run", help="run the company for N days")
    r.add_argument("--days", type=int, default=30)
    r.add_argument("--fresh", action="store_true", help="wipe state first")
    r.add_argument("--live", action="store_true", help="no market simulation — real APIs only")
    r.add_argument("--verbose", "-v", action="store_true", help="stream the event feed")
    r.set_defaults(fn=cmd_run)
    sub.add_parser("status", help="cash, revenue, roster").set_defaults(fn=cmd_status)
    sub.add_parser("personas", help="the AI influencer roster").set_defaults(fn=cmd_personas)
    sub.add_parser("niches", help="scored niche board").set_defaults(fn=cmd_niches)
    f = sub.add_parser("feed", help="event feed for a day")
    f.add_argument("--day", type=int, default=None)
    f.set_defaults(fn=cmd_feed)
    sub.add_parser("decisions", help="every decision an agent took").set_defaults(fn=cmd_decisions)
    d = sub.add_parser("report", help="render the HTML dashboard")
    d.add_argument("--out", default=None)
    d.set_defaults(fn=cmd_report)
    sub.add_parser("audit", help="run the compliance red-team set").set_defaults(fn=cmd_audit)
    sub.add_parser("reset", help="delete the database and generated media").set_defaults(fn=cmd_reset)

    args = ap.parse_args(argv)
    cfg = configmod.load(args.config)
    return int(args.fn(args, cfg) or 0)
