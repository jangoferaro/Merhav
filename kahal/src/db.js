import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  admin_token     TEXT NOT NULL UNIQUE,
  artist_name     TEXT NOT NULL,
  artist_contact  TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  venue           TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  price_agorot    INTEGER NOT NULL CHECK (price_agorot >= 0),
  capacity        INTEGER NOT NULL CHECK (capacity > 0),
  commission_pct  INTEGER NOT NULL CHECK (commission_pct BETWEEN 0 AND 50),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- שגריר = מישהו מהקהל שקיבל קישור אישי ומרוויח אחוזים מכל מי שקנה דרכו
CREATE TABLE IF NOT EXISTS agents (
  id          INTEGER PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES events(id),
  code        TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, contact)
);

-- כניסות ייחודיות לקישור של שגריר (מבקר אחד נספר פעם אחת)
CREATE TABLE IF NOT EXISTS clicks (
  agent_id    INTEGER NOT NULL REFERENCES agents(id),
  visitor_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                 INTEGER PRIMARY KEY,
  event_id           INTEGER NOT NULL REFERENCES events(id),
  agent_id           INTEGER REFERENCES agents(id),
  token              TEXT NOT NULL UNIQUE,
  buyer_name         TEXT NOT NULL,
  buyer_contact      TEXT NOT NULL,
  qty                INTEGER NOT NULL CHECK (qty > 0),
  total_agorot       INTEGER NOT NULL,
  commission_agorot  INTEGER NOT NULL DEFAULT 0,
  commission_paid_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  code           TEXT NOT NULL UNIQUE,
  checked_in_at  TEXT
);
`;

export function openDb(file = process.env.KAHAL_DB ?? "data/kahal.db") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/** מריץ פונקציה בתוך טרנזקציה אחת — הכל או כלום. */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
