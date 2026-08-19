"""Billing: subscriptions, pay-per-view unlocks, tips, affiliate and brand deals.

Offline it books revenue straight into the ledger; the Stripe adapter posts the
same shapes to real prices when STRIPE_API_KEY is set."""
from __future__ import annotations

import os


class MockPayments:
    name = "mock"
    platform_fee = 0.20          # what a creator platform keeps
    processor_fee = 0.029

    def charge_subscription(self, persona_handle: str, count: int, price: float) -> dict:
        gross = count * price
        net = gross * (1 - self.platform_fee) * (1 - self.processor_fee)
        return {"gross": round(gross, 2), "net": round(net, 2), "count": count,
                "stream": "subscription"}

    def charge_ppv(self, persona_handle: str, count: int, price: float) -> dict:
        gross = count * price
        net = gross * (1 - self.platform_fee) * (1 - self.processor_fee)
        return {"gross": round(gross, 2), "net": round(net, 2), "count": count, "stream": "ppv"}

    def payout_affiliate(self, clicks: int, epc: float) -> dict:
        return {"net": round(clicks * epc, 2), "stream": "affiliate", "count": clicks}


class StripePayments(MockPayments):
    name = "stripe"

    def __init__(self):
        self.key = os.environ.get("STRIPE_API_KEY", "")
        self.platform_fee = 0.0 if self.key else MockPayments.platform_fee
