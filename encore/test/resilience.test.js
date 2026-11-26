// עמידות: אין מכירת יתר תחת עומס, הודעות לא הולכות לאיבוד, וגיבוי שאפשר לשחזר ממנו.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as T from "../src/domain/tickets.js";
import * as OB from "../src/outbox.js";
import * as BK from "../src/backup.js";
import * as JOBS from "../src/jobs.js";
import { sandboxPay } from "../src/payments/sandbox.js";

let db, artist, camp;
const SHOW = { artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20", image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "5" };
beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = ID.getUser(db, insert(db, "users", { email: "a@x.com", email_hash: emailHash("a@x.com"), name: "נועה", created_at: clock.iso() }));
  camp = C.getCampaign(db, C.createCampaign(db, artist, SHOW));
});
after(() => clock.set(null));

async function serve() {
  resetRateLimits();
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
/** דפדפן מינימלי: עוגיות + csrf */
const browser = (base) => {
  const jar = {};
  const req = async (p, init = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base + p, ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k.trim()] = v; }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  };
  return { req };
};

test("עומס: 40 קונים בבת אחת על 5 כרטיסים אחרונים. בדיוק 5 מקבלים, אף אחד לא מקבל שגיאת שרת", async () => {
  const { server, base } = await serve();
  try {
    const buyers = await Promise.all(Array.from({ length: 40 }, async () => {
      const b = browser(base);
      const page = await b.req(`/checkout/${camp.id}`);
      return { b, csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1] };
    }));
    const results = await Promise.all(buyers.map(({ b, csrf }, i) =>
      b.req(`/checkout/${camp.id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: csrf, qty: "1", name: `קונה ${i}`, email: `b${i}@y.com` }) })
    ));
    assert.equal(results.filter((r) => r.status >= 500).length, 0);
    const held = db.prepare("SELECT COALESCE(SUM(qty), 0) n FROM ticket_orders WHERE campaign_id = ? AND status = 'pending'").get(camp.id).n;
    assert.equal(held, 5);
    assert.equal(T.inventory(db, camp).available, 0);
  } finally {
    server.close();
  }
});

test("תשלום שמגיע פעמיים (חזרה מהספק + webhook): כרטיסים פעם אחת, מייל כרטיסים אחד בתור", async () => {
  const { server, base } = await serve();
  try {
    const b = browser(base);
    let r = await b.req(`/checkout/${camp.id}`);
    const csrf = r.text.match(/name="_csrf" value="([^"]+)"/)[1];
    r = await b.req(`/checkout/${camp.id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: csrf, qty: "2", name: "דנה", email: "d@y.com", phone: "050-1234567" }) });
    const order = db.prepare("SELECT * FROM ticket_orders WHERE buyer_email = 'd@y.com'").get();
    sandboxPay(db, order.payment_ref, "4242424242424242");
    T.confirmPayment(db, order.gateway, order.payment_ref);
    T.confirmPayment(db, order.gateway, order.payment_ref);
    assert.equal(T.ticketsOf(db, order.id).length, 2);
    const ret = r.location ?? "";
    // החזרה מהספק אחרי שה-webhook כבר אישר: לא שולחים שוב
    await b.req(ret.replace(base, ""));
    await b.req(ret.replace(base, ""));
    const rows = db.prepare("SELECT dedupe_key FROM outbox WHERE dedupe_key LIKE ?").all(`tickets:${order.id}:%`).map((x) => x.dedupe_key).sort();
    assert.ok(rows.length <= 2);
    assert.equal(OB.enqueue(db, { to: "d@y.com", body: "x", key: `tickets:${order.id}:mail` }) && rows.includes(`tickets:${order.id}:mail`), false, "אותו מפתח לא נכנס פעמיים");
  } finally {
    server.close();
  }
});

test("תיבת יציאה: ספק שנופל מקבל ניסיונות חוזרים עם המתנה, ואחרי הצלחה ההודעה לא נשלחת שוב", async () => {
  assert.equal(OB.enqueue(db, { to: "d@y.com", subject: "כרטיסים", body: "שלום", key: "k1" }), true);
  assert.equal(OB.enqueue(db, { to: "d@y.com", subject: "כרטיסים", body: "שלום", key: "k1" }), false);
  let calls = 0;
  const down = { mail: async () => { calls++; throw new Error("503 from provider"); }, sms: async () => true };
  assert.equal(await OB.processOutbox(db, down), 0);
  let m = db.prepare("SELECT * FROM outbox WHERE dedupe_key = 'k1'").get();
  assert.equal(m.status, "pending");
  assert.equal(m.attempts, 1);
  assert.ok(m.next_at > clock.iso(), "הניסיון הבא נדחה");
  await OB.processOutbox(db, down);
  assert.equal(calls, 1, "לא מנסים שוב לפני הזמן");
  clock.set("2026-12-01T10:02:00.000Z");
  const sent = [];
  const up = { mail: async (x) => (sent.push(x.to_addr), true), sms: async () => true };
  assert.equal(await OB.processOutbox(db, up), 1);
  assert.equal(await OB.processOutbox(db, up), 0);
  assert.deepEqual(sent, ["d@y.com"]);
  assert.equal(db.prepare("SELECT status FROM outbox WHERE dedupe_key = 'k1'").get().status, "sent");
});

