import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db.js";
import { clock } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import { checkIdToken } from "../src/auth-google.js";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const claims = (over = {}) => ({
  iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600,
  nonce: "n1", email: "maya@gmail.com", email_verified: true, given_name: "מאיה", sub: "123", ...over,
});

test("בדיקת id_token: מנפיק, קהל, תוקף, nonce ומייל מאומת", () => {
  clock.set(null);
  assert.equal(checkIdToken(idToken(claims()), { nonce: "n1" }).email, "maya@gmail.com");
  assert.throws(() => checkIdToken(idToken(claims({ iss: "https://evil.example" })), { nonce: "n1" }), /מנפיק/);
  assert.throws(() => checkIdToken(idToken(claims({ aud: "other" })), { nonce: "n1" }), /לא נועד/);
  assert.throws(() => checkIdToken(idToken(claims({ exp: 1 })), { nonce: "n1" }), /פג תוקף/);
  assert.throws(() => checkIdToken(idToken(claims()), { nonce: "other" }), /לא תקינה/);
  assert.throws(() => checkIdToken(idToken(claims({ email_verified: false })), { nonce: "n1" }), /מאומת/);
});

let server, base, db, lastTokenRequest, nextClaims;
before(async () => {
  clock.set(null);
  db = openDb(":memory:");
  // מדמה את נקודת הטוקן של Google
  const fetchImpl = async (url, init) => {
    lastTokenRequest = { url, body: new URLSearchParams(init.body) };
    return { ok: true, json: async () => ({ id_token: idToken(nextClaims) }) };
  };
  server = http.createServer(createApp(db, { fetchImpl }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function googleRound({ tamperState = false, claimsOver = {} } = {}) {
  let res = await fetch(`${base}/auth/google?next=%2Fshows`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const google = new URL(res.headers.get("location"));
  assert.equal(google.host, "accounts.google.com");
  assert.equal(google.searchParams.get("code_challenge_method"), "S256");
  assert.equal(google.searchParams.get("redirect_uri"), `${base}/auth/google/callback`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  nextClaims = claims({ nonce: google.searchParams.get("nonce"), ...claimsOver });
  const state = tamperState ? "forged" : google.searchParams.get("state");
  res = await fetch(`${base}/auth/google/callback?code=abc&state=${state}`, { headers: { cookie }, redirect: "manual" });
  return res;
}

test("כניסה עם Google: יוצרת משתמש עם השם מ-Google, ובפעם השנייה מגיעה לאותו חשבון", async () => {
  resetRateLimits();
  let res = await googleRound();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/shows"); // יש שם מ-Google, אז לא צריך את מסך "איך קוראים לך"
  assert.match(res.headers.getSetCookie().join(";"), /sid=/);
  assert.ok(lastTokenRequest.body.get("code_verifier"));
  assert.equal(lastTokenRequest.body.get("code"), "abc");
  const u = db.prepare("SELECT * FROM users WHERE email = 'maya@gmail.com'").get();
  assert.equal(u.name, "מאיה");
  await googleRound();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'maya@gmail.com'").get().n, 1);
});

test("כניסה עם Google: state מזויף או מייל לא מאומת נדחים", async () => {
  resetRateLimits();
  let res = await googleRound({ tamperState: true });
  assert.equal(res.headers.get("location"), "/login");
  res = await googleRound({ claimsOver: { email: "x@gmail.com", email_verified: false } });
  assert.equal(res.headers.get("location"), "/login");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'x@gmail.com'").get().n, 0);
});

test("כפתור Google מופיע בדף הכניסה רק כשהוא מוגדר", async () => {
  assert.match(await (await fetch(`${base}/login`)).text(), /המשך עם Google/);
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.doesNotMatch(await (await fetch(`${base}/login`)).text(), /המשך עם Google/);
    assert.equal((await fetch(`${base}/auth/google`, { redirect: "manual" })).status, 404);
  } finally {
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  }
});
