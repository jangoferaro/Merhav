// ספק כרטוס מדומה (Sandbox). מתנהג כמו ספק אמיתי: יש לו קופה משלו,
// והוא מודיע לנו על רכישות, החזרים וביטולים רק דרך webhook חתום (HMAC + חותמת זמן).
// כך כל שרשרת השיוך והתגמולים נבדקת מקצה לקצה, ומחליפים אותו בספק אמיתי בלי לשנות את הליבה.
import crypto from "node:crypto";
import { insert } from "../db.js";
import { clock, config, hmac, normalizeEmail, randomToken, shortCode, UserError } from "../util.js";

const TOLERANCE_SEC = 300;
const secret = () => process.env.SIM_WEBHOOK_SECRET || hmac("sim", "webhook-secret");

export function signSim(raw, t = Math.floor(clock.now().getTime() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret()).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// מוגדר בהפעלת השרת: מעביר webhook חתום לנקודת הקליטה (כאילו נשלח ברשת)
let deliver = () => {
  throw new Error("sim deliver not configured");
};
export const setSimDeliver = (fn) => (deliver = fn);

function emit(type, data) {
  const raw = JSON.stringify({ id: `evt_${randomToken(12)}`, type, created: clock.iso(), data });
  return deliver(raw, { "x-sim-signature": signSim(raw) });
}

export const simProvider = {
  name: "sim",

  registerEvent(db, { title, price_agorot }) {
    const externalId = `simev_${shortCode(10)}`;
    insert(db, "sim_events", { external_id: externalId, title, price_agorot });
    return externalId;
  },

  checkoutUrl(campaign, ref) {
    return `/sim/checkout/${encodeURIComponent(campaign.external_event_id)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  },

  verifyWebhook(raw, headers) {
    const sig = String(headers["x-sim-signature"] ?? "");
    const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(sig);
    if (!m) throw new UserError("bad signature", 401);
    const age = Math.abs(clock.now().getTime() / 1000 - Number(m[1]));
    if (age > TOLERANCE_SEC) throw new UserError("stale signature", 401);
    const expected = signSim(raw, m[1]).split("v1=")[1];
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))) throw new UserError("bad signature", 401);
    const evt = JSON.parse(raw);
    if (!evt?.id || !evt?.type || !evt?.data) throw new UserError("bad payload", 400);
    return evt;
  },
};

// ---------- הצד של "הספק" — הקופה המדומה ----------

export const simEvent = (db, extId) => db.prepare("SELECT * FROM sim_events WHERE external_id = ?").get(extId);

export function simBuy(db, extId, { name, email, qty, ref }) {
  const ev = simEvent(db, extId);
  if (!ev || ev.cancelled) throw new UserError("ההופעה לא זמינה למכירה");
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new UserError("אפשר לקנות 1–10 כרטיסים");
  const buyerEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmail)) throw new UserError("מייל לא תקין");
  const buyerName = String(name ?? "").trim().slice(0, 80);
  if (!buyerName) throw new UserError("חסר שם");
  const sold = db.prepare("SELECT COALESCE(SUM(qty - refunded_qty),0) n FROM sim_orders WHERE external_event_id = ?").get(extId).n;
  if (sold + n > ev.capacity) throw new UserError("אין מספיק כרטיסים");

  const id = `simord_${shortCode(12)}`;
  const codes = Array.from({ length: n }, () => shortCode(8).toUpperCase());
  insert(db, "sim_orders", {
    id, external_event_id: extId, ref: String(ref ?? "").slice(0, 100), buyer_name: buyerName, buyer_email: buyerEmail,
    qty: n, unit_price_agorot: ev.price_agorot, codes: codes.join(","), created_at: clock.iso(),
  });
  emit("order.paid", {
    order_id: id, event_id: extId, qty: n, unit_price_agorot: ev.price_agorot,
    buyer_email: buyerEmail, ref: ref || null, ordered_at: clock.iso(),
  });
  return { id, codes };
}

/** החזר (מלא או חלקי). refunded_qty מצטבר — webhook נושא את הסך המעודכן, כך שהוא אידמפוטנטי. */
export function simRefund(db, orderId, qty) {
  const o = db.prepare("SELECT * FROM sim_orders WHERE id = ?").get(orderId);
  if (!o) throw new UserError("הזמנה לא נמצאה");
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || o.refunded_qty + n > o.qty) throw new UserError("כמות החזר לא תקינה");
  db.prepare("UPDATE sim_orders SET refunded_qty = refunded_qty + ? WHERE id = ?").run(n, orderId);
  emit("order.refunded", { order_id: orderId, refunded_qty: o.refunded_qty + n });
}

export function simCancelEvent(db, extId) {
  db.prepare("UPDATE sim_events SET cancelled = 1 WHERE external_id = ?").run(extId);
  emit("event.cancelled", { event_id: extId });
}

/** שליחה חוזרת של אותו אירוע בדיוק (כמו retry של ספק) — לבדיקת אידמפוטנטיות */
export function simReplay(raw) {
  return deliver(raw, { "x-sim-signature": signSim(raw) });
}

export const simOrders = (db, limit = 50) => db.prepare("SELECT * FROM sim_orders ORDER BY created_at DESC LIMIT ?").all(limit);
export const simOrder = (db, id) => db.prepare("SELECT * FROM sim_orders WHERE id = ?").get(id);