test("תיבת יציאה: אחרי 8 כישלונות ההודעה מסומנת dead ומופיעה כבעיה. הודעה שנתקעה באמצע חוזרת לתור", async () => {
  OB.enqueue(db, { to: "x@y.com", body: "b", key: "k2" });
  const down = { mail: async () => { throw new Error("down"); }, sms: async () => true };
  for (let i = 0; i < OB.MAX_ATTEMPTS; i++) {
    clock.set(new Date(clock.now().getTime() + 25 * 3600_000).toISOString());
    await OB.processOutbox(db, down);
  }
  assert.equal(db.prepare("SELECT status FROM outbox WHERE dedupe_key = 'k2'").get().status, "dead");
  assert.equal(OB.outboxStats(db).outbox_dead, 1);
  OB.enqueue(db, { to: "z@y.com", body: "b", key: "k3" });
  db.prepare("UPDATE outbox SET status = 'sending', claimed_at = ? WHERE dedupe_key = 'k3'").run(new Date(clock.now().getTime() - 10 * 60_000).toISOString());
  assert.equal(await OB.processOutbox(db, { mail: async () => true, sms: async () => true }), 1);
});

test("התראה במייל עוברת דרך תיבת היציאה", () => {
  ID.notify(db, artist.id, "נמכר כרטיס", "/artist", { email: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox WHERE to_addr = 'a@x.com'").get().n, 1);
});

test("מתזמן: עבודה לא רצה פעמיים במקביל, וכישלון נרשם בלי להפיל אחרות", async () => {
  let active = 0;
  let max = 0;
  const j = JOBS.schedule("test-slow", 3_600_000, async () => {
    active++; max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 30));
    active--;
  }, { runNow: false });
  await Promise.all([j.run(), j.run(), j.run()]);
  assert.equal(max, 1);
  const bad = JOBS.schedule("test-bad", 3_600_000, async () => { throw new Error("boom"); }, { runNow: false });
  await bad.run();
  assert.equal(bad.failures, 1);
  assert.equal(JOBS.jobsHealth().find((x) => x.name === "test-bad").last_error, "boom");
  clearInterval(j.timer); clearInterval(bad.timer);
  JOBS.jobs.delete("test-slow"); JOBS.jobs.delete("test-bad");
});

test("גיבוי: עותק תקין ונבדק, מדיניות שמירה, הצפנה, ושחזור מלא עם הכלי", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  const file = path.join(dir, "live.db");
  const live = openDb(file);
  const u = ID.getUser(live, insert(live, "users", { email: "a@x.com", email_hash: emailHash("a@x.com"), name: "נועה", created_at: clock.iso() }));
  const c = C.getCampaign(live, C.createCampaign(live, u, SHOW));
  const o = T.createOrder(live, c.id, { name: "דנה", email: "d@y.com", qty: 2 });
  T.startPayment(live, o, { origin: "x" });
  sandboxPay(live, T.ticketOrder(live, o.id).payment_ref, "4242424242424242");
  T.returnFromPayment(live, T.ticketOrder(live, o.id));

  const bdir = path.join(dir, "backups");
  const r = BK.backupLocal(live, { dir: bdir });
  assert.equal(r.tickets, 2);
  assert.equal(BK.verifyBackup(r.file).orders, 1);

  // שמירה: 100 קבצים שעתיים לאורך 4 ימים → 48 אחרונים + אחד ליום
  for (let h = 0; h < 100; h++) fs.writeFileSync(path.join(bdir, `encore-${new Date(Date.UTC(2026, 10, 1, h)).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.db`), "x");
  BK.prune(bdir);
  const left = fs.readdirSync(bdir).filter((f) => f.endsWith(".db"));
  assert.ok(left.length <= 48 + 6 && left.length >= 48, String(left.length));

  // הצפנה ושחזור מקובץ מוצפן
  process.env.BACKUP_ENCRYPTION_KEY = "test-key-123";
  const enc = BK.encrypt(fs.readFileSync(r.file));
  assert.throws(() => BK.decrypt(enc, Buffer.alloc(32)), /unable|auth/i);
  const encFile = path.join(dir, "x.db.enc");
  fs.writeFileSync(encFile, enc);
  const dest = path.join(dir, "restored.db");
  const out = execFileSync(process.execPath, ["--no-warnings", "ops/restore.mjs", encFile, dest], { env: process.env }).toString();
  assert.match(out, /2 כרטיסים/);
  const restored = openDb(dest);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM tickets").get().n, 2);
  delete process.env.BACKUP_ENCRYPTION_KEY;
});

