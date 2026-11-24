// כלים משותפים: זמן, כסף, הצפנה וגיבוב. אין כאן חוקים עסקיים.
import crypto from "node:crypto";

// ---------- הגדרות ----------

const DEV_SECRET = "dev-only-secret-change-me";
export const config = {
  get secret() {
    return process.env.ENCORE_SECRET || DEV_SECRET;
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  /** עמלת הפלטפורמה בנקודות בסיס (500 = 5% ממחיר כרטיס שנמכר דרך מקדם) */
  get feeBps() {
    return Number(process.env.PLATFORM_FEE_BPS ?? 500);
  },
  /** חלון שיוך: כמה ימים אחרי לחיצה הרכישה עדיין נזקפת למקדם */
  attributionDays: 30,
  /** כמה ימים אחרי ההופעה התגמול הופך לזמין (חלון ביטולים/החזרים) */
  holdDaysAfterShow: 3,
  /** סכום מינימלי לבקשת תשלום (אגורות) */
  minPayoutAgorot: 5000,
  get adminEmails() {
    return (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  },
};

if (config.isProd && config.secret === DEV_SECRET) {
  throw new Error("ENCORE_SECRET חייב להיות מוגדר בסביבת ייצור");
}

// ---------- זמן (ניתן להחלפה בבדיקות) ----------

let fixedNow = null;
export const clock = {
  now: () => (fixedNow ? new Date(fixedNow) : new Date()),
  iso: () => clock.now().toISOString(),
  set: (d) => (fixedNow = d ? new Date(d).getTime() : null),
  advanceDays: (n) => (fixedNow = clock.now().getTime() + n * 86400000),
};

export const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 86400000).toISOString();

const TZ = "Asia/Jerusalem";

/** "2026-12-31T21:00" כפי שהוקלד בישראל → ISO ב-UTC */
export function israelLocalToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(local ?? ""));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = tzOffsetMs(guess);
  return new Date(guess - offset).toISOString();
}

function tzOffsetMs(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** ISO → "2026-12-31T21:00" בשעון ישראל (לשדה datetime-local) */
export function isoToIsraelLocal(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  return new Date(t + tzOffsetMs(t)).toISOString().slice(0, 16);
}

export function showDate(iso, opts = {}) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...opts,
  });
}

export const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

// ---------- כסף: תמיד מספרים שלמים באגורות ----------

export function money(agorot) {
  const sign = agorot < 0 ? "−" : "";
  const a = Math.abs(agorot);
  return sign + "₪" + (a / 100).toLocaleString("he-IL", { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

export function shekelsToAgorot(input) {
  const s = String(input ?? "").replace(/[₪,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** עמלת הפלטפורמה לכרטיס, מעוגלת כלפי מטה לאגורה */
export const feePerTicket = (priceAgorot, bps) => Math.floor((priceAgorot * bps) / 10000);

// ---------- מזהים, גיבוב, הצפנה ----------

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");

const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
export function shortCode(len = 7) {
  return Array.from(crypto.randomBytes(len), (b) => CODE_ABC[b % CODE_ABC.length]).join("");
}

/** גיבוב מוקשח (עם הסוד של השרת) — לשמירת מזהים בלי לשמור את הערך עצמו */
export const hmac = (value, purpose = "id") =>
  crypto.createHmac("sha256", `${config.secret}:${purpose}`).update(String(value)).digest("base64url");

export const normalizeEmail = (e) => String(e ?? "").trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
export const emailHash = (email) => hmac(normalizeEmail(email), "email");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const encKey = () => crypto.scryptSync(config.secret, "encore-pii", 32);

/** הצפנת מידע רגיש (פרטי תשלום) — AES-256-GCM */
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function text(value, label, { max = 120, required = true } = {}) {
  const v = String(value ?? "").trim();
  if (required && !v) throw new UserError(`חסר: ${label}`);
  if (v.length > max) throw new UserError(`${label}: עד ${max} תווים`);
  return v;
}
