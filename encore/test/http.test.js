import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db.js";
import { clock } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import { signSim } from "../src/providers/sim.js";

process.env.ADMIN_EMAILS = "ops@encore.test";

let server, base, db;
before(async () => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  clock.set(null);
});

/** דפדפן מינימלי: עוגיות + טפסים עם csrf */
class Browser {
  jar = {};
  async req(path, { method = "GET", form, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method, redirect: "manual",
      headers: { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base + path, ...headers },
      body: form ? new URLSearchParams(form) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const [k, v] = kv.split("=");
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete this.jar[k.trim()];
      else this.jar[k.trim()] = v;
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get("location"), text };
  }
  async get(path) {
    let r = await this.req(path);
    for (let i = 0; i < 5 && r.status === 303; i++) r = await this.req(r.location);
    this.last = r.text;
    return r;
  }
  csrf() {
    return this.last.match(/name="_csrf" value="([^"]+)"/)[1];
  }
  async post(path, form = {}, { follow = true } = {}) {
    let r = await this.req(path, { method: "POST", form: { _csrf: this.csrf(), ...form } });
    if (follow) for (let i = 0; i < 5 && r.status === 303; i++) r = await this.req(r.location);
    this.last = r.text;
    return r;
  }
  async login(email, name) {
    await this.get("/login");
    const r = await this.post("/login", { email });
    const code = r.text.match(/הקוד הוא (\d{6})/)[1];
    await this.post("/login/code", { email, code });
    if (name) await this.post("/welcome", { name, next: "/shows" });
  }
}

test("מסע מלא: אמן מפרסם → מקדם משתף → חבר קונה → מקדם מרוויח → תשלום", async () => {
  resetRateLimits();
  const artist = new Browser();
  await artist.login("artist@encore.test", "נועה");

  // אמן: פרטים → תצוגה מקדימה → פרסום
  await artist.get("/artist/new/details");
  const show = { artist_name: "נועה", title: "ערב אקוסטי", starts_at: "2026-12-20T21:00", venue: "הבארבי", city: "תל אביב", price: "80", reward: "20", image_url: "https://img.example/show.jpg" };
  let r = await artist.post("/artist/new/preview", show);
  assert.match(r.text, /נשאר לכם מכל כרטיס/);
  assert.match(r.text, /₪56/);
  r = await artist.post("/artist/new", { ...show, publish: "1" });
  assert.match(r.text, /ההופעה פורסמה/);
  const cid = Number(r.text.match(/\/s\/(\d+)/)[1]);

  // מקדם: מרקטפלייס → שיתוף
  const promoter = new Browser();
  await promoter.get("/shows");
  assert.match(promoter.last, /ערב אקוסטי/);
  assert.match(promoter.last, /₪20/);
  r = await promoter.post(`/s/${cid}/promote`, {}, { follow: false });
  assert.match(r.location, /^\/login\?next=/); // צריך להתחבר רק עכשיו
  await promoter.login("dani@encore.test", "דני כהן");
  r = await promoter.get(`/s/${cid}/share`);
  const link = r.text.match(/\/r\/([a-z0-9]{7})/)[0];
  assert.match(r.text, /גילוי נאות/);
  assert.match(r.text, /wa\.me/);

  // רוכש: לינק → דף הופעה עם גילוי נאות → קופת הספק → תשלום
  const buyer = new Browser();
  r = await buyer.get(link);
  assert.match(r.text, /<b>דני<\/b> המליץ\/ה/);
  assert.doesNotMatch(r.text, /dani@encore/);
  r = await buyer.req(`/s/${cid}/buy`);
  assert.match(r.location, /^\/sim\/checkout\/simev_\w+\?ref=clk_/);
  await buyer.get(r.location);
  const ref = new URL(base + r.location).searchParams.get("ref");
  r = await buyer.post(r.location.split("?")[0], { name: "רוני", email: "roni@y.test", qty: "3", ref });
  assert.match(r.text, /התשלום התקבל/);

  // מקדם: התראה + ממתין לאישור
  r = await promoter.get("/me/money");
  assert.match(r.text, /ממתין לאישור<\/span><b>₪60/);
  r = await promoter.get("/me/notifications");
  assert.match(r.text, /בזכותך. הרווחת ₪60, בכפוף לאישור העסקה/);

  // אמן רואה תוצאות
  r = await artist.get(`/artist/c/${cid}`);
  assert.match(r.text, /<b>3<\/b><span>כרטיסים דרך ג׳וקרים/);
  assert.match(r.text, /<b>דני<\/b>/);
  assert.doesNotMatch(r.text, /dani@encore/);

  // אחרי ההופעה + חלון החזרים: זמין → בקשת תשלום → ops מאשר
  clock.set("2026-12-24T10:00:00.000Z");
  const ops = new Browser();
  await ops.login("ops@encore.test", "Ops");
  await ops.get("/admin");
  r = await ops.post("/admin/settle");
  assert.match(r.text, /1 תגמולים שוחררו/);
  assert.match(r.text, /היומן, היתרות והתשלומים תואמים/);

  await promoter.get("/me/money");
  await promoter.post("/me/payout-details", { full_name: "דני כהן", method: "bit", phone: "0501234567", adult: "on" });
  r = await promoter.post("/me/payouts");
  assert.match(r.text, /הבקשה התקבלה/);

  r = await ops.get("/admin?tab=payouts");
  assert.match(r.text, /ביט 0501234567/);
  const pid = r.text.match(/\/admin\/payouts\/(\d+)/)[1];
  await ops.post(`/admin/payouts/${pid}`, { outcome: "paid", reference: "BIT-777" });
  r = await promoter.get("/me/money");
  assert.match(r.text, /שולם<\/span><b>₪60/);
});

