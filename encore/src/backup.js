// גיבוי מסד הנתונים.
// כל שעה: עותק עקבי של המסד (VACUUM INTO, לא חוסם קריאות), בדיקה שהעותק תקין, ושמירה לפי מדיניות:
// 48 העותקים השעתיים האחרונים + עותק אחד לכל יום ב-30 הימים האחרונים.
// מחוץ לשרת (מומלץ מאוד): אם מוגדר אחסון תואם S3 (Cloudflare R2, AWS S3, Backblaze B2), העותק מוצפן
// ב-AES-256-GCM ונשלח לשם. בלי זה, גיבוי שנמצא על אותו דיסק לא מגן מפני אובדן הדיסק עצמו.
//
//   BACKUP_DIR            תיקיית הגיבויים המקומית (ברירת מחדל: backups ליד המסד)
//   BACKUP_S3_ENDPOINT    למשל https://<account>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET, BACKUP_S3_REGION (ברירת מחדל auto)
//   BACKUP_S3_URL_STYLE   virtual לאחסון שבו שם ה-bucket הוא תת-דומיין (Railway Buckets, AWS). אחרת path
//   BACKUP_ENCRYPTION_KEY מפתח ההצפנה לגיבוי מחוץ לשרת (חובה כשיש אחסון מרוחק). לשמור גם מחוץ ל-Railway!
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const backupState = { lastLocal: null, lastLocalError: null, lastRemote: null, lastRemoteError: null, lastSize: 0 };

export const backupDir = () => process.env.BACKUP_DIR || path.join(path.dirname(process.env.ENCORE_DB ?? "data/encore.db"), "backups");
export const remoteEnabled = () => ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET", "BACKUP_ENCRYPTION_KEY"].every((k) => process.env[k]);

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); // 20261126T101500Z

/** בדיקה שהגיבוי נפתח ותקין, ומחזיר כמה כרטיסים והזמנות יש בו */
export function verifyBackup(file) {
  const b = new DatabaseSync(file, { readOnly: true });
  try {
    const check = b.prepare("PRAGMA quick_check").get();
    const ok = Object.values(check)[0] === "ok";
    if (!ok) throw new Error(`גיבוי פגום: ${JSON.stringify(check)}`);
    return {
      tickets: b.prepare("SELECT COUNT(*) n FROM tickets").get().n,
      orders: b.prepare("SELECT COUNT(*) n FROM ticket_orders").get().n,
    };
  } finally {
    b.close();
  }
}

/** שמירה: 48 אחרונים + האחרון של כל יום ב-30 ימים */
export function prune(dir, { keepRecent = 48, keepDays = 30 } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /^encore-\d{8}T\d{6}Z\.db$/.test(f)).sort().reverse();
  const keep = new Set(files.slice(0, keepRecent));
  const days = new Set();
  for (const f of files) {
    const day = f.slice(7, 15);
    if (days.size >= keepDays && !days.has(day)) continue;
    if (!days.has(day)) {
      days.add(day);
      keep.add(f);
    }
  }
  let removed = 0;
  for (const f of files) if (!keep.has(f)) { fs.rmSync(path.join(dir, f), { force: true }); removed++; }
  return removed;
}

export function backupLocal(db, { dir = backupDir(), now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `encore-${stamp(now)}.db`);
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  // הנתיב נבנה אצלנו (תאריך בלבד), ובכל זאת מוגן ממרכאות
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const counts = verifyBackup(tmp);
  fs.renameSync(tmp, file);
  const removed = prune(dir);
  backupState.lastLocal = new Date().toISOString();
  backupState.lastLocalError = null;
  backupState.lastSize = fs.statSync(file).size;
  return { file, ...counts, removed };
}

// ---------- הצפנה ----------

const encKey = () => crypto.createHash("sha256").update(String(process.env.BACKUP_ENCRYPTION_KEY)).digest();
/** פורמט: "JCB1" + iv(12) + tag(16) + נתונים */
export function encrypt(buf, key = encKey()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("JCB1"), iv, c.getAuthTag(), data]);
}
export function decrypt(buf, key = encKey()) {
  if (buf.subarray(0, 4).toString() !== "JCB1") throw new Error("לא קובץ גיבוי של JoCares");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

// ---------- העלאה לאחסון תואם S3 (חתימת AWS SigV4, בלי ספריה) ----------

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hmacRaw = (k, s) => crypto.createHmac("sha256", k).update(s).digest();

export function signS3({ method, url, body, accessKey, secret, region, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? Buffer.alloc(0));
  const headers = { host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, u.pathname, u.search.slice(1), ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSign = hmacRaw(hmacRaw(hmacRaw(hmacRaw(`AWS4${secret}`, date), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSign).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}` };
}

/** כתובת האובייקט: path-style (ברירת מחדל, R2) או virtual-hosted (Railway Buckets, AWS): BACKUP_S3_URL_STYLE=virtual */
export function objectUrl(key) {
  const endpoint = new URL(process.env.BACKUP_S3_ENDPOINT);
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (process.env.BACKUP_S3_URL_STYLE === "virtual") return `${endpoint.protocol}//${bucket}.${endpoint.host}/${key}`;
  return `${endpoint.origin}/${bucket}/${key}`;
}

export async function uploadRemote(file, fetchImpl = fetch) {
  const body = encrypt(fs.readFileSync(file));
  const key = `jocares/${path.basename(file)}.enc`;
  const url = objectUrl(key);
  const headers = signS3({ method: "PUT", url, body, accessKey: process.env.BACKUP_S3_ACCESS_KEY, secret: process.env.BACKUP_S3_SECRET, region: process.env.BACKUP_S3_REGION || "auto" });
  const res = await fetchImpl(url, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream" }, body, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`העלאת גיבוי נכשלה: ${res.status} ${(await res.text()).slice(0, 200)}`);
  backupState.lastRemote = new Date().toISOString();
  backupState.lastRemoteError = null;
  return key;
}

/** הגיבוי השעתי: מקומי תמיד, ומרוחק כשמוגדר */
export async function runBackup(db, fetchImpl = fetch) {
  let local;
  try {
    local = backupLocal(db);
  } catch (e) {
    backupState.lastLocalError = String(e.message);
    throw e;
  }
  if (!remoteEnabled()) return { local: path.basename(local.file), tickets: local.tickets };
  try {
    const key = await uploadRemote(local.file, fetchImpl);
    return { local: path.basename(local.file), remote: key, tickets: local.tickets };
  } catch (e) {
    backupState.lastRemoteError = String(e.message);
    throw e;
  }
}

export function backupHealth() {
  const age = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60_000) : null);
  return {
    backup_local_age_min: age(backupState.lastLocal),
    backup_remote_age_min: remoteEnabled() ? age(backupState.lastRemote) : "not_configured",
    backup_error: backupState.lastLocalError || backupState.lastRemoteError,
    backup_size_kb: Math.round(backupState.lastSize / 1024),
  };
}
