import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import qrcode from "qrcode-generator";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as T from "../src/domain/tickets.js";
import * as DR from "../src/domain/door.js";
import { sandboxPay } from "../src/payments/sandbox.js";

const jsQR = createRequire(import.meta.url)("jsqr");
let db, org, other, camp;
const user = (e, n) => ID.getUser(db, insert(db, "users", { email: e, email_hash: emailHash(e), name: n, created_at: clock.iso() }));
const SHOW = { organizer_kind: "venue", organizer_name: "הבארבי", artist_name: "נועה", title: "ערב", venue: "הבארבי", starts_at: "2026-12-01T21:00", price: "80", reward: "20", image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "50" };
const buy = (c, input) => {
  const o = T.createOrder(db, c.id, input);
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  return T.ticketsOf(db, T.returnFromPayment(db, T.ticketOrder(db, o.id)).id);
};
beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  org = user("ops@barby.example", "הבארבי");
  other = user("x@other.example", "אחר");
  camp = C.getCampaign(db, C.createCampaign(db, org, SHOW));
});
after(() => clock.set(null));

test("צוות כניסה: איש צוות רואה רק את ההופעות של המארגן שלו, וביטול גישה עובד מיד", () => {
  const otherShow = C.getCampaign(db, C.createCampaign(db, other, { ...SHOW, organizer_name: "מקום אחר" }));
  const tok = DR.addStaff(db, org, camp.artist_id, "יוסי");
  const staff = DR.staffByToken(db, tok);
  assert.deepEqual(DR.eventsForStaff(db, staff).map((c) => c.id), [camp.id]);
  assert.throws(() => DR.resolveDoor(db, { staffToken: tok, campaignId: otherShow.id }), /לא נמצאה/);
  DR.revokeStaff(db, org, camp.artist_id, staff.id);
  assert.throws(() => DR.resolveDoor(db, { staffToken: tok, campaignId: camp.id }), /לא בתוקף/);
});

test("רשימת הכרטיסים למכשיר: בלי הקודים עצמם, רק גיבוב, ושם מלא רק בכרטיס שמי", () => {
  const [t] = buy(camp, { name: "דנה לוי", email: "d@y.com", qty: 1 });
  const m = DR.manifest(db, camp);
  assert.doesNotMatch(JSON.stringify(m), new RegExp(t.code));
  assert.equal(m.tickets[0].h, DR.codeHash(t.code));
  assert.equal(m.tickets[0].n, "דנה");
  const named = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, title: "שמי", ticket_mode: "named" }));
  buy(named, { name: "דנה לוי", email: "d@y.com", qty: 1 });
  assert.equal(DR.manifest(db, named).tickets[0].n, "דנה לוי");
});

test("כניסה, כניסה כפולה, ביטול עד 5 דקות, חיפוש לפי שם", () => {
  const [t1, t2] = buy(camp, { name: "דנה לוי", email: "d@y.com", qty: 2 });
  assert.equal(DR.admit(db, camp, { code: t1.code }).result, "ok");
  assert.equal(DR.admit(db, camp, { code: t1.code }).result, "used");
  assert.equal(DR.undo(db, camp, t1.id).result, "undone");
  assert.equal(DR.admit(db, camp, { code: t1.code }).result, "ok");
  clock.set("2026-12-01T10:10:00.000Z");
  assert.throws(() => DR.undo(db, camp, t1.id), /5 דקות/);
  const found = DR.search(db, camp, "דנה");
  assert.equal(found.length, 2);
  assert.equal(DR.admit(db, camp, { ticketId: t2.id }).result, "ok");
  assert.deepEqual({ ...DR.stats(db, camp) }, { total: 2, inside: 2, last15: 2 });
});

test("בלי קליטה: כניסות מסתנכרנות אחר כך, וכניסה שכבר נסרקה בדלת אחרת מסומנת כהתנגשות", () => {
  const [t1, t2] = buy(camp, { name: "דנה", email: "d@y.com", qty: 2 });
  DR.admit(db, camp, { code: t2.code }); // דלת אחרת, עם קליטה
  const res = DR.syncOffline(db, camp, [{ id: t1.id, at: "2026-12-01T09:59:00.000Z" }, { id: t2.id, at: "2026-12-01T09:58:00.000Z" }]);
  assert.deepEqual(res.map((r) => r.result), ["ok", "conflict"]);
  assert.equal(db.prepare("SELECT offline FROM door_checkins WHERE ticket_id = ?").get(t1.id).offline, 1);
});