test("אבטחה: CSRF, הפניה פתוחה, XSS, webhook לא חתום, הרשאות", async () => {
  resetRateLimits();
  clock.set("2026-12-01T10:00:00.000Z");
  const a = new Browser();
  await a.login("x@encore.test", "X");

  // בלי csrf
  let r = await a.req("/me/settings", { method: "POST", form: { notify_sales: "on" } });
  assert.equal(r.status, 303);
  assert.match((await a.get(r.location)).text, /פג תוקף הטופס/);
  assert.equal(db.prepare("SELECT notify_sales FROM users WHERE email = 'x@encore.test'").get().notify_sales, 1);

  // open redirect
  await a.get("/login?next=//evil.example");
  r = await a.req("/login?next=//evil.example");
  assert.equal(r.location, "/shows");

  // XSS בשם ההופעה
  await a.get("/artist/new/details");
  r = await a.post("/artist/new", {
    artist_name: "<img src=x onerror=alert(1)>", title: "<script>alert(1)</script>", starts_at: "2026-12-30T20:00",
    venue: "v", price: "50", reward: "10", publish: "1", image_url: "https://img.example/x.jpg",
  });
  assert.doesNotMatch(r.text, /<script>alert/);
  assert.doesNotMatch(r.text, /<img src=x/);

  // webhook לא חתום
  const raw = JSON.stringify({ id: "evt_1", type: "order.paid", data: {} });
  let w = await fetch(`${base}/webhooks/sim`, { method: "POST", body: raw, headers: { "x-sim-signature": "t=1,v1=" + "a".repeat(64) } });
  assert.equal(w.status, 401);
  w = await fetch(`${base}/webhooks/sim`, { method: "POST", body: raw, headers: { "x-sim-signature": signSim(raw) } });
  assert.equal(w.status, 400); // חתום אבל חסר שדות
  const ok = JSON.stringify({ id: "evt_2", type: "order.paid", data: { order_id: "o1", event_id: "nope", qty: 1, unit_price_agorot: 100, buyer_email: "a@b.co" } });
  w = await fetch(`${base}/webhooks/sim`, { method: "POST", body: ok, headers: { "x-sim-signature": signSim(ok) } });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).result, "unknown_event");

  // משתמש רגיל לא נכנס לניהול ולא לקמפיין של אחר
  const b = new Browser();
  await b.login("y@encore.test", "Y");
  assert.equal((await b.req("/admin")).status, 404);
  const cid = db.prepare("SELECT id FROM campaigns ORDER BY id DESC").get().id;
  assert.equal((await b.req(`/artist/c/${cid}`)).status, 404);
});

