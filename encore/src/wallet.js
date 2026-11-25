// כרטיסים ב-Wallet: Apple Wallet (קובץ pkpass חתום) ו-Google Wallet (קישור "שמירה" עם JWT חתום).
//
// הגדרה ב-Railway (בלי המשתנים הכפתורים לא מוצגים):
//  Apple  — APPLE_PASS_TYPE_ID (למשל pass.com.jocares.ticket), APPLE_PASS_TEAM_ID,
//           APPLE_PASS_CERT ו-APPLE_PASS_KEY (PEM של תעודת ה-Pass Type ID ושל המפתח),
//           APPLE_WWDR_CERT (תעודת הביניים של Apple, PEM), ואם למפתח יש סיסמה: APPLE_PASS_KEY_PASSWORD.
//  Google — GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_EMAIL ו-GOOGLE_WALLET_SA_KEY
//           (חשבון שירות עם הרשאה ל-Google Wallet API, והמפתח הפרטי שלו ב-PEM).
//
// מגבלה ידועה: עדכון כרטיס שכבר נשמר ב-Wallet (למשל אחרי החזר) דורש שירות עדכונים של כל ספק,
// שעוד לא נבנה. הכניסה בדלת בודקת תמיד מול המערכת, ולכן כרטיס שהוחזר לא ייכנס גם אם הוא עדיין ב-Wallet.
import crypto from "node:crypto";
import forge from "node-forge";
import { encodePng } from "./demo-images.js";

const pem = (k) => (process.env[k] || "").replace(/\\n/g, "\n");
const APPLE_KEYS = ["APPLE_PASS_TYPE_ID", "APPLE_PASS_TEAM_ID", "APPLE_PASS_CERT", "APPLE_PASS_KEY", "APPLE_WWDR_CERT"];
const GOOGLE_KEYS = ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SA_EMAIL", "GOOGLE_WALLET_SA_KEY"];

export const walletEnabled = () => ({
  apple: APPLE_KEYS.every((k) => process.env[k]),
  google: GOOGLE_KEYS.every((k) => process.env[k]),
});
export const walletMissing = () => ({
  apple: APPLE_KEYS.filter((k) => !process.env[k]),
  google: GOOGLE_KEYS.filter((k) => !process.env[k]),
});

const fmtCode = (code) => `${code.slice(0, 5)} ${code.slice(5)}`;
const absolute = (u, origin) => (/^https:\/\//.test(u) ? u : u?.startsWith("/") ? `${origin}${u}` : null);

// ---------- Apple Wallet ----------

/** zip בלי דחיסה (STORE): מספיק ל-pkpass ולא דורש ספריה */
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, n, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** אייקון של המותג: ריבוע חומצה עם עיגול דיו (Apple דורש icon.png) */
function brandIcon(size) {
  const rgb = Buffer.alloc(size * size * 3);
  const r = size * 0.28;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 3;
    const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < r * r;
    rgb[i] = inside ? 0x15 : 0xdf; rgb[i + 1] = inside ? 0x15 : 0xff; rgb[i + 2] = inside ? 0x15 : 0x45;
  }
  return encodePng(size, size, rgb);
}

export function passJson(c, t, { holder = "", named = false, url = "" }) {
  const end = new Date(new Date(c.starts_at).getTime() + 12 * 3600_000).toISOString();
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier: process.env.APPLE_PASS_TEAM_ID,
    serialNumber: t.code,
    organizationName: "JoCares",
    description: `כרטיס: ${c.artist_name} · ${c.title}`,
    logoText: "JoCares",
    foregroundColor: "rgb(21, 21, 21)",
    backgroundColor: "rgb(223, 255, 69)",
    labelColor: "rgb(21, 21, 21)",
    relevantDate: c.starts_at,
    expirationDate: end,
    eventTicket: {
      primaryFields: [{ key: "event", label: c.artist_name, value: c.title }],
      secondaryFields: [
        { key: "date", label: "מתי", value: c.starts_at, dateStyle: "PKDateStyleMedium", timeStyle: "PKDateStyleShort" },
        { key: "venue", label: "איפה", value: [c.venue, c.city].filter(Boolean).join(", ") },
      ],
      auxiliaryFields: holder ? [{ key: "holder", label: named ? "על שם" : "הוזמן על ידי", value: holder }] : [],
      backFields: [
        { key: "code", label: "קוד הכרטיס", value: fmtCode(t.code) },
        { key: "rules", label: "בכניסה", value: named ? `כרטיס שמי. מציגים את הקוד ותעודה מזהה על שם ${holder}. אי אפשר להעביר.` : "מציגים את הקוד. כל כרטיס נסרק פעם אחת." },
        ...(url ? [{ key: "link", label: "הכרטיסים שלך", value: url }] : []),
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: t.code, messageEncoding: "iso-8859-1", altText: fmtCode(t.code) }],
    barcode: { format: "PKBarcodeFormatQR", message: t.code, messageEncoding: "iso-8859-1", altText: fmtCode(t.code) },
  };
}

/** חתימת PKCS#7 מנותקת על manifest.json, עם תעודת הכרטיס ותעודת הביניים של Apple */
function signManifest(manifest) {
  const cert = forge.pki.certificateFromPem(pem("APPLE_PASS_CERT"));
  const keyPem = pem("APPLE_PASS_KEY");
  const key = process.env.APPLE_PASS_KEY_PASSWORD ? forge.pki.decryptRsaPrivateKey(keyPem, process.env.APPLE_PASS_KEY_PASSWORD) : forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString("binary"));
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(pem("APPLE_WWDR_CERT")));
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

export function applePass(c, t, opts) {
  const files = {
    "pass.json": Buffer.from(JSON.stringify(passJson(c, t, opts))),
    "icon.png": brandIcon(29),
    "icon@2x.png": brandIcon(58),
    "icon@3x.png": brandIcon(87),
  };
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, d]) => [n, crypto.createHash("sha1").update(d).digest("hex")]))));
  return zipStore({ ...files, "manifest.json": manifest, signature: signManifest(manifest) });
}

// ---------- Google Wallet ----------

export function googleSaveUrl(c, t, { holder = "", origin = "" }) {
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID;
  const he = (value) => ({ defaultValue: { language: "he", value } });
  const classId = `${issuer}.jocares_show_${c.id}`;
  const hero = absolute(c.image_url, origin);
  const payload = {
    iss: process.env.GOOGLE_WALLET_SA_EMAIL,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: origin ? [origin] : [],
    payload: {
      eventTicketClasses: [{
        id: classId, issuerName: "JoCares", reviewStatus: "UNDER_REVIEW",
        eventName: he(`${c.artist_name} · ${c.title}`),
        venue: { name: he(c.venue), address: he([c.venue, c.city].filter(Boolean).join(", ")) },
        dateTime: { start: c.starts_at },
        hexBackgroundColor: "#151515",
      }],
      eventTicketObjects: [{
        id: `${issuer}.jocares_ticket_${t.code}`, classId, state: "ACTIVE",
        barcode: { type: "QR_CODE", value: t.code, alternateText: fmtCode(t.code) },
        ...(holder ? { ticketHolderName: holder } : {}),
        ticketNumber: fmtCode(t.code),
        ...(hero ? { heroImage: { sourceUri: { uri: hero } } } : {}),
      }],
    },
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), pem("GOOGLE_WALLET_SA_KEY")).toString("base64url");
  return `https://pay.google.com/gp/v/save/${unsigned}.${sig}`;
}
