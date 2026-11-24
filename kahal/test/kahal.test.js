import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db.js";
import * as L from "../src/logic.js";
import { createApp } from "../src/server.js";

const EVENT = {
  artist_name: "נועה",
  artist_contact: "noa@example.com",
  title: "הופעה בבארבי",
  venue: "בארבי, תל אביב",
  starts_at: "2026-12-31T21:00",
  price: "80",
  capacity: "5",
  commission_pct: "10",
};

function setup() {
  const db = openDb(":memory:");
  return { db, event: L.createEvent(db, EVENT) };
}

test("עמלה מחושבת כאחוז מהסכום ומעוגלת כלפי מטה", () => {
  assert.equal(L.commissionFor(8000, 10), 800);
  assert.equal(L.commissionFor(999, 10), 99);
  assert.equal(L.shekelsToAgorot("₪120.5"), 12050);
});

test("קנייה דרך שגריר מזכה אותו בעמלה; קנייה ישירה לא", () => {
  const { db, event } = setup();
  const agent = L.joinAsAgent(db, event, { name: "דני", contact: "050-1234567" });
  const viaAgent = L.purchase(db, event, { name: "רוני", contact: "r@x.com", qty: 2, refCode: agent.code });
  const direct = L.purchase(db, event, { name: "גלי", contact: "g@x.com", qty: 1 });

  assert.equal(viaAgent.total_agorot, 16000);
  assert.equal(viaAgent.commission_agorot, 1600);
  assert.equal(direct.agent_id, null);
  assert.equal(L.ticketsForOrder(db, viaAgent.id).length, 2);

  const s = L.agentStats(db, agent.id);
  assert.equal(s.tickets, 2);
  assert.equal(s.pending, 1600);
});

test("שגריר לא מרוויח על הכרטיסים של עצמו", () => {
  const { db, event } = setup();
  const agent = L.joinAsAgent(db, event, { name: "דני", contact: "050-1234567" });
  const own = L.purchase(db, event, { name: "דני", contact: "0501234567", qty: 1, refCode: agent.code });
  assert.equal(own.agent_id, null);
  assert.equal(own.commission_agorot, 0);
});

test("הצטרפות חוזרת עם אותו טלפון מחזירה את אותו שגריר", () => {
  const { db, event } = setup();
  const a = L.joinAsAgent(db, event, { name: "דני", contact: "050-1234567" });
  const b = L.joinAsAgent(db, event, { name: "דני שוב", contact: "0501234567" });
  assert.equal(a.id, b.id);
});

test("אי אפשר למכור יותר כרטיסים מהקיבולת", () => {
  const { db, event } = setup();
  L.purchase(db, event, { name: "א", contact: "a", qty: 4 });
  assert.throws(() => L.purchase(db, event, { name: "ב", contact: "b", qty: 2 }), /נשארו רק 1/);
  L.purchase(db, event, { name: "ב", contact: "b", qty: 1 });
  assert.throws(() => L.purchase(db, event, { name: "ג", contact: "c", qty: 1 }), /אזלו/);
  assert.equal(L.ticketsSold(db, event.id), 5);
});

test("כניסה חוזרת של אותו מבקר לא נספרת פעמיים", () => {
  const { db, event } = setup();
  const agent = L.joinAsAgent(db, event, { name: "דני", contact: "d" });
  L.recordClick(db, agent.id, "v1");
  L.recordClick(db, agent.id, "v1");
  L.recordClick(db, agent.id, "v2");
  assert.equal(L.agentStats(db, agent.id).clicks, 2);
});

test("סימון תשלום מאפס את החוב לשגריר", () => {
  const { db, event } = setup();
  const agent = L.joinAsAgent(db, event, { name: "דני", contact: "d" });
  L.purchase(db, event, { name: "ר", contact: "r", qty: 1, refCode: agent.code });
  assert.equal(L.markAgentPaid(db, event.id, agent.id), 1);
  const s = L.agentStats(db, agent.id);
  assert.equal(s.pending, 0);
  assert.equal(s.paid, 800);
  assert.equal(L.eventSummary(db, event.id).owed, 0);
});

