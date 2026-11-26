import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import forge from "node-forge";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as T from "../src/domain/tickets.js";
import { sandboxPay } from "../src/payments/sandbox.js";
import { applePass, googleSaveUrl, walletEnabled } from "../src/wallet.js";

/** תעודות בדיקה: "תעודת ביניים" שחותמת על תעודת ה-Pass, כמו המבנה של Apple */
function testCerts() {
  const mk = (subject, issuer, signKey, pub, isCA) => {
    const c = forge.pki.createCertificate();
    c.publicKey = pub; c.serialNumber = String(Math.floor(Math.random() * 1e9));
    c.validity.notBefore = new Date(Date.now() - 86400000); c.validity.notAfter = new Date(Date.now() + 365 * 86400000);
    c.setSubject([{ name: "commonName", value: subject }]); c.setIssuer([{ name: "commonName", value: issuer }]);
    c.setExtensions([{ name: "basicConstraints", cA: isCA }]);
    c.sign(signKey, forge.md.sha256.create());
    return c;
  };
  const ca = forge.pki.rsa.generateKeyPair(2048);
  const leaf = forge.pki.rsa.generateKeyPair(2048);
  const caCert = mk("Test WWDR", "Test WWDR", ca.privateKey, ca.publicKey, true);
  const leafCert = mk("Pass Type ID: pass.test.jocares", "Test WWDR", ca.privateKey, leaf.publicKey, false);
  return { wwdr: forge.pki.certificateToPem(caCert), cert: forge.pki.certificateToPem(leafCert), key: forge.pki.privateKeyToPem(leaf.privateKey) };
}

let db, org;
const SHOW = { artist_name: "נועה", title: "ערב", venue: "בארבי", city: "תל אביב", starts_at: "2026-12-20T21:00", price: "80", reward: "20", image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "50" };
const buy = (c, input) => {
  const o = T.createOrder(db, c.id, input);
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  return T.returnFromPayment(db, T.ticketOrder(db, o.id));
};
beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  org = ID.getUser(db, insert(db, "users", { email: "o@x.com", email_hash: emailHash("o@x.com"), name: "נועה", created_at: clock.iso() }));
});
after(() => clock.set(null));

test("כרטיס שמי: שם לכל כרטיס, הראשון ברירת מחדל לשם הקונה, ובכניסה מוצג השם", () => {
  const c = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, ticket_mode: "named" }));
  assert.equal(c.ticket_mode, "named");
  assert.throws(() => T.createOrder(db, c.id, { name: "דנה לוי", email: "d@y.com", qty: 2 }), /שם על כרטיס 2/);
  const o = buy(c, { name: "דנה לוי", email: "d@y.com", qty: 2, holder_2: "רון כהן" });
  const [t1, t2] = T.ticketsOf(db, o.id);
  assert.deepEqual([t1.holder_name, t2.holder_name], ["דנה לוי", "רון כהן"]);
  assert.equal(T.checkIn(db, c, t2.code).t.holder_name, "רון כהן");
  const open = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, title: "פתוח" }));
  assert.equal(open.ticket_mode, "open");
  assert.equal(T.ticketsOf(db, buy(open, { name: "א", email: "a@y.com", qty: 1 }).id)[0].holder_name, "");
});

test("Apple Wallet: pkpass עם pass.json, אייקונים, מניפסט נכון וחתימה שעוברת אימות", () => {
  const certs = testCerts();
  Object.assign(process.env, { APPLE_PASS_TYPE_ID: "pass.test.jocares", APPLE_PASS_TEAM_ID: "TEAM1", APPLE_PASS_CERT: certs.cert, APPLE_PASS_KEY: certs.key, APPLE_WWDR_CERT: certs.wwdr });
  assert.equal(walletEnabled().apple, true);
  const c = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, ticket_mode: "named" }));
  const t = T.ticketsOf(db, buy(c, { name: "דנה לוי", email: "d@y.com", qty: 1 }).id)[0];
  const zip = applePass(c, t, { holder: "דנה לוי", named: true, url: "https://j.example/tickets/x" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pass-"));
  fs.writeFileSync(path.join(dir, "p.pkpass"), zip);
  execFileSync("unzip", ["-q", "p.pkpass"], { cwd: dir });
  const pass = JSON.parse(fs.readFileSync(path.join(dir, "pass.json"), "utf8"));
  assert.equal(pass.serialNumber, t.code);
  assert.equal(pass.barcodes[0].message, t.code);
  assert.equal(pass.eventTicket.auxiliaryFields[0].value, "דנה לוי");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const f of ["pass.json", "icon.png", "icon@2x.png"]) {
    assert.equal(manifest[f], crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f);
  }
  fs.writeFileSync(path.join(dir, "ca.pem"), certs.wwdr);
  execFileSync("openssl", ["smime", "-verify", "-binary", "-inform", "DER", "-in", "signature", "-content", "manifest.json", "-CAfile", "ca.pem", "-purpose", "any", "-out", "/dev/null"], { cwd: dir, stdio: "pipe" });
});

