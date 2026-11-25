import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import * as ID from "../src/domain/identity.js";
import * as CN from "../src/domain/connections.js";
import * as J from "../src/domain/jokers.js";
import { appleDeveloperToken, mapGenres, _resetAppleCache } from "../src/connect/providers.js";

Object.assign(process.env, {
  SPOTIFY_CLIENT_ID: "sp-id", SPOTIFY_CLIENT_SECRET: "sp-secret",
  INSTAGRAM_CLIENT_ID: "ig-id", INSTAGRAM_CLIENT_SECRET: "ig-secret",
  TIKTOK_CLIENT_KEY: "tt-key", TIKTOK_CLIENT_SECRET: "tt-secret",
  GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret",
  FACEBOOK_APP_ID: "fb-id", FACEBOOK_APP_SECRET: "fb-secret",
});
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
Object.assign(process.env, { APPLE_MUSIC_TEAM_ID: "TEAM123", APPLE_MUSIC_KEY_ID: "KEY123", APPLE_MUSIC_PRIVATE_KEY: ec.privateKey.export({ type: "pkcs8", format: "pem" }) });

let db, dani;
beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  dani = ID.getUser(db, insert(db, "users", { email: "dani@x.com", email_hash: emailHash("dani@x.com"), name: "דני", created_at: clock.iso() }));
});
after(() => clock.set(null));

/** ספקים מדומים: מחזירים תשובות בצורה של ה-API האמיתי, ורושמים מה נשלח אליהם */
function fakeProviders(overrides = {}) {
  const calls = [];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const f = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init, body: init.body ? new URLSearchParams(init.body.toString()) : null });
    const key = `${u.host}${u.pathname}`;
    if (overrides[key]) return overrides[key](u, init);
    switch (key) {
      case "accounts.spotify.com/api/token": return json(200, { access_token: "sp-access", refresh_token: "sp-refresh", expires_in: 3600, scope: "user-top-read user-follow-read" });
      case "api.spotify.com/v1/me": return json(200, { id: "dani1", display_name: "Dani", external_urls: { spotify: "https://open.spotify.com/user/dani1" } });
      case "api.spotify.com/v1/me/top/artists": return json(200, { items: [{ name: "Noa Barak", genres: ["israeli indie", "indie folk"] }, { name: "Radiohead", genres: ["alternative rock", "art rock"] }] });
      case "api.instagram.com/oauth/access_token": return json(200, { access_token: "ig-short", user_id: 1 });
      case "graph.instagram.com/access_token": return json(200, { access_token: "ig-long", expires_in: 5184000 });
      case "graph.instagram.com/me": return json(200, { user_id: "17841", username: "dani.music", followers_count: 4820, media_count: 120 });
      case "open.tiktokapis.com/v2/oauth/token/": return json(200, { access_token: "tt-access", refresh_token: "tt-refresh", expires_in: 86400, scope: "user.info.basic,user.info.stats" });
      case "open.tiktokapis.com/v2/user/info/": return json(200, { data: { user: { open_id: "tt1", username: "dani", follower_count: 15000, likes_count: 90000, video_count: 40 } } });
      case "oauth2.googleapis.com/token": return json(200, { access_token: "yt-access", refresh_token: "yt-refresh", expires_in: 3600 });
      case "www.googleapis.com/youtube/v3/channels": return json(200, { items: [{ id: "UC1", snippet: { title: "Dani", customUrl: "@dani" }, statistics: { subscriberCount: "2300", videoCount: "15", hiddenSubscriberCount: false } }] });
      case "graph.facebook.com/v21.0/oauth/access_token": return json(200, { access_token: "fb-access", expires_in: 5000000 });
      case "graph.facebook.com/v21.0/me/accounts": return json(200, { data: [{ id: "p1", name: "Small page", followers_count: 50 }, { id: "p2", name: "Dani Music", followers_count: 800, link: "https://facebook.com/danimusic" }] });
      case "api.music.apple.com/v1/me/library/artists": return json(200, { data: [{ attributes: { name: "Noa Barak" } }, { attributes: { name: "Shlomo Artzi" } }] });
      case "api.music.apple.com/v1/me/history/heavy-rotation": return json(200, { data: [{ attributes: { genreNames: ["Israeli", "Pop"] } }] });
      default: return json(404, { error: "not found" });
    }
  };
  return { f, calls };
}

