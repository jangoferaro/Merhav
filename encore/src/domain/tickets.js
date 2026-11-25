// הקופה של JoCares: מכירת כרטיסים, תשלום, כרטיס עם QR, החזרים וכניסה בדלת.
// כל מכירה ששולמה נכנסת למנוע השיוך והתגמולים (ingest.js) בדיוק כמו מכירה מספק חיצוני,
// כך שהג׳וקרים מקבלים תגמול בלי שאף אחד יעשה שום דבר ידני.
import crypto from "node:crypto";
import qrcode from "qrcode-generator";
import { insert, tx } from "../db.js";
import { clock, config, emailHash, isEmail, normalizeEmail, randomToken, text, UserError } from "../util.js";
import { gateway } from "../payments/index.js";
import { _setCancelHandler, getCampaign, parseEarly } from "./campaigns.js";
import { decideAttribution, ingestEvent } from "./ingest.js";
import { audit, notify } from "./identity.js";

const SALE_STATUSES = ["active", "paused", "sold_out"];
const minutes = (n) => new Date(clock.now().getTime() + n * 60000).toISOString();

/** המכירה פתוחה עד תחילת ההופעה, גם כשהקידום מושהה (השהיה עוצרת תגמולים, לא מכירות) */
export const salesOpen = (c) => c.provider === "jocares" && SALE_STATUSES.includes(c.status) && c.starts_at > clock.iso();

export function inventory(db, c) {
  const now = clock.iso();
  const sold = db.prepare("SELECT COALESCE(SUM(qty - refunded_qty), 0) n FROM ticket_orders WHERE campaign_id = ? AND status = 'paid'").get(c.id).n;
  const held = db.prepare("SELECT COALESCE(SUM(qty), 0) n FROM ticket_orders WHERE campaign_id = ? AND status = 'pending' AND expires_at > ?").get(c.id, now).n;
  const capacity = c.capacity ?? 0;
  return { capacity, sold, held, available: Math.max(0, capacity - sold - held) };
}

// ---------- מחיר מוקדם ----------

/** כמה כרטיסים כבר נמכרו (או שמורים) במחיר המוקדם */
function earlySold(db, c) {
  return db
    .prepare("SELECT COALESCE(SUM(qty), 0) n FROM ticket_orders WHERE campaign_id = ? AND unit_price_agorot = ? AND (status = 'paid' OR (status = 'pending' AND expires_at > ?))")
    .get(c.id, c.early_price_agorot, clock.iso()).n;
}

/** המחיר עכשיו: מוקדם אם הוא עוד בתוקף (לפי תאריך ולפי כמות), אחרת רגיל */
export function priceNow(db, c) {
  const base = { price: c.price_agorot, early: false, left: null, until: null };
  if (!c.early_price_agorot) return base;
  if (c.early_until && c.early_until <= clock.iso()) return base;
  const left = c.early_qty ? c.early_qty - earlySold(db, c) : null;
  if (left !== null && left <= 0) return base;
  return { price: c.early_price_agorot, early: true, left, until: c.early_until };
}

export function setEarlyPrice(db, actor, c, input) {
  const e = parseEarly(input, c.price_agorot, c.reward_agorot);
  db.prepare("UPDATE campaigns SET early_price_agorot = ?, early_until = ?, early_qty = ?, updated_at = ? WHERE id = ?").run(e.early_price_agorot, e.early_until, e.early_qty, clock.iso(), c.id);
  audit(db, actor.id, "tickets.early_price", "campaign", c.id, e);
  return e;
}

// ---------- הנחה מהג׳וקר ----------

/**
 * הנחה לכרטיס שהג׳וקר בחר לתת מתוך התגמול שלו. ניתנת רק כשברור שהמכירה תזכה אותו
 * (אותם כללי שיוך בדיוק), כדי שהאמן לא יממן הנחה שאף אחד לא "שילם" עליה.
 */
