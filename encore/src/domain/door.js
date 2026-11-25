// מערכת הכניסה: צוות דלת, סריקה, חיפוש לפי שם, ביטול כניסה, ועבודה בלי קליטה.
// שתי דרכי גישה: קישור סודי של הופעה (כמו קודם), או קישור אישי של איש צוות שרואה את כל ההופעות של המארגן.
import crypto from "node:crypto";
import { insert, tx } from "../db.js";
import { clock, randomToken, text, UserError } from "../util.js";
import { audit } from "./identity.js";
import { getCampaign } from "./campaigns.js";
import { campaignByDoor, doorStats, normalizeCode } from "./tickets.js";

const UNDO_MINUTES = 5;
export const codeHash = (code) => crypto.createHash("sha256").update(normalizeCode(code)).digest("hex").slice(0, 32);

// ---------- צוות כניסה ----------

export function addStaff(db, actor, artistId, name) {
  const token = randomToken(18);
  const id = insert(db, "door_staff", { artist_id: Number(artistId), name: text(name, "שם איש הצוות", { max: 40 }), token, created_by: actor.id, created_at: clock.iso() });
  audit(db, actor.id, "door.staff_added", "artist", Number(artistId), { staff: id });
  return token;
}
export const staffOf = (db, artistId) => db.prepare("SELECT * FROM door_staff WHERE artist_id = ? AND revoked_at IS NULL ORDER BY id").all(Number(artistId));
export const staffByToken = (db, token) => db.prepare("SELECT * FROM door_staff WHERE token = ? AND revoked_at IS NULL").get(String(token ?? ""));
export function revokeStaff(db, actor, artistId, staffId) {
  db.prepare("UPDATE door_staff SET revoked_at = ? WHERE id = ? AND artist_id = ?").run(clock.iso(), Number(staffId), Number(artistId));
  audit(db, actor.id, "door.staff_revoked", "artist", Number(artistId), { staff: Number(staffId) });
}

/** הופעות שאיש הצוות רואה: מאתמול ועד שבוע קדימה, של המארגן שלו */
export function eventsForStaff(db, staff) {
  const from = new Date(clock.now().getTime() - 18 * 3600_000).toISOString();
  const to = new Date(clock.now().getTime() + 7 * 86400_000).toISOString();
  return db
    .prepare(`SELECT c.id FROM campaigns c JOIN events e ON e.id = c.event_id WHERE c.artist_id = ? AND c.provider = 'jocares' AND c.status != 'draft' AND e.starts_at BETWEEN ? AND ? ORDER BY e.starts_at`)
    .all(staff.artist_id, from, to)
    .map((r) => ({ ...getCampaign(db, r.id), stats: doorStats(db, r.id) }));
}

/** מי ניגש: קישור הופעה, או איש צוות + הופעה של המארגן שלו */
export function resolveDoor(db, { eventToken, staffToken, campaignId }) {
  if (eventToken) {
    const c = campaignByDoor(db, eventToken);
    if (!c) throw new UserError("הקישור לכניסה לא בתוקף", 404);
    return { c, staff: null };
  }
  const staff = staffByToken(db, staffToken);
  if (!staff) throw new UserError("הקישור לא בתוקף. בקשו קישור חדש מהמארגן.", 404);
  const c = getCampaign(db, campaignId);
  if (!c || c.artist_id !== staff.artist_id) throw new UserError("ההופעה לא נמצאה", 404);
  return { c, staff };
}

// ---------- רשימת כרטיסים לעבודה בלי קליטה ----------

/**
 * רשימת הכרטיסים של ההופעה למכשיר הסורק. הקודים עצמם לא נשלחים: רק גיבוב, כדי שמכשיר שאבד לא יחשוף כרטיסים.
 * השם: לכרטיס שמי השם המלא (צריך לבדוק תעודה), לכרטיס רגיל רק השם הפרטי של המזמין.
 */
export function manifest(db, c) {
  const rows = db
    .prepare("SELECT t.id, t.code, t.status, t.seq, t.holder_name, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.campaign_id = ?")
    .all(c.id);
  return {
    campaign: c.id,
    at: clock.iso(),
    tickets: rows.map((t) => ({
      h: codeHash(t.code), id: t.id, s: t.status, q: `${t.seq}/${t.qty}`,
      n: t.holder_name || String(t.buyer_name).trim().split(/\s+/)[0], named: !!t.holder_name,
    })),
  };
}

// ---------- סריקה ----------

const ticketRow = (db, id) =>
  db.prepare("SELECT t.*, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.id = ?").get(id);

function log(db, t, action, { staff, device, offline = false, at }) {
  insert(db, "door_checkins", {
    ticket_id: t.id, campaign_id: t.campaign_id, action, staff_id: staff?.id ?? null, device: String(device ?? "").slice(0, 40),
    offline: offline ? 1 : 0, at: at ?? clock.iso(),
  });
}

const view = (t) => t && { id: t.id, name: t.holder_name || String(t.buyer_name).trim().split(/\s+/)[0], named: !!t.holder_name, q: `${t.seq}/${t.qty}`, used_at: t.used_at };

