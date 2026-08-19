"""Where a given piece of content is allowed to go.

SFW work fans out across the discovery platforms; adult-tier work is confined
to age-gated destinations and only when the operator enabled that tier. This is
consulted by the copywriter (what to write for) and enforced again by the
compliance officer and the publisher (what may actually ship).
"""
from __future__ import annotations


def route(persona, config, providers) -> list[str]:
    tier = persona.tier if config.adult_enabled else "sfw"
    wanted = config.platforms(tier) or config.platforms("sfw")
    available = set(providers.social)
    gated = providers.age_gated_platforms()
    out = []
    for p in wanted:
        if p not in available:
            continue
        if tier == "adult" and p not in gated:
            continue
        out.append(p)
    # Every persona also keeps a funnel destination for subscriptions.
    for p in config.platforms("funnel"):
        if p in available and p not in out and (config.adult_enabled or p in gated):
            out.append(p)
    return out
