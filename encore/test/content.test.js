import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as K from "../src/domain/content.js";
import * as M from "../src/domain/money.js";
import * as I from "../src/domain/ingest.js";
import * as R from "../src/domain/referrals.js";
import { setSimDeliver, simBuy } from "../src/providers/sim.js";

let db, artist, creator, ops;
const user = (email, name, is_admin = 0) =>
  ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, is_admin, created_at: clock.iso() }));

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  setSimDeliver((raw, h) => I.ingestWebhook(db, "sim", raw, h));
  artist = user("artist@x.com", "נועה");
  creator = user("lior@x.com", "ליאור");
  ops = user("ops@x.com", "Ops", 1);
  K.saveProfile(db, creator, { display_name: "ליאור", genres: "אינדי, פופ", kinds: ["content"], city: "חיפה" });
});

const service = (over = {}) => K.saveService(db, creator, { template: "reel", price: "200", ...over });
const order = (sid, over = {}) => K.placeOrder(db, artist, sid, { artist_name: "נועה", goal: "music", rights: "on", ...over });
const st = (id) => K.getOrder(db, id).status;
const pay = (id) => db.prepare("SELECT * FROM service_payments WHERE order_id = ?").get(id);

test("מחיר 200 → 20 עמלה → 180 ליוצר, כמו בדוגמה ב-PRD", () => {
  assert.deepEqual(K.serviceSplit(20000), { price: 20000, fee: 2000, creator: 18000 });
});