/** חיבור מלא דרך הדומיין: התחלה, חזרה עם state נכון, החלפת קוד */
async function connect(name, f) {
  const { url, cookieValue } = CN.startConnect(dani, name, { redirectUri: `https://j.example/connect/${name}/callback` });
  const state = new URL(url).searchParams.get("state");
  return { url: new URL(url), res: await CN.finishConnect(db, dani, name, { query: { code: "the-code", state }, cookieValue, redirectUri: `https://j.example/connect/${name}/callback`, fetchImpl: f }) };
}

test("Spotify: PKCE, אימות Basic, טעם ממופה לסגנונות שלנו, ואסימונים מוצפנים", async () => {
  const { f, calls } = fakeProviders();
  const { url, res } = await connect("spotify", f);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "user-top-read user-follow-read");
  const tokenCall = calls.find((c) => c.url.host === "accounts.spotify.com");
  assert.match(tokenCall.init.headers.authorization, /^Basic /);
  assert.ok(tokenCall.body.get("code_verifier"));
  assert.equal(res.ok, true);
  const m = CN.musicFromConnections(db, dani.id);
  assert.equal(m.genres[0], "אינדי");
  for (const g of ["רוק", "אלטרנטיבי", "פולק"]) assert.ok(m.genres.includes(g), g);
  assert.deepEqual(m.artists, ["Noa Barak", "Radiohead"]);
  assert.doesNotMatch(CN.accountOf(db, dani.id, "spotify").tokens_enc, /sp-access|sp-refresh/);
});

test("Instagram: טוקן קצר מוחלף בארוך, ומספר עוקבים מאומת מחליף הצהרה עצמית", async () => {
  J.saveJoker(db, dani, { nickname: "דני", social_platform: "Instagram", social_followers: "99999" });
  const { f } = fakeProviders();
  const { url, res } = await connect("instagram", f);
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic");
  assert.equal(res.account.handle, "@dani.music");
  const j = J.enrich(db, J.getJoker(db, dani.id));
  assert.equal(j.followers, 4820);
  assert.equal(j.followersVerified, true);
  J.setCard(db, dani, { publish: "1", fields: ["social"] });
  const v = J.publicView(J.getJoker(db, dani.id), J.powers(db, dani.id), { db });
  assert.deepEqual([v.social.followers, v.social.verified, v.social.platform], [4820, true, "Instagram"]);
});

test("TikTok (client_key), YouTube (מנויים), Facebook (העמוד עם הכי הרבה עוקבים)", async () => {
  const { f, calls } = fakeProviders();
  const tt = await connect("tiktok", f);
  assert.equal(tt.url.searchParams.get("client_key"), "tt-key");
  assert.equal(calls.find((c) => c.url.host === "open.tiktokapis.com" && c.body).body.get("client_key"), "tt-key");
  const yt = await connect("youtube", f);
  assert.equal(yt.url.searchParams.get("access_type"), "offline");
  const fb = await connect("facebook", f);
  assert.equal(fb.res.account.handle, "Dani Music");
  const v = CN.verifiedSocial(db, dani.id);
  assert.equal(v.label, "TikTok");
  assert.equal(v.value, 15000);
  assert.deepEqual(v.all.map((x) => x.label).sort(), ["Facebook", "TikTok", "YouTube"]);
});

test("state שלא תואם נדחה, וכשל אצל הספק לא מפיל כלום ומסומן בחשבון", async () => {
  const { f } = fakeProviders({ "graph.instagram.com/me": () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const { cookieValue } = CN.startConnect(dani, "instagram", { redirectUri: "https://j.example/cb" });
  await assert.rejects(CN.finishConnect(db, dani, "instagram", { query: { code: "x", state: "wrong" }, cookieValue, redirectUri: "https://j.example/cb", fetchImpl: f }), /לא הושלם/);
  const { res } = await connect("instagram", f);
  assert.equal(res.ok, false);
  assert.equal(res.account.status, "error");
  assert.equal(res.account.fail_count, 1);
});

test("אסימון שפג מתחדש אוטומטית; כשהחידוש נכשל החשבון מסומן 'ההרשאה פגה'", async () => {
  const { f, calls } = fakeProviders();
  await connect("spotify", f);
  clock.set("2026-12-03T10:00:00.000Z");
  assert.equal(await CN.syncDue(db, f), 1);
  assert.ok(calls.some((c) => c.body?.get("grant_type") === "refresh_token"));
  const bad = fakeProviders({ "accounts.spotify.com/api/token": () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }) });
  clock.set("2026-12-05T10:00:00.000Z");
  await CN.syncDue(db, bad.f);
  assert.equal(CN.accountOf(db, dani.id, "spotify").status, "expired");
});

