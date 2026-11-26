// בדיקת עומס: שרת אמיתי עם נתוני דוגמה, הרבה משתמשים במקביל.
// שימוש: node ops/load.mjs [משתמשים במקביל=50] [שניות=15]
// מודד: עמוד הופעה, עמוד קופה, יצירת הזמנה (כתיבה למסד), וסריקה בדלת. מדווח בקשות לשנייה, זמני תגובה ושגיאות.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const users = Number(process.argv[2] ?? 50);
const seconds = Number(process.argv[3] ?? 15);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-"));
const env = { ...process.env, ENCORE_DB: path.join(dir, "encore.db"), ENCORE_MEDIA_DIR: path.join(dir, "media"), PORT: "3999", NODE_ENV: "development", STAGING_PASSWORD: "", TRUST_PROXY: "1" };
const node = (args, opts = {}) => spawn(process.execPath, ["--no-warnings", ...args], { env, ...opts });
await new Promise((res, rej) => node(["src/seed.js"], { stdio: "ignore" }).on("exit", (c) => (c ? rej(new Error("seed")) : res())));
const server = node(["src/server.js"], { stdio: ["ignore", "ignore", "inherit"] });
const base = "http://127.0.0.1:3999";
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

const home = await (await fetch(`${base}/shows`)).text();
const showIds = [...new Set([...home.matchAll(/\/s\/(\d+)/g)].map((m) => m[1]))];
const stats = {};
const hit = async (name, fn) => {
  const s = (stats[name] ??= { n: 0, err: 0, ms: [] });
  const t0 = performance.now();
  try {
    const r = await fn();
    if (r.status >= 500) s.err++;
  } catch { s.err++; }
  s.n++; s.ms.push(performance.now() - t0);
};
const end = Date.now() + seconds * 1000;
let seq = 0;
// כל "משתמש" מגיע מכתובת אחרת, כמו במציאות (המגבלה לכל כתובת לא חוסמת את הבדיקה)
async function worker(_, w) {
  const ip = `10.9.${w >> 8}.${w & 255}`;
  const fetch = (url, init = {}) => globalThis.fetch(url, { ...init, headers: { "x-forwarded-for": ip, ...(init.headers ?? {}) } });
  while (Date.now() < end) {
    const id = showIds[seq++ % showIds.length];
    const k = seq % 10;
    if (k < 6) await hit("עמוד הופעה", () => fetch(`${base}/s/${id}`).then(async (r) => (await r.arrayBuffer(), r)));
    else if (k < 8) await hit("עמוד קופה", () => fetch(`${base}/checkout/${id}`).then(async (r) => (await r.arrayBuffer(), r)));
    else {
      // יצירת הזמנה: כתיבה למסד, החזקת מלאי
      const page = await fetch(`${base}/checkout/${id}`);
      const cookie = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
      await hit("יצירת הזמנה", () => fetch(`${base}/checkout/${id}`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded", referer: `${base}/checkout/${id}` }, body: new URLSearchParams({ _csrf: csrf ?? "", qty: "1", name: "בדיקת עומס", email: `load${seq}@y.com` }) }).then(async (r) => (await r.arrayBuffer(), r)));
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: users }, (_, w) => worker(_, w)));
const elapsed = (Date.now() - t0) / 1000;
server.kill("SIGTERM");
await new Promise((r) => server.on("exit", r));
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(env.ENCORE_DB, { readOnly: true });
const orders = db.prepare("SELECT COUNT(*) n FROM ticket_orders WHERE buyer_name = 'בדיקת עומס'").get().n;
// כמו חישוב המלאי בקוד: נמכרו (פחות הוחזרו) + מוחזקים כרגע, מול הקיבולת
const oversold = db.prepare(`SELECT COUNT(*) n FROM (SELECT o.campaign_id,
    SUM(CASE WHEN o.status = 'paid' THEN o.qty - o.refunded_qty WHEN o.status = 'pending' AND o.expires_at > ? THEN o.qty ELSE 0 END) q, e.capacity cap
  FROM ticket_orders o JOIN campaigns c ON c.id = o.campaign_id JOIN events e ON e.id = c.event_id GROUP BY o.campaign_id HAVING q > cap)`).get(new Date().toISOString()).n;
db.close();
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]?.toFixed(0);
let total = 0;
console.log(`\n${users} משתמשים במקביל, ${elapsed.toFixed(0)} שניות\n`);
for (const [name, s] of Object.entries(stats)) {
  total += s.n;
  console.log(`${name.padEnd(14)} ${String(s.n).padStart(6)} בקשות · p50 ${pct(s.ms, 0.5)}ms · p95 ${pct(s.ms, 0.95)}ms · p99 ${pct(s.ms, 0.99)}ms · שגיאות ${s.err}`);
}
console.log(`\nסה״כ ${total} בקשות, ${(total / elapsed).toFixed(0)} בקשות לשנייה`);
console.log(`הזמנות שנוצרו במסד: ${orders} · הופעות עם מכירת יתר: ${oversold}`);
fs.rmSync(dir, { recursive: true, force: true });
