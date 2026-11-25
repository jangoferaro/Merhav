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

process.env.ADMIN_EMAILS = "ops@x.com";
let db, artist, dani, camp;
const user = (email, name) => ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, created_at: clock.iso() }));
const SHOW = {
  artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
  image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "100",
};
const buy = (qty, { email = "f@y.com", clickToken = null } = {}) => {
  const o = T.createOrder(db, camp.id, { name: "חבר טוב", email, qty }, { clickToken });
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  return T.returnFromPayment(db, T.ticketOrder(db, o.id));
};

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני");
  camp = C.getCampaign(db, C.createCampaign(db, artist, SHOW));
});
after(() => clock.set(null));

test("הנחה מהג׳וקר: החבר משלם פחות, הג׳וקר מקבל פחות, והאמן מקבל בדיוק אותו דבר", async () => {
  const link = R.getOrCreateLink(db, dani, camp.id);
  assert.throws(() => R.setDiscount(db, dani, link.id, "20", camp.reward_agorot), /עד 19/);
  R.setDiscount(db, dani, link.id, "8", camp.reward_agorot);
  const token = R.recordClick(db, link, "v").token;
  assert.equal(T.discountPreview(db, camp, token), 800);
  const o = buy(2, { clickToken: token });
  assert.equal(o.total_agorot, 2 * 7200);
  assert.equal(M.balances(db, dani.id).pending, 2 * 1200);
  // אמן: 80 - 20 (תגמול) - 4 (עמלה) = 56 לכרטיס, עם הנחה או בלי
  assert.equal(M.showStatement(db, camp.id).net, 2 * 5600);
  // החזר של כרטיס אחד: התגמול יורד לפי הסכום אחרי ההנחה, והכסף שמוחזר הוא מה שהקונה שילם
  T.refundTickets(db, artist, o.id, 1);
  await T.processRefunds(db);
  assert.equal(M.balances(db, dani.id).pending, 1200);
  assert.equal(db.prepare("SELECT amount_agorot FROM ticket_refunds").get().amount_agorot, 7200);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("הנחה לא ניתנת כשהקנייה לא תזכה את הג׳וקר (רכישה עצמית), כדי שהאמן לא יממן אותה", () => {
  const link = R.getOrCreateLink(db, dani, camp.id);
  R.setDiscount(db, dani, link.id, "8", camp.reward_agorot);
  const o = buy(1, { email: "dani@x.com", clickToken: R.recordClick(db, link, "v").token });
  assert.equal(o.discount_agorot, 0);
  assert.equal(o.total_agorot, 8000);
});

test("העברת כרטיס בודד: קישור לכרטיס אחד בלבד", () => {
  const o = buy(3);
  const [t1, t2] = T.ticketsOf(db, o.id);
  const tok = T.ticketShareToken(db, t1);
  assert.equal(T.ticketShareToken(db, T.ticketsOf(db, o.id)[0]), tok);
  assert.equal(T.ticketByShare(db, tok).code, t1.code);
  assert.notEqual(T.ticketShareToken(db, t2), tok);
});

test("תזכורת: רק בהסכמה, נשלחת פעם אחת בזמן, לא למי שכבר קנה, ואפשר לבטל", async () => {
  assert.throws(() => T.addReminder(db, camp, { email: "a@y.com" }), /לאשר/);
  T.addReminder(db, camp, { email: "a@y.com", consent: "on" });
  T.addReminder(db, camp, { email: "a@y.com", consent: "on" }); // כפול לא נרשם פעמיים
  T.addReminder(db, camp, { email: "f@y.com", consent: "on" });
  T.addReminder(db, camp, { email: "c@y.com", consent: "on" });
  T.cancelReminder(db, db.prepare("SELECT token FROM show_reminders WHERE email = 'c@y.com'").get().token);
  buy(1, { email: "f@y.com" });
  const sent = [];
  const send = async (r) => sent.push(r.email);
  assert.equal(await T.processReminders(db, send), 0); // עוד מוקדם
  clock.set("2026-12-17T20:00:00.000Z"); // 3 ימים לפני
  assert.equal(await T.processReminders(db, send), 1);
  assert.deepEqual(sent, ["a@y.com"]);
  assert.equal(await T.processReminders(db, send), 0);
});

test("תזכורת מוקדמת יותר כשהמחיר המוקדם עומד להיגמר", () => {
  const c = C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, early_price: "60", early_until: "2026-12-05T21:00" }));
  assert.equal(T.reminderDueAt(c), new Date(new Date(c.early_until).getTime() - 86400000).toISOString());
});

