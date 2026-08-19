"""Configuration: a TOML file plus environment overrides.

Providers auto-degrade: if the API key for a live provider is missing, that
provider falls back to its deterministic mock so the whole company still runs
end to end (that is what makes `run --days 30` work on a bare machine).
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from typing import Any

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "config", "company.toml")


@dataclass
class Config:
    raw: dict[str, Any] = field(default_factory=dict)
    path: str = DEFAULT_PATH

    # -- accessors ----------------------------------------------------------
    def get(self, dotted: str, default: Any = None) -> Any:
        node: Any = self.raw
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    @property
    def company(self) -> str:
        return self.get("company.name", "Merhav Media Group")

    @property
    def seed(self) -> int:
        return int(os.environ.get("AGENCY_SEED", self.get("company.seed", 1337)))

    @property
    def start_capital(self) -> float:
        return float(self.get("finance.start_capital", 2000.0))

    @property
    def daily_budget(self) -> float:
        return float(self.get("finance.daily_budget", 60.0))

    @property
    def adult_enabled(self) -> bool:
        return bool(self.get("policy.allow_adult_tier", False)) and \
            os.environ.get("AGENCY_ADULT_TIER", "").lower() in ("1", "true", "yes")

    def provider(self, kind: str) -> str:
        """Which provider to use for `kind` (llm/image/video/voice/social)."""
        env = os.environ.get(f"AGENCY_{kind.upper()}_PROVIDER")
        return env or self.get(f"providers.{kind}", "mock")

    def price(self, item: str) -> float:
        return float(self.get(f"unit_costs.{item}", 0.0))

    def platforms(self, tier: str) -> list[str]:
        return list(self.get(f"distribution.{tier}", []))


def load(path: str | None = None) -> Config:
    path = path or os.environ.get("AGENCY_CONFIG") or DEFAULT_PATH
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)
    return Config(raw=raw, path=path)