test("ספריית הסריקה קוראת את ה-QR שלנו", () => {
  const [t] = buy(camp, { name: "דנה", email: "d@y.com", qty: 1 });
  const q = qrcode(0, "M"); q.addData(t.code); q.make();
  const n = q.getModuleCount(), scale = 6, pad = 4, size = (n + pad * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + pad) * scale + dy) * size + (x + pad) * scale + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  assert.equal(jsQR(px, size, size).data, t.code);
});

test("HTTP: איש צוות מהקישור האישי, סריקה דרך האפליקציה, הגנת csrf", async () => {
  resetRateLimits();
  const [t] = buy(camp, { name: "דנה", email: "d@y.com", qty: 1 });
  const tok = DR.addStaff(db, org, camp.artist_id, "יוסי");
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const req = async (path, init = {}) => {
    const res = await fetch(base + path, { redirect: "manual", ...init, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k.trim()] = v; }
    return { status: res.status, text: await res.text() };
  };
  try {
    let r = await req(`/door/s/${tok}`);
    assert.match(r.text, /איזו הופעה/);
    assert.match(r.text, new RegExp(`/door/s/${tok}/e/${camp.id}`));
    r = await req(`/door/s/${tok}/e/${camp.id}`);
    const csrf = r.text.match(/data-csrf="([^"]+)"/)[1];
    assert.match(r.text, /jsqr\.js/);
    const api = `/door/api/s/${tok}/${camp.id}`;
    r = await req(`${api}/manifest`);
    assert.equal(JSON.parse(r.text).tickets.length, 1);
    r = await req(`${api}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: t.code }) });
    assert.equal(r.status, 403); // בלי csrf
    r = await req(`${api}/check`, { method: "POST", headers: { "content-type": "application/json", "x-door-csrf": csrf }, body: JSON.stringify({ code: t.code, device: "d1" }) });
    const j = JSON.parse(r.text);
    assert.equal(j.result, "ok");
    assert.equal(j.stats.inside, 1);
    assert.equal(db.prepare("SELECT staff_id FROM door_checkins").get().staff_id, DR.staffByToken(db, tok).id);
    r = await req("/static/jsqr.js");
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
});

test("API לאפליקציית הנייטיב: מפתח אישי בכותרת, בלי עוגיות, וביטול גישה עובד מיד", async () => {
  resetRateLimits();
  const [t, t2] = buy(camp, { name: "דנה לוי", email: "d@y.com", qty: 2 });
  const tok = DR.addStaff(db, org, camp.artist_id, "יוסי");
  const otherShow = C.getCampaign(db, C.createCampaign(db, other, { ...SHOW, organizer_name: "אחר" }));
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/door/app/v1`;
  const call = async (path, { key = tok, body } = {}) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  try {
    let r = await call("/me", { key: "x".repeat(24) });
    assert.equal(r.status, 401);
    r = await call("/me");
    assert.equal(r.json.staff.name, "יוסי");
    assert.equal(r.json.organizer.name, "הבארבי");
    assert.deepEqual(r.json.events.map((e) => e.id), [camp.id]);
    assert.equal(r.json.events[0].total, 2);
    assert.equal((await call(`/e/${otherShow.id}/manifest`)).status, 404);

    r = await call(`/e/${camp.id}/manifest`);
    assert.equal(r.json.tickets.length, 2);
    assert.ok(!JSON.stringify(r.json).includes(t.code), "הקודים עצמם לא נשלחים למכשיר");

    r = await call(`/e/${camp.id}/check`, { body: { code: t.code, device: "ios-1" } });
    assert.equal(r.json.result, "ok");
    assert.equal(r.json.stats.inside, 1);
    r = await call(`/e/${camp.id}/check`, { body: { code: t.code } });
    assert.equal(r.json.result, "used");
    r = await call(`/e/${camp.id}/search?q=${encodeURIComponent("דנה")}`);
    assert.equal(r.json.length, 2);
    r = await call(`/e/${camp.id}/sync`, { body: { items: [{ id: t2.id, at: "2026-12-01T09:59:00.000Z" }] } });
    assert.deepEqual(r.json.results.map((x) => x.result), ["ok"]);
    r = await call(`/e/${camp.id}/stats`);
    assert.deepEqual(r.json.staff, [{ name: "יוסי", n: 2 }]);
    r = await call(`/e/${camp.id}/undo`, { body: { id: t.id } });
    assert.equal(r.json.result, "undone");

    DR.revokeStaff(db, org, camp.artist_id, DR.staffByToken(db, tok).id);
    assert.equal((await call("/me")).status, 401);
  } finally {
    server.close();
  }
});
