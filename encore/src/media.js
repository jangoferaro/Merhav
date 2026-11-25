// תמונות: קבלת קובץ מהטופס (multipart), בדיקה שהוא באמת תמונה, ושמירה בדיסק.
// כל הופעה וכל יוצר חייבים תמונה. מקבלים JPEG, PNG או WebP עד 8MB. לא מקבלים SVG (יכול להכיל קוד).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { UserError } from "./util.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const mediaDir = () => process.env.ENCORE_MEDIA_DIR ?? "data/media";

const TYPES = {
  jpg: { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};

// וידאו: MP4 ו-MOV (ftyp בבית 4), WebM (חתימת EBML)
const VIDEO = {
  mp4: { mime: "video/mp4", test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && !/^qt/.test(b.subarray(8, 12).toString("latin1")) },
  mov: { mime: "video/quicktime", test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /^qt/.test(b.subarray(8, 12).toString("latin1")) },
  webm: { mime: "video/webm", test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};
const MIME = Object.fromEntries([...Object.entries(TYPES), ...Object.entries(VIDEO)].map(([k, v]) => [k, v.mime]));

export function sniffVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  for (const [ext, t] of Object.entries(VIDEO)) if (t.test(buf)) return ext;
  return null;
}

/** תמונה או וידאו (לערכת השיתוף ולתוצרים של יוצרים). מחזיר { url, kind } */
export function saveMedia(file) {
  if (!file?.data?.length) throw new UserError("לא נבחר קובץ");
  const vid = sniffVideo(file.data);
  if (!vid) return { url: saveImage(file), kind: "image" };
  if (file.data.length > MAX_VIDEO_BYTES) throw new UserError("הסרטון גדול מדי (עד 80MB). אפשר לקצר או לייצא באיכות נמוכה יותר.");
  fs.mkdirSync(mediaDir(), { recursive: true });
  const name = `${crypto.randomBytes(12).toString("base64url")}.${vid}`;
  fs.writeFileSync(path.join(mediaDir(), name), file.data, { flag: "wx" });
  return { url: `/media/${name}`, kind: "video" };
}

export const mediaKind = (url) => (/\.(mp4|mov|webm)$/.test(String(url)) ? "video" : "image");

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
export const ANY_MEDIA_RE = /^\/media\/[\w-]{16}\.(jpg|png|webp|mp4|mov|webm)$/;

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

/** מגיש קובץ מדיה. תומך ב-Range, כי ספארי לא מנגן וידאו בלי זה. */
export function serveMedia(name, res, range = "") {
  if (!ANY_MEDIA_RE.test(`/media/${name}`)) return false;
  const file = path.join(mediaDir(), name);
  if (!fs.existsSync(file)) return false;
  const size = fs.statSync(file).size;
  const headers = {
    "content-type": MIME[name.split(".").pop()],
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "accept-ranges": "bytes",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, "content-length": size });
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
