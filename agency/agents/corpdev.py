"""Corporate development — the holding company's buy and sell side.

The company can get a branch three ways: build one from zero, buy one, or keep
one it already has. Those are the same decision measured in different units, so
this agent measures them the same way: what does a dollar of monthly profit
cost, and how certain is it?

Building is the *expensive* option and our own books prove it — most launches
never earn anything, so the cost of a survivor includes everyone who was culled.
That survival-adjusted number is the denominator every acquisition is judged
against.
"""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Niche, Persona, Result, Task, next_id
from ..core.valuation import cost_to_build, value_branch

# Findings that make an asset un-buyable at any price, not merely cheaper.
DISQUALIFYING = {
    "account transfer breaches platform terms":
        "the asset cannot be legally transferred — the platform's terms forbid selling the account",
    "engagement looks bought":
        "the audience is not real, so neither is the earnings history",
    "owner is the face — not transferable":
        "the value walks out of the door with the seller",
}

# Findings that survive diligence but change the price.
DISCOUNTS = {"single platform": 0.85, "no email list": 0.80}


class CorpDevAgent(Agent):
    name = "corpdev"
    dept = "corporate development"
    title = "Head of Corp Dev"
    handles = ("corp.scan", "corp.exit")

    def handle(self, task: Task) -> Result:
        if not self.ctx.config.get("holding.enabled", False):
            return Result(output={"skipped": "holding_disabled"})
        return self._scan() if task.type == "corp.scan" else self._exit()

    # -- buy side -----------------------------------------------------------
    def _scan(self) -> Result:
        store, day = self.ctx.store, self.ctx.day
        every = int(self.ctx.config.get("holding.scan_every", 7))
        if day % every != 0:
            return Result(output={"skipped": "not_a_scan_day"})

        reserve = float(self.ctx.config.get("holding.cash_reserve", 400.0))
        if self.ctx.ledger.cash <= reserve:
            return Result(output={"skipped": "below_cash_reserve"})

        # Live mode has no simulated marketplace: real listings are imported.
        listings = store.listings(status="open")
        if not listings and self.ctx.world is not None:
            found = self.llm("market_scan", 'Acquisition listings.\n{"k": 5}')["listings"]
            for row in found:
                row.update({"day": day, "source": "sim", "status": "open"})
                store.save_listing(row)
            listings = found
        if not listings:
            self.log("no acquisition listings to review "
                     "(import real ones with: agency market import <csv>)", topic="corpdev")
            return Result(output={"listings": 0})

        build = cost_to_build(store, self.ctx.config, day, self.ctx.world)
        reviewed, bought = 0, []
        for listing in sorted(listings, key=lambda x: x.get("asking_price", 0)):
            reviewed += 1
            verdict = self.evaluate(listing, build)
            listing["status"] = "reviewed"
            listing["verdict"] = verdict
            store.save_listing(listing)
            if verdict["buy"]:
                deal = self._acquire(listing, verdict)
                if deal:
                    bought.append(deal)
                    break                       # one acquisition per scan
        self.log(f"reviewed {reviewed} listings, bought {len(bought)}",
                 {"build_cost_per_profit": round(build["cost_per_monthly_profit"], 1)},
                 topic="corpdev")
        return Result(output={"reviewed": reviewed, "bought": len(bought)})

    def evaluate(self, listing: dict, build: dict) -> dict:
        """Buy, build, or pass — and the reason, in that order of scrutiny."""
        cfg = self.ctx.config
        flags = listing.get("flags", [])
        for flag in flags:
            if flag in DISQUALIFYING:
                return {"buy": False, "reason": DISQUALIFYING[flag], "flag": flag,
                        "our_value": 0.0, "max_bid": 0.0}

        profit = float(listing.get("monthly_profit", 0))
        if profit <= 0:
            return {"buy": False, "reason": "no trailing profit to price", "our_value": 0.0,
                    "max_bid": 0.0}

        multiple = float(cfg.get("holding.base_multiple", 26.0))
        for flag in flags:
            multiple *= DISCOUNTS.get(flag, 1.0)
        # A young asset has no track record; discount it the same way a branch
        # of our own is discounted before maturity.
        months = float(listing.get("age_months", 12))
        multiple *= min(1.0, months / 12.0 + 0.25)
        if listing.get("email_list", 0) > 0:
            multiple *= 1.08                 # an owned list is the transferable part

        our_value = profit * multiple
        max_bid = our_value * float(cfg.get("holding.min_discount", 0.78))
        ask = float(listing.get("asking_price", 0))

        # What the same monthly profit would cost us to build, including the
        # launches that never work — the honest comparison.
        survival = max(0.05, build.get("survival_rate", 0.2))
        unit = build.get("cost_per_monthly_profit", 0.0) or 0.0
        have_benchmark = unit > 0 and build.get("monthly_profit", 0) > 0
        build_cost = unit * profit / survival if have_benchmark else 0.0
        cheaper_to_build = have_benchmark and build_cost < ask * 0.8

        cash = self.ctx.ledger.cash
        ticket_cap = min(cash - float(cfg.get("holding.cash_reserve", 400.0)),
                         cash * float(cfg.get("holding.max_ticket", 0.40)))

        if ask > max_bid:
            return {"buy": False, "our_value": our_value, "max_bid": max_bid, "ask": ask,
                    "reason": f"asking {ask / profit:.0f}x against our {multiple:.0f}x — "
                              f"overpriced by ${ask - max_bid:,.0f}"}
        if cheaper_to_build:
            return {"buy": False, "our_value": our_value, "max_bid": max_bid, "ask": ask,
                    "reason": f"we can build the same ${profit:,.0f}/mo for ~${build_cost:,.0f}"}
        if ask > ticket_cap:
            return {"buy": False, "our_value": our_value, "max_bid": max_bid, "ask": ask,
                    "reason": f"${ask:,.0f} exceeds the ticket cap of ${ticket_cap:,.0f}"}
        return {"buy": True, "our_value": our_value, "max_bid": max_bid, "ask": ask,
                "multiple": multiple, "build_cost": build_cost,
                "reason": (f"pays back in {ask / profit:.0f} months; building the same profit "
                           f"costs ~${build_cost:,.0f} at our {survival:.0%} survival rate"
                           if have_benchmark else
                           f"pays back in {ask / profit:.0f} months; we have no profitable "
                           f"branch of our own to price a build against")}

    def _acquire(self, listing: dict, verdict: dict) -> dict | None:
        store, day = self.ctx.store, self.ctx.day
        price = float(listing["asking_price"])
        reserve = float(self.ctx.config.get("holding.cash_reserve", 400.0))
        if not self.invest("acquisition", price, reserve, persona_id=""):
            return None

        niche = next((n for n in store.niches(Niche) if n.name == listing.get("niche")), None)
        handle = f"{listing['kind'].split()[0].lower()}.{listing['id'][-4:]}"
        p = Persona(id=next_id("persona"), niche_id=niche.id if niche else "",
                    name=listing["kind"].title(), handle=handle,
                    archetype=f"acquired {listing['kind']}", tier="sfw",
                    seed=self.ctx.sub_rng("acq", listing["id"]).randrange(10_000, 9_999_999),
                    look="acquired asset — existing library and audience",
                    bio=f"Acquired {listing['kind']} in {listing.get('niche', '')}.",
                    voice="inherited house voice",
                    pillars=["inherited library", "audience reactivation", "new format tests"],
                    created_day=day, quality=0.55, slots=2, origin="bought",
                    acquired_price=price, acquired_day=day,
                    inherited_profit=float(listing["monthly_profit"]))
        store.save_persona(p)

        if self.ctx.world:
            platforms = self.ctx.config.platforms("sfw")[:2] or ["tiktok"]
            per = float(listing.get("followers", 0)) / max(1, len(platforms))
            for platform in platforms:
                self.ctx.world.seed_audience(p.id, platform, per)
            self.ctx.world.seed_audience(p.id, platforms[0], per,
                                         subs=float(listing.get("email_list", 0)) * 0.05)

        deal = {"id": next_id("deal"), "day": day, "kind": "buy", "persona_id": p.id,
                "target": listing["id"], "price": price,
                "multiple": price / max(0.01, listing["monthly_profit"]),
                "monthly_profit": listing["monthly_profit"], "rationale": verdict["reason"],
                "listing": listing}
        store.save_deal(deal)
        listing["status"] = "acquired"
        store.save_listing(listing)
        self.decide("acquire",
                    f"Bought {listing['kind']} ({listing['followers']:,} followers, "
                    f"${listing['monthly_profit']:,.0f}/mo) for ${price:,.0f} at "
                    f"{deal['multiple']:.0f}x. {verdict['reason']}.",
                    {"persona": p.id, "price": price})
        return deal

    # -- sell side ----------------------------------------------------------
    def _exit(self) -> Result:
        store, day = self.ctx.store, self.ctx.day
        cfg = self.ctx.config
        sold = []
        for p in store.personas(Persona, status="active"):
            val = value_branch(store, cfg, p, day, self.ctx.world)
            store.save_valuation(p.id, day, val.value, val.as_dict())
            if val.monthly_profit <= 0 or val.value <= 0:
                continue

            # An offer only exists if someone makes one; model that as arriving
            # occasionally, and in live mode it is imported like any real deal.
            rng = self.ctx.sub_rng("offer", p.id, day)
            if self.ctx.world is None or rng.random() > 0.12:
                continue
            offer = val.value * rng.uniform(0.75, 1.35)
            offer_multiple = offer / val.monthly_profit

            growth = val.factors.get("growth", 1.0)
            flat = growth <= 1.0 + float(cfg.get("holding.exit_flat_growth", 0.06))
            rich = offer_multiple >= float(cfg.get("holding.exit_multiple", 30.0))
            if not (rich and (flat or offer > val.value * 1.25)):
                continue

            basis = p.acquired_price or store.persona_direct_cost(p.id)
            gain = offer - basis
            store.add_revenue(day, p.id, "exit", offer,
                              f"sold at {offer_multiple:.0f}x monthly profit")
            p.status = "sold"
            store.save_persona(p)
            deal = {"id": next_id("deal"), "day": day, "kind": "sell", "persona_id": p.id,
                    "target": p.handle, "price": offer, "multiple": offer_multiple,
                    "monthly_profit": val.monthly_profit,
                    "rationale": f"growth {growth:.2f}, offer {offer_multiple:.0f}x",
                    "basis": basis, "gain": gain}
            store.save_deal(deal)
            sold.append(deal)
            self.decide("exit",
                        f"Sold @{p.handle} for ${offer:,.0f} at {offer_multiple:.0f}x "
                        f"(${val.monthly_profit:,.0f}/mo, cost basis ${basis:,.0f}, "
                        f"gain ${gain:,.0f}). Growth had flattened to {growth:.2f}.",
                        {"persona": p.id, "price": offer, "gain": gain})
        return Result(output={"sold": len(sold)})
