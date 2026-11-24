// תמונות: קבלת קובץ מהטופס (multipart), בדיקה שהוא באמת תמונה, ושמירה בדיסק.
// כל הופעה וכל יוצר חייבים תמונה. מקבלים JPEG, PNG או WebP עד 8MB. לא מקבלים SVG (יכול להכיל קוד).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { UserError } from "./util.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const mediaDir = () => process.env.ENCORE_MEDIA_DIR ?? "data/media";

const TYPES = {
  jpg: { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};

/** מזהה סוג לפי הבתים עצמם (לא לפי שם הקובץ או מה שהדפדפן טען) */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  for (const [ext, t] of Object.entries(TYPES)) if (t.test(buf)) return ext;
  return null;
}

/** שומר תמונה ומחזיר את הנתיב הציבורי שלה (/media/...) */
export function saveImage(file) {
  if (!file?.data?.length) throw new UserError("לא נבחרה תמונה");
  if (file.data.length > MAX_IMAGE_BYTES) throw new UserError("התמונה גדולה מדי (עד 8MB)");
  const ext = sniffImage(file.data);
  if (!ext) throw new UserError("הקובץ לא נראה כמו תמונה. אפשר JPG, PNG או WebP.");
  fs.mkdirSync(mediaDir(), { recursive: true });
  const name = `${crypto.randomBytes(12).toString("base64url")}.${ext}`;
  fs.writeFileSync(path.join(mediaDir(), name), file.data, { flag: "wx" });
  return `/media/${name}`;
}

export const MEDIA_RE = /^\/media\/[\w-]{16}\.(jpg|png|webp)$/;

/** תמונה תקינה לשמירה בשדה image_url: קובץ שהועלה אצלנו, או קישור https (למשל מחילוץ מעמוד ההופעה) */
export function validImageRef(v) {
  const s = String(v ?? "").trim();
  if (MEDIA_RE.test(s)) return s;
  if (/^https:\/\/[^\s<>"']+$/.test(s) && s.length <= 500) return s;
  return null;
}

/**
 * מחליט מה התמונה מהטופס: קובץ חדש שהועלה (שדה image) גובר על קישור קיים (image_url).
 * זורק אם אין שום תמונה — אין הופעה ואין יוצר בלי תמונה.
 */
export function imageFromForm(form, { required = true } = {}) {
  if (form.image?.data?.length) return saveImage(form.image);
  const ref = validImageRef(form.image_url);
  if (ref) return ref;
  if (required) throw new UserError("צריך תמונה. אפשר להעלות מהטלפון או מהמחשב.");
  return "";
}

export function serveMedia(name, res) {
  if (!MEDIA_RE.test(`/media/${name}`)) return false;
  const file = path.join(mediaDir(), name);
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, {
    "content-type": TYPES[name.split(".").pop()].mime,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------- multipart/form-data (בלי תלויות) ----------

export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) throw new UserError("טופס לא תקין");
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const out = {};
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.subarray(start, start + 2).toString() === "--") break;
    const headEnd = buf.indexOf("\r\n\r\n", start);
    if (headEnd === -1) break;
    const head = buf.subarray(start + 2, headEnd).toString("utf8");
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    const body = buf.subarray(headEnd + 4, next - 2); // בלי ה-\r\n שלפני הגבול
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name) {
      const value = filename !== undefined ? { filename, data: Buffer.from(body) } : body.toString("utf8");
      if (filename !== undefined && !body.length) {
        // שדה קובץ ריק (לא נבחר קובץ) — מתעלמים
      } else {
        out[name] = name in out ? [].concat(out[name], value) : value;
      }
    }
    pos = next;
  }
  return out;
}
