"""Billing.

Two distinct jobs, deliberately kept apart:

* `charge_*` / `payout_*` compute what a given number of subscribers or clicks
  is *worth*. In simulated mode that is what the monetization agent books, and
  it is written to the ledger as `source='modelled'`.
* `fetch_receipts()` reports money that actually landed. Only that is booked as
  `source='real'`. The offline provider has no receipts and says so, rather
  than inventing any.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request


class MockPayments:
    name = "mock"
    live = False
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

    def fetch_receipts(self, since_ts: int = 0) -> list[dict]:
        """Money that actually arrived. Nothing can, without a live processor."""
        return []


class StripePayments(MockPayments):
    """Stripe. Subscriptions billed by Stripe are read back as balance
    transactions, so the ledger records what settled rather than what was
    modelled."""
    name = "stripe"
    API = "https://api.stripe.com/v1"

    def __init__(self):
        self.key = os.environ.get("STRIPE_API_KEY", "")
        self.live = bool(self.key)
        # With Stripe the platform cut is ours to keep; only the processor fee applies.
        self.platform_fee = 0.0 if self.key else MockPayments.platform_fee

    def _get(self, path: str, params: dict) -> dict:
        url = f"{self.API}/{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"authorization": f"Bearer {self.key}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())

    def fetch_receipts(self, since_ts: int = 0) -> list[dict]:
        if not self.key:
            return []
        try:
            data = self._get("balance_transactions",
                             {"limit": 100, "created[gte]": int(since_ts), "type": "charge"})
        except Exception:
            return []
        out = []
        for tx in data.get("data", []):
            out.append({
                "external_id": tx.get("id", ""),
                "amount": tx.get("net", 0) / 100.0,      # Stripe reports minor units
                "currency": tx.get("currency", "usd"),
                "created": tx.get("created", 0),
                "stream": "subscription",
                "note": tx.get("description") or "stripe charge",
            })
        return out