export function jokerDiscount(db, c, { clickToken, email, qty }) {
  if (!clickToken) return 0;
  const link = db.prepare("SELECT l.* FROM referral_clicks k JOIN referral_links l ON l.id = k.link_id WHERE k.token = ?").get(clickToken);
  if (!link?.discount_agorot) return 0;
  const att = decideAttribution(db, c, { ref: clickToken, buyerHash: emailHash(email), qty, orderedAt: clock.iso() });
  if (att.reason !== "ok" || att.rewardedQty < qty) return 0;
  return Math.min(link.discount_agorot, c.reward_agorot - 100);
}

/** ההנחה שמבקר יקבל, לתצוגה לפני שהשאיר מייל */
export function discountPreview(db, c, clickToken) {
  if (!clickToken || c.status !== "active") return 0;
  const link = db.prepare("SELECT l.* FROM referral_clicks k JOIN referral_links l ON l.id = k.link_id WHERE k.token = ?").get(clickToken);
  return link?.campaign_id === c.id ? Math.min(link.discount_agorot || 0, Math.max(0, c.reward_agorot - 100)) : 0;
}

// ---------- "בואו איתי" ----------

/** קוד הזמנה של קונה: קישור אישי לשלוח לחברים. נוצר בפעם הראשונה שצריך אותו. */
export function inviteCode(db, order) {
  if (order.invite_code) return order.invite_code;
  for (let i = 0; i < 5; i++) {
    const code = randomToken(6);
    try {
      db.prepare("UPDATE ticket_orders SET invite_code = ? WHERE id = ? AND invite_code IS NULL").run(code, order.id);
      return ticketOrder(db, order.id).invite_code;
    } catch {}
  }
  throw new Error("could not allocate invite code");
}

export const orderByInvite = (db, code) =>
  db.prepare("SELECT * FROM ticket_orders WHERE invite_code = ? AND status = 'paid'").get(String(code ?? "").slice(0, 20));

/** כמה חברים קנו בעקבות הקונה הזה */
export const invitedCount = (db, orderId) =>
  db.prepare("SELECT COALESCE(SUM(qty - refunded_qty), 0) n FROM ticket_orders WHERE invited_by = ? AND status = 'paid'").get(orderId).n;

export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || "חבר/ה";

export const orderByToken = (db, token) => db.prepare("SELECT * FROM ticket_orders WHERE token = ?").get(String(token ?? ""));
export const ticketOrder = (db, id) => db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(Number(id));
export const ticketsOf = (db, orderId) => db.prepare("SELECT * FROM tickets WHERE order_id = ? ORDER BY seq").all(orderId);

// ---------- קנייה ----------

/**
 * הזמנה ממתינה: הכרטיסים שמורים לקונה לרבע שעה בזמן שהוא משלם.
 * הבדיקה וההזמנה באותה טרנזקציה, כך ששני קונים לא יכולים לקחת את אותו כרטיס אחרון.
 */
export function createOrder(db, campaignId, input, { clickToken = null, invitedBy = null } = {}) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (!c || !salesOpen(c)) throw new UserError("המכירה להופעה הזו סגורה");
    const qty = Number(input.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > config.maxTicketsPerOrder) throw new UserError(`אפשר לקנות 1 עד ${config.maxTicketsPerOrder} כרטיסים`);
    const { available } = inventory(db, c);
    if (available < qty) throw new UserError(available ? `נשארו רק ${available} כרטיסים` : "הכרטיסים אזלו");
    const email = normalizeEmail(input.email);
    if (!isEmail(email)) throw new UserError("המייל לא תקין. לשם נשלחים הכרטיסים.");
    const phone = String(input.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
    const fee = config.ticketFeeAgorot;
    const { price } = priceNow(db, c);
    const inviter = invitedBy ? orderByInvite(db, invitedBy) : null;
    const discount = jokerDiscount(db, c, { clickToken, email, qty });
    const id = insert(db, "ticket_orders", {
      campaign_id: c.id, token: randomToken(18), buyer_name: text(input.name, "שם", { max: 80 }), buyer_email: email,
      buyer_phone: phone, qty, unit_price_agorot: price, fee_agorot: fee, total_agorot: qty * (price - discount + fee), discount_agorot: discount,
      invited_by: inviter && inviter.campaign_id === c.id ? inviter.id : null,
      status: "pending", click_token: clickToken, marketing_consent: input.consent === "on" ? 1 : 0,
      gateway: gateway().name, created_at: clock.iso(), expires_at: minutes(config.holdMinutes),
    });
    return ticketOrder(db, id);
  });
}