test("Google Wallet: קישור שמירה עם JWT חתום RS256, עם הקוד והשם", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, { GOOGLE_WALLET_ISSUER_ID: "3388000000012345", GOOGLE_WALLET_SA_EMAIL: "wallet@jocares.iam.gserviceaccount.com", GOOGLE_WALLET_SA_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) });
  const c = C.getCampaign(db, C.createCampaign(db, org, SHOW));
  const t = T.ticketsOf(db, buy(c, { name: "דנה", email: "d@y.com", qty: 1 }).id)[0];
  const url = googleSaveUrl(c, t, { holder: "דנה", origin: "https://j.example" });
  assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  const [h, b, s] = url.split("/save/")[1].split(".");
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, "base64url")));
  const p = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(p.typ, "savetowallet");
  const obj = p.payload.eventTicketObjects[0];
  assert.equal(obj.barcode.value, t.code);
  assert.equal(obj.ticketHolderName, "דנה");
  assert.equal(obj.classId, `3388000000012345.jocares_show_${c.id}`);
});

// ---------- עיצוב, מצבים ושירות העדכונים ----------
import http from "node:http";
import { createApp } from "../src/server.js";
import { resetRateLimits } from "../src/http.js";
import { saveImage } from "../src/media.js";
import { demoImage } from "../src/demo-images.js";
import * as DR from "../src/domain/door.js";
import * as WS from "../src/wallet-service.js";
import { passJson, passAuthToken } from "../src/wallet.js";

const unzip = (zip) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pass-"));
  fs.writeFileSync(path.join(dir, "p.pkpass"), zip);
  execFileSync("unzip", ["-q", "p.pkpass"], { cwd: dir });
  return { dir, files: fs.readdirSync(dir), pass: JSON.parse(fs.readFileSync(path.join(dir, "pass.json"), "utf8")) };
};
const appleEnv = () => {
  const certs = testCerts();
  Object.assign(process.env, { APPLE_PASS_TYPE_ID: "pass.test.jocares", APPLE_PASS_TEAM_ID: "TEAM1", APPLE_PASS_CERT: certs.cert, APPLE_PASS_KEY: certs.key, APPLE_WWDR_CERT: certs.wwdr });
};

test("Apple Wallet: כרטיס כהה עם תמונת ההופעה, לוגו, מספר כרטיס, וכרטיס שמי שאי אפשר להעביר", () => {
  appleEnv();
  process.env.ENCORE_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
  const image_url = saveImage({ data: demoImage(7, "rays", 640, 480) });
  const c = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, image_url, ticket_mode: "named" }));
  const o = buy(c, { name: "דנה לוי", email: "d@y.com", qty: 2, holder_2: "רון כהן" });
  const t = T.ticketsOf(db, o.id)[1];
  const { files, pass, dir } = unzip(applePass(c, t, { holder: t.holder_name, named: true, qty: 2, origin: "https://jocares.example" }));
  for (const f of ["logo.png", "logo@2x.png", "strip.png", "strip@2x.png", "strip@3x.png", "icon@3x.png"]) assert.ok(files.includes(f), f);
  // מידות הרצועה לפי Apple: 375x123 נקודות
  const png = fs.readFileSync(path.join(dir, "strip@2x.png"));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [750, 246]);
  assert.equal(pass.backgroundColor, "rgb(21, 21, 21)");
  assert.equal(pass.sharingProhibited, true);
  assert.equal(pass.webServiceURL, "https://jocares.example/wallet/apple");
  assert.equal(pass.authenticationToken, passAuthToken(t));
  const aux = Object.fromEntries(pass.eventTicket.auxiliaryFields.map((f) => [f.key, f.value]));
  assert.deepEqual(aux, { holder: "רון כהן", seq: "2 מתוך 2", id: "תעודה מזהה" });
  assert.ok(!JSON.stringify(pass).includes("דנה"), "בכרטיס של רון לא מופיע שם הקונה");
  // כרטיס רגיל: אפשר להעביר, ובלי שם הקונה
  const open = C.getCampaign(db, C.createCampaign(db, org, { ...SHOW, title: "פתוח" }));
  const t2 = T.ticketsOf(db, buy(open, { name: "דנה", email: "d@y.com", qty: 1 }).id)[0];
  const p2 = passJson(open, t2, { qty: 1, origin: "http://localhost:3000" });
  assert.equal(p2.sharingProhibited, undefined);
  assert.equal(p2.webServiceURL, undefined, "שירות העדכונים רק ב-https");
  assert.deepEqual(p2.eventTicket.auxiliaryFields, []);
  delete process.env.ENCORE_MEDIA_DIR;
});

