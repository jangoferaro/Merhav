"""Content banks used by the offline generator.

Everything here is template + seeded recombination: enough variety that a
30-day run produces distinguishable content, deterministic enough that a rerun
reproduces it exactly.
"""
from __future__ import annotations

import hashlib
import json
import re

NICHES = [
    # name, demand, cpm, competition, monetization, risk, tier
    ("fitness & home workouts", 0.86, 14.0, 0.78, 0.62, 0.20, "sfw"),
    ("personal finance for 20s", 0.72, 26.0, 0.60, 0.70, 0.35, "sfw"),
    ("travel & digital nomad", 0.80, 12.0, 0.74, 0.48, 0.18, "sfw"),
    ("streetwear & fashion hauls", 0.78, 16.0, 0.72, 0.58, 0.22, "sfw"),
    ("ai tools & productivity", 0.68, 22.0, 0.55, 0.66, 0.15, "sfw"),
    ("gaming & esports clips", 0.88, 9.0, 0.85, 0.40, 0.20, "sfw"),
    ("beauty & skincare routines", 0.82, 18.0, 0.80, 0.64, 0.25, "sfw"),
    ("luxury cars & watches", 0.66, 20.0, 0.62, 0.52, 0.22, "sfw"),
    ("cooking in 60 seconds", 0.84, 11.0, 0.76, 0.44, 0.12, "sfw"),
    ("mindfulness & sleep", 0.62, 15.0, 0.50, 0.56, 0.20, "sfw"),
    ("pet content & training", 0.74, 10.0, 0.66, 0.38, 0.10, "sfw"),
    ("glamour & boudoir portraits", 0.70, 8.0, 0.55, 0.88, 0.85, "adult"),
]

FIRST = ["Maya", "Noa", "Alina", "Rae", "Iris", "Talia", "Vera", "Sasha", "Dana", "Nika",
         "Leo", "Adam", "Ken", "Roy", "Ilan", "Omri"]
LAST = ["Kane", "Ford", "Vale", "Nomi", "Bloom", "Ridge", "Sol", "Marr", "Levine", "Ash"]

ARCHETYPES = ["the girl next door who actually did the reps",
              "the ex-analyst who quit to teach money",
              "the calm expert who never oversells",
              "the chaotic-good friend with great taste",
              "the perfectionist who shows the failures too",
              "the quiet nerd with a cult following"]

LOOK_PARTS = {
    "age": ["24-year-old", "27-year-old", "29-year-old", "31-year-old"],
    "build": ["athletic", "slim", "curvy", "broad-shouldered", "petite"],
    "hair": ["long auburn hair", "short black bob", "platinum buzzcut", "wavy brown hair",
             "dark curls", "sandy blonde ponytail"],
    "eyes": ["green eyes", "hazel eyes", "dark brown eyes", "grey-blue eyes"],
    "mark": ["a small scar above the left brow", "freckles across the nose",
             "a fine gold chain always worn", "a faded geometric tattoo on the forearm"],
    "style": ["minimal streetwear", "warm earth tones", "monochrome tailoring",
              "sporty technical fabrics", "soft vintage denim"],
}

