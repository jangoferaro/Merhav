import unittest

from ..core.models import Persona
from ..core.valuation import value_branch
from .helpers import build_company


class FakeBuildBenchmark(dict):
    """Stands in for what our own books say a built branch costs."""
    def __init__(self, per_profit=40.0, survival=0.2):
        super().__init__(cost_per_monthly_profit=per_profit, survival_rate=survival,
                         monthly_profit=100.0)


def listing(**over):
    base = {"id": "lst_test", "kind": "niche newsletter", "niche": "ai tools & productivity",
            "followers": 40000, "monthly_revenue": 800.0, "monthly_profit": 500.0,
            "asking_price": 8000.0, "ask_multiple": 16.0, "age_months": 24,
            "email_list": 3000, "flags": []}
    base.update(over)
    return base


class TestDiligence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.company, cls.store = build_company(days=1)
        cls.corpdev = cls.company.routes["corp.scan"]

    def test_an_untransferable_asset_is_refused_at_any_price(self):
        for flag in ("account transfer breaches platform terms",
                     "engagement looks bought",
                     "owner is the face — not transferable"):
            v = self.corpdev.evaluate(listing(flags=[flag], asking_price=1.0),
                                      FakeBuildBenchmark())
            self.assertFalse(v["buy"], flag)
            self.assertEqual(v.get("flag"), flag)

    def test_an_overpriced_asset_is_refused(self):
        v = self.corpdev.evaluate(listing(asking_price=40_000.0), FakeBuildBenchmark())
        self.assertFalse(v["buy"])
        self.assertIn("overpriced", v["reason"])

    def test_a_fairly_priced_transferable_asset_passes(self):
        self.company.ctx.ledger.cash = 40_000.0      # a balance sheet that can carry it
        v = self.corpdev.evaluate(listing(asking_price=6_000.0), FakeBuildBenchmark())
        self.assertTrue(v["buy"], v["reason"])

    def test_building_wins_when_our_own_books_say_it_is_cheaper(self):
        self.company.ctx.ledger.cash = 40_000.0
        v = self.corpdev.evaluate(listing(asking_price=6_000.0),
                                  FakeBuildBenchmark(per_profit=1.0, survival=1.0))
        self.assertFalse(v["buy"])
        self.assertIn("build", v["reason"])

    def test_a_deal_may_not_consume_the_whole_balance_sheet(self):
        self.company.ctx.ledger.cash = 7_000.0
        v = self.corpdev.evaluate(listing(asking_price=6_000.0), FakeBuildBenchmark())
        self.assertFalse(v["buy"])
        self.assertIn("ticket cap", v["reason"])


class TestHoldingAccounting(unittest.TestCase):
    """The two mistakes that turn a report into a lie."""

    def test_an_acquisition_is_capital_not_an_operating_cost(self):
        company, store = build_company(days=2)
        corpdev = company.routes["corp.scan"]
        _, opex_before = store.day_pnl(2)
        corpdev.invest("acquisition", 500.0, reserve=0.0)
        _, opex_after = store.day_pnl(2)
        self.assertAlmostEqual(opex_before, opex_after, places=2,
                               msg="capex leaked into the operating P&L")
        self.assertAlmostEqual(store.capital_deployed(), 500.0, places=2)

    def test_an_acquisition_ignores_the_daily_marketing_budget(self):
        company, store = build_company(days=1)
        company.ctx.ledger.daily_budget = 60.0
        company.ctx.ledger.spent_today = 60.0
        company.ctx.ledger.cash = 5_000.0
        self.assertTrue(company.routes["corp.scan"].invest("acquisition", 900.0, reserve=100.0))

    def test_an_acquisition_never_breaches_the_cash_reserve(self):
        company, store = build_company(days=1)
        company.ctx.ledger.cash = 1_000.0
        self.assertFalse(company.routes["corp.scan"].invest("acquisition", 950.0, reserve=400.0))

    def test_selling_a_branch_is_not_operating_revenue(self):
        company, store = build_company(days=2)
        before = store.revenue_split()
        store.add_revenue(2, "p1", "exit", 50_000.0, "sold")
        store.add_revenue(2, "p1", "subscription", 100.0, "monthly")
        after = store.revenue_split()
        self.assertAlmostEqual(after["capital"] - before["capital"], 50_000.0, places=2)
        self.assertAlmostEqual(after["operating"] - before["operating"], 100.0, places=2)


class TestNav(unittest.TestCase):
    def test_a_sold_branch_is_not_counted_twice(self):
        company, store = build_company(days=2)
        p = store.personas(Persona)[0]
        store.save_valuation(p.id, 2, 10_000.0, {})
        with_branch = store.nav(company.config.start_capital)["holdings"]
        contribution = store.latest_valuations()[p.id]
        self.assertAlmostEqual(contribution, 10_000.0, places=2)

        p.status = "sold"
        store.save_persona(p)
        store.commit()
        after = store.nav(company.config.start_capital)["holdings"]
        self.assertAlmostEqual(after, with_branch - contribution, places=2,
                               msg="a sold branch is already in the cash line")


class TestValuation(unittest.TestCase):
    def test_a_branch_with_no_profit_is_valued_on_rebuild_cost_not_a_multiple(self):
        company, store = build_company(days=3)
        p = store.personas(Persona)[0]
        val = value_branch(store, company.config, p, 3, company.world)
        self.assertEqual(val.multiple, 0.0)
        self.assertIn("rebuild", val.factors.get("basis", ""))

    def test_an_implausible_uplift_on_an_acquired_branch_is_flagged(self):
        company, store = build_company(days=30)
        p = store.personas(Persona)[0]
        p.origin, p.inherited_profit, p.acquired_day = "bought", 10.0, 1
        store.save_persona(p)
        store.add_revenue(30, p.id, "subscription", 4_000.0, "test")
        val = value_branch(store, company.config, p, 30, company.world)
        self.assertIn("untested assumption", val.note)
        self.assertGreater(val.factors["implied_uplift"], 3.0)