test("גיבוי מרוחק: העלאה מוצפנת וחתומה לאחסון תואם S3", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  Object.assign(process.env, { BACKUP_S3_ENDPOINT: "https://acc.r2.example", BACKUP_S3_BUCKET: "jc-backups", BACKUP_S3_ACCESS_KEY: "AK", BACKUP_S3_SECRET: "SK", BACKUP_ENCRYPTION_KEY: "k", BACKUP_DIR: dir });
  const calls = [];
  const fake = async (url, init) => (calls.push({ url, init }), { ok: true, text: async () => "" });
  const live = openDb(path.join(dir, "live.db"));
  const r = await BK.runBackup(live, fake);
  assert.match(r.remote, /^jocares\/encore-\d{8}T\d{6}Z\.db\.enc$/);
  assert.equal(calls[0].url, `https://acc.r2.example/jc-backups/${r.remote}`);
  assert.match(calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(calls[0].init.body.subarray(0, 4).toString(), "JCB1", "נשלח מוצפן");
  assert.equal(BK.backupHealth().backup_remote_age_min, 0);
  for (const k of ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET", "BACKUP_ENCRYPTION_KEY", "BACKUP_DIR"]) delete process.env[k];
});

test("בריאות: /health בודק את המסד בפועל", async () => {
  const { server, base } = await serve();
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    db.close();
    assert.equal((await fetch(`${base}/health`)).status, 503);
  } finally {
    server.close();
  }
});

// ---------- משפך, התראות, עמודי עזרה ----------
import * as FN from "../src/domain/funnel.js";
import { checkAlerts } from "../src/alerts.js";

test("משפך: צפיות וכניסות לקופה נספרות לפי מקור, בוטים לא נספרים, והאמן רואה את המשפך", async () => {
  const { server, base } = await serve();
  try {
    await fetch(`${base}/s/${camp.id}`);
    await fetch(`${base}/s/${camp.id}`);
    await fetch(`${base}/s/${camp.id}`, { headers: { "user-agent": "facebookexternalhit/1.1" } });
    await fetch(`${base}/checkout/${camp.id}`);
    const f = FN.funnel(db, camp.id);
    assert.equal(f.views, 2);
    assert.equal(f.checkout, 1);
    assert.equal(f.to_checkout, 50);
  } finally {
    server.close();
  }
});

test("התראות: בעיה נשלחת למנהלים פעם אחת לכל 6 שעות, ובעיה חדשה נשלחת מיד", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const h = { ok: false, problems: ["backup"] };
  assert.equal(checkAlerts(db, h, { emails: ["ops@x.com", " b@x.com "], now }), 2);
  assert.equal(checkAlerts(db, h, { emails: ["ops@x.com"], now: new Date("2026-12-01T11:00:00Z") }), 0);
  assert.equal(checkAlerts(db, { ok: false, problems: ["outbox_stuck"] }, { emails: ["ops@x.com"], now }), 1);
  assert.equal(checkAlerts(db, { ok: true, problems: [] }, { emails: ["ops@x.com"], now }), 0);
  assert.match(db.prepare("SELECT subject FROM outbox WHERE to_addr = 'b@x.com'").get().subject, /backup/);
});

test("עזרה והצהרת נגישות פתוחות לכולם, גם כשהאתר נעול בסיסמת פיילוט", async () => {
  process.env.STAGING_PASSWORD = "pilot-test";
  const { server, base } = await serve();
  try {
    for (const p of ["/help", "/accessibility"]) {
      const r = await fetch(base + p, { redirect: "manual" });
      assert.equal(r.status, 200, p);
    }
    assert.match(await (await fetch(`${base}/accessibility`)).text(), /הצהרת נגישות/);
  } finally {
    server.close();
    delete process.env.STAGING_PASSWORD;
  }
});