test("פרטי אמן לקבלת הכסף: מוצפנים, רק לבעלים", () => {
  const input = { type: "patur", legal_name: "נועה ברק", tax_id: "123456789", phone: "0501234567", bank: "לאומי", branch: "800", account: "123456", confirm: "on" };
  assert.throws(() => M.saveArtistPayout(db, dani, camp.artist_id, input), /אין הרשאה/);
  assert.throws(() => M.saveArtistPayout(db, artist, camp.artist_id, { ...input, tax_id: "12" }), /לא תקין/);
  M.saveArtistPayout(db, artist, camp.artist_id, input);
  assert.equal(M.artistPayout(db, camp.artist_id).account, "123456");
  assert.doesNotMatch(db.prepare("SELECT payout_details_enc FROM artists WHERE id = ?").get(camp.artist_id).payout_details_enc, /123456/);
});

test("HTTP: הנחה בקופה, העברת כרטיס, תזכורת, סיכום כספי ומסך הצוות", async () => {
  resetRateLimits();
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const req = async (path, { method = "GET", form } = {}) => {
    const res = await fetch(base + path, { method, redirect: "manual", body: form ? new URLSearchParams(form) : undefined,
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base + path } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k.trim()] = v; }
    let r = { status: res.status, location: res.headers.get("location"), text: await res.text() };
    return r;
  };
  const follow = async (r) => { while (r.status === 303) r = await req(r.location); return r; };
  const csrf = (t) => t.match(/name="_csrf" value="([^"]+)"/)[1];
  try {
    const link = R.getOrCreateLink(db, dani, camp.id);
    R.setDiscount(db, dani, link.id, "5", camp.reward_agorot);
    let r = await follow(await req(`/r/${link.code}`));
    assert.match(r.text, /נותן\/ת לך ₪5 הנחה/);
    r = await follow(await req(`/s/${camp.id}/buy`));
    assert.match(r.text, /הנחה של ₪5 לכרטיס/);
    r = await follow(await req(`/s/${camp.id}/remind`, { method: "POST", form: { _csrf: csrf(r.text), email: "later@y.com", consent: "on" } }));
    assert.match(r.text, /נזכיר לך/);
    r = await follow(await req(`/checkout/${camp.id}`));
    r = await req(`/checkout/${camp.id}`, { method: "POST", form: { _csrf: csrf(r.text), qty: "2", name: "רוני", email: "roni@y.com" } });
    r = await follow(r);
    r = await follow(await req(r.text.match(/action="(\/pay\/sandbox\/[\w-]+)"/)[1], { method: "POST", form: { _csrf: csrf(r.text), card: "4242424242424242" } }));
    assert.match(r.text, /העברת הכרטיס הזה/);
    const single = r.text.match(/\/t\/[\w-]+/)[0];
    const one = await req(single);
    assert.equal((one.text.match(/class="tkt st-/g) ?? []).length, 1);
    assert.match(one.text, /<dt>מאת<\/dt><dd>רוני<\/dd>/);

    // אמן: סיכום כספי ובקשה למלא פרטי תשלום
    const a = {};
    Object.assign(jar, a);
    const sid = ID.createSession(db, artist.id);
    jar.sid = sid;
    r = await follow(await req(`/artist/c/${camp.id}`));
    assert.match(r.text, /סיכום כספי/);
    assert.match(r.text, /למילוי הפרטים/);
    assert.match(r.text, /₪150/); // 2 × 75 (80 פחות 5 הנחה)
    // צוות: מסך כרטיסים
    const ops = user("ops@x.com", "Ops");
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(ops.id);
    jar.sid = ID.createSession(db, ops.id);
    r = await follow(await req("/admin?tab=tickets"));
    assert.match(r.text, /הזמנות אחרונות/);
    assert.match(r.text, /roni@y\.com/);
  } finally {
    server.close();
  }
});
