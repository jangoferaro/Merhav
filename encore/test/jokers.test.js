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
import * as J from "../src/domain/jokers.js";
import { sandboxPay } from "../src/payments/sandbox.js";

let db, artist, dani, maya, newbie, camp;
const user = (email, name) => ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, created_at: clock.iso() }));
const SHOW = {
  artist_name: "נועה", title: "ערב", venue: "בארבי", city: "תל אביב", genre: "אינדי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
  image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "100",
};
const buy = (qty, clickToken, email = "f@y.com") => {
  const o = T.createOrder(db, camp.id, { name: "חבר", email, qty }, { clickToken });
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  return T.returnFromPayment(db, T.ticketOrder(db, o.id));
};

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני כהן");
  maya = user("maya@x.com", "מאיה");
  newbie = user("new@x.com", "חדש");
  camp = C.getCampaign(db, C.createCampaign(db, artist, SHOW));
});
after(() => clock.set(null));

test("פרופיל: רק שם חובה, טעם נבחר מרשימה, ועוקבים הם הצהרה עצמית", () => {
  const j = J.saveJoker(db, dani, { nickname: "דני", genres: ["אינדי", "לא-ז׳אנר"], social_followers: "4,820" });
  assert.equal(j.genres, "אינדי");
  assert.equal(j.social_followers, 4820);
  assert.match(j.public_id, /^\d{5}$/);
  assert.throws(() => J.saveJoker(db, dani, { nickname: "" , social_url: "http://x" }), /https/);
});

test("הקלף הציבורי מציג רק מה שנבחר, ואף פעם לא רווחים", () => {
  const j = J.saveJoker(db, dani, { nickname: "דני", city: "תל אביב", genres: ["אינדי"], bio: "סוד", social_followers: "100" });
  J.setCard(db, dani, { publish: "1", fields: ["genres"] });
  const v = J.publicView(J.getJoker(db, dani.id), J.powers(db, dani.id));
  assert.deepEqual(v.genres, ["אינדי"]);
  assert.equal(v.city, "");
  assert.equal(v.bio, "");
  assert.equal(v.tickets, null);
  assert.equal(v.social, null);
  assert.equal("earnings" in v || "balance" in v, false);
  assert.equal(j.public_id.length, 5);
});

test("התאמה: טעם ואזור קודמים, וג׳וקר חדש תמיד מקבל מקום ברשימה", () => {
  J.saveJoker(db, dani, { nickname: "דני", city: "תל אביב", genres: ["אינדי"] });
  J.saveJoker(db, maya, { nickname: "מאיה", city: "חיפה", genres: ["מטאל"] });
  J.saveJoker(db, newbie, { nickname: "חדש" });
  J.saveJoker(db, artist, { nickname: "נועה", genres: ["אינדי"] }); // האמנית עצמה לא מופיעה
  const rows = J.jokersForCampaign(db, camp);
  assert.deepEqual(rows.map((r) => r.j.nickname).slice(0, 1), ["דני"]);
  assert.ok(rows.some((r) => r.j.nickname === "חדש"));
  assert.ok(!rows.some((r) => r.j.user_id === artist.id));
  assert.match(rows[0].reasons.join(" "), /אוהב\/ת אינדי/);
  J.setInvitationsOn(db, maya, false);
  assert.ok(!J.jokersForCampaign(db, camp).some((r) => r.j.user_id === maya.id));
});