PILLARS = {
    "fitness & home workouts": ["form-check", "12-week transformation log", "5-minute finishers",
                                "gym myths debunked", "meal prep on a budget"],
    "personal finance for 20s": ["salary negotiation scripts", "index funds explained",
                                 "my monthly numbers", "debt payoff diary", "money mistakes"],
    "travel & digital nomad": ["cost of living breakdowns", "48h city guides", "visa hacks",
                               "packing systems", "remote work setups"],
    "streetwear & fashion hauls": ["fit checks", "thrift flips", "dupes vs originals",
                                   "capsule wardrobe", "brand deep dives"],
    "ai tools & productivity": ["tool of the day", "workflow teardown", "prompt patterns",
                                "automation build", "before/after time audit"],
    "gaming & esports clips": ["clutch clips", "settings & sens", "patch reactions",
                               "rank climb diary", "gear reviews"],
    "beauty & skincare routines": ["ingredient explainers", "morning routine", "product graveyard",
                                   "budget vs luxury", "before/after 30 days"],
    "luxury cars & watches": ["spec breakdowns", "depreciation truth", "collection tours",
                              "buying guides", "auction watch"],
    "cooking in 60 seconds": ["one-pan dinners", "5-ingredient recipes", "technique in 30s",
                              "fridge-clearout meals", "meal prep sunday"],
    "mindfulness & sleep": ["2-minute reset", "sleep protocol", "breathing patterns",
                            "journaling prompts", "anxiety toolkit"],
    "pet content & training": ["training in 60s", "day in the life", "vet myths",
                               "gear that works", "rescue diaries"],
    "glamour & boudoir portraits": ["editorial portrait set", "behind the shoot",
                                    "styling notes", "lighting breakdown", "subscriber exclusive"],
}

HOOKS = [
    "I did {thing} for {n} days and the results were not what I expected",
    "Stop doing {thing}. Do this instead.",
    "Nobody tells you this about {topic}",
    "The {n}-second version of {topic}",
    "I was wrong about {topic} for {n} years",
    "{n} things I'd tell my younger self about {topic}",
    "This costs $0 and beats {thing}",
    "Watch me fix {thing} in one take",
]

BEATS = [
    "cold open on the result, no intro",
    "name the mistake the viewer is making",
    "show the fix in one continuous shot",
    "give the number that proves it",
    "one line of doubt, then resolve it",
    "close with the next step, not a follow-me beg",
]

CTAS = ["Full breakdown in the link.", "Part 2 tomorrow.", "Saved for later? Do it now.",
        "The full 20-min version is on the members page.", "Comment 'PLAN' and I'll send it."]

SETTINGS = ["golden-hour rooftop", "clean studio backdrop", "sunlit kitchen", "city street at dusk",
            "minimal home gym", "cafe window seat", "hotel balcony", "concrete parking garage"]
SHOTS = ["medium close-up, 50mm, shallow depth of field", "wide establishing shot, 24mm",
         "over-the-shoulder, 35mm", "flat-lay top-down", "handheld vertical, waist-up"]
LIGHT = ["soft window light", "warm practical lamps", "overcast diffuse light",
         "single key light with rim", "neon spill, teal and magenta"]

COMMENTS = ["how long did this take?", "does this work for beginners?", "link please!",
            "this actually helped, thanks", "is she real??", "what camera is this",
            "tried it, day 3, works", "price?", "can you do one for men",
            "how do I start with $100"]


def _pick(rng, seq):
    return seq[rng.randrange(len(seq))]


