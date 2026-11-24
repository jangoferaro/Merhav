import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as R from "../src/domain/referrals.js";
import * as M from "../src/domain/money.js";
import * as CP from "../src/domain/coupons.js";
import "../src/domain/ingest.js";

let db, artist, dani, maya, ops, camp, danLink, mayaLink;
const user = (email, name, is_admin = 0) =>
  ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, is_admin, created_at: clock.iso() }));

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני");
  maya = user("maya@x.com", "מאיה");
  ops = user("ops@x.com", "Ops", 1);
  camp = C.getCampaign(db, C.createCampaign(db, artist, {
    artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
    image_url: "https://img.example/a.jpg", source_url: "https://tickets.example/noa", ticketing: "coupon",
  }));
  danLink = R.getOrCreateLink(db, dani, camp.id);
  mayaLink = R.getOrCreateLink(db, maya, camp.id);
});

const importCsv = (csv) => {
  const id = CP.previewImport(db, ops, camp.id, { csv, filename: "export.csv" });
  return { id, d: CP.describeImport(db, id) };
};
const pending = () => M.balances(db, dani.id).pending;

test("הופעה עם לינק לאתר הכרטיסים נכנסת למסלול הקופונים, וכל ג׳וקר מקבל קוד", () => {
  assert.equal(camp.provider, "coupon");
  assert.match(danLink.coupon_code, /^JO[A-Z2-9]{6}$/);
  assert.notEqual(danLink.coupon_code, mayaLink.coupon_code);
  assert.match(R.shareText(camp, "https://j.example/r/x", danLink), new RegExp(`קוד בקופה: ${danLink.coupon_code}`));
  assert.throws(() => C.createCampaign(db, artist, { artist_name: "נועה", title: "x", venue: "v", starts_at: "2026-12-20T21:00", price: "80", reward: "20", image_url: "https://img.example/a.jpg", ticketing: "coupon" }), /לינק לעמוד הכרטיסים/);
});

test("ייבוא מכירות: תצוגה מקדימה לא משנה כלום, אישור יוצר תגמולים לפי הקוד", () => {
  const csv = `מס הזמנה,קוד קופון,כמות,סה"כ,תאריך\n1001,${danLink.coupon_code.toLowerCase()},2,160,03/12/2026 20:15\n1002,,1,80,03/12/2026\n1003,JOZZZZZZ,1,80,04/12/2026\n1004,${mayaLink.coupon_code},1,80,04/12/2026`;
  const { id, d } = importCsv(csv);
  assert.deepEqual(d.missing, []);
  assert.equal(d.counts.newMatched, 2);
  assert.deepEqual(d.counts.unknownCodes, ["JOZZZZZZ"]);
  assert.equal(pending(), 0); // תצוגה מקדימה בלבד
  CP.applyImport(db, ops, id);
  assert.equal(pending(), 4000);
  assert.equal(M.balances(db, maya.id).pending, 2000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 4);
  assert.throws(() => CP.applyImport(db, ops, id), /כבר טופל/);
  assert.match(db.prepare("SELECT body FROM notifications WHERE user_id = ?").get(dani.id).body, /עם הקוד שלך/);
});

test("אותו קובץ שוב לא סופר פעמיים, והחזר בקובץ הבא מוריד את התגמול", () => {
  const base = `order,coupon,qty,total,date\n1001,${danLink.coupon_code},2,160,2026-12-03`;
  CP.applyImport(db, ops, importCsv(base).id);
  const again = importCsv(base);
  assert.equal(again.d.counts.unchanged, 1);
  CP.applyImport(db, ops, again.id);
  assert.equal(pending(), 4000);
  const withRefund = importCsv(`${base}\n1001,${danLink.coupon_code},1,80,2026-12-05,refund`.replace("order,coupon,qty,total,date", "order,coupon,qty,total,date,status"));
  assert.equal(withRefund.d.counts.refunds, 1);
  CP.applyImport(db, ops, withRefund.id);
  assert.equal(pending(), 2000);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("הזכאות נבדקת לפי מצב הקמפיין ביום הקנייה, גם כשהקובץ מגיע אחרי ההופעה", () => {
  clock.set("2026-12-05T10:00:00.000Z");
  C.setStatus(db, artist, camp.id, "paused");
  clock.set("2026-12-07T10:00:00.000Z");
  C.setStatus(db, artist, camp.id, "active");
  clock.set("2026-12-22T10:00:00.000Z"); // אחרי ההופעה
  M.settle(db);
  assert.equal(C.getCampaign(db, camp.id).status, "ended");
  const { id } = importCsv(`order,coupon,qty,date\nA,${danLink.coupon_code},1,2026-12-04\nB,${danLink.coupon_code},1,2026-12-06\nC,${danLink.coupon_code},1,2026-12-10`);
  CP.applyImport(db, ops, id);
  const reasons = db.prepare("SELECT external_order_id, attribution FROM orders ORDER BY external_order_id").all().map((o) => o.attribution);
  assert.deepEqual(reasons, ["ok", "campaign_paused", "ok"]);
  assert.equal(pending(), 4000);
});

test("רכישה עצמית מזוהה כשבקובץ יש מייל של הקונה", () => {
  const { id } = importCsv(`order,coupon,qty,email\n1,${danLink.coupon_code},1,DANI@x.com\n2,${danLink.coupon_code},1,friend@y.com`);
  CP.applyImport(db, ops, id);
  assert.deepEqual(db.prepare("SELECT attribution FROM orders ORDER BY id").all().map((o) => o.attribution), ["self_purchase", "ok"]);
});

test("תור הצוות: קודים שממתינים להגדרה אצל ספק הכרטוס", () => {
  let q = CP.couponQueue(db);
  assert.equal(q[0].pending, 2);
  assert.equal(CP.markRegistered(db, ops, camp.id), 2);
  q = CP.couponQueue(db);
  assert.equal(q[0].pending, 0);
  R.getOrCreateLink(db, user("new@x.com", "חדש"), camp.id);
  assert.equal(CP.couponQueue(db)[0].pending, 1);
});

test("CSV: מרכאות, פסיק בתוך תא, נקודה-פסיק כמפריד", () => {
  const p = CP.parseCsv(`"מס' הזמנה";"קוד";"שם"\n7;JOAAAAAA;"כהן, דני"\n`);
  assert.deepEqual(p.rows[0], ["7", "JOAAAAAA", "כהן, דני"]);
  assert.throws(() => CP.parseCsv("רק כותרת\n"), /ריק/);
});

test("תאריך בלי שעה נחשב כסוף היום: מכירה ביום הפרסום נספרת", () => {
  clock.set("2026-12-10T15:00:00.000Z");
  const late = C.getCampaign(db, C.createCampaign(db, artist, {
    artist_name: "נועה", title: "מאוחר", venue: "v", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
    image_url: "https://img.example/a.jpg", source_url: "https://tickets.example/late", ticketing: "coupon",
  }));
  const l = R.getOrCreateLink(db, dani, late.id);
  for (const date of ["10/12/2026", "2026-12-10"]) {
    const id = CP.previewImport(db, ops, late.id, { csv: `order,coupon,date\n${date},${l.coupon_code},${date}` });
    CP.applyImport(db, ops, id);
  }
  assert.deepEqual(db.prepare("SELECT attribution FROM orders WHERE campaign_id = ?").all(late.id).map((o) => o.attribution), ["ok", "ok"]);
});
