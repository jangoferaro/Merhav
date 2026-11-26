// Identity & Access: כניסה עם קוד חד-פעמי למייל (בלי סיסמאות), סשנים, תפקידים.
// אותו משתמש יכול להיות גם אמן וגם מקדם — התפקיד נגזר ממה שהוא עושה, לא מחשבון נפרד.
import { enqueue } from "../outbox.js";
import crypto from "node:crypto";
import { insert, tx } from "../db.js";
import { clock, addDays, config, emailHash, hmac, isEmail, normalizeEmail, randomToken, safeEqual, text, UserError } from "../util.js";

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_DAYS = 60;

export function audit(db, actorId, action, entity, entityId, data = {}) {
  insert(db, "audit_log", {
    actor_id: actorId ?? null, action, entity, entity_id: entityId ?? null,
    data: JSON.stringify(data), created_at: clock.iso(),
  });
}

/**
 * התראה באתר. עם { email: true } גם במייל (לדברים שחשוב לדעת עליהם בזמן: מכירה, תשלום, הזמנה).
 * המייל יוצא אחרי שהטרנזקציה הסתיימה, וכישלון בשליחה לא משפיע על כלום.
 */
export function notify(db, userId, body, url = "", { email = false } = {}) {
  const id = insert(db, "notifications", { user_id: userId, body, url, created_at: clock.iso() });
  if (!email) return;
  const u = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  if (!u?.email || u.email.endsWith(".local")) return;
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  // דרך תיבת היציאה: נשלח גם אם הספק נפל לרגע, ופעם אחת בלבד
  enqueue(db, { to: u.email, subject: body.length > 70 ? body.slice(0, 67) + "…" : body, body: `${body}\n\n${base}${url}\n\nJoCares`, key: `notify:${id}` });
}

/** שלב 1: מבקשים קוד. מחזיר את הקוד (השרת מחליט אם לשלוח במייל או להציג במצב פיתוח). */
export function requestLoginCode(db, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) throw new UserError("כתובת המייל לא נראית תקינה");
  const hourAgo = new Date(clock.now().getTime() - 3600000).toISOString();
  const recent = db.prepare("SELECT COUNT(*) n FROM login_codes WHERE email = ? AND created_at > ?").get(email, hourAgo).n;
  if (recent >= MAX_CODES_PER_HOUR) throw new UserError("ביקשת יותר מדי קודים. נסו שוב בעוד שעה.", 429);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  insert(db, "login_codes", {
    email, code_hash: hmac(`${email}:${code}`, "login"),
    expires_at: new Date(clock.now().getTime() + CODE_TTL_MIN * 60000).toISOString(),
    created_at: clock.iso(),
  });
  return { email, code };
}

/** שלב 2: מאמתים קוד → מחזיר משתמש + טוקן סשן. יוצר משתמש אם זו הפעם הראשונה. */
export function verifyLoginCode(db, rawEmail, rawCode) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  const row = db
    .prepare("SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1")
    .get(email);
  if (!row || row.expires_at < clock.iso()) throw new UserError("הקוד פג תוקף. בקשו קוד חדש.");
  if (row.attempts >= MAX_ATTEMPTS) throw new UserError("יותר מדי ניסיונות. בקשו קוד חדש.", 429);
  if (!safeEqual(row.code_hash, hmac(`${email}:${code}`, "login"))) {
    // נספר מחוץ לטרנזקציה כדי שהניסיון הכושל יישמר
    db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    throw new UserError("הקוד לא נכון");
  }
  return tx(db, () => {
    const used = db.prepare("UPDATE login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(clock.iso(), row.id);
    if (used.changes !== 1) throw new UserError("הקוד כבר שומש. בקשו קוד חדש.");
    return signInVerifiedEmail(db, email, { method: "email_code" });
  });
}

/**
 * כניסה עם מייל שכבר אומת (בקוד למייל, או ע"י Google). אותו מייל = אותו חשבון,
 * כך שמי שנכנס פעם בקוד ופעם עם Google מגיע לאותו מקום.
 */
export function signInVerifiedEmail(db, rawEmail, { name = "", method } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) throw new UserError("כתובת המייל לא תקינה");
  return tx(db, () => {
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const cleanName = String(name ?? "").trim().slice(0, 60);
      const id = insert(db, "users", {
        email, email_hash: emailHash(email), created_at: clock.iso(), name: cleanName || null,
        is_admin: config.adminEmails.includes(email) ? 1 : 0,
      });
      user = getUser(db, id);
      audit(db, id, "user.created", "user", id, { method });
    } else if (!user.name && name) {
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(String(name).trim().slice(0, 60), user.id);
      user = getUser(db, user.id);
    }
    if (user.frozen_at) throw new UserError("החשבון מוקפא. פנו לצוות התמיכה.", 403);
    return { user, sessionToken: createSession(db, user.id) };
  });
}

export function createSession(db, userId) {
  const token = randomToken(32);
  insert(db, "sessions", {
    id_hash: hmac(token, "session"), user_id: userId,
    expires_at: addDays(clock.iso(), SESSION_DAYS), created_at: clock.iso(),
  });
  return token;
}

export function userFromSession(db, token) {
  if (!token) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE id_hash = ?").get(hmac(token, "session"));
  if (!s || s.expires_at < clock.iso()) return null;
  const u = getUser(db, s.user_id);
  return u && !u.frozen_at ? u : null;
}

export const endSession = (db, token) => db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hmac(token, "session"));

export const getUser = (db, id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

export function setName(db, userId, name) {
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(text(name, "שם", { max: 60 }), userId);
}

export const displayName = (u) => u?.name || (u?.email ?? "").split("@")[0];
/** שם ציבורי: שם פרטי בלבד — לא חושפים מייל או שם מלא לאמנים/רוכשים */
export const publicName = (u) => (u?.name || "חבר/ה").trim().split(/\s+/)[0];

export function artistsOf(db, userId) {
  return db
    .prepare("SELECT a.* FROM artists a JOIN artist_members m ON m.artist_id = a.id WHERE m.user_id = ? ORDER BY a.id")
    .all(userId);
}

export function canManageArtist(db, user, artistId) {
  if (!user) return false;
  if (user.is_admin) return true;
  return !!db.prepare("SELECT 1 FROM artist_members WHERE artist_id = ? AND user_id = ?").get(artistId, user.id);
}

export function setFrozen(db, adminId, userId, frozen) {
  db.prepare("UPDATE users SET frozen_at = ? WHERE id = ?").run(frozen ? clock.iso() : null, userId);
  if (frozen) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  audit(db, adminId, frozen ? "user.frozen" : "user.unfrozen", "user", userId);
}

export function unreadCount(db, userId) {
  return db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId).n;
}