def _payload(prompt: str) -> dict:
    """Agents pass their arguments as a JSON block at the end of the prompt."""
    m = re.search(r"\{.*\}\s*$", prompt, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


# -- generators (one per `purpose`) ----------------------------------------

def gen_niche_scan(prompt, rng):
    p = _payload(prompt)
    allow_adult = bool(p.get("allow_adult"))
    pool = [n for n in NICHES if allow_adult or n[6] == "sfw"]
    k = min(int(p.get("k", 6)), len(pool))
    idx = rng.sample(range(len(pool)), k)
    out = []
    for i in idx:
        name, demand, cpm, comp, mon, risk, tier = pool[i]
        j = lambda v, s=0.06: round(min(1.0, max(0.0, v + rng.uniform(-s, s))), 3)
        out.append({"name": name, "demand": j(demand), "cpm": round(cpm * rng.uniform(0.85, 1.15), 2),
                    "competition": j(comp), "monetization": j(mon), "risk": j(risk), "tier": tier})
    return {"niches": out}


def gen_persona(prompt, rng):
    p = _payload(prompt)
    niche = p.get("niche", "lifestyle")
    first, last = _pick(rng, FIRST), _pick(rng, LAST)
    handle = f"{first.lower()}.{last.lower()}"
    look = (f"{_pick(rng, LOOK_PARTS['age'])} fictional {_pick(rng, LOOK_PARTS['build'])} person with "
            f"{_pick(rng, LOOK_PARTS['hair'])}, {_pick(rng, LOOK_PARTS['eyes'])}, "
            f"{_pick(rng, LOOK_PARTS['mark'])}, dressed in {_pick(rng, LOOK_PARTS['style'])}")
    return {
        "name": f"{first} {last}",
        "handle": handle,
        "archetype": _pick(rng, ARCHETYPES),
        "age": 24 + rng.randrange(0, 10),
        "look": look,
        "bio": f"{first} — {niche}. {_pick(rng, ARCHETYPES)}. Fully AI-generated character.",
        "voice": _pick(rng, ["dry, specific, never hypey", "warm and encouraging, short sentences",
                             "blunt, numbers-first", "playful, self-deprecating"]),
        "pillars": PILLARS.get(niche, ["daily tips", "behind the scenes", "q&a", "reviews", "story time"])[:5],
    }


def gen_calendar(prompt, rng):
    p = _payload(prompt)
    pillars = p.get("pillars") or ["daily tips"]
    slots = int(p.get("slots", 3))
    out = []
    for i in range(slots):
        out.append({"pillar": _pick(rng, pillars),
                    "fmt": "video" if rng.random() < 0.6 else "image",
                    "slot_hour": _pick(rng, [8, 12, 17, 19, 21])})
    return {"slots": out}


def gen_script(prompt, rng):
    p = _payload(prompt)
    pillar = p.get("pillar", "daily tips")
    key = f'{pillar}|{p.get("day", 0)}|{p.get("slot", 0)}|{p.get("voice", "")}'
    rng.seed(int.from_bytes(hashlib.blake2b(key.encode(), digest_size=6).digest(), "big"))
    topic = pillar.replace("-", " ")
    hook = _pick(rng, HOOKS).format(thing=topic, topic=topic, n=_pick(rng, [3, 5, 7, 14, 30, 60]))
    beats = rng.sample(BEATS, 3)
    return {"hook": hook,
            "script": " / ".join(beats),
            "beats": beats,
            "duration": _pick(rng, [18, 22, 27, 33, 45])}


ADULT_STYLE = ["boudoir editorial, lingerie, tasteful", "suggestive editorial portrait",
               "glamour lingerie set, soft focus"]


def gen_image_prompt(prompt, rng):
    p = _payload(prompt)
    look = p.get("look", "fictional adult person")
    style = f", {_pick(rng, ADULT_STYLE)}" if p.get("tier") == "adult" else ""
    return {"prompt": (f"{look}{style}, {_pick(rng, SETTINGS)}, {_pick(rng, SHOTS)}, "
                       f"{_pick(rng, LIGHT)}, photoreal, consistent facial identity, "
                       f"natural skin texture"),
            "negative": "text, watermark, extra fingers, distorted face, real celebrity likeness"}


def gen_caption(prompt, rng):
    p = _payload(prompt)
    hook = p.get("hook", "")
    pillar = p.get("pillar", "")
    platform = p.get("platform", "instagram")
    tags = ["#" + re.sub(r"[^a-z0-9]", "", w.lower()) for w in (pillar.split() + [platform])[:4] if w]
    body = {"tiktok": f"{hook}\n\n{_pick(rng, CTAS)}",
            "instagram": f"{hook}\n\n{_pick(rng, BEATS)}.\n{_pick(rng, CTAS)}",
            "x": f"{hook}\n{_pick(rng, CTAS)}",
            "youtube": f"{hook} | {pillar}\n\n{_pick(rng, CTAS)}",
            "reddit": f"{hook}",
            "fanvue": f"{hook}\n\n{_pick(rng, CTAS)}"}.get(platform, hook)
    return {"caption": body, "hashtags": tags, "cta": _pick(rng, CTAS)}


def gen_reply(prompt, rng):
    p = _payload(prompt)
    comment = p.get("comment", "")
    voice = p.get("voice", "warm")
    if "?" in comment:
        text = _pick(rng, ["Good question — short answer: yes, start with the 5-minute version.",
                           "About 20 minutes, and you can split it.",
                           "Beginner-friendly. Halve the reps for week one.",
                           "Link is in the bio, it's the free one."])
    else:
        text = _pick(rng, ["Appreciate you.", "Love that — keep me posted on day 7.",
                           "This made my day.", "Glad it landed."])
    return {"reply": text, "voice": voice}


def gen_interactions(prompt, rng):
    n = int(_payload(prompt).get("n", 3))
    return {"comments": [{"id": f"c{rng.randrange(10**6)}", "text": _pick(rng, COMMENTS)} for _ in range(n)]}


ASSET_KINDS = [
    ("faceless youtube channel", 0.9, True),
    ("niche newsletter", 1.25, True),
    ("instagram meme page", 0.65, False),
    ("tiktok clip account", 0.55, False),
    ("content site + list", 1.35, True),
    ("AI persona brand", 0.8, True),
]


def gen_market_scan(prompt, rng):
    """Acquisition listings, the way a marketplace actually looks: mostly
    overpriced, a few fairly priced, occasionally something mispriced because
    the owner is tired. Risk flags are what a buyer would actually find in
    diligence."""
    p = _payload(prompt)
    k = int(p.get("k", 5))
    out = []
    for _ in range(k):
        kind, quality, transferable = _pick(rng, ASSET_KINDS)
        niche = _pick(rng, NICHES)[0]
        followers = int(rng.lognormvariate(9.6, 0.9))          # ~2k .. ~120k
        # Revenue per follower has to sit in the same range our own monetization
        # can reach, otherwise every listing is underpriced by construction and
        # the buy-side agent prints money against an assumption we wrote.
        monthly_revenue = round(followers * rng.uniform(0.008, 0.05) * quality, 2)
        margin = rng.uniform(0.45, 0.85)
        monthly_profit = round(monthly_revenue * margin, 2)
        # Sellers anchor high; the spread is where the work is. A minority are
        # motivated — burnt out, moving on, or holding an asset they have
        # stopped operating — and that is where acquisitions actually happen.
        motivated = rng.random() < 0.22
        ask_multiple = round(rng.uniform(11, 20) if motivated else rng.uniform(18, 46), 1)
        flags = ["owner has stopped posting"] if motivated else []
        if rng.random() < 0.35:
            flags.append("single platform")
        if rng.random() < 0.30:
            flags.append("no email list")
        if rng.random() < 0.22:
            flags.append("engagement looks bought")
        if rng.random() < 0.18:
            flags.append("owner is the face — not transferable")
        if not transferable:
            flags.append("account transfer breaches platform terms")
        out.append({
            "id": f"lst_{rng.randrange(10**6):06d}",
            "kind": kind, "niche": niche, "followers": followers,
            "monthly_revenue": monthly_revenue, "monthly_profit": monthly_profit,
            "asking_price": round(monthly_profit * ask_multiple, 2),
            "ask_multiple": ask_multiple,
            "age_months": rng.randrange(4, 48),
            "email_list": int(followers * rng.uniform(0.0, 0.08)) if transferable else 0,
            "flags": flags,
        })
    return {"listings": out}


def gen_rationale(prompt, rng):
    return {"text": _pick(rng, [
        "Reallocating toward proven CPM and retention, away from flat cohorts.",
        "Cohort is compounding; adding a slot is cheaper than opening a new persona.",
        "Two weeks below the payback threshold — capital is better used elsewhere.",
        "Funnel conversion, not reach, is the bottleneck this week.",
    ])}
