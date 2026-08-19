import os
import tempfile
import unittest

from ..core.models import Persona, Task
from ..core.store import Store
from .helpers import build_company


class FakeProcessor:
    """Stands in for Stripe: reports two settled charges, always the same ones."""
    name = "fake"
    live = True

    def fetch_receipts(self, since_ts: int = 0):
        return [{"external_id": "tx_1", "amount": 12.40, "created": 1000,
                 "stream": "subscription", "note": "monthly"},
                {"external_id": "tx_2", "amount": 3.10, "created": 1001,
                 "stream": "ppv", "note": "unlock"}]


class TestLiveMode(unittest.TestCase):
    def _live_company(self):
        from ..core import config as configmod
        from ..core.orchestrator import Company
        cfg = configmod.load()
        cfg.raw["paths"]["media"] = tempfile.mkdtemp(prefix="agency-live-")
        store = Store(":memory:")
        return Company(cfg, store, world=None), store   # world=None == live

    def test_live_mode_books_no_modelled_revenue(self):
        company, store = self._live_company()
        company.run(days=3, start=1)
        self.assertEqual(store.revenue_by_source().get("modelled", 0.0), 0.0)

    def test_settled_receipts_are_booked_as_real_money(self):
        company, store = self._live_company()
        company.ctx.providers.payments = FakeProcessor()
        company.run(days=1, start=1)
        by_source = store.revenue_by_source()
        self.assertAlmostEqual(by_source.get("real", 0.0), 15.50, places=2)
        self.assertNotIn("modelled", by_source)

    def test_the_same_receipt_is_never_booked_twice(self):
        company, store = self._live_company()
        company.ctx.providers.payments = FakeProcessor()
        company.run(days=1, start=1)
        company.ctx.memory["last_receipt_ts"] = 0      # force a re-read of the same window
        company.run(days=1, start=2)
        self.assertAlmostEqual(store.revenue_by_source().get("real", 0.0), 15.50, places=2)

    def test_dry_run_sends_nothing_and_records_no_posts(self):
        from ..core import config as configmod
        from ..core.orchestrator import Company
        cfg = configmod.load()
        cfg.raw["paths"]["media"] = tempfile.mkdtemp(prefix="agency-dry-")
        store = Store(":memory:")
        company = Company(cfg, store, world=None, dry_run=True)
        company.run(days=1, start=1)
        self.assertEqual(store.query("SELECT COUNT(*) c FROM posts")[0]["c"], 0)
        self.assertGreater(store.query("SELECT COUNT(*) c FROM content")[0]["c"], 0)


class TestRealMoneyImport(unittest.TestCase):
    def test_imported_payouts_land_as_real_revenue_and_dedupe(self):
        company, store = build_company(days=1)
        for _ in range(2):
            store.add_revenue(day=1, persona_id="", stream="brand_deal", amount=250.0,
                              note="invoice 001", source="real", external_id="inv-001")
        self.assertAlmostEqual(store.revenue_by_source()["real"], 250.0, places=2)

    def test_real_and_modelled_are_never_summed_in_the_same_figure(self):
        company, store = build_company(days=3)
        store.add_revenue(day=3, persona_id="", stream="manual", amount=100.0,
                          source="real", external_id="x-1")
        by_source = store.revenue_by_source()
        self.assertIn("modelled", by_source)
        self.assertAlmostEqual(by_source["real"], 100.0, places=2)


class TestPreflight(unittest.TestCase):
    def test_a_bare_machine_is_not_cleared_for_live_publishing(self):
        from ..core.preflight import run
        company, store = build_company(days=0)
        for key in ("EROMIFY_API_KEY", "IMAGE_API_KEY", "STRIPE_API_KEY", "FUNNEL_URL",
                    "TIKTOK_ACCESS_TOKEN", "IG_ACCESS_TOKEN"):
            os.environ.pop(key, None)
        pf = run(company.config, company.ctx.providers, company.ctx.policy)
        self.assertFalse(pf.ready)
        labels = {c.key for c in pf.blocking_gaps}
        self.assertIn("payments", labels)
        self.assertIn("distribution", labels)
        # the gate itself must never be a gap
        self.assertNotIn("compliance", labels)


class TestFunnel(unittest.TestCase):
    def test_pages_render_with_the_disclosure_and_a_working_cta(self):
        from ..report.funnel import render_all
        company, store = build_company(days=1)
        os.environ["SUBSCRIBE_URL"] = "https://buy.stripe.com/test"
        outdir = tempfile.mkdtemp(prefix="agency-funnel-")
        paths = render_all(store, company.config, outdir)
        self.assertTrue(paths)
        with open(paths[0], encoding="utf-8") as fh:
            page = fh.read()
        self.assertIn("AI-generated character", page)
        self.assertIn("https://buy.stripe.com/test", page)
        self.assertIn('prefers-color-scheme: dark', page)
        os.environ.pop("SUBSCRIBE_URL")