test("מסלול מלא: הזמנה → אישור יוצר → תוצר → תיקון → אישור → הכסף ליוצר", () => {
  const id = order(service());
  assert.equal(st(id), "requested");
  assert.equal(pay(id).status, "authorized"); // הכסף נתפס אצל ספק התשלומים, לא אצלנו
  K.acceptOrder(db, creator, id);
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/v1" });
  K.requestRevision(db, artist, id, "אפשר כתוביות גדולות יותר?");
  assert.throws(() => K.requestRevision(db, artist, id, "עוד"), /אי אפשר לעבור|נוצלו/);
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/v2" });
  assert.throws(() => K.requestRevision(db, artist, id, "עוד אחד"), /נוצלו/);
  K.approveOrder(db, artist, id);
  assert.equal(st(id), "completed");
  assert.equal(pay(id).status, "captured");
  assert.equal(M.balances(db, creator.id).available, 18000);
  assert.equal(K.deliverablesOf(db, id).length, 2);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("התנאים נשמרים בהזמנה: שינוי מחיר אחר כך לא משנה אותה", () => {
  const sid = service();
  const id = order(sid);
  K.saveService(db, creator, { template: "reel", price: "500" }, sid);
  assert.equal(K.getOrder(db, id).price_agorot, 20000);
  assert.equal(K.getOrder(db, id).terms.license, "organic");
  assert.ok(K.getOrder(db, id).terms.license_points.length > 2);
});

test("יוצר מסרב או לא מגיב → ההרשאה משתחררת ולא מחויבים", () => {
  const a = order(service());
  K.declineOrder(db, creator, a);
  assert.equal(pay(a).status, "voided");
  const b = order(service({ template: "graphic", price: "150" }));
  clock.advanceDays(4);
  M.settle(db);
  assert.equal(st(b), "cancelled");
  assert.equal(pay(b).status, "voided");
});

test("אמן לא מגיב לתוצר 5 ימים → מאושר אוטומטית", () => {
  const id = order(service());
  K.acceptOrder(db, creator, id);
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/v1" });
  clock.advanceDays(6);
  M.settle(db);
  assert.equal(st(id), "completed");
  assert.equal(M.balances(db, creator.id).available, 18000);
});

test("ביטול: לפני אישור מותר; אחרי שהתחיל רק אם עבר מועד האספקה", () => {
  const id = order(service());
  K.acceptOrder(db, creator, id);
  assert.throws(() => K.cancelOrder(db, artist, id), /מועד האספקה/);
  clock.advanceDays(6);
  K.cancelOrder(db, artist, id);
  assert.equal(pay(id).status, "voided");
});

test("שירות עם פרסום: תוצר מאושר → פרסום עם קישור → אימות → תשלום", () => {
  const id = order(service({ template: "story_post", price: "150" }));
  K.acceptOrder(db, creator, id);
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/draft" });
  K.approveOrder(db, artist, id);
  assert.equal(st(id), "approved");
  assert.equal(M.balances(db, creator.id).available, 0); // עוד לא פורסם
  K.submitPublication(db, creator, id, { url: "https://instagram.com/stories/x/1" });
  clock.advanceDays(4);
  M.settle(db);
  assert.equal(st(id), "completed");
  assert.equal(K.publicationOf(db, id).method, "auto_link");
});

test("מחלוקת: הצוות מכריע בפשרה, והחיוב והזיכוי תואמים", () => {
  const id = order(service());
  K.acceptOrder(db, creator, id);
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/v1" });
  K.openOrderDispute(db, artist, id, "התוצר לא תואם לבריף");
  assert.equal(st(id), "disputed");
  assert.throws(() => K.approveOrder(db, artist, id), /אי אפשר לעבור/);
  K.resolveOrderDispute(db, ops, id, { outcome: "split", amount: "100", resolution: "חצי מהעבודה סופקה" });
  assert.equal(pay(id).captured_agorot, 10000);
  assert.equal(M.balances(db, creator.id).available, 9000);
  assert.deepEqual(M.reconciliationIssues(db), []);
});

test("הרשאות: רק הצד הנכון יכול לבצע כל פעולה", () => {
  const id = order(service());
  const stranger = user("s@x.com", "S");
  assert.throws(() => K.acceptOrder(db, artist, id), /לא נמצאה/);
  assert.throws(() => K.acceptOrder(db, stranger, id), /לא נמצאה/);
  assert.throws(() => K.placeOrder(db, creator, service(), { artist_name: "x", rights: "on" }), /מעצמך/);
  assert.throws(() => order(service(), { rights: undefined }), /זכות/);
});

test("מודל היברידי: הזמנה שקשורה להופעה נותנת ליוצר לינק אישי, ומכירות דרכו מזכות אותו", () => {
  const cid = C.createCampaign(db, artist, { artist_name: "נועה", title: "השקה", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20" });
  const id = order(service(), { campaign_id: String(cid) });
  K.acceptOrder(db, creator, id);
  const o = K.getOrder(db, id);
  assert.ok(o.link_id);
  assert.match(o.brief, /לינק האישי/);
  const link = db.prepare("SELECT * FROM referral_links WHERE id = ?").get(o.link_id);
  simBuy(db, C.getCampaign(db, cid).external_event_id, { name: "ק", email: "k@y.com", qty: 3, ref: R.recordClick(db, link, "v").token });
  K.submitDeliverable(db, creator, id, { url: "https://drive.example/v1" });
  K.approveOrder(db, artist, id);
  const b = M.balances(db, creator.id);
  assert.equal(b.available, 18000); // העבודה
  assert.equal(b.pending, 6000); // 3 כרטיסים × 20, אחרי ההופעה
});

test("גילוי יוצרים: התאמת סגנון מעל מחיר, ובלי יוצרים מוסתרים", () => {
  const other = user("o@x.com", "אחר");
  K.saveProfile(db, other, { display_name: "אחר", genres: "ג'אז" });
  K.saveService(db, other, { template: "reel", price: "50" });
  service();
  C.createCampaign(db, artist, { artist_name: "נועה", title: "x", venue: "v", genre: "אינדי", starts_at: "2026-12-20T21:00", price: "80", reward: "20" });
  let list = K.discoverCreators(db, { viewerId: artist.id });
  assert.equal(list[0].user_id, creator.id);
  assert.deepEqual(list[0].match, ["אינדי"]);
  K.setProfileStatus(db, ops, creator.id, "hidden");
  list = K.discoverCreators(db, { viewerId: artist.id });
  assert.deepEqual(list.map((c) => c.user_id), [other.id]);
  assert.deepEqual(K.discoverCreators(db, { kind: "exposure" }), []);
});
