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
import * as M from "../src/domain/money.js";
import * as T from "../src/domain/tickets.js";
import { sandboxPay } from "../src/payments/sandbox.js";

let db, artist, dani, camp;
const user = (email, name, is_admin = 0) =>
  ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, is_admin, created_at: clock.iso() }));
const SHOW = {
  artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
  image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "5",
};

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני");
  camp = C.getCampaign(db, C.createCampaign(db, artist, SHOW));
});
after(() => clock.set(null));

/** קנייה מלאה דרך הדומיין: הזמנה → עמוד תשלום → אישור */
function buy(qty, { email = "friend@y.com", clickToken = null, card = "4242424242424242" } = {}) {
  const o = T.createOrder(db, camp.id, { name: "חבר", email, qty, consent: "on" }, { clickToken });
  T.startPayment(db, o, { origin: "https://j.example" });
  const ref = T.ticketOrder(db, o.id).payment_ref;
  sandboxPay(db, ref, card);
  return T.returnFromPayment(db, T.ticketOrder(db, o.id));
}

test("קנייה דרך ג׳וקר: כרטיסים עם קוד, תגמול לג׳וקר, והקונה נרשם לעדכונים", () => {
  assert.equal(camp.provider, "jocares");
  assert.equal(camp.capacity, 5);
  const link = R.getOrCreateLink(db, dani, camp.id);
  const click = R.recordClick(db, link, "v1");
  const o = buy(2, { clickToken: click.token });
  assert.equal(o.status, "paid");
  const tickets = T.ticketsOf(db, o.id);
  assert.equal(tickets.length, 2);
  assert.match(tickets[0].code, /^[A-Z2-9]{10}$/);
  assert.equal(M.balances(db, dani.id).pending, 4000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE artist_id = ?").get(camp.artist_id).n, 1);
  assert.deepEqual(T.inventory(db, camp), { capacity: 5, sold: 2, held: 0, available: 3 });
  assert.match(T.qrSvg(tickets[0].code), /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  // אותו אישור שוב לא יוצר כרטיסים או תגמול נוסף
  T.confirmPayment(db, "sandbox", o.payment_ref);
  assert.equal(T.ticketsOf(db, o.id).length, 2);
  assert.equal(M.balances(db, dani.id).pending, 4000);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("מלאי: שמירה בזמן תשלום, אין מכירת יתר, ושמירה שפגה משחררת", () => {
  const a = T.createOrder(db, camp.id, { name: "א", email: "a@y.com", qty: 4 });
  assert.equal(T.inventory(db, camp).available, 1);
  assert.throws(() => T.createOrder(db, camp.id, { name: "ב", email: "b@y.com", qty: 2 }), /נשארו רק 1/);
  clock.set("2026-12-01T10:20:00.000Z");
  assert.equal(T.inventory(db, camp).available, 5);
  assert.equal(M.settle(db).expired, 1);
  assert.equal(T.ticketOrder(db, a.id).status, "expired");
});

test("תשלום שהגיע אחרי שהשמירה פגה והכרטיסים נמכרו: נדחה והכסף מוחזר", async () => {
  const late = T.createOrder(db, camp.id, { name: "איטי", email: "slow@y.com", qty: 3 });
  T.startPayment(db, late, { origin: "https://j.example" });
  clock.set("2026-12-01T10:30:00.000Z");
  M.settle(db);
  buy(3);
  const ref = T.ticketOrder(db, late.id).payment_ref;
  sandboxPay(db, ref, "4242424242424242");
  const o = T.returnFromPayment(db, T.ticketOrder(db, late.id));
  assert.equal(o.status, "rejected");
  assert.equal(T.ticketsOf(db, o.id).length, 0);
  assert.equal(await T.processRefunds(db), 1);
  assert.equal(db.prepare("SELECT refunded_agorot FROM pay_sandbox WHERE ref = ?").get(ref).refunded_agorot, 24000);
});

test("כרטיס שנדחה בתשלום לא יוצר הזמנה", () => {
  const o = buy(1, { card: "4000000000000002" });
  assert.equal(o.status, "failed");
  assert.equal(T.inventory(db, camp).available, 5);
});

test("החזר חלקי: הכרטיס נפסל, התגמול יורד, הכסף חוזר דרך ספק התשלום", async () => {
  const link = R.getOrCreateLink(db, dani, camp.id);
  const o = buy(3, { clickToken: R.recordClick(db, link, "v").token });
  T.refundTickets(db, artist, o.id, 1, "בקשת הקונה");
  assert.equal(M.balances(db, dani.id).pending, 4000);
  assert.deepEqual(T.ticketsOf(db, o.id).map((t) => t.status), ["valid", "valid", "refunded"]);
  assert.equal(await T.processRefunds(db), 1);
  assert.equal(db.prepare("SELECT refunded_agorot FROM pay_sandbox").get().refunded_agorot, 8000);
  assert.throws(() => T.refundTickets(db, artist, o.id, 3), /אפשר להחזיר 1 עד 2/);
  const bad = T.checkIn(db, camp, T.ticketsOf(db, o.id)[2].code);
  assert.equal(bad.result, "refunded");
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("ביטול הופעה מחזיר את כל הכרטיסים ומבטל תגמולים", async () => {
  const link = R.getOrCreateLink(db, dani, camp.id);
  buy(2, { clickToken: R.recordClick(db, link, "v").token });
  buy(1, { email: "other@y.com" });
  C.setStatus(db, artist, camp.id, "cancelled");
  assert.equal(M.balances(db, dani.id).pending, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tickets WHERE status = 'valid'").get().n, 0);
  assert.equal(await T.processRefunds(db), 2);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("כניסה: כל כרטיס נכנס פעם אחת, וכרטיס של הופעה אחרת לא עובר", () => {
  const o = buy(2);
  const [t1] = T.ticketsOf(db, o.id);
  assert.equal(T.checkIn(db, camp, `jot-${t1.code.toLowerCase()}`).result, "ok");
  assert.equal(T.checkIn(db, camp, t1.code).result, "used");
  assert.equal(T.checkIn(db, camp, "ZZZZZZZZZZ").result, "unknown");
  const other = C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, title: "אחר" }));
  assert.equal(T.checkIn(db, other, T.ticketsOf(db, o.id)[1].code).result, "wrong_show");
  assert.deepEqual({ ...T.doorStats(db, camp.id) }, { total: 2, inside: 1 });
});

test("השהיית קידום לא עוצרת מכירה, אבל מכירה בזמן השהיה לא מזכה בתגמול", () => {
  const link = R.getOrCreateLink(db, dani, camp.id);
  const token = R.recordClick(db, link, "v").token;
  C.setStatus(db, artist, camp.id, "paused");
  camp = C.getCampaign(db, camp.id);
  assert.equal(buy(1, { clickToken: token }).status, "paid");
  assert.equal(M.balances(db, dani.id).pending, 0);
  assert.equal(db.prepare("SELECT attribution FROM orders").get().attribution, "campaign_paused");
});

test("קיבולת: אי אפשר להוריד מתחת למה שנמכר. רשימת קונים בלי הזרקת נוסחאות", () => {
  T.createOrder(db, camp.id, { name: "=HYPERLINK(1)", email: "x@y.com", qty: 1 });
  buy(3);
  assert.throws(() => T.setCapacity(db, artist, camp, 3), /כבר נמכרו 4/);
  T.setCapacity(db, artist, camp, 50);
  assert.equal(C.getCampaign(db, camp.id).capacity, 50);
  const csv = T.buyersCsv(db, camp.id);
  assert.match(csv, /friend@y\.com/);
  assert.doesNotMatch(csv, /HYPERLINK/); // הזמנה שלא שולמה לא ברשימה
  const o = T.createOrder(db, camp.id, { name: "=cmd", email: "z@y.com", qty: 1 });
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  T.returnFromPayment(db, T.ticketOrder(db, o.id));
  assert.match(T.buyersCsv(db, camp.id), /'=cmd/);
});

test("קובץ יומן תקין להוספה ליומן", () => {
  const o = buy(1);
  const ics = T.ics(C.getCampaign(db, camp.id), o, "https://j.example/tickets/x");
  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /DTSTART:20261220T190000Z/);
  assert.match(ics, /LOCATION:בארבי/);
});

// ---------- מקצה לקצה דרך HTTP ----------

class Browser {
  constructor(base) {
    this.base = base;
    this.jar = {};
  }
  async req(path, { method = "GET", form } = {}) {
    const res = await fetch(this.base + path, {
      method, redirect: "manual",
      headers: { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: this.base + path },
      body: form ? new URLSearchParams(form) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      this.jar[k.trim()] = v;
    }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  async get(path) {
    let r = await this.req(path);
    for (let i = 0; i < 6 && r.status === 303; i++) r = await this.req(r.location);
    this.last = r.text;
    return r;
  }
  async post(path, form = {}) {
    let r = await this.req(path, { method: "POST", form: { _csrf: this.last.match(/name="_csrf" value="([^"]+)"/)[1], ...form } });
    for (let i = 0; i < 6 && r.status === 303; i++) r = await this.req(r.location);
    this.last = r.text;
    return r;
  }
  async login(email, name) {
    await this.get("/login");
    const r = await this.post("/login", { email });
    await this.post("/login/code", { email, code: r.text.match(/הקוד הוא (\d{6})/)[1] });
    if (name) await this.post("/welcome", { name, next: "/shows" });
  }
}

test("HTTP: אמן פותח הופעה בקופה של JoCares → ג׳וקר משתף → חבר קונה ומשלם → כרטיס עם QR → סריקה בדלת", async () => {
  resetRateLimits();
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = new Browser(base);
    await a.login("noa@x.com", "נועה");
    await a.get("/artist/new/details");
    assert.match(a.last, /JoCares מוכרת/);
    const show = { ...SHOW, title: "השקה", capacity: "100" };
    let r = await a.post("/artist/new/preview", show);
    r = await a.post("/artist/new", { ...show, publish: "1" });
    const cid = Number(r.text.match(/\/s\/(\d+)/)[1]);
    assert.match(r.text, /0 \/ 100/);
    const doorUrl = r.text.match(/\/door\/[\w-]+/)[0];

    const j = new Browser(base);
    await j.login("joker@x.com", "יעל");
    await j.get(`/s/${cid}`);
    r = await j.post(`/s/${cid}/promote`);
    const refPath = r.text.match(/\/r\/[\w-]+/)[0];

    const friend = new Browser(base);
    await friend.get(refPath);
    assert.match(friend.last, /יעל/);
    r = await friend.get(`/s/${cid}/buy`);
    assert.match(r.text, /<b>יעל<\/b> מזמין\/ה אותך/);
    assert.match(r.text, /לתשלום/);
    r = await friend.post(`/checkout/${cid}`, { qty: "2", name: "חבר טוב", email: "friend@z.com", phone: "050-1234567" });
    assert.match(r.text, /קופת ניסיון/);
    const payPath = r.text.match(/action="(\/pay\/sandbox\/[\w-]+)"/)[1];
    r = await friend.post(payPath, { card: "4242 4242 4242 4242" });
    assert.match(r.text, /שולם/);
    assert.equal((r.text.match(/<svg/g) ?? []).length >= 2, true);
    const code = r.text.match(/class="ticket-code" dir="ltr">([A-Z2-9]{5}) ([A-Z2-9]{5})</);
    const ticketsPath = r.text.match(/\/tickets\/[\w-]+(?=\/calendar)/)[0];

    // הג׳וקר רואה את התגמול
    await j.get("/me/money");
    assert.match(j.last, /₪40/);

    // סריקה בדלת: בלי חשבון, רק עם הקישור
    const door = new Browser(base);
    await door.get(doorUrl);
    r = await door.post(doorUrl, { code: code[1] + code[2] });
    assert.equal(r.status, 200);
    assert.match(r.text, /כניסה/);
    assert.match(r.text, /חבר טוב/);
    r = await door.post(doorUrl, { code: code[1] + code[2] });
    assert.equal(r.status, 409);
    assert.match(r.text, /כבר נסרק/);

    // האמן רואה מכירה ומחזיר כרטיס אחד
    r = await a.get(`/artist/c/${cid}`);
    assert.match(r.text, /2 \/ 100/);
    const orderId = r.text.match(/name="order" value="(\d+)"/)[1];
    r = await a.post(`/artist/c/${cid}/refund`, { order: orderId, qty: "1" });
    assert.match(r.text, /הוחזר/);
    await j.get("/me/money");
    assert.match(j.last, /₪20/);
    r = await a.req(`/artist/c/${cid}/buyers.csv`);
    assert.match(r.text, /friend@z\.com/);

    // קישור הכרטיסים נשאר פרטי, ויש קובץ יומן
    r = await friend.get(ticketsPath + "/calendar.ics");
    assert.match(r.text, /BEGIN:VCALENDAR/);
    r = await new Browser(base).get("/tickets/not-a-real-token");
    assert.equal(r.status, 404);
    assert.deepEqual(M.reconciliationIssues(db), []);
  } finally {
    server.close();
  }
});