/** כניסה לפי קוד או לפי מזהה כרטיס (מחיפוש). העדכון אטומי: כרטיס נכנס פעם אחת, גם משתי דלתות */
export function admit(db, c, { code = null, ticketId = null, staff = null, device = "", offline = false, at = null }) {
  let t;
  if (ticketId) t = ticketRow(db, Number(ticketId));
  else {
    const n = normalizeCode(code);
    t = n ? db.prepare("SELECT t.*, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE t.code = ?").get(n) : null;
  }
  if (!t) return { result: "unknown" };
  if (t.campaign_id !== c.id) return { result: "wrong_show" };
  if (t.status === "refunded") return { result: "refunded", ticket: view(t) };
  const when = at && at < clock.iso() ? at : clock.iso();
  const ok = db.prepare("UPDATE tickets SET status = 'used', used_at = ? WHERE id = ? AND status = 'valid'").run(when, t.id).changes;
  if (!ok) return { result: "used", ticket: view(ticketRow(db, t.id)) };
  log(db, t, "in", { staff, device, offline, at: when });
  return { result: "ok", ticket: view({ ...t, used_at: when }) };
}

/** ביטול כניסה שנסרקה בטעות, עד 5 דקות אחרי */
export function undo(db, c, ticketId, { staff = null, device = "" } = {}) {
  return tx(db, () => {
    const t = ticketRow(db, Number(ticketId));
    if (!t || t.campaign_id !== c.id || t.status !== "used") throw new UserError("אין מה לבטל");
    if (new Date(t.used_at).getTime() < clock.now().getTime() - UNDO_MINUTES * 60_000) throw new UserError(`אפשר לבטל רק עד ${UNDO_MINUTES} דקות אחרי הסריקה`);
    db.prepare("UPDATE tickets SET status = 'valid', used_at = NULL WHERE id = ?").run(t.id);
    log(db, t, "undo", { staff, device });
    return { result: "undone", ticket: view(t) };
  });
}

/** חיפוש לאורח בלי טלפון: לפי שם על הכרטיס, שם המזמין, או סוף הקוד */
export function search(db, c, q) {
  const s = String(q ?? "").trim();
  if (s.length < 2) return [];
  const like = `%${s.replace(/[%_]/g, "")}%`;
  return db
    .prepare(
      `SELECT t.*, o.buyer_name, o.qty FROM tickets t JOIN ticket_orders o ON o.id = t.order_id
        WHERE t.campaign_id = ? AND t.status != 'refunded' AND (t.holder_name LIKE ? OR o.buyer_name LIKE ? OR t.code LIKE ?)
        ORDER BY t.status = 'used', o.buyer_name, t.seq LIMIT 12`
    )
    .all(c.id, like, like, `%${s.toUpperCase().replace(/[^A-Z0-9]/g, "")}`)
    .map((t) => ({ ...view(t), status: t.status, buyer: t.buyer_name }));
}

/**
 * כניסות שנסרקו בלי קליטה ומגיעות עכשיו. כל אחת נבדקת שוב מול המצב האמיתי:
 * אם הכרטיס כבר נכנס מדלת אחרת, היא מסומנת כהתנגשות כדי שהצוות יידע.
 */
export function syncOffline(db, c, items, { staff = null, device = "" } = {}) {
  return tx(db, () =>
    (Array.isArray(items) ? items.slice(0, 500) : []).map((it) => {
      const r = admit(db, c, { ticketId: it.id, code: it.code, staff, device, offline: true, at: typeof it.at === "string" ? it.at : null });
      return { id: it.id ?? null, result: r.result === "used" ? "conflict" : r.result };
    })
  );
}

export function stats(db, c) {
  const s = doorStats(db, c.id);
  // לפי המצב הנוכחי של הכרטיסים, כך שכניסה שבוטלה לא נספרת
  const last15 = db.prepare("SELECT COUNT(*) n FROM tickets WHERE campaign_id = ? AND status = 'used' AND used_at > ?").get(c.id, new Date(clock.now().getTime() - 15 * 60_000).toISOString()).n;
  return { ...s, last15 };
}

// ---------- לאפליקציית הנייטיב ----------

/** מסך הבית של האפליקציה: מי אני, אצל מי, ואילו הופעות. רק מה שהמסך צריך */
export function appHome(db, staff) {
  const organizer = db.prepare("SELECT name, kind FROM artists WHERE id = ?").get(staff.artist_id) ?? {};
  return {
    staff: { name: staff.name },
    organizer: { name: organizer.name ?? "", kind: organizer.kind ?? "artist" },
    events: eventsForStaff(db, staff).map((c) => ({
      id: c.id, artist: c.artist_name, title: c.title, venue: c.venue, starts_at: c.starts_at,
      inside: c.stats.inside, total: c.stats.total,
    })),
  };
}

/** כמה נכנסו דרך כל איש צוות, וכמה נסרקו בלי קליטה. מספרים בלבד */
export function staffCounts(db, c) {
  return db
    .prepare(
      `SELECT COALESCE(s.name, 'קישור ההופעה') name, SUM(CASE WHEN d.action = 'in' THEN 1 ELSE -1 END) n
         FROM door_checkins d LEFT JOIN door_staff s ON s.id = d.staff_id
        WHERE d.campaign_id = ? GROUP BY d.staff_id ORDER BY n DESC`
    )
    .all(c.id)
    .filter((r) => r.n > 0);
}
