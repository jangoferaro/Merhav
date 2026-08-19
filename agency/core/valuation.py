"""What a branch is worth.

Cash tells you what the company has. This tells you what it owns. A content
business is priced on trailing profit times a multiple, and the multiple is not
a constant — it moves with growth, with how concentrated the revenue is, and
with how much of the asset would survive being handed to someone else.

Every number in DEFAULTS is a market assumption, not a fact. Content businesses
have traded anywhere from roughly 20x to 45x monthly profit depending on the
year, the niche and the quality of the earnings; the config is where you put
the comps you actually believe.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Valuation:
    value: float
    monthly_profit: float
    multiple: float
    factors: dict
    note: str = ""

    def as_dict(self) -> dict:
        return {"value": round(self.value, 2), "monthly_profit": round(self.monthly_profit, 2),
                "multiple": round(self.multiple, 2), "factors": self.factors, "note": self.note}


def _trailing(store, persona_id: str, day: int, window: int = 30) -> tuple[float, float]:
    """Operating revenue only. A previous sale is a capital event and would
    value the branch on its own liquidation."""
    since = max(0, day - window)
    rows = store.query(
        "SELECT COALESCE(SUM(amount),0) s FROM revenue WHERE persona_id=? AND day>=? "
        "AND stream NOT IN ('exit')", (persona_id, since))
    revenue = float(rows[0]["s"])
    cost = store.persona_cost(persona_id, since_day=since, n_personas=1)
    return revenue, cost


def value_branch(store, config, persona, day: int, world=None) -> Valuation:
    window = int(config.get("holding.valuation_window", 30))
    base_multiple = float(config.get("holding.base_multiple", 26.0))   # x monthly profit
    revenue, cost = _trailing(store, persona.id, day, window)
    recent = (revenue - cost) * (30.0 / max(1, min(window, day)))
    long_rev, long_cost = _trailing(store, persona.id, day, window * 2)
    smoothed = (long_rev - long_cost) * (30.0 / max(1, min(window * 2, day)))
    # A spike is not a run rate. Price the branch on the more conservative of
    # the two windows — which is what a buyer's diligence would do.
    monthly_profit = min(recent, smoothed) if smoothed > 0 else recent

    if monthly_profit <= 0:
        # A branch that does not earn is worth what its audience would cost to
        # rebuild, heavily discounted — not zero, but not a multiple either.
        followers = world.total_followers(persona.id) if world else 0
        rebuild = followers * float(config.get("holding.value_per_follower", 0.02))
        return Valuation(value=round(rebuild, 2), monthly_profit=monthly_profit,
                         multiple=0.0,
                         factors={"followers": followers, "basis": "rebuild_cost"},
                         note="no trailing profit — valued on what the audience cost to build")

    # Growth: a branch still compounding is worth more than a flat one.
    prev_rev = store.persona_revenue(persona.id, since_day=max(0, day - window * 2)) - revenue
    growth = (revenue - prev_rev) / prev_rev if prev_rev > 0 else 0.5
    growth_factor = max(0.7, min(1.25, 1.0 + growth * 0.35))

    # Concentration: one platform carrying everything is a fragile asset.
    platforms = store.query(
        "SELECT COUNT(DISTINCT platform) c FROM posts WHERE persona_id=?", (persona.id,))[0]["c"]
    concentration = 0.85 if platforms <= 1 else (0.95 if platforms == 2 else 1.0)

    # Transferability: what a buyer can actually take ownership of. Social
    # accounts themselves are not transferable under most platform terms, so an
    # asset whose value sits entirely in follower counts trades at a discount to
    # one with a list, a site and recurring billing behind it.
    subs = world.sub_count(persona.id) if world else 0
    transferable = 1.0 if subs >= int(config.get("holding.transferable_subs", 50)) else 0.75

    # Age: a three-week-old account has no track record to sell.
    age_days = max(1, day - persona.created_day)
    maturity = min(1.0, age_days / float(config.get("holding.maturity_days", 90)))

    multiple = base_multiple * growth_factor * concentration * transferable * maturity
    factors = {"growth": round(growth_factor, 3), "concentration": concentration,
               "transferable": transferable, "maturity": round(maturity, 3),
               "platforms": platforms, "subs": subs, "age_days": age_days}
    note = ""

    # For an acquired branch, the entire thesis is "our operation earns more
    # from this audience than the seller did". That is one assumption, it is
    # unvalidated, and it is doing all the work in the valuation — so measure it
    # and say so rather than letting it hide inside a multiple.
    if getattr(persona, "origin", "built") == "bought" and persona.inherited_profit > 0:
        uplift = monthly_profit / persona.inherited_profit
        factors["implied_uplift"] = round(uplift, 2)
        factors["inherited_profit"] = persona.inherited_profit
        credible = float(config.get("holding.credible_uplift", 3.0))
        if uplift > credible:
            note = (f"valuation implies our operation earns {uplift:.1f}x what the seller did "
                    f"from the same audience — above the {credible:.0f}x we consider credible. "
                    f"Treat this number as an untested assumption, not an asset value.")

    return Valuation(value=round(monthly_profit * multiple, 2),
                     monthly_profit=monthly_profit, multiple=multiple,
                     factors=factors, note=note)


def cost_to_build(store, config, day: int, world=None) -> dict:
    """What this company's own history says it costs to build an audience and a
    dollar of monthly profit from zero. This is the honest denominator for any
    'should we buy instead' decision — not an industry benchmark, our number.
    """
    total_cost = float(store.query(
        "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE kind='opex'")[0]["s"])
    from .models import Persona
    personas = store.personas(Persona)
    followers = sum(world.total_followers(p.id) for p in personas) if world else 0
    revenue = float(store.query(
        "SELECT COALESCE(SUM(amount),0) s FROM revenue WHERE stream NOT IN ('exit')")[0]["s"])
    days = max(1, day)
    monthly_profit = (revenue - total_cost) * (30.0 / days)
    survivors = len([p for p in personas if p.status == "active"])
    launched = len(personas)
    return {
        "cost_per_follower": (total_cost / followers) if followers else 0.0,
        "cost_per_monthly_profit": (total_cost / monthly_profit) if monthly_profit > 0 else 0.0,
        "survival_rate": (survivors / launched) if launched else 0.0,
        "total_cost": total_cost, "followers": followers, "monthly_profit": monthly_profit,
    }
