// כל חוקי העסק במקום אחד: יצירת אירוע, שגרירים, ייחוס מכירות ועמלות.
// השרת (server.js) רק מתרגם בקשות HTTP לקריאות כאן.
import crypto from "node:crypto";
import { tx } from "./db.js";

export class UserError extends Error {}

const MAX_TICKETS_PER_ORDER = 10;

export const token = (bytes = 18) => crypto.randomBytes(bytes).toString("base64url");

/** קוד קצר וקריא לקישור (בלי אותיות שמתבלבלות כמו 0/O, 1/l). */
export function shortCode(len = 6) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

export function slugify(text) {
  const base = String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // רק אותיות לטיניות — קישור עברי הופך לג'יבריש מקודד בוואטסאפ
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base ? `${base}-${shortCode(4)}` : shortCode(7);
}

/** "120" / "120.5" / "₪120" → 12000 / 12050 / 12000 אגורות */
export function shekelsToAgorot(input) {
  const n = Number(String(input ?? "").replace(/[₪,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new UserError("מחיר לא תקין");
  return Math.round(n * 100);
}

/** העמלה לשגריר: אחוז ממחיר ההזמנה, מעוגל כלפי מטה לאגורה. */
export function commissionFor(totalAgorot, pct) {
  return Math.floor((totalAgorot * pct) / 100);
}

export const normalizeContact = (c) => String(c ?? "").trim().toLowerCase().replace(/[\s-]/g, "");

function required(value, label, max = 120) {
  const v = String(value ?? "").trim();
  if (!v) throw new UserError(`חסר: ${label}`);
  if (v.length > max) throw new UserError(`${label} ארוך מדי`);
  return v;
}

// ---------- אירועים ----------

export function createEvent(db, input) {
  const commission = Number(input.commission_pct);
  if (!Number.isInteger(commission) || commission < 0 || commission > 50) {
    throw new UserError("אחוז העמלה צריך להיות מספר שלם בין 0 ל-50");
  }
  const capacity = Number(input.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    throw new UserError("מספר הכרטיסים צריך להיות בין 1 ל-100,000");
  }
  const startsAt = required(input.starts_at, "תאריך ושעה", 40);
  if (Number.isNaN(Date.parse(startsAt))) throw new UserError("תאריך לא תקין");

  const ev = {
    slug: slugify(input.title),
    admin_token: token(),
    artist_name: required(input.artist_name, "שם האומן/ית"),
    artist_contact: required(input.artist_contact, "טלפון או אימייל"),
    title: required(input.title, "שם האירוע"),
    description: String(input.description ?? "").trim().slice(0, 2000),
    venue: required(input.venue, "מקום"),
    starts_at: startsAt,
    price_agorot: shekelsToAgorot(input.price),
    capacity,
    commission_pct: commission,
  };
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO events (slug, admin_token, artist_name, artist_contact, title, description,
         venue, starts_at, price_agorot, capacity, commission_pct)
       VALUES (:slug, :admin_token, :artist_name, :artist_contact, :title, :description,
         :venue, :starts_at, :price_agorot, :capacity, :commission_pct)`
    )
    .run(ev);
  return { id: Number(lastInsertRowid), ...ev };
}

export const getEventBySlug = (db, slug) => db.prepare("SELECT * FROM events WHERE slug = ?").get(slug);
export const getEventByAdminToken = (db, t) => db.prepare("SELECT * FROM events WHERE admin_token = ?").get(t);
export const getEventById = (db, id) => db.prepare("SELECT * FROM events WHERE id = ?").get(id);

export function ticketsSold(db, eventId) {
  return db.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM orders WHERE event_id = ?").get(eventId).n;
}

// ---------- שגרירים ----------

/** מצטרפים כשגרירים. אותו טלפון/אימייל באותו אירוע → מקבלים חזרה את השגריר הקיים. */
export function joinAsAgent(db, event, { name, contact }) {
  const c = normalizeContact(required(contact, "טלפון או אימייל"));
  const existing = db.prepare("SELECT * FROM agents WHERE event_id = ? AND contact = ?").get(event.id, c);
  if (existing) return existing;
  const agent = { event_id: event.id, code: shortCode(), token: token(), name: required(name, "שם"), contact: c };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO agents (event_id, code, token, name, contact) VALUES (:event_id, :code, :token, :name, :contact)")
    .run(agent);
  return { id: Number(lastInsertRowid), ...agent };
}

export const getAgentByToken = (db, t) => db.prepare("SELECT * FROM agents WHERE token = ?").get(t);
export const getAgentByCode = (db, eventId, code) =>
  db.prepare("SELECT * FROM agents WHERE event_id = ? AND code = ?").get(eventId, String(code ?? ""));

/** רושם כניסה לקישור של שגריר. מבקר חוזר לא נספר פעמיים. */
export function recordClick(db, agentId, visitorId) {
  db.prepare("INSERT OR IGNORE INTO clicks (agent_id, visitor_id) VALUES (?, ?)").run(agentId, visitorId);
}

export function agentStats(db, agentId) {
  const s = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(qty), 0) AS tickets,
              COALESCE(SUM(commission_agorot), 0) AS earned,
              COALESCE(SUM(CASE WHEN commission_paid_at IS NOT NULL THEN commission_agorot END), 0) AS paid
         FROM orders WHERE agent_id = ?`
    )
    .get(agentId);
  const clicks = db.prepare("SELECT COUNT(*) AS n FROM clicks WHERE agent_id = ?").get(agentId).n;
  return { ...s, clicks, pending: s.earned - s.paid };
}

/** טבלת השגרירים של אירוע, מהמוכר הכי טוב למטה. */
export function leaderboard(db, eventId) {
  return db
    .prepare(
      `SELECT a.id, a.name, a.contact, a.code,
              (SELECT COUNT(*) FROM clicks c WHERE c.agent_id = a.id) AS clicks,
              COALESCE(SUM(o.qty), 0) AS tickets,
              COALESCE(SUM(o.total_agorot), 0) AS revenue,
              COALESCE(SUM(o.commission_agorot), 0) AS earned,
              COALESCE(SUM(CASE WHEN o.commission_paid_at IS NULL THEN o.commission_agorot END), 0) AS pending
         FROM agents a LEFT JOIN orders o ON o.agent_id = a.id
        WHERE a.event_id = ?
        GROUP BY a.id
        ORDER BY tickets DESC, clicks DESC, a.id`
    )
    .all(eventId);
}

/** האומן מסמן ששילם לשגריר את כל מה שהגיע לו עד עכשיו. */
export function markAgentPaid(db, eventId, agentId) {
  return db
    .prepare(
      `UPDATE orders SET commission_paid_at = datetime('now')
        WHERE event_id = ? AND agent_id = ? AND commission_paid_at IS NULL AND commission_agorot > 0`
    )
    .run(eventId, agentId).changes;
}

// ---------- רכישה ----------

/**
 * יוצר הזמנה + כרטיסים, ומייחס אותה לשגריר אם המבקר הגיע דרך קישור.
 * הכל בטרנזקציה אחת כדי שלא יימכרו יותר כרטיסים מהקיבולת.
 * הערה: התשלום עצמו כאן מדומה — ראו README לחיבור סליקה.
 */
export function purchase(db, event, { name, contact, qty, refCode }) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TICKETS_PER_ORDER) {
    throw new UserError(`אפשר לקנות בין 1 ל-${MAX_TICKETS_PER_ORDER} כרטיסים בהזמנה`);
  }
  const buyerName = required(name, "שם");
  const buyerContact = normalizeContact(required(contact, "טלפון או אימייל"));

  return tx(db, () => {
    const left = event.capacity - ticketsSold(db, event.id);
    if (n > left) throw new UserError(left > 0 ? `נשארו רק ${left} כרטיסים` : "הכרטיסים אזלו");

    let agent = refCode ? getAgentByCode(db, event.id, refCode) : null;
    // שגריר לא מרוויח עמלה על הכרטיסים של עצמו
    if (agent && agent.contact === buyerContact) agent = null;

    const total = event.price_agorot * n;
    const order = {
      event_id: event.id,
      agent_id: agent?.id ?? null,
      token: token(),
      buyer_name: buyerName,
      buyer_contact: buyerContact,
      qty: n,
      total_agorot: total,
      commission_agorot: agent ? commissionFor(total, event.commission_pct) : 0,
    };
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO orders (event_id, agent_id, token, buyer_name, buyer_contact, qty, total_agorot, commission_agorot)
         VALUES (:event_id, :agent_id, :token, :buyer_name, :buyer_contact, :qty, :total_agorot, :commission_agorot)`
      )
      .run(order);
    const orderId = Number(lastInsertRowid);
    const insertTicket = db.prepare("INSERT INTO tickets (order_id, code) VALUES (?, ?)");
    for (let i = 0; i < n; i++) insertTicket.run(orderId, shortCode(8).toUpperCase());
    return { id: orderId, ...order };
  });
}

export const getOrderByToken = (db, t) => db.prepare("SELECT * FROM orders WHERE token = ?").get(t);
export const ticketsForOrder = (db, orderId) =>
  db.prepare("SELECT * FROM tickets WHERE order_id = ? ORDER BY id").all(orderId);

export function recentOrders(db, eventId, limit = 50) {
  return db
    .prepare(
      `SELECT o.*, a.name AS agent_name FROM orders o LEFT JOIN agents a ON a.id = o.agent_id
        WHERE o.event_id = ? ORDER BY o.id DESC LIMIT ?`
    )
    .all(eventId, limit);
}

export function eventSummary(db, eventId) {
  const s = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS tickets,
              COALESCE(SUM(total_agorot), 0) AS revenue,
              COALESCE(SUM(commission_agorot), 0) AS commissions,
              COALESCE(SUM(CASE WHEN agent_id IS NOT NULL THEN qty END), 0) AS via_agents,
              COALESCE(SUM(CASE WHEN commission_paid_at IS NULL THEN commission_agorot END), 0) AS owed
         FROM orders WHERE event_id = ?`
    )
    .get(eventId);
  const agents = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE event_id = ?").get(eventId).n;
  const checkedIn = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id
        WHERE o.event_id = ? AND t.checked_in_at IS NOT NULL`
    )
    .get(eventId).n;
  return { ...s, agents, checkedIn, net: s.revenue - s.commissions };
}

// ---------- כניסה לאירוע ----------

/** בדיקת כרטיס בכניסה. כרטיס עובד פעם אחת בלבד. */
export function checkIn(db, eventId, code) {
  const c = String(code ?? "").trim().toUpperCase();
  const t = db
    .prepare(
      `SELECT t.*, o.buyer_name FROM tickets t JOIN orders o ON o.id = t.order_id
        WHERE t.code = ? AND o.event_id = ?`
    )
    .get(c, eventId);
  if (!t) return { ok: false, message: `הכרטיס ${c} לא נמצא באירוע הזה` };
  if (t.checked_in_at) return { ok: false, message: `הכרטיס ${c} כבר נסרק (${t.checked_in_at})` };
  db.prepare("UPDATE tickets SET checked_in_at = datetime('now') WHERE id = ?").run(t.id);
  return { ok: true, message: `ברוכים הבאים, ${t.buyer_name}! כרטיס ${c} תקין` };
}