test("הזמנה עם תגמול מוגדל: הג׳וקר מקבל יותר על כל כרטיס, והחזר מוריד בהתאם", () => {
  J.saveJoker(db, dani, { nickname: "דני" });
  assert.throws(() => J.inviteJoker(db, artist, camp.id, { joker_id: dani.id, bonus: "70" }), /גבוה מדי/);
  const id = J.inviteJoker(db, artist, camp.id, { joker_id: dani.id, kind: "promote", bonus: "10", message: "בוא" });
  assert.throws(() => J.inviteJoker(db, artist, camp.id, { joker_id: dani.id }), /כבר שלחת/);
  assert.match(db.prepare("SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC").get(dani.id).body, /₪30 לכרטיס/);
  J.decideInvitation(db, dani, id, true);
  const link = R.getOrCreateLink(db, dani, camp.id);
  assert.equal(link.bonus_agorot, 1000);
  const o = buy(2, R.recordClick(db, link, "v").token);
  assert.equal(M.balances(db, dani.id).pending, 2 * 3000);
  T.refundTickets(db, artist, o.id, 1);
  assert.equal(M.balances(db, dani.id).pending, 3000);
  assert.equal(M.showStatement(db, camp.id).rewards, 3000);
  assert.deepEqual(M.reconciliationIssues(db), []);
  assert.throws(() => J.decideInvitation(db, dani, id, true), /לא פתוחה/);
});

test("HTTP: ג׳וקר ממלא פרופיל ומפרסם קלף, אמן מוצא ומזמין, הג׳וקר מקבל ומגיע ללינק", async () => {
  resetRateLimits();
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mk = () => {
    const jar = {};
    const req = async (path, { method = "GET", form } = {}) => {
      const res = await fetch(base + path, { method, redirect: "manual", body: form ? new URLSearchParams(form) : undefined,
        headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base + path } });
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k.trim()] = v; }
      let r = { status: res.status, location: res.headers.get("location"), text: await res.text() };
      while (r.status === 303) r = await req(r.location);
      return r;
    };
    return { jar, req };
  };
  const csrf = (t) => t.match(/name="_csrf" value="([^"]+)"/)[1];
  try {
    const d = mk();
    d.jar.sid = ID.createSession(db, dani.id);
    let r = await d.req("/me/profile");
    assert.match(r.text, /JOKER \d{5}/);
    r = await d.req("/me/profile", { method: "POST", form: { _csrf: csrf(r.text), nickname: "דני", city: "תל אביב", genres: "אינדי", social_platform: "Instagram", social_followers: "4820" } });
    assert.match(r.text, /הפרופיל נשמר/);
    assert.match(r.text, /הופעות שמתאימות לך/);
    assert.match(r.text, /כי בחרת אינדי/);
    r = await d.req("/me/profile/card", { method: "POST", form: { _csrf: csrf(r.text), publish: "1", fields: "genres" } });
    const pid = J.getJoker(db, dani.id).public_id;
    const anon = mk();
    r = await anon.req(`/j/${pid}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /אינדי/);
    assert.doesNotMatch(r.text, /4\.8K/); // עוקבים לא נבחרו לקלף
    assert.doesNotMatch(r.text, /הרווחת/);

    const a = mk();
    a.jar.sid = ID.createSession(db, artist.id);
    r = await a.req(`/artist/c/${camp.id}/jokers`);
    assert.match(r.text, /דני/);
    assert.match(r.text, /4\.8K עוקבים/); // לאמן מוצג, מסומן כהצהרה עצמית
    assert.match(r.text, /הצהרה עצמית/);
    r = await a.req(`/artist/c/${camp.id}/invite`, { method: "POST", form: { _csrf: csrf(r.text), joker_id: String(dani.id), kind: "promote", bonus: "5" } });
    assert.match(r.text, /ההזמנה נשלחה/);

    r = await d.req("/me/profile");
    assert.match(r.text, /הזמנות מאמנים \(1\)/);
    const inv = r.text.match(/\/me\/invitations\/(\d+)\/accept/)[1];
    r = await d.req(`/me/invitations/${inv}/accept`, { method: "POST", form: { _csrf: csrf(r.text) } });
    assert.match(r.text, /הלינק האישי שלך/);
    J.setCard(db, dani, { publish: "0" });
    assert.equal((await anon.req(`/j/${pid}`)).status, 404);
  } finally {
    server.close();
  }
});
