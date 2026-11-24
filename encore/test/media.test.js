import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { clock } from "../src/util.js";
import { resetRateLimits } from "../src/http.js";
import { createApp } from "../src/server.js";
import { sniffImage, parseMultipart, validImageRef } from "../src/media.js";
import { demoImage } from "../src/demo-images.js";
import * as C from "../src/domain/campaigns.js";
import { insert } from "../src/db.js";
import { emailHash } from "../src/util.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-media-"));
process.env.ENCORE_MEDIA_DIR = dir;

test("מזהה תמונה לפי הבתים, לא לפי שם הקובץ", () => {
  assert.equal(sniffImage(demoImage(1, "rings", 40, 30)), "png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpg");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)></svg>....")), null);
  assert.equal(sniffImage(Buffer.from("GIF89a.........")), null);
});

test("קישור תמונה: רק קובץ שלנו או https", () => {
  assert.equal(validImageRef("/media/abcdefghijklmnop.png"), "/media/abcdefghijklmnop.png");
  assert.equal(validImageRef("https://x.example/a.jpg"), "https://x.example/a.jpg");
  assert.equal(validImageRef("http://x.example/a.jpg"), null);
  assert.equal(validImageRef("/media/../../etc/passwd"), null);
  assert.equal(validImageRef("javascript:alert(1)"), null);
});

test("parseMultipart מפריד שדות וקבצים", () => {
  const b = "XyZ";
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\nערב\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from([1, 2, 3, 13, 10, 4]),
    Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="empty"; filename=""\r\n\r\n\r\n--${b}--\r\n`),
  ]);
  const f = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.equal(f.title, "ערב");
  assert.deepEqual([...f.image.data], [1, 2, 3, 13, 10, 4]);
  assert.equal(f.empty, undefined);
});

test("אין הופעה בלי תמונה", () => {
  const db = openDb(":memory:");
  clock.set("2026-12-01T10:00:00.000Z");
  const u = { id: insert(db, "users", { email: "a@x.com", email_hash: emailHash("a@x.com"), created_at: clock.iso() }) };
  assert.throws(() => C.createCampaign(db, u, { artist_name: "א", title: "ב", venue: "ג", starts_at: "2026-12-20T21:00", price: "80", reward: "20" }), /צריך תמונה/);
});

// ---------- העלאה אמיתית דרך HTTP ----------

let server, base, db;
before(async () => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  clock.set(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function loginJar(email) {
  const jar = {};
  const req = async (p, init = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), referer: base + p, ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar[k] = v; }
    return res;
  };
  let t = await (await req("/login")).text();
  let csrf = t.match(/name="_csrf" value="([^"]+)"/)[1];
  t = await (await req("/login", { method: "POST", body: new URLSearchParams({ _csrf: csrf, email }) })).text();
  const code = t.match(/הקוד הוא (\d{6})/)[1];
  await req("/login/code", { method: "POST", body: new URLSearchParams({ _csrf: csrf, email, code }) });
  return { req, csrf };
}

test("אמן מעלה תמונה אמיתית: נשמרת, מוגשת כתמונה, ומופיעה בהופעה", async () => {
  resetRateLimits();
  const { req, csrf } = await loginJar("up@encore.test");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, artist_name: "נועה", title: "ערב", starts_at: "2026-12-20T21:00", venue: "בארבי", price: "80", reward: "20" })) fd.append(k, v);
  fd.append("image", new Blob([demoImage(5, "rays", 64, 48)], { type: "image/png" }), "show.png");
  const r = await req("/artist/new/preview", { method: "POST", body: fd });
  const html = await r.text();
  assert.equal(r.status, 200, html.slice(0, 300));
  const src = html.match(/\/media\/[\w-]{16}\.png/)[0];
  const img = await fetch(base + src);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  assert.ok(fs.existsSync(path.join(dir, src.slice(7))));

  // קובץ שמתחזה לתמונה נדחה
  const bad = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, artist_name: "נועה", title: "ערב", starts_at: "2026-12-20T21:00", venue: "בארבי", price: "80", reward: "20" })) bad.append(k, v);
  bad.append("image", new Blob(["<svg onload=alert(1)>"], { type: "image/png" }), "evil.png");
  const r2 = await req("/artist/new/preview", { method: "POST", body: bad });
  assert.match(await r2.text(), /לא נראה כמו תמונה/);
  assert.equal((await fetch(base + "/media/../package.json")).status, 404);
});
