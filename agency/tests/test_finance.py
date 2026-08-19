import unittest

from ..core.agent import Ledger
from .helpers import build_company


class TestLedger(unittest.TestCase):
    def test_daily_budget_is_a_hard_ceiling(self):
        led = Ledger(cash=1000, daily_budget=10)
        self.assertTrue(led.spend(6))
        self.assertFalse(led.spend(6))          # 12 > 10 for the day
        led.new_day(10)
        self.assertTrue(led.spend(6))

    def test_cannot_spend_money_that_is_not_there(self):
        led = Ledger(cash=5, daily_budget=100)
        self.assertFalse(led.spend(6))


class TestBooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.company, cls.store = build_company(days=8)

    def test_cash_matches_revenue_minus_cost(self):
        rev, cost = self.store.totals()
        expected = self.company.config.start_capital + rev - cost
        self.assertAlmostEqual(self.company.ctx.ledger.cash, expected, places=2)

    def test_costs_are_attributed_to_personas(self):
        direct = self.store.query(
            "SELECT COUNT(*) c FROM costs WHERE persona_id != ''")[0]["c"]
        self.assertGreater(direct, 0)

    def test_daily_spend_never_exceeded_the_budget(self):
        for row in self.store.query("SELECT day, SUM(amount) s FROM costs GROUP BY day"):
            self.assertLessEqual(row["s"], self.company.config.daily_budget * 1.5,
                                 f"day {row['day']} overspent")
