import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// כל הסכומים באגורות (INTEGER). כל הזמנים ב-ISO UTC (TEXT).
const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------- זהות וגישה ----------
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  email_hash          TEXT NOT NULL UNIQUE,
  name                TEXT,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  frozen_at           TEXT,
  notify_sales        INTEGER NOT NULL DEFAULT 1,
  payout_details_enc  TEXT,
  adult_confirmed_at  TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_codes_email ON login_codes(email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ---------- אמנים והופעות ----------
CREATE TABLE IF NOT EXISTS artists (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_members (
  artist_id  INTEGER NOT NULL REFERENCES artists(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (artist_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,
  artist_id    INTEGER NOT NULL REFERENCES artists(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  venue        TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT '',
  genre        TEXT NOT NULL DEFAULT '',
  starts_at    TEXT NOT NULL,
  image_url    TEXT NOT NULL DEFAULT '',
  source_url   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- ---------- קמפיינים ----------
CREATE TABLE IF NOT EXISTS campaigns (
  id                 INTEGER PRIMARY KEY,
  event_id           INTEGER NOT NULL REFERENCES events(id),
  artist_id          INTEGER NOT NULL REFERENCES artists(id),
  created_by         INTEGER NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL CHECK (status IN ('draft','active','paused','sold_out','ended','cancelled')),
  price_agorot       INTEGER NOT NULL CHECK (price_agorot > 0),
  promo_limit        INTEGER CHECK (promo_limit IS NULL OR promo_limit > 0),
  provider           TEXT NOT NULL,
  external_event_id  TEXT NOT NULL,
  share_text         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (provider, external_event_id)
);

-- תנאי הקמפיין נשמרים בגרסאות: כל עסקה מחושבת לפי הגרסה שהייתה בתוקף ברגע העסקה
CREATE TABLE IF NOT EXISTS campaign_terms (
  id             INTEGER PRIMARY KEY,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(id),
  version        INTEGER NOT NULL,
  reward_agorot  INTEGER NOT NULL CHECK (reward_agorot > 0),
  fee_bps        INTEGER NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  UNIQUE (campaign_id, version)
);

-- ---------- שיוך ----------
CREATE TABLE IF NOT EXISTS referral_links (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id),
  promoter_id  INTEGER NOT NULL REFERENCES users(id),
  code         TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  UNIQUE (campaign_id, promoter_id)
);

-- לחיצה: בלי IP, רק מזהה מבקר מגובב ודומיין המפנה
CREATE TABLE IF NOT EXISTS referral_clicks (
  id              INTEGER PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  link_id         INTEGER NOT NULL REFERENCES referral_links(id),
  visitor_hash    TEXT NOT NULL,
  referrer_host   TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clicks_link ON referral_clicks(link_id);

-- ---------- הזמנות (מאושרות ע"י מערכת הכרטוס בלבד) ----------
CREATE TABLE IF NOT EXISTS orders (
  id                 INTEGER PRIMARY KEY,
  provider           TEXT NOT NULL,
  external_order_id  TEXT NOT NULL,
  campaign_id        INTEGER NOT NULL REFERENCES campaigns(id),
  qty                INTEGER NOT NULL CHECK (qty > 0),
  refunded_qty       INTEGER NOT NULL DEFAULT 0,
  unit_price_agorot  INTEGER NOT NULL,
  total_agorot       INTEGER NOT NULL,
  buyer_email_hash   TEXT NOT NULL,
  first_for_artist   INTEGER NOT NULL DEFAULT 0,
  click_id           INTEGER REFERENCES referral_clicks(id),
  link_id            INTEGER REFERENCES referral_links(id),
  terms_id           INTEGER REFERENCES campaign_terms(id),
  rewarded_qty       INTEGER NOT NULL DEFAULT 0,
  fee_agorot         INTEGER NOT NULL DEFAULT 0,
  attribution        TEXT NOT NULL,
  cancelled          INTEGER NOT NULL DEFAULT 0,
  ordered_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  UNIQUE (provider, external_order_id)
);
CREATE INDEX IF NOT EXISTS orders_campaign ON orders(campaign_id);

-- ---------- תגמולים ויומן כספי ----------
-- kind: sale (אחד להזמנה) | clawback (קיזוז אחרי תשלום) | adjustment (התאמה ידנית מתועדת) | service (עבודת תוכן שהושלמה)
CREATE TABLE IF NOT EXISTS commissions (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('sale','clawback','adjustment','service')),
  order_id       INTEGER REFERENCES orders(id),
  service_order_id INTEGER REFERENCES service_orders(id),
  campaign_id    INTEGER REFERENCES campaigns(id),
  promoter_id    INTEGER NOT NULL REFERENCES users(id),
  amount_agorot  INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','payable','paid','reversed','disputed')),
  payout_id      INTEGER REFERENCES payouts(id),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  payable_at     TEXT,
  paid_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_sale_commission_per_order ON commissions(order_id) WHERE kind = 'sale';
CREATE UNIQUE INDEX IF NOT EXISTS one_earning_per_service_order ON commissions(service_order_id) WHERE kind = 'service';
CREATE INDEX IF NOT EXISTS commissions_promoter ON commissions(promoter_id, status);

-- יומן בלתי ניתן לשינוי: כל שינוי בסכום תגמול נרשם כאן. sum(ledger) לכל תגמול == amount_agorot שלו.
CREATE TABLE IF NOT EXISTS ledger (
  id             INTEGER PRIMARY KEY,
  commission_id  INTEGER NOT NULL REFERENCES commissions(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL CHECK (type IN ('accrue','reverse','clawback','adjust')),
  amount_agorot  INTEGER NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  actor_id       INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TABLE IF NOT EXISTS payouts (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  amount_agorot  INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('requested','paid','failed')),
  reference      TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  decided_at     TEXT,
  decided_by     INTEGER REFERENCES users(id)
);

-- ---------- אינטגרציה ----------
CREATE TABLE IF NOT EXISTS webhook_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  result       TEXT NOT NULL DEFAULT '',
  received_at  TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

-- ---------- שונות ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS disputes (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  campaign_id  INTEGER REFERENCES campaigns(id),
  service_order_id INTEGER REFERENCES service_orders(id),
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolution   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  INTEGER REFERENCES users(id)
);

-- הסכמה מפורשת של רוכש לקבל עדכונים מהאמן
CREATE TABLE IF NOT EXISTS follows (
  id          INTEGER PRIMARY KEY,
  artist_id   INTEGER NOT NULL REFERENCES artists(id),
  email       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  UNIQUE (artist_id, email)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- ---------- מודול תוכן: יוצרים, שירותים והזמנות ----------
CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id),
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '',
  kinds         TEXT NOT NULL DEFAULT '',
  image_url     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_portfolio (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  url         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- ערוצים אישיים. מספר העוקבים מדווח ע"י היוצר ומוצג כ"לא מאומת"
CREATE TABLE IF NOT EXISTS social_channels (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  platform    TEXT NOT NULL,
  url         TEXT NOT NULL,
  followers   INTEGER,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_services (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  template              TEXT NOT NULL,
  title                 TEXT NOT NULL,
  deliverable           TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  price_agorot          INTEGER NOT NULL CHECK (price_agorot >= 1000),
  delivery_days         INTEGER NOT NULL CHECK (delivery_days BETWEEN 1 AND 60),
  revisions             INTEGER NOT NULL CHECK (revisions BETWEEN 0 AND 3),
  license               TEXT NOT NULL,
  includes_publication  INTEGER NOT NULL DEFAULT 0,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- הזמנה: התנאים נשמרים כתמונת מצב (terms_json) — שינוי מחיר בשירות לא משנה הזמנה קיימת
CREATE TABLE IF NOT EXISTS service_orders (
  id                     INTEGER PRIMARY KEY,
  service_id             INTEGER NOT NULL REFERENCES creator_services(id),
  creator_id             INTEGER NOT NULL REFERENCES users(id),
  artist_id              INTEGER NOT NULL REFERENCES artists(id),
  artist_user_id         INTEGER NOT NULL REFERENCES users(id),
  campaign_id            INTEGER REFERENCES campaigns(id),
  link_id                INTEGER REFERENCES referral_links(id),
  status                 TEXT NOT NULL CHECK (status IN ('requested','accepted','submitted','revision_requested','approved','published','completed','cancelled','disputed')),
  title                  TEXT NOT NULL,
  terms_json             TEXT NOT NULL,
  price_agorot           INTEGER NOT NULL,
  fee_agorot             INTEGER NOT NULL,
  creator_amount_agorot  INTEGER NOT NULL,
  includes_publication   INTEGER NOT NULL,
  brief                  TEXT NOT NULL,
  revisions_left         INTEGER NOT NULL,
  due_at                 TEXT NOT NULL,
  disputed_from          TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  accepted_at            TEXT,
  submitted_at           TEXT,
  approved_at            TEXT,
  published_at           TEXT,
  completed_at           TEXT,
  cancelled_at           TEXT
);
CREATE INDEX IF NOT EXISTS service_orders_creator ON service_orders(creator_id, status);
CREATE INDEX IF NOT EXISTS service_orders_artist ON service_orders(artist_user_id, status);

CREATE TABLE IF NOT EXISTS deliverables (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES service_orders(id),
  version     INTEGER NOT NULL,
  url         TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  UNIQUE (order_id, version)
);

CREATE TABLE IF NOT EXISTS revision_requests (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES service_orders(id),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL UNIQUE REFERENCES service_orders(id),
  url          TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  verified_at  TEXT,
  verified_by  INTEGER REFERENCES users(id),
  method       TEXT
);

-- הכסף של האמן מוחזק אצל ספק התשלומים (הרשאה), לא אצל הפלטפורמה
CREATE TABLE IF NOT EXISTS service_payments (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL UNIQUE REFERENCES service_orders(id),
  provider         TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  amount_agorot    INTEGER NOT NULL,
  captured_agorot  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('authorized','captured','voided')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- ---------- ייבוא מכירות (מסלול הקופונים): הצוות מעלה את ייצוא המכירות של מערכת הכרטוס ----------
CREATE TABLE IF NOT EXISTS sales_imports (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id),
  filename     TEXT NOT NULL DEFAULT '',
  raw_csv      TEXT NOT NULL,
  mapping      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied','discarded')),
  summary      TEXT NOT NULL DEFAULT '{}',
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  applied_at   TEXT
);

-- ---------- ספק כרטוס מדומה (Sandbox) — מחליף מערכת כרטוס אמיתית בפיתוח ובדמו ----------
CREATE TABLE IF NOT EXISTS sim_events (
  external_id   TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  price_agorot  INTEGER NOT NULL,
  capacity      INTEGER NOT NULL DEFAULT 500,
  cancelled     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sim_orders (
  id            TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL REFERENCES sim_events(external_id),
  ref           TEXT NOT NULL DEFAULT '',
  buyer_name    TEXT NOT NULL,
  buyer_email   TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  refunded_qty  INTEGER NOT NULL DEFAULT 0,
  unit_price_agorot INTEGER NOT NULL,
  codes         TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ---------- כרטוס של JoCares: הקופה שלנו ----------
CREATE TABLE IF NOT EXISTS ticket_orders (
  id                INTEGER PRIMARY KEY,
  campaign_id       INTEGER NOT NULL REFERENCES campaigns(id),
  token             TEXT NOT NULL UNIQUE,           -- הקישור הפרטי של הקונה לכרטיסים
  buyer_name        TEXT NOT NULL,
  buyer_email       TEXT NOT NULL,
  buyer_phone       TEXT NOT NULL DEFAULT '',
  qty               INTEGER NOT NULL CHECK (qty > 0),
  refunded_qty      INTEGER NOT NULL DEFAULT 0,
  unit_price_agorot INTEGER NOT NULL,
  fee_agorot        INTEGER NOT NULL DEFAULT 0,      -- דמי שירות לכרטיס
  total_agorot      INTEGER NOT NULL,
  status            TEXT NOT NULL,                   -- pending | paid | expired | failed | rejected
  click_token       TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  gateway           TEXT NOT NULL,
  payment_ref       TEXT,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  paid_at           TEXT
);
CREATE INDEX IF NOT EXISTS ticket_orders_campaign ON ticket_orders(campaign_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_orders_payment ON ticket_orders(gateway, payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES ticket_orders(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  code        TEXT NOT NULL UNIQUE,
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'valid',        -- valid | used | refunded
  used_at     TEXT
);

-- החזרים: נרשמים מיד (הכרטיס נפסל, התגמול מתעדכן), והכסף עצמו מוחזר דרך ספק התשלום ברקע
CREATE TABLE IF NOT EXISTS ticket_refunds (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES ticket_orders(id),
  qty           INTEGER NOT NULL,
  amount_agorot INTEGER NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',    -- pending | done | failed
  error         TEXT,
  actor_id      INTEGER,
  created_at    TEXT NOT NULL,
  done_at       TEXT
);

-- ערכת שיתוף: תמונות שהאמן מעלה לג׳וקרים
CREATE TABLE IF NOT EXISTS campaign_assets (
  id          INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  image_url   TEXT NOT NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- ג׳וקר מציע לאמן שירות בתשלום (למשל סרטון המלצה). האמן מחליט אם להזמין.
CREATE TABLE IF NOT EXISTS service_offers (
  id          INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  service_id  INTEGER NOT NULL REFERENCES creator_services(id),
  creator_id  INTEGER NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',          -- open | ordered | dismissed
  order_id    INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS service_offers_open ON service_offers(campaign_id, creator_id) WHERE status = 'open';

-- "תזכירו לי": תזכורת אחת במייל, רק למי שביקש במפורש
CREATE TABLE IF NOT EXISTS show_reminders (
  id          INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  ref_code    TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  cancelled_at TEXT,
  UNIQUE (campaign_id, email)
);

-- ספק תשלום מדומה (Sandbox): עמוד תשלום מתארח, כמו אצל ספקי סליקה אמיתיים
CREATE TABLE IF NOT EXISTS pay_sandbox (
  ref           TEXT PRIMARY KEY,
  amount_agorot INTEGER NOT NULL,
  refunded_agorot INTEGER NOT NULL DEFAULT 0,
  description   TEXT NOT NULL,
  return_url    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | failed
  card_last4    TEXT,
  created_at    TEXT NOT NULL,
  paid_at       TEXT
);
`;

export function openDb(file = process.env.ENCORE_DB ?? "data/encore.db") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * הגירות קטנות למסדים קיימים (CREATE TABLE IF NOT EXISTS לא מוסיף עמודות לטבלה שכבר קיימת).
 * כל צעד בודק אם כבר בוצע, כך שאפשר להריץ שוב ושוב.
 */
function migrate(db) {
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const add = (t, col, def) => {
    if (!cols(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`);
  };
  // קופונים: קוד אישי לכל לינק, ומתי הצוות הגדיר אותו במערכת הכרטוס של האמן
  add("referral_links", "coupon_code", "TEXT");
  add("referral_links", "coupon_registered_at", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS referral_links_coupon ON referral_links(coupon_code) WHERE coupon_code IS NOT NULL");
  // כרטוס של JoCares: קיבולת המקום וקישור סודי לסריקה בכניסה
  add("events", "capacity", "INTEGER");
  add("campaigns", "door_token", "TEXT");
  // הזמנה אישית: משפט שהג׳וקר כותב לחברים
  add("referral_links", "note", "TEXT");
  // מחיר מוקדם: עד תאריך ו/או עד מספר כרטיסים
  add("campaigns", "early_price_agorot", "INTEGER");
  add("campaigns", "early_until", "TEXT");
  add("campaigns", "early_qty", "INTEGER");
  // "בואו איתי": קונה מזמין חברים (בלי תגמול), וסופרים כמה באו בעקבותיו
  add("ticket_orders", "invite_code", "TEXT");
  add("ticket_orders", "invited_by", "INTEGER");
  // ערכת שיתוף: גם סרטונים, וגם תוכן מאושר של יוצרים (עם קרדיט)
  add("campaign_assets", "kind", "TEXT NOT NULL DEFAULT 'image'");
  add("campaign_assets", "credit", "TEXT");
  add("campaign_assets", "service_order_id", "INTEGER");
  // הנחה מהג׳וקר: חלק מהתגמול שלו עובר לחבר כהנחה (לכל כרטיס)
  add("referral_links", "discount_agorot", "INTEGER NOT NULL DEFAULT 0");
  add("ticket_orders", "discount_agorot", "INTEGER NOT NULL DEFAULT 0");
  add("orders", "joker_discount_agorot", "INTEGER NOT NULL DEFAULT 0");
  // העברת כרטיס בודד לחבר
  add("tickets", "share_token", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS tickets_share ON tickets(share_token) WHERE share_token IS NOT NULL");
  // פרטי האמן לקבלת הכסף ממכירות (מוצפן)
  add("artists", "payout_details_enc", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ticket_orders_invite ON ticket_orders(invite_code) WHERE invite_code IS NOT NULL");
  const missing = db.prepare("SELECT id FROM referral_links WHERE coupon_code IS NULL").all();
  for (const { id } of missing) db.prepare("UPDATE referral_links SET coupon_code = ? WHERE id = ?").run(newCouponCode(db), id);
}

const COUPON_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** JO + 6 תווים בלי אותיות מבלבלות (0/O, 1/I). ייחודי בכל המערכת. */
export function newCouponCode(db) {
  for (;;) {
    const code = "JO" + Array.from(crypto.randomBytes(6), (b) => COUPON_ABC[b % COUPON_ABC.length]).join("");
    if (!db.prepare("SELECT 1 FROM referral_links WHERE coupon_code = ?").get(code)) return code;
  }
}

/** טרנזקציה: הכל או כלום. תומך בקינון (פנימי פשוט רץ בתוך החיצוני). */
export function tx(db, fn) {
  if (db.__inTx) return fn();
  db.exec("BEGIN IMMEDIATE");
  db.__inTx = true;
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.__inTx = false;
  }
}

export const insert = (db, table, row) => {
  row = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === undefined ? null : v]));
  const keys = Object.keys(row);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => ":" + k).join(",")})`)
    .run(row);
  return Number(lastInsertRowid);
};
