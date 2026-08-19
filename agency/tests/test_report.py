import os
import tempfile
import unittest

from ..report.dashboard import render
from .helpers import build_company


class TestDashboard(unittest.TestCase):
    def test_dashboard_renders_from_the_database_alone(self):
        company, store = build_company(days=3)
        out = os.path.join(tempfile.mkdtemp(), "dash.html")
        render(store, company.config, out)
        with open(out, encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn("<title>", html)
        self.assertIn("the roster", html)
        self.assertIn("compliance gate", html)
        # both themes must be defined at token level, never inside a block only
        self.assertIn('prefers-color-scheme: dark', html)
        self.assertIn('[data-theme="dark"]', html)
        self.assertGreater(len(html), 10_000)