test("ניתוק מוחק אסימונים, מדדים וטעם; צמיחה מוצגת רק משתי מדידות בהפרש של שבוע", async () => {
  const { f } = fakeProviders();
  await connect("instagram", f);
  assert.equal(CN.growth(db, dani.id, "instagram"), null);
  clock.set("2026-12-09T10:00:00.000Z");
  const more = fakeProviders({ "graph.instagram.com/me": () => ({ ok: true, status: 200, json: async () => ({ user_id: "17841", username: "dani.music", followers_count: 5000 }) }) });
  await CN.syncAccount(db, CN.accountOf(db, dani.id, "instagram"), more.f);
  assert.deepEqual(CN.growth(db, dani.id, "instagram"), { delta: 180, days: 8 });
  CN.disconnect(db, dani, "instagram");
  assert.equal(CN.accountOf(db, dani.id, "instagram"), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metric_snapshots").get().n, 0);
  assert.equal(CN.verifiedSocial(db, dani.id), null);
});

test("Apple Music: טוקן מפתח חתום ES256 שנבדק במפתח הציבורי, וסנכרון ספרייה", async () => {
  _resetAppleCache();
  const tok = appleDeveloperToken();
  const [h, b, sig] = tok.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY123" });
  assert.equal(JSON.parse(Buffer.from(b, "base64url")).iss, "TEAM123");
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${b}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  const { f, calls } = fakeProviders();
  const res = await CN.connectApple(db, dani, "music-user-token-abcdefghijklmnop", f);
  assert.equal(res.ok, true);
  assert.equal(calls[0].init.headers["music-user-token"], "music-user-token-abcdefghijklmnop");
  const m = CN.musicFromConnections(db, dani.id);
  assert.deepEqual(m.artists, ["Noa Barak", "Shlomo Artzi"]);
  assert.ok(m.genres.includes("ים תיכוני") && m.genres.includes("פופ"));
});

test("מיפוי סגנונות", () => {
  assert.deepEqual(mapGenres(["indie rock", "indie pop", "techno", "k-pop"]).slice(0, 1), ["אינדי"]);
  assert.ok(mapGenres(["deep house"]).includes("אלקטרוני"));
  assert.deepEqual(mapGenres(["polka"]), []);
});

test("HTTP: כפתור חיבור מפנה לספק עם עוגיית state, והחזרה מחברת ומציגה בפרופיל", async () => {
  resetRateLimits();
  const { f } = fakeProviders();
  const server = http.createServer(createApp(db, { fetchImpl: f }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = { sid: ID.createSession(db, dani.id) };
  const req = async (path) => {
    const res = await fetch(base + path, { redirect: "manual", headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k.trim()] = v; }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  };
  try {
    let r = await req("/me/profile");
    assert.match(r.text, /href="\/connect\/spotify"/);
    assert.match(r.text, /href="\/connect\/apple"/);
    r = await req("/connect/spotify");
    assert.equal(r.status, 302);
    const to = new URL(r.location);
    assert.equal(to.host, "accounts.spotify.com");
    assert.ok(jar.cstate);
    r = await req(`/connect/spotify/callback?code=abc&state=${to.searchParams.get("state")}`);
    assert.equal(r.status, 303);
    r = await req("/me/profile");
    assert.match(r.text, /Spotify מחובר/);
    assert.match(r.text, /לפי Spotify/);
    r = await req("/connect/apple");
    assert.equal(r.status, 200);
    assert.match(r.text, /js-cdn\.music\.apple\.com/);
  } finally {
    server.close();
  }
});
