// תיבת יציאה: כל מייל ו-SMS חשוב (כרטיסים, תזכורות, התראות) נכתב קודם למסד, ורק אחר כך נשלח.
// אם הספק נופל, ההודעה לא הולכת לאיבוד: היא נשלחת שוב עם המתנה הולכת וגדלה.
// מפתח ייחודי (dedupe) מבטיח שאותה הודעה לא תישלח פעמיים, גם אם נכתבה פעמיים.
import { clock } from "./util.js";

const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440]; // דקות בין ניסיונות
export const MAX_ATTEMPTS = BACKOFF_MIN.length;

export function migrateOutbox(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox (
      id          INTEGER PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('mail','sms')),
      to_addr     TEXT NOT NULL,
      subject     TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL,
      dedupe_key  TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | sent | skipped | dead
      attempts    INTEGER NOT NULL DEFAULT 0,
      next_at     TEXT NOT NULL,
      claimed_at  TEXT,
      last_error  TEXT,
      created_at  TEXT NOT NULL,
      sent_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_at);
  `);
}

/** מוסיף הודעה. מחזיר true אם נוספה, false אם כבר קיימת עם אותו מפתח */
export function enqueue(db, { kind = "mail", to, subject = "", body, key }) {
  if (!to) return false;
  return (
    db.prepare("INSERT OR IGNORE INTO outbox (kind, to_addr, subject, body, dedupe_key, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(kind, String(to), String(subject), String(body), String(key), clock.iso(), clock.iso()).changes === 1
  );
}

/**
 * שולח את מה שהגיע זמנו. כל הודעה "נתפסת" לפני השליחה, כך ששתי ריצות לא ישלחו אותה פעמיים.
 * הודעה שנתקעה ב-sending (השרת נפל באמצע) חוזרת לתור אחרי 5 דקות.
 * send = { mail(msg) → true/false, sms(msg) → true/false }. false = אין ספק מוגדר (מסומן skipped).
 */
export async function processOutbox(db, send, { limit = 50 } = {}) {
  const now = clock.iso();
  const stale = new Date(clock.now().getTime() - 5 * 60_000).toISOString();
  db.prepare("UPDATE outbox SET status = 'pending' WHERE status = 'sending' AND claimed_at < ?").run(stale);
  const due = db.prepare("SELECT * FROM outbox WHERE status = 'pending' AND next_at <= ? ORDER BY id LIMIT ?").all(now, limit);
  let sent = 0;
  for (const m of due) {
    const claimed = db.prepare("UPDATE outbox SET status = 'sending', claimed_at = ? WHERE id = ? AND status = 'pending'").run(clock.iso(), m.id).changes;
    if (!claimed) continue;
    try {
      const ok = await (m.kind === "sms" ? send.sms(m) : send.mail(m));
      db.prepare("UPDATE outbox SET status = ?, attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?").run(ok ? "sent" : "skipped", clock.iso(), m.id);
      if (ok) sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const next = new Date(clock.now().getTime() + BACKOFF_MIN[Math.min(attempts, MAX_ATTEMPTS) - 1] * 60_000).toISOString();
      db.prepare("UPDATE outbox SET status = ?, attempts = ?, next_at = ?, last_error = ? WHERE id = ?").run(dead ? "dead" : "pending", attempts, next, String(e?.message ?? e).slice(0, 300), m.id);
      console.error(`[outbox] ${m.kind} #${m.id} attempt ${attempts}${dead ? " (gave up)" : ""}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  return sent;
}

export function outboxStats(db) {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    outbox_pending: n("SELECT COUNT(*) n FROM outbox WHERE status IN ('pending','sending')"),
    outbox_retrying: n("SELECT COUNT(*) n FROM outbox WHERE status = 'pending' AND attempts > 0"),
    outbox_dead: n("SELECT COUNT(*) n FROM outbox WHERE status = 'dead'"),
    outbox_oldest_pending_min: Math.round(
      (Date.now() - Date.parse(db.prepare("SELECT MIN(created_at) m FROM outbox WHERE status IN ('pending','sending')").get().m ?? new Date().toISOString())) / 60_000
    ),
  };
}
