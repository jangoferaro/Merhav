import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash, shekelsToAgorot, isoToIsraelLocal, israelLocalToIso } from "../src/util.js";
import * as C from "../src/domain/campaigns.js";
import * as R from "../src/domain/referrals.js";
import * as I from "../src/domain/ingest.js";
import * as M from "../src/domain/money.js";
import * as ID from "../src/domain/identity.js";
import { parseShowHtml, isPrivateIp } from "../src/domain/extract.js";
import { setSimDeliver, simBuy, simRefund, simCancelEvent, simReplay, signSim } from "../src/providers/sim.js";

const T0 = "2026-12-01T10:00:00.000Z";
let db, artist, promoter, other;

function user(email, name) {
  const id = insert(db, "users", { email, email_hash: emailHash(email), name, created_at: clock.iso() });
  return ID.getUser(db, id);
}

const SHOW = {
  artist_name: "נועה", title: "הופעה אקוסטית", venue: "הבארבי", city: "תל אביב",
  starts_at: "2026-12-20T21:00", price: "80", reward: "20", image_url: "https://img.example/show.jpg",
};

beforeEach(() => {
  clock.set(T0);
  db = openDb(":memory:");
  setSimDeliver((raw, headers) => I.ingestWebhook(db, "sim", raw, headers));
  artist = user("artist@x.com", "נועה");
  promoter = user("dani@x.com", "דני כהן");
  other = user("maya@x.com", "מאיה");
});

const newCampaign = (over = {}) => C.getCampaign(db, C.createCampaign(db, artist, { ...SHOW, ...over }));
const linkFor = (u, c) => R.getOrCreateLink(db, u, c.id);
const click = (link, visitor = "v1") => R.recordClick(db, link, visitor).token;
const buy = (c, { qty = 1, email = "buyer@y.com", ref } = {}) =>
  simBuy(db, c.external_event_id, { name: "רוכש", email, qty, ref });
const sale = () => db.prepare("SELECT * FROM commissions WHERE kind = 'sale' ORDER BY id DESC").get();

// ---------- כסף וזמן ----------

test("סכומים נשמרים באגורות בלי floating point", () => {
  assert.equal(shekelsToAgorot("80"), 8000);
  assert.equal(shekelsToAgorot("19.9"), 1990);
  assert.equal(shekelsToAgorot("0.1"), 10);
  assert.equal(shekelsToAgorot("1.234"), null);
  assert.equal(shekelsToAgorot("-5"), null);
});

test("שעון ישראל כולל שעון קיץ", () => {
  assert.equal(israelLocalToIso("2026-12-20T21:00"), "2026-12-20T19:00:00.000Z");
  assert.equal(israelLocalToIso("2026-07-20T21:00"), "2026-07-20T18:00:00.000Z");
  assert.equal(isoToIsraelLocal("2026-07-20T18:00:00.000Z"), "2026-07-20T21:00");
});

// ---------- קמפיינים ----------

test("חלוקת מחיר כמו בדוגמה ב-PRD: 80 → 20 מקדם, 4 פלטפורמה, 56 אמן", () => {
  assert.deepEqual(C.split(8000, 2000), { price: 8000, reward: 2000, fee: 400, artist: 5600 });
});

test("יצירת קמפיין מפרסמת אותו ורושמת אותו אצל ספק הכרטוס", () => {
  const c = newCampaign();
  assert.equal(c.status, "active");
  assert.equal(c.reward_agorot, 2000);
  assert.ok(db.prepare("SELECT 1 FROM sim_events WHERE external_id = ?").get(c.external_event_id));
});

test("תגמול שלא משאיר כלום לאמן נדחה", () => {
  assert.throws(() => newCampaign({ reward: "79" }), /גבוה מדי/);
  assert.throws(() => newCampaign({ starts_at: "2020-01-01T20:00" }), /עברה/);
});

test("מעברי מצב: רק חוקיים", () => {
  const c = newCampaign();
  C.setStatus(db, artist, c.id, "paused");
  C.setStatus(db, artist, c.id, "active");
  C.setStatus(db, artist, c.id, "ended");
  assert.throws(() => C.setStatus(db, artist, c.id, "active"), /אי אפשר/);
});

// ---------- שיוך ----------

test("רכישה דרך לינק: תגמול ממתין + התראה למקדם", () => {
  const c = newCampaign();
  const link = linkFor(promoter, c);
  buy(c, { qty: 2, ref: click(link) });
  const s = sale();
  assert.equal(s.amount_agorot, 4000);
  assert.equal(s.status, "pending");
  assert.equal(s.promoter_id, promoter.id);
  const n = db.prepare("SELECT body FROM notifications WHERE user_id = ?").get(promoter.id);
  assert.match(n.body, /בזכותך.*₪40.*בכפוף לאישור/);
  assert.deepEqual(R.linkStats(db, link.id), { clicks: 1, tickets: 2 });
});

