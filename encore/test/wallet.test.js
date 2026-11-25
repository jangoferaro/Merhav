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