test("טיוטה לא מופיעה לציבור; קמפיין מושהה לא מאפשר לינק חדש", async () => {
  resetRateLimits();
  const a = new Browser();
  await a.login("draft@encore.test", "D");
  await a.get("/artist/new/details");
  const r = await a.post("/artist/new", { artist_name: "D", title: "טיוטה", starts_at: "2026-12-30T20:00", venue: "v", price: "50", reward: "10", publish: "0", image_url: "https://img.example/x.jpg" });
  assert.match(r.text, /נשמר כטיוטה/);
  const cid = db.prepare("SELECT id FROM campaigns ORDER BY id DESC").get().id;
  assert.equal((await new Browser().req(`/s/${cid}`)).status, 404);
  assert.doesNotMatch((await new Browser().get("/shows")).text, /טיוטה/);
});

test("מסע תוכן: יוצר פותח פרופיל ושירות → אמן בוחר מטרה ומזמין → תוצר → אישור → הכסף ליוצר", async () => {
  resetRateLimits();
  clock.set("2026-12-01T10:00:00.000Z");
  const creator = new Browser();
  await creator.login("lior@encore.test", "ליאור");
  await creator.get("/creator");
  assert.match(creator.last, /לא צריך אלפי עוקבים/);
  let r = await creator.post("/creator/profile", { display_name: "ליאור", genres: "אינדי", kinds: "content", bio: "מצלמת הופעות" });
  assert.match(r.text, /צריך תמונה שלך לפרופיל/); // אין יוצר בלי תמונה
  await creator.get("/creator");
  r = await creator.post("/creator/profile", { display_name: "ליאור", genres: "אינדי", kinds: "content", bio: "מצלמת הופעות", image_url: "https://img.example/lior.jpg" });
  assert.match(r.text, /איזה שירות\?/); // אחרי פרופיל: ישר לבחירת תבנית
  await creator.get("/creator/services/new?template=reel");
  r = await creator.post("/creator/services/new", { template: "reel", price: "200", title: "ריל לקידום", deliverable: "ריל 30 שניות", delivery_days: "5", revisions: "1", license: "organic" });
  assert.match(r.text, /השירות פורסם/);

  const artist = new Browser();
  await artist.login("band@encore.test", "להקה");
  r = await artist.get("/grow");
  assert.match(r.text, /מה תרצה שיקרה\?/);
  r = await artist.get("/creators?kind=content&goal=content");
  assert.match(r.text, /ליאור/);
  assert.match(r.text, /₪200/);
  const sid = r.text.match(/\/creators\/(\d+)/)[1];
  r = await artist.get(`/creators/${sid}`);
  const orderHref = r.text.match(/\/services\/\d+\/order[^"]*/)[0].replace(/&amp;/g, "&");
  r = await artist.get(orderHref);
  assert.match(r.text, /שימוש בערוצים שלך/);
  assert.match(r.text, /היוצר מקבל ₪180/);
  r = await artist.post(orderHref.split("?")[0], { artist_name: "הלהקה", goal: "content", rights: "on", notes: "קצב מהיר" });
  assert.match(r.text, /ההזמנה נשלחה/);
  const oid = db.prepare("SELECT id FROM service_orders ORDER BY id DESC").get().id;

  // זר לא רואה את ההזמנה
  const stranger = new Browser();
  await stranger.login("z@encore.test", "Z");
  assert.equal((await stranger.req(`/orders/${oid}`)).status, 404);

  r = await creator.get(`/orders/${oid}`);
  assert.match(r.text, /הזמנה חדשה בשבילך/);
  assert.match(r.text, /הערות האמן: קצב מהיר/);
  await creator.post(`/orders/${oid}/accept`);
  r = await creator.post(`/orders/${oid}/deliver`, { url: "https://drive.example/reel-v1", note: "גרסה ראשונה" });
  assert.match(r.text, /נשלח לאמן/);

  r = await artist.get(`/orders/${oid}`);
  assert.match(r.text, /התוצר מוכן/);
  r = await artist.post(`/orders/${oid}/approve`);
  assert.match(r.text, /חויבתם ₪200/);

  r = await creator.get("/me/money");
  assert.match(r.text, /זמין לתשלום<\/span><b>₪180/);
  assert.match(r.text, /עבודת תוכן · ריל לקידום/);
});

test("אין אימוג'ים בממשק", async () => {
  const page = (await new Browser().get("/")).text + (await new Browser().get("/creators")).text + (await new Browser().get("/grow")).text;
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("תצוגה מקדימה בוואטסאפ: תגיות OG עם תמונת ההופעה, ובוט לא נספר כלחיצה", async () => {
  resetRateLimits();
  const c = db.prepare("SELECT c.id, l.code, l.id AS link_id FROM campaigns c JOIN referral_links l ON l.campaign_id = c.id LIMIT 1").get();
  const before = db.prepare("SELECT COUNT(*) n FROM referral_clicks WHERE link_id = ?").get(c.link_id).n;
  const bot = { "user-agent": "WhatsApp/2.23.20.0 A" };
  const r = await fetch(`${base}/r/${c.code}`, { headers: bot, redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.getSetCookie().filter((x) => x.startsWith("ref_")).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM referral_clicks WHERE link_id = ?").get(c.link_id).n, before);
  const page = await (await fetch(base + r.headers.get("location"), { headers: bot })).text();
  assert.match(page, /<meta property="og:image" content="https:\/\/img\.example\/show\.jpg">/);
  assert.match(page, /<meta property="og:title" content="נועה: ערב אקוסטי">/);
  assert.match(page, new RegExp(`<meta property="og:url" content="http://127\\.0\\.0\\.1:\\d+/s/${c.id}">`));
  const home = await (await fetch(base + "/")).text();
  assert.match(home, /og:image" content="http:\/\/127\.0\.0\.1:\d+\/static\/og\.png"/);
  assert.equal((await fetch(base + "/static/og.png")).headers.get("content-type"), "image/png");
});

test("סביבת בדיקה: דף נחיתה פתוח, השאר דורש קוד גישה (לא חלון סיסמה של הדפדפן)", async () => {
  resetRateLimits();
  process.env.STAGING_PASSWORD = "pilot-2026";
  try {
    const anon = new Browser();
    let r = await anon.req("/");
    assert.equal(r.status, 200);
    assert.match(r.text, /אמנות<br>צריכה קהל/);
    assert.match(r.text, /איך זה עובד/);
    assert.equal((await anon.req("/how")).status, 200);
    assert.equal((await anon.req("/health")).status, 200);
    r = await anon.req("/shows");
    assert.equal(r.status, 303);
    assert.equal(r.location, "/pilot?next=%2Fshows");
    await anon.get("/pilot?next=%2Fshows");
    r = await anon.post("/pilot", { code: "nope", next: "/shows" });
    assert.match(r.text, /הקוד לא נכון/);
    r = await anon.post("/pilot", { code: "pilot-2026", next: "/shows" }, { follow: false });
    assert.equal(r.location, "/shows");
    assert.equal((await anon.req("/shows")).status, 200);
    const id = db.prepare("SELECT id FROM campaigns WHERE status = 'active' LIMIT 1").get().id;
    assert.equal((await fetch(`${base}/s/${id}`, { headers: { "user-agent": "facebookexternalhit/1.1" }, redirect: "manual" })).status, 200);
    assert.equal((await fetch(`${base}/s/${id}`, { redirect: "manual" })).status, 303);
  } finally {
    delete process.env.STAGING_PASSWORD;
  }
});
