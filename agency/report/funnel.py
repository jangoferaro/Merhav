"""Link-in-bio funnel pages — the missing half of the money path.

Reach is worthless without somewhere for a click to land. This renders one
self-contained page per persona: the offer, the subscribe button, a free lead
magnet that captures an email, and the affiliate picks that usually earn the
first dollar. Each page takes its accent hue from the persona's identity seed,
so the page and the feed look like the same character.

Every destination is read from the environment, so the same command produces a
placeholder page today and the real, chargeable one the moment the accounts
exist:
    SUBSCRIBE_URL     Stripe payment link / Fanvue profile / Patreon
    NEWSLETTER_ACTION form POST endpoint for the email capture
    AFFILIATE_URL     where "my picks" sends people
"""
from __future__ import annotations

import html
import os

from ..core.models import Niche, Persona

DISCLOSURE = "AI-generated character. Not a real person."


def _esc(s) -> str:
    return html.escape(str(s))


def _palette(seed: int) -> dict[str, str]:
    hue = seed % 360
    alt = (hue + 42) % 360
    return {
        "accent": f"hsl({hue} 62% 44%)",
        "accent_dark": f"hsl({hue} 70% 62%)",
        "warm": f"hsl({alt} 58% 50%)",
        "ground": f"hsl({hue} 22% 97%)",
        "ground_dark": f"hsl({hue} 24% 8%)",
        "panel_dark": f"hsl({hue} 20% 12%)",
        "ink": f"hsl({hue} 30% 12%)",
        "ink_dark": f"hsl({hue} 18% 94%)",
    }


PAGE = """<meta charset="utf-8">
<title>{name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Public+Sans:wght@400;500;600&display=swap">
<style>
:root{{
  --accent:{accent}; --warm:{warm}; --ground:{ground}; --panel:#fff;
  --ink:{ink}; --ink-2:hsl(0 0% 38%); --line:hsl(0 0% 88%);
}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{
  --accent:{accent_dark}; --ground:{ground_dark}; --panel:{panel_dark};
  --ink:{ink_dark}; --ink-2:hsl(0 0% 68%); --line:hsl(0 0% 24%);
}}}}
:root[data-theme="dark"]{{
  --accent:{accent_dark}; --ground:{ground_dark}; --panel:{panel_dark};
  --ink:{ink_dark}; --ink-2:hsl(0 0% 68%); --line:hsl(0 0% 24%);
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);
  font-family:"Public Sans",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55}}
.wrap{{max-width:560px;margin:0 auto;padding:44px 22px 64px;display:flex;flex-direction:column;gap:26px}}
h1,h2{{font-family:"Bricolage Grotesque","Public Sans",sans-serif;margin:0;letter-spacing:-.03em;
  text-wrap:balance}}
h1{{font-size:clamp(34px,9vw,52px);font-weight:800;line-height:.98}}
h2{{font-size:19px;font-weight:600}}
.mark{{width:104px;height:104px;border-radius:26px;background:
  linear-gradient(140deg,var(--accent),var(--warm));display:grid;place-items:center;
  font-family:"Bricolage Grotesque",sans-serif;font-size:42px;font-weight:800;color:#fff;
  letter-spacing:-.04em}}
.handle{{font-size:15px;color:var(--accent);font-weight:600}}
.lede{{font-size:18px;color:var(--ink-2);margin:0}}
.disclosure{{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2);
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;align-self:flex-start}}
.disclosure b{{color:var(--ink);font-weight:600}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;
  display:flex;flex-direction:column;gap:14px}}
.price{{font-family:"Bricolage Grotesque",sans-serif;font-size:40px;font-weight:800;
  letter-spacing:-.03em}}
.price span{{font-size:15px;font-weight:500;color:var(--ink-2);letter-spacing:0}}
ul{{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}}
li{{display:grid;grid-template-columns:20px 1fr;gap:10px;font-size:15px}}
li:before{{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent);
  margin-top:8px}}
.cta{{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;
  font-weight:600;font-size:17px;padding:15px 20px;border-radius:12px;transition:transform .12s}}
.cta:hover{{transform:translateY(-1px)}}
.cta:focus-visible{{outline:3px solid var(--warm);outline-offset:3px}}
.cta.ghost{{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}}
form{{display:flex;gap:9px;flex-wrap:wrap}}
input[type=email]{{flex:1 1 220px;padding:13px 14px;border-radius:11px;border:1px solid var(--line);
  background:var(--ground);color:var(--ink);font:inherit;font-size:15px}}
input[type=email]:focus-visible{{outline:2px solid var(--accent);outline-offset:1px}}
button{{padding:13px 20px;border-radius:11px;border:none;background:var(--ink);color:var(--ground);
  font:inherit;font-weight:600;cursor:pointer}}
.picks a{{color:var(--ink);text-decoration:none;display:flex;justify-content:space-between;
  gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px}}
.picks a:last-child{{border-bottom:none}}
.picks span{{color:var(--accent);font-weight:600;white-space:nowrap}}
footer{{font-size:12.5px;color:var(--ink-2);border-top:1px solid var(--line);padding-top:18px;
  display:flex;flex-direction:column;gap:6px}}
@media (prefers-reduced-motion:reduce){{.cta{{transition:none}}}}
</style>
<div class="wrap">
  <div class="mark">{initials}</div>
  <div>
    <div class="handle">@{handle}</div>
    <h1>{name}</h1>
  </div>
  <p class="lede">{lede}</p>
  <div class="disclosure"><b>AI</b> {disclosure}</div>

  <div class="card">
    <h2>{offer_title}</h2>
    <div class="price">${price}<span> / month</span></div>
    <ul>{bullets}</ul>
    <a class="cta" href="{subscribe_url}">{subscribe_label}</a>
  </div>

  <div class="card">
    <h2>Start free</h2>
    <p class="lede" style="font-size:15px">{magnet}</p>
    <form action="{newsletter_action}" method="post">
      <input type="email" name="email" placeholder="your email" required aria-label="your email">
      <button type="submit">Send it</button>
    </form>
  </div>

  {picks_block}

  <footer>
    <span>{disclosure} Content is generated; the person shown does not exist.</span>
    <span>{contact}</span>
  </footer>
</div>
"""

