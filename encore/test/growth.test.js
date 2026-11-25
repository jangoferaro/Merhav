import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as R from "../src/domain/referrals.js";
import * as T from "../src/domain/tickets.js";
import { sandboxPay } from "../src/payments/sandbox.js";

let db, artist, dani, camp;
const user = (email, name) => ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, created_at: clock.iso() }));
const SHOW = {
  artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
  image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "100",
};
const pay = (o) => {
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  return T.returnFromPayment(db, T.ticketOrder(db, o.id));
};

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני כהן");
});
after(() => clock.set(null));

test("מחיר מוקדם: חל עד הכמות שנקבעה, ואז חוזר למחיר הרגיל", () => {
  camp = C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, early_price: "60", early_qty: "3" }));
  assert.deepEqual(T.priceNow(db, camp), { price: 6000, early: true, left: 3, until: null });
  const a = pay(T.createOrder(db, camp.id, { name: "א", email: "a@y.com", qty: 2 }));
  assert.equal(a.unit_price_agorot, 6000);
  assert.equal(a.total_agorot, 12000);
  assert.equal(T.priceNow(db, camp).left, 1);
  pay(T.createOrder(db, camp.id, { name: "ב", email: "b@y.com", qty: 1 }));
  assert.equal(T.priceNow(db, camp).early, false);
  assert.equal(T.createOrder(db, camp.id, { name: "ג", email: "c@y.com", qty: 1 }).unit_price_agorot, 8000);
});

test("מחיר מוקדם: נגמר בתאריך, ואי אפשר לקבוע מחיר שלא משאיר לאמן כלום", () => {
  camp = C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, early_price: "60", early_until: "2026-12-05T23:59" }));
  assert.equal(T.priceNow(db, camp).early, true);
  clock.set("2026-12-06T10:00:00.000Z");
  assert.equal(T.priceNow(db, camp).price, 8000);
  assert.throws(() => C.createCampaign(db, artist, { ...SHOW, early_price: "90", early_qty: "5" }), /נמוך מהמחיר הרגיל/);
  assert.throws(() => C.createCampaign(db, artist, { ...SHOW, early_price: "20", early_qty: "5" }), /התגמול לג׳וקר גבוה מדי/);
  assert.throws(() => C.createCampaign(db, artist, { ...SHOW, early_price: "60" }), /תאריך סיום, מספר כרטיסים/);
  T.setEarlyPrice(db, artist, camp, {});
  assert.equal(C.getCampaign(db, camp.id).early_price_agorot, null);
});

test("משפט אישי של ג׳וקר: נשמר, מוגבל באורך, ורק לבעל הלינק", () => {
  camp = C.getCampaign(db, C.createCampaign(db, artist, SHOW));
  const link = R.getOrCreateLink(db, dani, camp.id);
  R.setNote(db, dani, link.id, "  הייתי   בהופעה הקודמת. בואו!  ");
  assert.equal(R.getLinkByCode(db, link.code).note, "הייתי בהופעה הקודמת. בואו!");
  R.setNote(db, artist, link.id, "פריצה");
  assert.equal(R.getLinkByCode(db, link.code).note, "הייתי בהופעה הקודמת. בואו!");
  assert.throws(() => R.setNote(db, dani, link.id, "א".repeat(141)), /עד 140/);
});