test("כרטיס נסרק בכניסה פעם אחת בלבד", () => {
  const { db, event } = setup();
  const order = L.purchase(db, event, { name: "ר", contact: "r", qty: 1 });
  const [t] = L.ticketsForOrder(db, order.id);
  assert.equal(L.checkIn(db, event.id, t.code.toLowerCase()).ok, true);
  assert.equal(L.checkIn(db, event.id, t.code).ok, false);
  assert.equal(L.checkIn(db, event.id, "NOPE").ok, false);
});

test("ולידציה של יצירת אירוע", () => {
  const db = openDb(":memory:");
  assert.throws(() => L.createEvent(db, { ...EVENT, commission_pct: "80" }), L.UserError);
  assert.throws(() => L.createEvent(db, { ...EVENT, title: "" }), L.UserError);
  assert.throws(() => L.createEvent(db, { ...EVENT, price: "-5" }), L.UserError);
});

// ---------- זרימה מלאה דרך HTTP ----------

async function withServer(fn) {
  const db = openDb(":memory:");
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, db);
  } finally {
    server.close();
  }
}

const form = (o) => ({ method: "POST", body: new URLSearchParams(o), redirect: "manual" });
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("זרימה מלאה: אומן → שגריר → חבר קונה דרך הקישור → האומן רואה ומשלם", async () => {
  await withServer(async (base, db) => {
    // 1. האומן פותח אירוע
    let res = await fetch(`${base}/events`, form(EVENT));
    assert.equal(res.status, 201);
    const manage = (await res.text()).match(/\/manage\/([\w-]+)/)[0];
    const event = db.prepare("SELECT * FROM events").get();

    // 2. מישהו מהקהל מצטרף כשגריר
    res = await fetch(`${base}/e/${event.slug}/join`, form({ name: "דני", contact: "dani@x.com" }));
    assert.equal(res.status, 303);
    const agentPage = await (await fetch(base + res.headers.get("location"))).text();
    const link = agentPage.match(/\/e\/[^"<?]+\?ref=(\w+)/);
    assert.ok(link, "בלוח השגריר מופיע קישור אישי");

    // 3. חבר נכנס לקישור (נשמרת עוגייה) ואז קונה
    res = await fetch(`${base}${link[0]}`);
    assert.match(await res.text(), /הגעת דרך/);
    const cookie = cookieOf(res);
    res = await fetch(`${base}/e/${event.slug}/buy`, { ...form({ name: "רוני", contact: "roni@x.com", qty: "2" }), headers: { cookie } });
    assert.equal(res.status, 303);
    const orderHtml = await (await fetch(base + res.headers.get("location"))).text();
    assert.match(orderHtml, /נתראה שם, רוני/);

    // 4. השגריר רואה שהרוויח
    const agent = db.prepare("SELECT * FROM agents").get();
    const again = await (await fetch(`${base}/agent/${agent.token}`)).text();
    assert.match(again, /₪16/);

    // 5. האומן רואה ומסמן ששילם
    let dash = await (await fetch(base + manage)).text();
    assert.match(dash, /דני/);
    assert.match(dash, /סימון ששולם/);
    res = await fetch(`${base}${manage}/payout/${agent.id}`, form({}));
    dash = await (await fetch(base + res.headers.get("location"))).text();
    assert.match(dash, /סומן ששולם/);
    assert.doesNotMatch(dash, /<button class="small">/);
  });
});

test("קלט זדוני מוצג כטקסט ולא כ-HTML", async () => {
  await withServer(async (base, db) => {
    await fetch(`${base}/events`, form({ ...EVENT, title: "<script>alert(1)</script>" }));
    const { slug } = db.prepare("SELECT slug FROM events").get();
    const page = await (await fetch(`${base}/e/${slug}`)).text();
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /&lt;script&gt;/);
  });
});

test("טוקן ניהול לא קיים מחזיר 404", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/manage/nope`)).status, 404);
  });
});

test("כתובת האירוע לטינית בלבד, גם לשם בעברית", () => {
  assert.match(L.slugify("הופעה בבארבי"), /^[a-z0-9]{7}$/);
  assert.match(L.slugify("Noa Live 2026"), /^noa-live-2026-[a-z0-9]{4}$/);
});
