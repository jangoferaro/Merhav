from __future__ import annotations

import os
import tempfile

from ..core import config as configmod
from ..core.orchestrator import Company
from ..core.store import Store
from ..sim.world import World


def build_company(days: int = 0, adult: bool = False, media_dir: str | None = None):
    """A company wired to an in-memory database and a throwaway media folder."""
    cfg = configmod.load()
    media = media_dir or tempfile.mkdtemp(prefix="agency-test-")
    cfg.raw.setdefault("paths", {})["media"] = media
    if adult:
        cfg.raw["policy"]["allow_adult_tier"] = True
        os.environ["AGENCY_ADULT_TIER"] = "1"
    else:
        os.environ.pop("AGENCY_ADULT_TIER", None)
    store = Store(":memory:")
    company = Company(cfg, store, World.from_config(cfg))
    if days:
        company.run(days=days, start=1)
    return company, store