/** פותח עסקה אצל ספק התשלום ומחזיר לאן לשלוח את הקונה */
export function startPayment(db, order, { origin }) {
  const c = getCampaign(db, order.campaign_id);
  const g = gateway(order.gateway);
  const { ref, redirectUrl } = g.createPayment(db, {
    amount: order.total_agorot,
    description: `${order.qty} כרטיסים · ${c.artist_name} · ${c.title}`,
    returnUrl: `${origin}/checkout/return/${order.token}`,
    buyer: { name: order.buyer_name, email: order.buyer_email, phone: order.buyer_phone },
  });
  db.prepare("UPDATE ticket_orders SET payment_ref = ? WHERE id = ?").run(ref, order.id);
  return redirectUrl;
}

const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newTicketCode(db) {
  for (;;) {
    const code = Array.from(crypto.randomBytes(10), (b) => CODE_ABC[b % CODE_ABC.length]).join("");
    if (!db.prepare("SELECT 1 FROM tickets WHERE code = ?").get(code)) return code;
  }
}

/**
 * הספק אישר את התשלום (חזרה של הקונה או התראת שרת). אידמפוטנטי: קריאה שנייה לא משנה כלום.
 * אם התשלום הגיע אחרי שהשמירה פגה והכרטיסים כבר נמכרו לאחר, ההזמנה נדחית והכסף מוחזר.
 * מחזיר את ההזמנה המעודכנת.
 */