PICKS = """<div class="card picks">
    <h2>What I actually use</h2>
    {rows}
    <p class="lede" style="font-size:13px">Some links are affiliate links.</p>
  </div>"""


def render_persona(persona: Persona, niche_name: str, outdir: str) -> str:
    pal = _palette(persona.seed)
    subscribe = os.environ.get("SUBSCRIBE_URL", "")
    newsletter = os.environ.get("NEWSLETTER_ACTION", "")
    affiliate = os.environ.get("AFFILIATE_URL", "")
    initials = "".join(part[0] for part in persona.name.split()[:2]).upper()

    bullets = "".join(f"<li><span>{_esc(p)}</span></li>" for p in persona.pillars)
    picks_block = ""
    if affiliate:
        rows = "".join(
            f'<a href="{_esc(affiliate)}" rel="sponsored nofollow">{_esc(p)}<span>see it →</span></a>'
            for p in persona.pillars[:3])
        picks_block = PICKS.format(rows=rows)

    page = PAGE.format(
        name=_esc(persona.name), handle=_esc(persona.handle), initials=_esc(initials),
        lede=_esc(f"{persona.archetype.capitalize()} — {niche_name}."),
        disclosure=DISCLOSURE,
        offer_title=_esc(f"Everything, every week"),
        price=f"{persona.price:.2f}".rstrip("0").rstrip("."),
        bullets=bullets,
        subscribe_url=_esc(subscribe or "#no-subscribe-url-configured"),
        subscribe_label="Subscribe" if subscribe else "Set SUBSCRIBE_URL to enable",
        magnet=_esc(f"The {persona.pillars[0]} starter, free. One email, no course pitch."),
        newsletter_action=_esc(newsletter or "#no-newsletter-endpoint-configured"),
        picks_block=picks_block,
        contact=_esc(f"@{persona.handle} · operated by an automated content system"),
        **pal)

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{persona.handle}.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    return path


def render_all(store, cfg, outdir: str) -> list[str]:
    niches = {n.id: n.name for n in store.niches(Niche)}
    return [render_persona(p, niches.get(p.niche_id, ""), outdir)
            for p in store.personas(Persona, status="active")]