test("Apple Wallet: הכרטיס משתנה לפי המצב: נכנס/ה בשעה, או בוטל, ובשניהם בלי QR", () => {
  const c = C.getCampaign(db, C.createCampaign(db, org, SHOW));
  const o = buy(c, { name: "דנה", email: "d@y.com", qty: 2 });
  const [t1, t2] = T.ticketsOf(db, o.id);
  assert.equal(passJson(c, t1, {}).barcodes[0].message, t1.code);
  assert.equal(passJson(c, t1, {}).eventTicket.headerFields[0].value, "כניסה אחת");
  DR.admit(db, c, { code: t1.code });
  const used = passJson(c, T.ticketsOf(db, o.id)[0], {});
  assert.equal(used.voided, true);
  assert.equal(used.barcodes, undefined);
  assert.match(used.eventTicket.headerFields[0].value, /^נכנס\/ה \d\d:\d\d$/);
  T.refundTickets(db, org, o.id, 1);
  const refunded = T.ticketsOf(db, o.id).find((t) => t.status === "refunded");
  assert.equal(refunded.id, t2.id);
  assert.equal(passJson(c, refunded, {}).eventTicket.headerFields[0].value, "בוטל");
});

test("שירות העדכונים של Apple: רישום מכשיר, שינוי בכניסה, דחיפה, הורדת כרטיס עדכני וביטול רישום", async () => {
  appleEnv();
  resetRateLimits();
  const c = C.getCampaign(db, C.createCampaign(db, org, SHOW));
  const o = buy(c, { name: "דנה", email: "d@y.com", qty: 1 });
  const t = T.ticketsOf(db, o.id)[0];
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/wallet/apple/v1`;
  const dev = "a1b2c3d4e5f6a7b8";
  const reg = `${base}/devices/${dev}/registrations/pass.test.jocares`;
  const auth = { authorization: `ApplePass ${passAuthToken(t)}` };
  const post = (url, headers, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(`${reg}/${t.code}`, { authorization: "ApplePass wrongwrongwrongwrong" }, { pushToken: "ff".repeat(32) })).status, 401);
    assert.equal((await post(`${base}/devices/${dev}/registrations/pass.other/${t.code}`, auth, { pushToken: "ff".repeat(32) })).status, 404);
    assert.equal((await post(`${reg}/${t.code}`, auth, { pushToken: "ff".repeat(32) })).status, 201);
    assert.equal((await post(`${reg}/${t.code}`, auth, { pushToken: "ff".repeat(32) })).status, 200);

    let r = await fetch(reg);
    const first = await r.json();
    assert.deepEqual(first.serialNumbers, [t.code]);

    // כניסה בדלת: הכרטיס מסומן כמשתנה, ונשלחת דחיפה אחת למכשיר
    await new Promise((res) => setTimeout(res, 5));
    DR.admit(db, c, { code: t.code });
    const pushed = [];
    assert.equal(await WS.pushUpdates(db, async (tok) => (pushed.push(tok), 200)), 1);
    assert.deepEqual(pushed, ["ff".repeat(32)]);
    assert.equal(await WS.pushUpdates(db, async () => 200), 0, "לא דוחפים פעמיים על אותו שינוי");

    r = await fetch(`${reg}?passesUpdatedSince=${encodeURIComponent(first.lastUpdated)}`);
    assert.deepEqual((await r.json()).serialNumbers, [t.code]);

    r = await fetch(`${base}/passes/pass.test.jocares/${t.code}`, { headers: auth });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/vnd.apple.pkpass");
    const lm = r.headers.get("last-modified");
    const { pass } = unzip(Buffer.from(await r.arrayBuffer()));
    assert.equal(pass.voided, true);
    assert.equal((await fetch(`${base}/passes/pass.test.jocares/${t.code}`, { headers: { ...auth, "if-modified-since": lm } })).status, 304);
    assert.equal((await fetch(`${base}/passes/pass.test.jocares/${t.code}`)).status, 401);

    // מכשיר שהסיר את הכרטיס: Apple מחזירה 410 והרישום נמחק
    DR.undo(db, c, t.id);
    await WS.pushUpdates(db, async () => 410);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_registrations").get().n, 0);

    assert.equal((await post(`${reg}/${t.code}`, auth, { pushToken: "ee".repeat(32) })).status, 201);
    assert.equal((await fetch(`${reg}/${t.code}`, { method: "DELETE", headers: auth })).status, 200);
    assert.equal((await fetch(reg)).status, 204);
  } finally {
    server.close();
  }
});