class Browser {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(path, { method = "GET", form, headers = {} } = {}) {
    const res = await fetch(this.base + path, {
      method, redirect: "manual",
      headers: { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: this.base + path, ...headers },
      body: form ? new URLSearchParams(form) : undefined,
    });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); this.jar[k.trim()] = v; }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  async get(path, headers) { let r = await this.req(path, { headers }); for (let i = 0; i < 6 && r.status === 303; i++) r = await this.req(r.location, { headers }); this.last = r.text; return r; }
  async post(path, form = {}) {
    let r = await this.req(path, { method: "POST", form: { _csrf: this.last.match(/name="_csrf" value="([^"]+)"/)[1], ...form } });
    for (let i = 0; i < 6 && r.status === 303; i++) r = await this.req(r.location);
    this.last = r.text; return r;
  }
  async login(email, name) {
    await this.get("/login");
    const r = await this.post("/login", { email });
    await this.post("/login/code", { email, code: r.text.match(/הקוד הוא (\d{6})/)[1] });
    if (name) await this.post("/welcome", { name, next: "/shows" });
  }
}

test("HTTP: הזמנה אישית של ג׳וקר, בואו איתי אחרי קנייה, ערכת שיתוף", async () => {
  resetRateLimits();
  camp = C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, early_price: "60", early_qty: "50" }));
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ג׳וקר כותב משפט אישי
    const j = new Browser(base);
    await j.login("yael@x.com", "יעל לוי");
    await j.get(`/s/${camp.id}`);
    await j.post(`/s/${camp.id}/promote`);
    assert.match(j.last, /data-story/);
    let r = await j.post(`/s/${camp.id}/share/note`, { note: "הייתי בהופעה הקודמת, מטורף" });
    assert.match(r.text, /נשמר/);
    const refPath = r.text.match(/\/r\/[\w-]+/)[0];
    r = await j.req(`/s/${camp.id}/share/qr.svg`);
    assert.match(r.text, /^<svg/);

    // וואטסאפ מציג "יעל מזמינה אותך"
    const bot = { "user-agent": "WhatsApp/2.23" };
    r = await new Browser(base).get(refPath, bot);
    assert.match(r.text, /og:title" content="יעל מזמין\/ה אותך: נועה · ערב"/);

    // חבר נכנס: רואה את ההזמנה האישית ואת המחיר המוקדם
    const friend = new Browser(base);
    r = await friend.get(refPath);
    assert.match(r.text, /<b>יעל<\/b> מזמין\/ה אותך/);
    assert.match(r.text, /הייתי בהופעה הקודמת, מטורף/);
    assert.match(r.text, /מחיר מוקדם/);
    r = await friend.get(`/s/${camp.id}/buy`);
    r = await friend.post(`/checkout/${camp.id}`, { qty: "1", name: "רוני לוי", email: "roni@z.com" });
    r = await friend.post(r.text.match(/action="(\/pay\/sandbox\/[\w-]+)"/)[1], { card: "4242424242424242" });
    assert.match(r.text, /בואו איתי/);
    const invitePath = r.text.match(/\/i\/[\w-]+/)[0];

    // חבר של החבר: רואה "רוני כבר קנה", קונה, ורוני רואה שהביא חבר
    const third = new Browser(base);
    r = await third.get(invitePath);
    assert.match(r.text, /<b>רוני<\/b> כבר קנה\/תה כרטיס/);
    r = await new Browser(base).get(invitePath, bot);
    assert.match(r.text, /og:title" content="רוני מזמין\/ה אותך/);
    await third.get(`/checkout/${camp.id}`);
    r = await third.post(`/checkout/${camp.id}`, { qty: "2", name: "שי", email: "shai@z.com" });
    await third.post(r.text.match(/action="(\/pay\/sandbox\/[\w-]+)"/)[1], { card: "4242424242424242" });
    const roni = db.prepare("SELECT * FROM ticket_orders WHERE buyer_email = 'roni@z.com'").get();
    assert.equal(T.invitedCount(db, roni.id), 2);
    r = await friend.get(`/tickets/${roni.token}`);
    assert.match(r.text, /2 חברים כבר קנו/);
    // ההזמנה של חבר לא נותנת תגמול לאף אחד
    assert.equal(db.prepare("SELECT attribution FROM orders WHERE external_order_id = ?").get(String(db.prepare("SELECT id FROM ticket_orders WHERE buyer_email = 'shai@z.com'").get().id)).attribution, "direct");

    // אמן מעלה תמונה לערכה, והג׳וקר רואה אותה
    const a = new Browser(base);
    await a.login("artist@x.com");
    await a.get(`/artist/c/${camp.id}`);
    assert.match(a.last, /ערכת שיתוף לג׳וקרים/);
    assert.match(a.last, /מחיר מוקדם/);
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
    const fd = new FormData();
    fd.set("_csrf", a.last.match(/name="_csrf" value="([^"]+)"/)[1]);
    fd.set("media", new Blob([png], { type: "image/png" }), "x.png");
    const up = await fetch(`${base}/artist/c/${camp.id}/assets`, { method: "POST", body: fd, redirect: "manual", headers: { cookie: Object.entries(a.jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base } });
    assert.equal(up.status, 303);
    assert.equal(R.assetsOf(db, camp.id).length, 1);
    r = await j.get(`/s/${camp.id}/share`);
    assert.match(r.text, /חומרים מהאמן/);
  } finally {
    server.close();
  }
});
