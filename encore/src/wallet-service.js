// שירות העדכונים של Apple Wallet (PassKit Web Service).
// המכשיר נרשם לכל כרטיס עם טוקן דחיפה. כשכרטיס משתנה, שולחים ל-Apple דחיפה ריקה (APNs),
// והמכשיר שואל אותנו אילו כרטיסים השתנו ומוריד את הגרסה העדכנית.
// הדחיפה משתמשת באותה תעודה של ה-Pass Type ID, כך שאין משתנים חדשים להגדרה.
import http2 from "node:http2";
import { clock, safeEqual } from "./util.js";
import { passAuthToken } from "./wallet.js";

const pem = (k) => (process.env[k] || "").replace(/\\n/g, "\n");
const SERIAL = /^[A-Z0-9]{6,20}$/;
const DEVICE = /^[A-Za-z0-9]{8,128}$/;
const PUSH = /^[A-Za-z0-9]{16,200}$/;

const ticketBySerial = (db, serial) =>
  SERIAL.test(String(serial)) ? db.prepare("SELECT t.*, o.status AS order_status FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.code = ?").get(serial) : null;

/** בדיקת "Authorization: ApplePass <token>" מול הכרטיס */
export function authorize(db, serial, header) {
  const t = ticketBySerial(db, serial);
  const m = /^ApplePass\s+(\S+)$/.exec(String(header ?? ""));
  if (!t || t.order_status !== "paid" || !m || !safeEqual(m[1], passAuthToken(t))) return null;
  return t;
}

/** רישום מכשיר לכרטיס. 201 אם חדש, 200 אם כבר היה */
export function register(db, device, serial, pushToken) {
  if (!DEVICE.test(String(device)) || !PUSH.test(String(pushToken ?? ""))) return 400;
  const row = db.prepare("SELECT id FROM wallet_registrations WHERE device = ? AND serial = ?").get(device, serial);
  if (row) {
    db.prepare("UPDATE wallet_registrations SET push_token = ? WHERE id = ?").run(pushToken, row.id);
    return 200;
  }
  // מגבלה סבירה למכשיר אחד, כדי שאי אפשר יהיה למלא את הטבלה
  if (db.prepare("SELECT COUNT(*) n FROM wallet_registrations WHERE device = ?").get(device).n >= 500) return 400;
  db.prepare("INSERT INTO wallet_registrations (device, push_token, serial, created_at) VALUES (?, ?, ?, ?)").run(device, pushToken, serial, clock.iso());
  return 201;
}

export function unregister(db, device, serial) {
  db.prepare("DELETE FROM wallet_registrations WHERE device = ? AND serial = ?").run(String(device), String(serial));
}

/** אילו כרטיסים של המכשיר השתנו מאז התג האחרון. null אם אין */
export function updatedSince(db, device, since) {
  const rows = db
    .prepare(
      `SELECT t.code, COALESCE(t.pass_updated_at, '') AS u FROM wallet_registrations r JOIN tickets t ON t.code = r.serial
        WHERE r.device = ? AND (? = '' OR COALESCE(t.pass_updated_at, '') > ?)`
    )
    .all(String(device), String(since ?? ""), String(since ?? ""));
  if (!rows.length) return null;
  // התג באותו שעון כמו הטריגרים במסד (זמן אמיתי), כדי שההשוואה תהיה עקבית
  const last = rows.reduce((m, r) => (r.u > m ? r.u : m), String(since ?? "")) || new Date().toISOString();
  return { serialNumbers: rows.map((r) => r.code), lastUpdated: last };
}

/** מתי הכרטיס השתנה לאחרונה, לכותרת Last-Modified */
export const lastModified = (t) => new Date(t.pass_updated_at || "2026-01-01T00:00:00Z");

// ---------- דחיפה ל-Apple ----------

/** שליחה אמיתית ל-APNs ב-HTTP/2 עם תעודת ה-Pass Type ID */
export function apnsSender() {
  let session = null;
  const connect = () => {
    if (session && !session.closed && !session.destroyed) return session;
    session = http2.connect("https://api.push.apple.com", {
      cert: pem("APPLE_PASS_CERT"), key: pem("APPLE_PASS_KEY"), passphrase: process.env.APPLE_PASS_KEY_PASSWORD || undefined,
    });
    session.on("error", () => { session = null; });
    session.unref();
    return session;
  };
  return (token) =>
    new Promise((resolve) => {
      try {
        const req = connect().request({ ":method": "POST", ":path": `/3/device/${token}`, "apns-topic": process.env.APPLE_PASS_TYPE_ID, "apns-push-type": "background", "content-type": "application/json" });
        req.setTimeout(10_000, () => { req.close(); resolve(0); });
        req.on("response", (h) => resolve(Number(h[":status"])));
        req.on("error", () => resolve(0));
        req.end("{}");
      } catch {
        resolve(0);
      }
    });
}

/**
 * דוחף לכל מכשיר שיש לו כרטיס שהשתנה מאז הדחיפה האחרונה. רץ ב-tick של השרת.
 * טוקן שהוחזר ממנו 410 (המכשיר הסיר את הכרטיס) נמחק.
 */
export async function pushUpdates(db, send) {
  const rows = db
    .prepare(
      `SELECT r.id, r.push_token, t.pass_updated_at AS u FROM wallet_registrations r JOIN tickets t ON t.code = r.serial
        WHERE t.pass_updated_at IS NOT NULL AND COALESCE(r.notified_at, '') < t.pass_updated_at LIMIT 500`
    )
    .all();
  if (!rows.length) return 0;
  const byToken = new Map();
  for (const r of rows) byToken.set(r.push_token, [...(byToken.get(r.push_token) ?? []), r]);
  let sent = 0;
  for (const [token, regs] of byToken) {
    const status = await send(token);
    if (status === 200) sent++;
    if (status === 410) db.prepare("DELETE FROM wallet_registrations WHERE push_token = ?").run(token);
    // גם כשהדחיפה נכשלה מסמנים, כדי לא לנסות בלי סוף. המכשיר יתעדכן ממילא בפעם הבאה שהכרטיס יוצג
    else for (const r of regs) db.prepare("UPDATE wallet_registrations SET notified_at = ? WHERE id = ?").run(r.u, r.id);
  }
  return sent;
}