export function confirmPayment(db, gatewayName, ref) {
  const out = tx(db, () => {
    const order = db.prepare("SELECT * FROM ticket_orders WHERE gateway = ? AND payment_ref = ?").get(gatewayName, ref);
    if (!order) throw new UserError("העסקה לא נמצאה", 404);
    if (order.status === "paid" || order.status === "rejected") return { order };
    const c = getCampaign(db, order.campaign_id);
    const now = clock.iso();
    const stillHeld = order.status === "pending" && order.expires_at > now;
    if (!stillHeld) {
      const { available } = inventory(db, c);
      if (available < order.qty || !salesOpen(c)) {
        db.prepare("UPDATE ticket_orders SET status = 'rejected', paid_at = ? WHERE id = ?").run(now, order.id);
        insert(db, "ticket_refunds", { order_id: order.id, qty: order.qty, amount_agorot: order.total_agorot, reason: "התשלום הגיע אחרי שהכרטיסים אזלו", created_at: now });
        return { order: ticketOrder(db, order.id), refundQueued: true };
      }
    }
    db.prepare("UPDATE ticket_orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now, order.id);
    for (let i = 1; i <= order.qty; i++) {
      insert(db, "tickets", { order_id: order.id, campaign_id: c.id, code: newTicketCode(db), seq: i });
    }
    // המכירה נכנסת למנוע השיוך והתגמולים, כמו כל ספק אחר
    ingestEvent(db, "jocares", {
      id: `paid:${order.id}`, type: "order.paid",
      data: {
        order_id: String(order.id), event_id: c.external_event_id, qty: order.qty, unit_price_agorot: order.unit_price_agorot,
        buyer_email: order.buyer_email, ref: order.click_token, ordered_at: now, joker_discount_agorot: order.discount_agorot,
      },
    });
    if (order.marketing_consent) {
      db.prepare("INSERT OR IGNORE INTO follows (artist_id, email, source, created_at) VALUES (?, ?, ?, ?)").run(c.artist_id, order.buyer_email, `tickets:${c.id}`, now);
    }
    return { order: ticketOrder(db, order.id), fresh: true };
  });
  return out;
}

export function failPayment(db, gatewayName, ref) {
  db.prepare("UPDATE ticket_orders SET status = 'failed' WHERE gateway = ? AND payment_ref = ? AND status = 'pending'").run(gatewayName, ref);
}

/** הקונה חזר מעמוד התשלום: בודקים מול הספק מה קרה */
export function returnFromPayment(db, order) {
  if (order.status !== "pending" && order.status !== "expired") return order;
  const g = gateway(order.gateway);
  const status = g.paymentStatus(db, order.payment_ref);
  if (status === "paid") return confirmPayment(db, g.name, order.payment_ref).order;
  if (status === "failed") failPayment(db, g.name, order.payment_ref);
  return ticketOrder(db, order.id);
}

// ---------- החזרים ----------

/**
 * החזר של חלק מהכרטיסים או כולם. מיד: הכרטיסים נפסלים והתגמול של הג׳וקר מתעדכן.
 * הכסף עצמו מוחזר דרך ספק התשלום ב-processRefunds (אפשר לנסות שוב אם נכשל).
 */
export function refundTickets(db, actor, orderId, qtyInput, reason = "") {
  return tx(db, () => {
    const order = ticketOrder(db, orderId);
    if (!order || order.status !== "paid") throw new UserError("ההזמנה לא נמצאה");
    const left = order.qty - order.refunded_qty;
    const qty = qtyInput === "all" ? left : Number(qtyInput);
    if (!Number.isInteger(qty) || qty < 1 || qty > left) throw new UserError(left ? `אפשר להחזיר 1 עד ${left} כרטיסים` : "כל הכרטיסים בהזמנה כבר הוחזרו");
    const refunded = order.refunded_qty + qty;
    db.prepare("UPDATE ticket_orders SET refunded_qty = ? WHERE id = ?").run(refunded, order.id);
    // קודם כרטיסים שעוד לא נסרקו בכניסה
    const ids = db.prepare("SELECT id FROM tickets WHERE order_id = ? AND status != 'refunded' ORDER BY status = 'used', seq DESC LIMIT ?").all(order.id, qty);
    for (const { id } of ids) db.prepare("UPDATE tickets SET status = 'refunded' WHERE id = ?").run(id);
    insert(db, "ticket_refunds", {
      order_id: order.id, qty, amount_agorot: qty * (order.unit_price_agorot - order.discount_agorot + order.fee_agorot),
      reason: String(reason).slice(0, 200), actor_id: actor?.id ?? null, created_at: clock.iso(),
    });
    ingestEvent(db, "jocares", { id: `refund:${order.id}:${refunded}`, type: "order.refunded", data: { order_id: String(order.id), refunded_qty: refunded } });
    audit(db, actor?.id, "tickets.refund", "ticket_order", order.id, { qty, reason });
    return ticketOrder(db, order.id);
  });
}

/** מעביר לספק התשלום את ההחזרים שממתינים. רץ מיד אחרי החזר, ושוב בכל סבב תחזוקה. */
export async function processRefunds(db) {
  const pending = db
    .prepare("SELECT r.*, o.gateway, o.payment_ref FROM ticket_refunds r JOIN ticket_orders o ON o.id = r.order_id WHERE r.status IN ('pending','failed') ORDER BY r.id LIMIT 50")
    .all();
  let done = 0;
  for (const r of pending) {
    try {
      await gateway(r.gateway).refund(db, r.payment_ref, r.amount_agorot);
      db.prepare("UPDATE ticket_refunds SET status = 'done', error = NULL, done_at = ? WHERE id = ?").run(clock.iso(), r.id);
      done++;
    } catch (e) {
      db.prepare("UPDATE ticket_refunds SET status = 'failed', error = ? WHERE id = ?").run(String(e.message).slice(0, 300), r.id);
    }
  }
  return done;
}

// ביטול הופעה: כל הכרטיסים מוחזרים, וכל התגמולים מתבטלים
_setCancelHandler((db, c, actorId) => {
  if (c.provider !== "jocares") return;
  const orders = db.prepare("SELECT id FROM ticket_orders WHERE campaign_id = ? AND status = 'paid' AND refunded_qty < qty").all(c.id);
  for (const { id } of orders) refundTickets(db, actorId ? { id: actorId } : null, id, "all", "ההופעה בוטלה");
  db.prepare("UPDATE ticket_orders SET status = 'expired' WHERE campaign_id = ? AND status = 'pending'").run(c.id);
  for (const { buyer_email } of db.prepare("SELECT DISTINCT buyer_email FROM ticket_orders WHERE campaign_id = ? AND status = 'paid'").all(c.id)) {
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(buyer_email);
    if (u) notify(db, u.id, `ההופעה "${c.title}" בוטלה. הכסף על הכרטיסים מוחזר לאמצעי התשלום.`, "/me");
  }
});

/** שמירות שפגו משחררות את הכרטיסים */
export function expireHolds(db) {
  return db.prepare("UPDATE ticket_orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(clock.iso()).changes;
}

// ---------- כניסה ----------

export function doorToken(db, campaignId) {
  const c = db.prepare("SELECT door_token FROM campaigns WHERE id = ?").get(campaignId);
  if (c?.door_token) return c.door_token;
  const token = randomToken(18);
  db.prepare("UPDATE campaigns SET door_token = ? WHERE id = ?").run(token, campaignId);
  return token;
}

export const campaignByDoor = (db, token) => {
  const row = db.prepare("SELECT id FROM campaigns WHERE door_token = ?").get(String(token ?? ""));
  return row ? getCampaign(db, row.id) : null;
};

/** קישור חדש לכניסה: הקודם מפסיק לעבוד (אם דלף) */
export function rotateDoorToken(db, actor, campaignId) {
  db.prepare("UPDATE campaigns SET door_token = NULL WHERE id = ?").run(campaignId);
  audit(db, actor.id, "door.rotate", "campaign", campaignId, {});
  return doorToken(db, campaignId);
}

export const normalizeCode = (v) => String(v ?? "").toUpperCase().replace(/^JOT-/, "").replace(/[^A-Z0-9]/g, "").slice(0, 20);

/** סריקה בכניסה. כרטיס נכנס פעם אחת בלבד (העדכון אטומי). */
export function checkIn(db, campaign, codeInput) {
  const code = normalizeCode(codeInput);
  const t = code ? db.prepare("SELECT t.*, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.code = ?").get(code) : null;
  if (!t) return { result: "unknown", code };
  if (t.campaign_id !== campaign.id) return { result: "wrong_show", code, t };
  if (t.status === "refunded") return { result: "refunded", code, t };
  const now = clock.iso();
  const ok = db.prepare("UPDATE tickets SET status = 'used', used_at = ? WHERE id = ? AND status = 'valid'").run(now, t.id).changes;
  if (!ok) return { result: "used", code, t: db.prepare("SELECT t.*, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.id = ?").get(t.id) };
  return { result: "ok", code, t: { ...t, status: "used", used_at: now } };
}

export function doorStats(db, campaignId) {
  return db.prepare("SELECT COUNT(*) total, COALESCE(SUM(status = 'used'), 0) inside FROM tickets WHERE campaign_id = ? AND status != 'refunded'").get(campaignId);
}

// ---------- לאמן ----------

export function ordersOfCampaign(db, campaignId) {
  return db
    .prepare(
      `SELECT o.*, u.name AS promoter_name,
              (SELECT COUNT(*) FROM tickets t WHERE t.order_id = o.id AND t.status = 'used') AS used
         FROM ticket_orders o
         LEFT JOIN orders x ON x.provider = 'jocares' AND x.external_order_id = CAST(o.id AS TEXT)
         LEFT JOIN referral_links l ON l.id = x.link_id
         LEFT JOIN users u ON u.id = l.promoter_id
        WHERE o.campaign_id = ? AND o.status IN ('paid','rejected')
        ORDER BY o.paid_at DESC`
    )
    .all(campaignId);
}

export function salesSummary(db, c) {
  const inv = inventory(db, c);
  const gross = db
    .prepare("SELECT COALESCE(SUM((qty - refunded_qty) * (unit_price_agorot - discount_agorot)), 0) n FROM ticket_orders WHERE campaign_id = ? AND status = 'paid'")
    .get(c.id).n;
  return { ...inv, gross, ...doorStats(db, c.id) };
}

export function setCapacity(db, actor, c, value) {
  const n = Number(value);
  const { sold, held } = inventory(db, c);
  if (!Number.isInteger(n) || n < 1 || n > 20000) throw new UserError("מספר כרטיסים לא תקין");
  if (n < sold + held) throw new UserError(`כבר נמכרו ${sold + held} כרטיסים. אי אפשר להוריד מתחת לזה.`);
  db.prepare("UPDATE events SET capacity = ? WHERE id = ?").run(n, c.event_id);
  audit(db, actor.id, "tickets.capacity", "campaign", c.id, { from: c.capacity, to: n });
}

const csvCell = (v) => {
  const s = String(v ?? "");
  // מונע הזרקת נוסחאות כשפותחים באקסל
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** רשימת הקונים לאמן (המוכר). עמודת ההסכמה אומרת למי מותר לשלוח דיוור. */
export function buyersCsv(db, campaignId) {
  const rows = db
    .prepare("SELECT * FROM ticket_orders WHERE campaign_id = ? AND status = 'paid' ORDER BY paid_at")
    .all(campaignId);
  const head = ["מס הזמנה", "שם", "מייל", "טלפון", "כרטיסים", "הוחזרו", "סכום", "תאריך", "מאשר/ת עדכונים"];
  const lines = rows.map((o) =>
    [o.id, o.buyer_name, o.buyer_email, o.buyer_phone, o.qty, o.refunded_qty, ((o.qty - o.refunded_qty) * (o.unit_price_agorot - o.discount_agorot + o.fee_agorot)) / 100, o.paid_at, o.marketing_consent ? "כן" : "לא"].map(csvCell).join(",")
  );
  return "﻿" + [head.join(","), ...lines].join("\r\n");
}

// ---------- העברת כרטיס בודד ----------

/** קישור לכרטיס אחד בלבד, לשלוח לחבר. מי שמחזיק בו יכול להיכנס עם הכרטיס הזה, ורק איתו. */
export function ticketShareToken(db, t) {
  if (t.share_token) return t.share_token;
  const token = randomToken(12);
  db.prepare("UPDATE tickets SET share_token = ? WHERE id = ? AND share_token IS NULL").run(token, t.id);
  return db.prepare("SELECT share_token FROM tickets WHERE id = ?").get(t.id).share_token;
}
export const ticketByShare = (db, token) =>
  db.prepare("SELECT t.*, o.buyer_name, o.qty, o.status AS order_status FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.share_token = ?").get(String(token ?? ""));

// ---------- תזכורות ----------

/**
 * "תזכירו לי": מייל אחד בלבד, למי שביקש במפורש. נשלח 3 ימים לפני ההופעה,
 * או יום לפני שהמחיר המוקדם נגמר, מה שקודם. אפשר לבטל בקישור.
 */
export function addReminder(db, c, { email, consent, refCode = null }) {
  const e = normalizeEmail(email);
  if (!isEmail(e)) throw new UserError("המייל לא תקין");
  if (consent !== "on") throw new UserError("צריך לאשר שנשלח תזכורת");
  if (!["active", "paused", "sold_out"].includes(c.status) || c.starts_at <= clock.iso()) throw new UserError("ההופעה לא פתוחה");
  db.prepare("INSERT OR IGNORE INTO show_reminders (campaign_id, email, token, ref_code, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(c.id, e, randomToken(16), refCode, clock.iso());
}

export function reminderDueAt(c) {
  const show = new Date(c.starts_at).getTime() - 3 * 86400000;
  const early = c.early_price_agorot && c.early_until ? new Date(c.early_until).getTime() - 86400000 : Infinity;
  return new Date(Math.min(show, early)).toISOString();
}

/** תזכורות שהגיע זמנן. send(reminder, campaign) שולח בפועל; אם נכשל, ננסה בסבב הבא. */
export async function processReminders(db, send) {
  const rows = db
    .prepare("SELECT r.* FROM show_reminders r JOIN campaigns c ON c.id = r.campaign_id WHERE r.sent_at IS NULL AND r.cancelled_at IS NULL AND c.status IN ('active','paused','sold_out') LIMIT 200")
    .all();
  let sent = 0;
  for (const r of rows) {
    const c = getCampaign(db, r.campaign_id);
    if (reminderDueAt(c) > clock.iso() || c.starts_at <= clock.iso()) continue;
    // כבר קנה? לא מטרידים
    if (db.prepare("SELECT 1 FROM ticket_orders WHERE campaign_id = ? AND buyer_email = ? AND status = 'paid'").get(c.id, r.email)) {
      db.prepare("UPDATE show_reminders SET sent_at = ? WHERE id = ?").run(clock.iso(), r.id);
      continue;
    }
    try {
      await send(r, c, priceNow(db, c));
      db.prepare("UPDATE show_reminders SET sent_at = ? WHERE id = ?").run(clock.iso(), r.id);
      sent++;
    } catch (e) {
      console.error("[reminder]", e.message);
    }
  }
  return sent;
}

export function cancelReminder(db, token) {
  return db.prepare("UPDATE show_reminders SET cancelled_at = ? WHERE token = ? AND cancelled_at IS NULL").run(clock.iso(), String(token ?? "")).changes;
}

// ---------- כרטיס ----------

/** QR כ-SVG נקי (path אחד, בלי style), מתאים ל-CSP */
export function qrSvg(data, { size = 220 } = {}) {
  const q = qrcode(0, "M");
  q.addData(String(data));
  q.make();
  const n = q.getModuleCount();
  const pad = 4;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  const box = n + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${box}" height="${box}" fill="#fff"/><path d="${d}" fill="#151515"/></svg>`;
}

const icsText = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
const icsDate = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function ics(c, order, url) {
  const end = new Date(new Date(c.starts_at).getTime() + 3 * 3600000).toISOString();
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JoCares//Tickets//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:jocares-order-${order.id}@jocares`,
    `DTSTAMP:${icsDate(clock.iso())}`,
    `DTSTART:${icsDate(c.starts_at)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`${c.artist_name}: ${c.title}`)}`,
    `LOCATION:${icsText([c.venue, c.city].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsText(`${order.qty - order.refunded_qty} כרטיסים. הכרטיסים שלך: ${url}`)}`,
    `URL:${url}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

export function ticketIssues(db) {
  const out = [];
  for (const o of db.prepare("SELECT o.id FROM ticket_orders o WHERE o.status = 'paid' AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.provider = 'jocares' AND x.external_order_id = CAST(o.id AS TEXT))").all()) {
    out.push(`הזמנת כרטיסים ${o.id} שולמה אבל לא נרשמה במנוע התגמולים`);
  }
  for (const o of db.prepare("SELECT o.id, o.refunded_qty, x.refunded_qty AS x FROM ticket_orders o JOIN orders x ON x.provider = 'jocares' AND x.external_order_id = CAST(o.id AS TEXT) WHERE o.refunded_qty != x.refunded_qty").all()) {
    out.push(`הזמנת כרטיסים ${o.id}: ${o.refunded_qty} הוחזרו בקופה, ${o.x} במנוע התגמולים`);
  }
  const stuck = db.prepare("SELECT COUNT(*) n FROM ticket_refunds WHERE status = 'failed'").get().n;
  if (stuck) out.push(`${stuck} החזרים נכשלו אצל ספק התשלום ומחכים לניסיון נוסף`);
  return out;
}

export const pendingRefunds = (db) =>
  db.prepare("SELECT r.*, o.buyer_name, o.campaign_id FROM ticket_refunds r JOIN ticket_orders o ON o.id = r.order_id WHERE r.status != 'done' ORDER BY r.id DESC").all();
