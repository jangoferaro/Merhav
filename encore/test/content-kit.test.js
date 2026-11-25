import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as R from "../src/domain/referrals.js";
import * as K from "../src/domain/content.js";
import { saveMedia, serveMedia, sniffVideo } from "../src/media.js";

process.env.ENCORE_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jo-media-"));
let db, artist, dani, camp, svc;
const user = (email, name) => ID.getUser(db, insert(db, "users", { email, email_hash: emailHash(email), name, created_at: clock.iso() }));
// MP4 מינימלי: רק כותרת ftyp (מספיק לזיהוי הסוג)
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(200, 1)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  "), Buffer.alloc(50, 1)]);

beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  artist = user("artist@x.com", "נועה");
  dani = user("dani@x.com", "דני כהן");
  camp = C.getCampaign(db, C.createCampaign(db, artist, {
    artist_name: "נועה", title: "ערב", venue: "בארבי", starts_at: "2026-12-20T21:00", price: "80", reward: "20",
    image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "100",
  }));
  K.saveProfile(db, dani, { display_name: "דני", image_url: "https://img.example/d.jpg", kinds: ["content"] });
  K.saveService(db, dani, { template: "recommend", price: "150" });
  svc = K.servicesOf(db, dani.id)[0];
});
after(() => clock.set(null));

test("וידאו: מזוהה לפי הבתים, נשמר, ומוגש עם Range (נדרש לאייפון)", async () => {
  assert.equal(sniffVideo(MP4), "mp4");
  assert.equal(sniffVideo(MOV), "mov");
  const m = saveMedia({ data: MP4 });
  assert.equal(m.kind, "video");
  assert.match(m.url, /^\/media\/[\w-]{16}\.mp4$/);
  const server = http.createServer((req, res) => serveMedia(req.url.slice(7), res, req.headers.range) || res.end("404"));
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${m.url}`, { headers: { range: "bytes=0-9" } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), `bytes 0-9/${MP4.length}`);
    assert.equal(r.headers.get("content-type"), "video/mp4");
    assert.equal((await r.arrayBuffer()).byteLength, 10);
  } finally {
    server.close();
  }
});

test("ג׳וקר מציע סרטון המלצה → האמן מזמין → היוצר מעלה סרטון → אושר → נכנס לערכת השיתוף עם קרדיט", () => {
  R.getOrCreateLink(db, dani, camp.id);
  K.offerService(db, dani, camp.id, { service_id: svc.id, message: "אני בא לכל ההופעות שלכם" });
  assert.throws(() => K.offerService(db, dani, camp.id, { service_id: svc.id }), /כבר שלחת/);
  assert.match(db.prepare("SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC").get(artist.id).body, /מציע\/ה לך: סרטון המלצה/);
  const offers = K.offersFor(db, camp.id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].message, "אני בא לכל ההופעות שלכם");

  const orderId = K.placeOrder(db, artist, svc.id, { artist_name: "נועה", goal: "show", campaign_id: String(camp.id), rights: "on" });
  assert.equal(K.offersFor(db, camp.id).length, 0);
  assert.equal(K.myOffer(db, dani.id, camp.id).status, "ordered");
  assert.equal(K.getOrder(db, orderId).terms.joker_share, true);

  K.acceptOrder(db, dani, orderId);
  K.submitDeliverable(db, dani, orderId, { media: { data: MP4 }, note: "גרסה ראשונה" });
  assert.equal(R.assetsOf(db, camp.id).length, 0); // רק אחרי אישור
  K.approveOrder(db, artist, orderId);
  const [a] = R.assetsOf(db, camp.id);
  assert.equal(a.kind, "video");
  assert.equal(a.credit, "דני");
  assert.equal(a.service_order_id, orderId);
});

test("לא מציעים לעצמך, ותוצר שהוא קישור חיצוני לא נכנס לערכה", () => {
  K.saveProfile(db, artist, { display_name: "נועה", image_url: "https://img.example/n.jpg", kinds: ["content"] });
  K.saveService(db, artist, { template: "recommend", price: "100" });
  assert.throws(() => K.offerService(db, artist, camp.id, { service_id: K.servicesOf(db, artist.id)[0].id }), /לעצמך/);
  const orderId = K.placeOrder(db, artist, svc.id, { artist_name: "נועה", campaign_id: String(camp.id), rights: "on" });
  K.acceptOrder(db, dani, orderId);
  K.submitDeliverable(db, dani, orderId, { url: "https://drive.example/x" });
  K.approveOrder(db, artist, orderId);
  assert.equal(R.assetsOf(db, camp.id).length, 0);
});