test("לינק אישי אחד לכל מקדם בכל הופעה", () => {
  const c = newCampaign();
  assert.equal(linkFor(promoter, c).id, linkFor(promoter, c).id);
  assert.notEqual(linkFor(promoter, c).id, linkFor(other, c).id);
});

test("רכישה ישירה, רכישה עצמית ולחיצה ישנה לא מזכות", () => {
  const c = newCampaign();
  const link = linkFor(promoter, c);
  buy(c, {});
  buy(c, { email: "DANI@x.com", ref: click(link, "self") });
  const old = click(link, "old");
  clock.advanceDays(31);
  // ההופעה עוד לא עברה? מזיזים את ההופעה כדי לבדוק רק את חלון השיוך
  db.prepare("UPDATE events SET starts_at = ?").run("2027-03-01T19:00:00.000Z");
  buy(c, { email: "late@y.com", ref: old });
  const reasons = db.prepare("SELECT attribution FROM orders ORDER BY id").all().map((r) => r.attribution);
  assert.deepEqual(reasons, ["direct", "self_purchase", "click_expired"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commissions").get().n, 0);
});

test("הלחיצה האחרונה זוכה", () => {
  const c = newCampaign();
  click(linkFor(promoter, c), "v");
  const last = click(linkFor(other, c), "v");
  buy(c, { ref: last });
  assert.equal(sale().promoter_id, other.id);
});

test("קמפיין מושהה: הרכישה נרשמת אבל לא מזכה בתגמול", () => {
  const c = newCampaign();
  const ref = click(linkFor(promoter, c));
  C.setStatus(db, artist, c.id, "paused");
  buy(c, { ref });
  assert.equal(db.prepare("SELECT attribution FROM orders").get().attribution, "campaign_paused");
  assert.equal(sale(), undefined);
});

test("מגבלת כרטיסים לקידום: תגמול חלקי ואז 'אזל' אוטומטית", () => {
  const c = newCampaign({ promo_limit: "3" });
  const link = linkFor(promoter, c);
  buy(c, { qty: 2, ref: click(link, "a") });
  buy(c, { qty: 2, ref: click(link, "b") });
  assert.equal(sale().amount_agorot, 2000); // רק כרטיס אחד מתוך 2 נכנס במכסה
  assert.equal(C.getCampaign(db, c.id).status, "sold_out");
  buy(c, { qty: 1, ref: click(link, "c") });
  assert.equal(db.prepare("SELECT attribution FROM orders ORDER BY id DESC").get().attribution, "campaign_sold_out");
});

test("שינוי תגמול חל רק על מכירות עתידיות", () => {
  const c = newCampaign();
  const link = linkFor(promoter, c);
  buy(c, { ref: click(link, "a") });
  C.changeReward(db, artist, c.id, "30");
  buy(c, { ref: click(link, "b") });
  const amounts = db.prepare("SELECT amount_agorot FROM commissions ORDER BY id").all().map((r) => r.amount_agorot);
  assert.deepEqual(amounts, [2000, 3000]);
});

// ---------- webhooks ----------

test("webhook עם חתימה שגויה נדחה", () => {
  const raw = JSON.stringify({ id: "evt_x", type: "order.paid", data: {} });
  assert.throws(() => I.ingestWebhook(db, "sim", raw, { "x-sim-signature": "t=1,v1=" + "0".repeat(64) }), /signature/);
  const sig = signSim(raw);
  assert.throws(() => I.ingestWebhook(db, "sim", raw.replace("evt_x", "evt_y"), { "x-sim-signature": sig }), /signature/);
});

test("אותו אירוע פעמיים לא יוצר תגמול כפול; גם לא אותה הזמנה באירוע אחר", () => {
  const c = newCampaign();
  const ref = click(linkFor(promoter, c));
  let captured;
  setSimDeliver((raw, h) => {
    captured = raw;
    return I.ingestWebhook(db, "sim", raw, h);
  });
  buy(c, { ref });
  assert.equal(simReplay(captured).status, "duplicate");
  const again = JSON.parse(captured);
  again.id = "evt_other";
  assert.match(simReplay(JSON.stringify(again)).result, /duplicate_order/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commissions").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 1);
});

test("החזר שמגיע לפני הרכישה: נדחה כדי שהספק ינסה שוב, בלי להיחשב כמעובד", () => {
  const raw = JSON.stringify({ id: "evt_r", type: "order.refunded", created: T0, data: { order_id: "nope", refunded_qty: 1 } });
  assert.throws(() => I.ingestWebhook(db, "sim", raw, { "x-sim-signature": signSim(raw) }), I.RetryLater);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM webhook_events").get().n, 0);
});

// ---------- החזרים וביטולים ----------

test("החזר חלקי מוריד קודם כרטיסים שלא זיכו; החזר מלא מבטל את התגמול", () => {
  const c = newCampaign({ promo_limit: "2" });
  const { id } = buy(c, { qty: 3, ref: click(linkFor(promoter, c)) }); // 2 מזכים, 1 לא
  simRefund(db, id, 1);
  assert.equal(sale().amount_agorot, 4000);
  simRefund(db, id, 1);
  assert.equal(sale().amount_agorot, 2000);
  simRefund(db, id, 1);
  assert.equal(sale().amount_agorot, 0);
  assert.equal(sale().status, "reversed");
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("ביטול הופעה מבטל את כל התגמולים", () => {
  const c = newCampaign();
  buy(c, { qty: 2, ref: click(linkFor(promoter, c)) });
  simCancelEvent(db, c.external_event_id);
  assert.equal(C.getCampaign(db, c.id).status, "cancelled");
  assert.equal(sale().status, "reversed");
  assert.equal(M.balances(db, promoter.id).pending, 0);
});

// ---------- שחרור ותשלום ----------

function sellAndSettle(qty = 3) {
  const c = newCampaign();
  const o = buy(c, { qty, ref: click(linkFor(promoter, c)) });
  clock.set("2026-12-24T10:00:00.000Z"); // 3+ ימים אחרי ההופעה
  M.settle(db);
  return { c, o };
}

const payoutInput = { full_name: "דני כהן", method: "bit", phone: "050-123-4567", adult: "on" };

test("אחרי ההופעה וחלון ההחזרים: הקמפיין מסתיים והתגמול זמין", () => {
  const c = newCampaign();
  buy(c, { qty: 3, ref: click(linkFor(promoter, c)) });
  clock.set("2026-12-21T10:00:00.000Z");
  M.settle(db);
  assert.equal(C.getCampaign(db, c.id).status, "ended");
  assert.equal(M.balances(db, promoter.id).pending, 6000); // עוד בחלון ההחזרים
  clock.set("2026-12-24T10:00:00.000Z");
  M.settle(db);
  assert.deepEqual(M.balances(db, promoter.id), { pending: 0, available: 6000, disputed: 0, inTransit: 0, paid: 0 });
});

test("בקשת תשלום דורשת פרטים מוצפנים וגיל 18, ותשלום כפול לא אפשרי", () => {
  sellAndSettle();
  const admin = user("ops@x.com", "Ops");
  assert.throws(() => M.requestPayout(db, promoter), /לאן להעביר/);
  assert.throws(() => M.savePayoutDetails(db, promoter, { ...payoutInput, adult: undefined }), /18/);
  M.savePayoutDetails(db, promoter, payoutInput);
  const u = ID.getUser(db, promoter.id);
  assert.doesNotMatch(u.payout_details_enc, /0501234567/);
  assert.equal(M.payoutDetails(u).phone, "0501234567");

  const pid = M.requestPayout(db, promoter);
  assert.throws(() => M.requestPayout(db, promoter), /בטיפול/);
  assert.equal(M.balances(db, promoter.id).inTransit, 6000);
  M.decidePayout(db, admin, pid, "paid", "BIT-123");
  M.decidePayout(db, admin, pid, "paid", "BIT-123"); // לחיצה כפולה
  assert.deepEqual(M.balances(db, promoter.id), { pending: 0, available: 0, disputed: 0, inTransit: 0, paid: 6000 });
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("החזר אחרי שהתגמול שולם יוצר קיזוז מהתשלום הבא", () => {
  const { o } = sellAndSettle();
  const admin = user("ops@x.com", "Ops");
  M.savePayoutDetails(db, promoter, payoutInput);
  M.decidePayout(db, admin, M.requestPayout(db, promoter), "paid", "X1");
  simRefund(db, o.id, 1);
  assert.equal(sale().status, "paid");
  assert.equal(sale().amount_agorot, 6000);
  assert.equal(M.balances(db, promoter.id).available, -2000);
  simRefund(db, o.id, 0 + 1); // החזר נוסף
  assert.equal(M.balances(db, promoter.id).available, -4000);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("תשלום שנכשל מחזיר את הכסף ליתרה הזמינה", () => {
  sellAndSettle();
  const admin = user("ops@x.com", "Ops");
  M.savePayoutDetails(db, promoter, payoutInput);
  M.decidePayout(db, admin, M.requestPayout(db, promoter), "failed", "חשבון שגוי");
  assert.equal(M.balances(db, promoter.id).available, 6000);
});

test("מקדם מוקפא: תגמולים לא משתחררים ומכירות חדשות לא מזכות", () => {
  const c = newCampaign();
  const link = linkFor(promoter, c);
  buy(c, { ref: click(link, "a") });
  ID.setFrozen(db, artist.id, promoter.id, true);
  buy(c, { ref: click(link, "b") });
  assert.equal(db.prepare("SELECT attribution FROM orders ORDER BY id DESC").get().attribution, "promoter_frozen");
  clock.set("2026-12-24T10:00:00.000Z");
  M.settle(db);
  assert.equal(M.balances(db, promoter.id).pending, 2000);
});

test("מחלוקת עם התאמה מתועדת ביומן", () => {
  const admin = user("ops@x.com", "Ops");
  const d = M.openDispute(db, promoter, { message: "חבר קנה ולא נספר" });
  M.resolveDispute(db, admin, d, { outcome: "resolved", resolution: "אומת מול הספק", adjustment: "20" });
  assert.equal(M.balances(db, promoter.id).available, 2000);
  assert.throws(() => M.resolveDispute(db, admin, d, { outcome: "resolved", resolution: "x" }), /כבר טופלה/);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("היומן לא ניתן לעריכה או מחיקה", () => {
  const c = newCampaign();
  buy(c, { ref: click(linkFor(promoter, c)) });
  assert.throws(() => db.exec("UPDATE ledger SET amount_agorot = 1"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM audit_log"), /append-only/);
});

// ---------- מדדי קהל ----------

test("'קנו לראשונה' נמדד לפי האמן, לא לפי הופעה", () => {
  const c1 = newCampaign();
  const c2 = newCampaign({ title: "הופעה שנייה" });
  buy(c1, { email: "fan@y.com", ref: click(linkFor(promoter, c1), "1") });
  buy(c2, { email: "fan@y.com", ref: click(linkFor(promoter, c2), "2") });
  buy(c2, { email: "new@y.com", ref: click(linkFor(promoter, c2), "3") });
  assert.equal(C.campaignResults(db, c1.id).first_time, 1);
  assert.equal(C.campaignResults(db, c2.id).first_time, 1);
});

test("מרקטפלייס: רק פעילים, ומעדיף את הערים שהמקדם כבר קידם בהן", () => {
  const ta = newCampaign();
  const hf = newCampaign({ title: "חיפה", city: "חיפה" });
  const paused = newCampaign({ title: "מושהה" });
  C.setStatus(db, artist, paused.id, "paused");
  linkFor(promoter, hf);
  const list = C.marketplace(db, { userId: promoter.id });
  assert.deepEqual(list.map((r) => r.id), [hf.id, ta.id]);
  assert.equal(list[0].promoting, true);
});

// ---------- כניסה ----------

test("כניסה עם קוד חד-פעמי: ניסיונות מוגבלים, קוד לא עובד פעמיים", () => {
  const { code } = ID.requestLoginCode(db, "New@Y.com");
  assert.throws(() => ID.verifyLoginCode(db, "new@y.com", "000000" === code ? "111111" : "000000"), /לא נכון/);
  const { user: u, sessionToken } = ID.verifyLoginCode(db, "new@y.com", code);
  assert.equal(u.email, "new@y.com");
  assert.equal(ID.userFromSession(db, sessionToken).id, u.id);
  assert.throws(() => ID.verifyLoginCode(db, "new@y.com", code), /פג תוקף|שומש/);
});

test("5 ניסיונות שגויים חוסמים את הקוד", () => {
  const { code } = ID.requestLoginCode(db, "a@y.com");
  const wrong = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.throws(() => ID.verifyLoginCode(db, "a@y.com", wrong), /לא נכון/);
  assert.throws(() => ID.verifyLoginCode(db, "a@y.com", code), /יותר מדי/);
});

// ---------- חילוץ פרטים ----------

test("חילוץ פרטי הופעה מ-JSON-LD", () => {
  const html = `<html><head><title>x</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
      {"@type":"MusicEvent","name":"ערב שירים","startDate":"2026-12-20T21:00:00+02:00",
       "location":{"@type":"Place","name":"הבארבי","address":{"addressLocality":"תל אביב"}},
       "performer":{"@type":"MusicGroup","name":"הלהקה"},"offers":{"price":"95"},"image":["https://img.example/p.jpg"]}]}
    </script></head></html>`;
  assert.deepEqual(parseShowHtml(html), {
    title: "ערב שירים", artist_name: "הלהקה", starts_at: "2026-12-20T21:00", venue: "הבארבי",
    city: "תל אביב", price: "95", image_url: "https://img.example/p.jpg",
  });
});

test("חילוץ נופל ל-Open Graph כשאין JSON-LD", () => {
  const html = `<meta property="og:title" content="Live &amp; Loud"><meta property="og:image" content="https://i.example/a.png">`;
  assert.deepEqual(parseShowHtml(html), { title: "Live & Loud", image_url: "https://i.example/a.png" });
});

test("הגנת SSRF חוסמת כתובות פנימיות", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "172.20.0.1", "::1", "::ffff:127.0.0.1", "fd00::1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp("93.184.216.34"), false);
});
