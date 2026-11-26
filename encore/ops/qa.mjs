// בדיקת איכות מקצה לקצה (סוכן הבדיקות): מקים שרת עם נתוני הדגמה, עובר בדפדפן על התהליכים המרכזיים
// בגודל של טלפון, ומריץ בדיקת נגישות (axe, WCAG 2 AA) על הדפים העיקריים.
// הרצה: npm run ops:qa · יוצא עם קוד 1 אם משהו נכשל. הדוח מודפס כ-JSON.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "jo-qa-"));
const env = { ...process.env, ENCORE_DB: path.join(work, "e.db"), ENCORE_MEDIA_DIR: path.join(work, "media"), PORT: "3917", NODE_ENV: "development", ENCORE_ENV: "" };
const node = ["--no-warnings=ExperimentalWarning"];
spawnSync(process.execPath, [...node, "src/seed.js"], { env, stdio: "ignore" });
const server = spawn(process.execPath, [...node, "src/server.js"], { env, stdio: "ignore" });
const B = "http://localhost:3917";
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(B + "/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const report = { flows: {}, a11y: {}, failures: [] };
const fail = (m) => report.failures.push(m);
const browser = await chromium.launch();
const page = async () => (await browser.newContext({ ...devices["iPhone 13"], bypassCSP: true })).newPage();

async function axe(p, name) {
  await p.addScriptTag({ content: AXE });
  const v = await p.evaluate(async () =>
    (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length }))
  );
  report.a11y[name] = v;
  for (const x of v) fail(`נגישות: ${name}: ${x.id} (${x.impact}, ${x.nodes})`);
}

async function login(p, email, name) {
  await p.fill("input[name=email]", email);
  await p.click('form[action="/login"] button');
  const code = (await p.textContent("body")).match(/הקוד הוא (\d{6})/)?.[1];
  if (!code) throw new Error("קוד כניסה לא הוצג");
  await p.fill("input[name=code]", code);
  await p.click('form[action="/login/code"] button');
  if (name && (await p.$("input[name=name]"))) {
    await p.fill("input[name=name]", name);
    await p.click('form[action="/welcome"] button');
  }
}

try {
  // ג׳וקר חדש: מדף הבית עד לינק לשיתוף
  const j = await page();
  await j.goto(B + "/");
  await axe(j, "דף בית");
  await j.click('a.btn.acid[href="/shows"]');
  await axe(j, "הופעות");
  await j.click('form[action$="/promote"] button >> nth=0');
  await login(j, `qa-joker-${Date.now()}@example.com`, "בודק");
  report.flows.joker = { clicks: 5, landed: new URL(j.url()).pathname };
  if (!/\/s\/\d+\/share$/.test(j.url())) fail(`ג׳וקר חדש לא הגיע ללינק שלו (${j.url()})`);
  await axe(j, "לינק אישי");
  const ref = (await j.textContent(".linkbox code")).trim();
  await j.goto(B + "/me/profile");
  await axe(j, "פרופיל ג׳וקר");

  // קונה: מהלינק של הג׳וקר עד כרטיס
  const q = await page();
  await q.goto(ref);
  await axe(q, "דף הופעה");
  await q.click('a[href$="/buy"]');
  await axe(q, "קופה");
  await q.fill("input[name=name]", "קונה בדיקה");
  await q.fill("input[name=email]", "qa-buyer@example.com");
  await q.click("button.acid");
  await axe(q, "תשלום");
  await q.click("form button.btn.big");
  if (!/\/tickets\//.test(q.url())) fail("הקונה לא הגיע לכרטיסים");
  const qrs = await q.$$(".tkt .qr svg");
  report.flows.buyer = { clicks: 3, tickets: qrs.length };
  if (!qrs.length) fail("אין QR בכרטיס");
  await axe(q, "כרטיסים");

  // אמן חדש: מדף הבית עד טופס הופעה, ובדיקה ששדות רשות לא חוסמים פרסום
  const a = await page();
  await a.goto(B + "/");
  await a.click('a.btn.ghost[href*="grow"]');
  await login(a, `qa-artist-${Date.now()}@example.com`, "אמנית בדיקה");
  await axe(a, "מטרות לאמן");
  await a.goto(B + "/artist/new/details");
  await axe(a, "פרטי הופעה");
  const req = await a.$$eval("form [required]", (els) => els.map((e) => e.name));
  report.flows.artistRequired = req;
  for (const opt of ["early_price", "early_until", "early_qty", "description", "genre", "promo_limit"]) {
    if (req.includes(opt)) fail(`שדה רשות מסומן חובה: ${opt}`);
  }

  // דפים פתוחים לכולם
  const o = await page();
  for (const [name, url] of [["איך זה עובד", "/how"], ["תנאים", "/terms"], ["מחיקת מידע", "/data-deletion"], ["עזרה", "/help"], ["נגישות", "/accessibility"], ["כניסה", "/login"]]) {
    await o.goto(B + url);
    await axe(o, name);
  }
  const health = await (await fetch(B + "/ops/health")).json();
  report.health = { ok: health.ok, problems: health.problems };
  if (!health.ok) fail(`בעיות במצב התפעולי: ${health.problems.join(", ")}`);
} catch (e) {
  fail(`התהליך נעצר: ${e.message}`);
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(work, { recursive: true, force: true });
}

report.ok = report.failures.length === 0;
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
