"""Revenue: the funnel that turns attention into cash, and the inbound brand
deals that arrive once a persona has an audience worth renting."""
from __future__ import annotations

from ..core.agent import Agent
from ..core.models import Niche, Persona, Post, Result, Task

TARGET_CONVERSION = 0.02


class MonetizationAgent(Agent):
    name = "revenue"
    dept = "revenue"
    title = "Head of Monetization"
    handles = ("revenue.funnel",)

    def _clicks_today(self, persona_id: str) -> int:
        day = self.ctx.day
        rows = self.ctx.store.query(
            "SELECT m.post_id, m.clicks, m.day FROM metrics m JOIN posts p ON p.id=m.post_id "
            "WHERE p.persona_id=? AND m.day IN (?,?)", (persona_id, day, day - 1))
        today = {r["post_id"]: r["clicks"] for r in rows if r["day"] == day}
        prev = {r["post_id"]: r["clicks"] for r in rows if r["day"] == day - 1}
        return sum(max(0, v - prev.get(k, 0)) for k, v in today.items())

    def handle(self, task: Task) -> Result:
        store, day, world = self.ctx.store, self.ctx.day, self.ctx.world
        payments = self.ctx.providers.payments
        if world is None:
            return self._live(store, day, payments)
        booked = 0.0
        for p in store.personas(Persona, status="active"):
            clicks = self._clicks_today(p.id)
            if world is None:
                continue
            trust = min(1.0, 0.45 + (day - p.created_day) / 60 + p.quality * 0.3)
            new_subs = world.convert_subscribers(p.id, clicks, p.price, trust)
            subs = world.sub_count(p.id)

            # Subscriptions bill monthly; book the daily slice.
            if subs:
                bill = payments.charge_subscription(p.handle, subs, p.price / 30.0)
                store.add_revenue(day, p.id, "subscription", bill["net"], f"{subs} subs @ ${p.price}")
                booked += bill["net"]
            # Pay-per-view drops, for the age-gated tier only.
            if p.tier == "adult" and subs > 5:
                buyers = int(subs * 0.12)
                ppv = payments.charge_ppv(p.handle, buyers, round(p.price * 0.6, 2))
                store.add_revenue(day, p.id, "ppv", ppv["net"], f"{buyers} unlocks")
                booked += ppv["net"]
            # Affiliate income on outbound clicks.
            if clicks:
                aff = payments.payout_affiliate(clicks, self.ctx.config.get("finance.epc", 0.06))
                store.add_revenue(day, p.id, "affiliate", aff["net"], f"{clicks} clicks")
                booked += aff["net"]

            # Price tuning against the observed conversion rate.
            conv = (new_subs / clicks) if clicks else None
            if conv is not None and clicks > 60:
                if conv < TARGET_CONVERSION * 0.6 and p.price > 6.99:
                    p.price = round(max(6.99, p.price - 1.0), 2)
                    self.decide("price_down", f"@{p.handle}: conversion {conv:.2%} on {clicks} "
                                              f"clicks — price to ${p.price}.", {"persona": p.id})
                    store.save_persona(p)
                elif conv > TARGET_CONVERSION * 1.8 and p.price < 24.99:
                    p.price = round(p.price + 1.0, 2)
                    self.decide("price_up", f"@{p.handle}: conversion {conv:.2%} — price to "
                                            f"${p.price}.", {"persona": p.id})
                    store.save_persona(p)
        if booked:
            self.log(f"booked ${booked:.2f} across the roster", {"amount": round(booked, 2)},
                     topic="revenue")
        return Result(output={"booked": round(booked, 2)})


    # -- live mode ----------------------------------------------------------
    def _live(self, store, day, payments) -> Result:
        """Real money only. Whatever the processor reports as settled is what
        the ledger gets — no conversion model runs in live mode."""
        since = int(self.ctx.memory.get("last_receipt_ts", 0))
        receipts = payments.fetch_receipts(since)
        if not receipts:
            self.log("no settled receipts to book"
                     + ("" if getattr(payments, "live", False) else
                        " — no live payment processor configured (set STRIPE_API_KEY)"),
                     level="info" if getattr(payments, "live", False) else "warn",
                     topic="revenue")
            return Result(output={"booked": 0.0, "receipts": 0})
        booked, newest = 0.0, since
        handles = {p.handle: p.id for p in store.personas(Persona)}
        for r in receipts:
            persona_id = handles.get(str(r.get("handle", "")), "")
            store.add_revenue(day, persona_id, r.get("stream", "subscription"),
                              float(r["amount"]), r.get("note", ""), source="real",
                              external_id=r.get("external_id", ""))
            booked += float(r["amount"])
            newest = max(newest, int(r.get("created", 0)))
        self.ctx.memory["last_receipt_ts"] = newest
        self.log(f"booked ${booked:.2f} of settled revenue from {len(receipts)} receipts",
                 {"amount": round(booked, 2)}, topic="revenue")
        return Result(output={"booked": round(booked, 2), "receipts": len(receipts)})


class BizDevAgent(Agent):
    name = "bizdev"
    dept = "revenue"
    title = "Brand Partnerships"
    handles = ("revenue.deals",)

    def handle(self, task: Task) -> Result:
        store, day, world = self.ctx.store, self.ctx.day, self.ctx.world
        if world is None:
            # Inbound sponsorship is a human negotiation; in live mode it enters
            # the books through `agency revenue import`, not through an agent.
            return Result(output={"skipped": "live_mode"})
        signed = []
        for p in store.personas(Persona, status="active"):
            followers = world.total_followers(p.id)
            if followers < 15000:
                continue
            rng = self.ctx.sub_rng("bizdev", p.id, day)
            if rng.random() > 0.12:
                continue
            niche = next((n for n in store.niches(Niche) if n.id == p.niche_id), None)
            cpm = niche.cpm if niche else 12.0
            fee = round(followers / 1000 * cpm * rng.uniform(0.5, 1.1), 2)
            store.add_revenue(day, p.id, "brand_deal", fee, "sponsored integration")
            signed.append((p.handle, fee))
            self.decide("brand_deal", f"@{p.handle} signed a ${fee:.0f} integration "
                                      f"({followers:,} followers, ${cpm:.0f} CPM).",
                        {"persona": p.id, "fee": fee})
        return Result(output={"deals": signed})
