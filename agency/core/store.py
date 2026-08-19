"""SQLite persistence. Every agent action, asset, post, dollar in and dollar out
lands here, so a run is fully auditable and resumable."""
from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict
from typing import Any, Iterable, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta        (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS niches      (id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS personas    (id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS content     (id TEXT PRIMARY KEY, persona_id TEXT, day INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS assets      (id TEXT PRIMARY KEY, persona_id TEXT, day INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS posts       (id TEXT PRIMARY KEY, content_id TEXT, persona_id TEXT,
                                        platform TEXT, day INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS metrics     (post_id TEXT, day INTEGER, views INTEGER, likes INTEGER,
                                        comments INTEGER, shares INTEGER, follows INTEGER,
                                        clicks INTEGER, PRIMARY KEY (post_id, day));
CREATE TABLE IF NOT EXISTS audience    (persona_id TEXT, platform TEXT, day INTEGER,
                                        followers INTEGER, subs INTEGER,
                                        PRIMARY KEY (persona_id, platform, day));
-- `source` is the most important column in this database: 'real' means money
-- that actually arrived from a payment provider or an imported payout
-- statement; 'modelled' means the market simulator produced it. They are never
-- summed together in any report.
CREATE TABLE IF NOT EXISTS revenue     (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER,
                                        persona_id TEXT, stream TEXT, amount REAL, note TEXT,
                                        source TEXT DEFAULT 'modelled', external_id TEXT);
-- `kind` separates running the business from buying one: 'opex' is what the
-- daily P&L consumes, 'capex' is capital deployed into an asset that still
-- exists afterwards. Summing them produces a number that means nothing.
CREATE TABLE IF NOT EXISTS costs       (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER,
                                        dept TEXT, item TEXT, amount REAL, persona_id TEXT,
                                        kind TEXT DEFAULT 'opex');
CREATE TABLE IF NOT EXISTS events      (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER,
                                        topic TEXT, actor TEXT, level TEXT, message TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS decisions   (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER,
                                        agent TEXT, kind TEXT, rationale TEXT, data TEXT);
-- The holding company's own books: what was bought, what was sold, at what
-- multiple, and what the reasoning was at the time.
CREATE TABLE IF NOT EXISTS deals      (id TEXT PRIMARY KEY, day INTEGER, kind TEXT,
                                       persona_id TEXT, target TEXT, price REAL,
                                       multiple REAL, monthly_profit REAL, rationale TEXT,
                                       data TEXT);
CREATE TABLE IF NOT EXISTS listings   (id TEXT PRIMARY KEY, day INTEGER, source TEXT,
                                       status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS valuations (persona_id TEXT, day INTEGER, value REAL, data TEXT,
                                       PRIMARY KEY (persona_id, day));
CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, day INTEGER, persona_id TEXT,
                                        dimension TEXT, data TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS tasklog     (id TEXT PRIMARY KEY, day INTEGER, type TEXT, agent TEXT,
                                        status TEXT, ms INTEGER, payload TEXT, output TEXT);
CREATE INDEX IF NOT EXISTS ix_events_day  ON events(day);
CREATE INDEX IF NOT EXISTS ix_posts_day   ON posts(day);
CREATE INDEX IF NOT EXISTS ix_rev_day     ON revenue(day);
CREATE INDEX IF NOT EXISTS ix_cost_day    ON costs(day);
"""


def _d(obj: Any) -> str:
    if hasattr(obj, "__dataclass_fields__"):
        obj = asdict(obj)
    return json.dumps(obj, ensure_ascii=False)


class Store:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.commit()

    # -- generic helpers ----------------------------------------------------
    def close(self) -> None:
        self.db.commit()
        self.db.close()

    def set_meta(self, key: str, value: Any) -> None:
        self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(value)))

    def get_meta(self, key: str, default: Any = None) -> Any:
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    # -- upserts ------------------------------------------------------------
    def save_niche(self, n) -> None:
        self.db.execute("INSERT OR REPLACE INTO niches VALUES (?,?)", (n.id, _d(n)))

    def save_persona(self, p) -> None:
        self.db.execute("INSERT OR REPLACE INTO personas VALUES (?,?)", (p.id, _d(p)))

    def save_content(self, c) -> None:
        self.db.execute("INSERT OR REPLACE INTO content VALUES (?,?,?,?)",
                        (c.id, c.persona_id, c.day, _d(c)))

    def save_asset(self, a) -> None:
        self.db.execute("INSERT OR REPLACE INTO assets VALUES (?,?,?,?)",
                        (a.id, a.persona_id, a.day, _d(a)))

    def save_post(self, p) -> None:
        self.db.execute("INSERT OR REPLACE INTO posts VALUES (?,?,?,?,?,?)",
                        (p.id, p.content_id, p.persona_id, p.platform, p.day, _d(p)))

    def save_metrics(self, post_id: str, day: int, m: dict) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?,?,?)",
            (post_id, day, m.get("views", 0), m.get("likes", 0), m.get("comments", 0),
             m.get("shares", 0), m.get("follows", 0), m.get("clicks", 0)))

    def save_audience(self, persona_id: str, platform: str, day: int, followers: int, subs: int) -> None:
        self.db.execute("INSERT OR REPLACE INTO audience VALUES (?,?,?,?,?)",
                        (persona_id, platform, day, followers, subs))

    def add_revenue(self, day: int, persona_id: str, stream: str, amount: float, note: str = "",
                    source: str = "modelled", external_id: str = "") -> None:
        if source == "real" and external_id:
            dup = self.db.execute("SELECT 1 FROM revenue WHERE external_id=? AND source='real'",
                                  (external_id,)).fetchone()
            if dup:                      # a payout statement imported twice must not double-count
                return
        self.db.execute(
            "INSERT INTO revenue (day,persona_id,stream,amount,note,source,external_id) "
            "VALUES (?,?,?,?,?,?,?)",
            (day, persona_id, stream, round(amount, 4), note, source, external_id))

    def add_cost(self, day: int, dept: str, item: str, amount: float,
                 persona_id: str = "", kind: str = "opex") -> None:
        self.db.execute(
            "INSERT INTO costs (day,dept,item,amount,persona_id,kind) VALUES (?,?,?,?,?,?)",
            (day, dept, item, round(amount, 4), persona_id, kind))

    def capital_deployed(self) -> float:
        return float(self.db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE kind='capex'").fetchone()["s"])

    def persona_cost(self, persona_id: str, since_day: int = 0, n_personas: int = 1) -> float:
        """Direct costs booked against a persona plus its share of overhead."""
        direct = self.db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE persona_id=? AND day>=? "
            "AND kind='opex'", (persona_id, since_day)).fetchone()["s"]
        overhead = self.db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE (persona_id='' OR persona_id IS NULL)"
            " AND day>=? AND kind='opex'", (since_day,)).fetchone()["s"]
        return float(direct) + float(overhead) / max(1, n_personas)

    def add_event(self, day: int, topic: str, actor: str, level: str, message: str, data: Any = None) -> None:
        self.db.execute("INSERT INTO events (day,topic,actor,level,message,data) VALUES (?,?,?,?,?,?)",
                        (day, topic, actor, level, message, _d(data or {})))

    def add_decision(self, day: int, agent: str, kind: str, rationale: str, data: Any = None) -> None:
        self.db.execute("INSERT INTO decisions (day,agent,kind,rationale,data) VALUES (?,?,?,?,?)",
                        (day, agent, kind, rationale, _d(data or {})))

    def log_task(self, task, agent: str, status: str, ms: int, output: Any) -> None:
        self.db.execute("INSERT OR REPLACE INTO tasklog VALUES (?,?,?,?,?,?,?,?)",
                        (task.id, task.day, task.type, agent, status, ms,
                         _d(task.payload), _d(output)))

    def save_deal(self, deal: dict) -> None:
        self.db.execute("INSERT OR REPLACE INTO deals VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (deal["id"], deal["day"], deal["kind"], deal.get("persona_id", ""),
                         deal.get("target", ""), float(deal.get("price", 0)),
                         float(deal.get("multiple", 0)), float(deal.get("monthly_profit", 0)),
                         deal.get("rationale", ""), _d(deal)))

    def deals(self, kind: str | None = None) -> list[dict]:
        where = " WHERE kind=?" if kind else ""
        rows = self.db.execute(f"SELECT * FROM deals{where} ORDER BY day",
                               (kind,) if kind else ()).fetchall()
        return [dict(r) for r in rows]

    def save_listing(self, listing: dict) -> None:
        self.db.execute("INSERT OR REPLACE INTO listings VALUES (?,?,?,?,?)",
                        (listing["id"], listing["day"], listing.get("source", "sim"),
                         listing.get("status", "open"), _d(listing)))

    def listings(self, status: str | None = None) -> list[dict]:
        where = " WHERE status=?" if status else ""
        rows = self.db.execute(f"SELECT data FROM listings{where}",
                               (status,) if status else ()).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def save_valuation(self, persona_id: str, day: int, value: float, data: dict) -> None:
        self.db.execute("INSERT OR REPLACE INTO valuations VALUES (?,?,?,?)",
                        (persona_id, day, round(value, 2), _d(data)))

    def latest_valuations(self) -> dict[str, float]:
        rows = self.db.execute(
            "SELECT persona_id, value, MAX(day) d FROM valuations GROUP BY persona_id").fetchall()
        return {r["persona_id"]: float(r["value"]) for r in rows}

    def save_experiment(self, exp: dict) -> None:
        self.db.execute("INSERT OR REPLACE INTO experiments VALUES (?,?,?,?,?,?)",
                        (exp["id"], exp["day"], exp["persona_id"], exp["dimension"],
                         _d(exp), exp.get("status", "running")))

    # -- reads --------------------------------------------------------------
    def _load(self, table: str, cls, where: str = "", args: Iterable = ()) -> list:
        rows = self.db.execute(f"SELECT data FROM {table} {where}", tuple(args)).fetchall()
        return [cls(**json.loads(r["data"])) for r in rows]

    def niches(self, cls) -> list:
        return self._load("niches", cls)

    def personas(self, cls, status: Optional[str] = None) -> list:
        out = self._load("personas", cls)
        return [p for p in out if status is None or p.status == status]

    def persona(self, cls, pid: str):
        row = self.db.execute("SELECT data FROM personas WHERE id=?", (pid,)).fetchone()
        return cls(**json.loads(row["data"])) if row else None

    def content_row(self, cls, cid: str):
        row = self.db.execute("SELECT data FROM content WHERE id=?", (cid,)).fetchone()
        return cls(**json.loads(row["data"])) if row else None

    def posts_on(self, cls, day: int) -> list:
        rows = self.db.execute("SELECT data FROM posts WHERE day=?", (day,)).fetchall()
        return [cls(**json.loads(r["data"])) for r in rows]

    def live_posts(self, cls, since_day: int) -> list:
        rows = self.db.execute("SELECT data FROM posts WHERE day>=?", (since_day,)).fetchall()
        return [cls(**json.loads(r["data"])) for r in rows]

    def latest_audience(self, persona_id: str) -> dict[str, tuple[int, int]]:
        rows = self.db.execute(
            "SELECT platform, followers, subs, MAX(day) AS d FROM audience "
            "WHERE persona_id=? GROUP BY platform", (persona_id,)).fetchall()
        return {r["platform"]: (r["followers"], r["subs"]) for r in rows}

    def day_pnl(self, day: int, source: str | None = None) -> tuple[float, float]:
        extra = " AND source=?" if source else ""
        args = (day, source) if source else (day,)
        rev = self.db.execute(
            f"SELECT COALESCE(SUM(amount),0) s FROM revenue WHERE day=?{extra}", args).fetchone()["s"]
        cost = self.db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE day=? AND kind='opex'",
            (day,)).fetchone()["s"]
        return float(rev), float(cost)

    def totals(self, source: str | None = None) -> tuple[float, float]:
        where = " WHERE source=?" if source else ""
        args = (source,) if source else ()
        rev = self.db.execute(f"SELECT COALESCE(SUM(amount),0) s FROM revenue{where}",
                              args).fetchone()["s"]
        cost = self.db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM costs WHERE kind='opex'").fetchone()["s"]
        return float(rev), float(cost)

    CAPITAL_STREAMS = ("exit",)

    def revenue_split(self) -> dict[str, float]:
        """Operating revenue and capital events are different things and must
        never be added into one headline number: selling a branch is not a
        month of trading."""
        rows = self.db.execute("SELECT stream, SUM(amount) s FROM revenue GROUP BY stream")
        operating = capital = 0.0
        for r in rows:
            if r["stream"] in self.CAPITAL_STREAMS:
                capital += float(r["s"])
            else:
                operating += float(r["s"])
        return {"operating": operating, "capital": capital}

    def persona_direct_cost(self, persona_id: str) -> float:
        """What this branch alone consumed — the cost basis for a sale."""
        r = self.db.execute("SELECT COALESCE(SUM(amount),0) s FROM costs WHERE persona_id=?",
                            (persona_id,)).fetchone()["s"]
        return float(r)

    def nav(self, start_capital: float = 0.0) -> dict:
        """Net asset value: cash plus what the branches *still owned* are worth.
        A branch that was sold is already in the cash line; counting its last
        valuation as well would book the same asset twice."""
        cash = float(self.get_meta("cash", start_capital))
        owned = {r["id"] for r in self.db.execute(
            "SELECT id FROM personas WHERE json_extract(data,'$.status')='active'").fetchall()}
        holdings = sum(v for pid, v in self.latest_valuations().items() if pid in owned)
        return {"cash": cash, "holdings": holdings, "nav": cash + holdings,
                "capital_deployed": self.capital_deployed()}

    def revenue_by_source(self) -> dict[str, float]:
        return {r["source"]: float(r["s"]) for r in self.db.execute(
            "SELECT source, SUM(amount) s FROM revenue GROUP BY source").fetchall()}

    def persona_revenue(self, persona_id: str, since_day: int = 0) -> float:
        r = self.db.execute("SELECT COALESCE(SUM(amount),0) s FROM revenue WHERE persona_id=? AND day>=?",
                            (persona_id, since_day)).fetchone()["s"]
        return float(r)

    def query(self, sql: str, args: Iterable = ()) -> list[sqlite3.Row]:
        return self.db.execute(sql, tuple(args)).fetchall()

    def commit(self) -> None:
        self.db.commit()
