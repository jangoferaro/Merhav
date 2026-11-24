// רכיבי תצוגה משותפים. כל ערך שעובר דרך html`` מקבל escape, חוץ מתוצאות html`` אחרות.
import { config, money, showDate } from "../util.js";
import { STATUS_LABEL } from "../domain/campaigns.js";

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s));

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const render = (v) =>
  v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join("") : v === false || v == null ? "" : esc(v);

export function html(strings, ...values) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

export { money, showDate };

export const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

/** טופס POST קטן עם כפתור אחד */
export const postButton = (ctx, action, label, { cls = "", confirm = "", fields = {} } = {}) => html`
  <form method="post" action="${action}" class="inline-form"${confirm ? html` data-confirm="${confirm}"` : ""}>
    ${csrfField(ctx)}${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button class="${cls}">${label}</button>
  </form>`;

// ---------- פוסטר: תמונה אמיתית, או גרדיאנט עם ראשי תיבות ----------

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

export const TREATMENTS = ["lines", "frame", "band"];

/**
 * פוסטר = התמונה של ההופעה (תמיד יש), עם טיפול גרפי אחד מתוך שפת העיצוב:
 *  lines  קווי בנייה דקים מעל התמונה
 *  frame  מסגרת עבה בצבע מהפלטה
 *  band   פס צבע עם שם האמן באות כבדה
 * הטיפול והצבע נגזרים מהשם, כך שאותה הופעה נראית תמיד אותו דבר.
 */
export function poster(c, cls = "", treatment) {
  const h = hash(`${c.artist_name}|${c.title}`);
  const t = treatment ?? TREATMENTS[h % TREATMENTS.length];
  const color = (h >>> 5) % 6;
  const small = cls.includes("thumb");
  return html`<div class="poster tr-${small ? "plain" : t} pc-${color} ${cls}">${c.image_url
    ? html`<img src="${c.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : ""}${t === "band" && !small ? html`<span class="band" aria-hidden="true">${c.artist_name}</span>` : ""}</div>`;
}

/** העלאת תמונה: תצוגה מקדימה של הקיימת, ובחירת קובץ חדש מהטלפון או מהמחשב */
export function imageInput({ current = "", label = "העלאת תמונה", hint = "JPG, PNG או WebP · עד 8MB", round = false } = {}) {
  return html`
<div class="upload${round ? " round" : ""}">
  <input type="hidden" name="image_url" value="${current}">
  <label class="upload-box">
    <span class="upload-preview">${current ? html`<img src="${current}" alt="" referrerpolicy="no-referrer">` : ""}</span>
    <span class="upload-text"><b data-label-change="החלפת תמונה">${current ? "החלפת תמונה" : label}</b><small>${hint}</small></span>
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp" ${current ? "" : html`required`} data-preview>
  </label>
</div>`;
}

/** חותמת עגולה: הסכום החשוב במסך (העיגול הוא החריג היחיד לפינות הישרות) */
export const stamp = (value, label, cls = "") => html`<span class="stamp ${cls}"><b>${value}</b><small>${label}</small></span>`;

export const statusBadge = (s) => html`<span class="badge st-${s}">${STATUS_LABEL[s] ?? s}</span>`;

export const stat = (value, label, cls = "") => html`<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;

export const empty = (title, body, action = "") => html`<div class="empty"><h3>${title}</h3><p>${body}</p>${action}</div>`;

/** כרטיס הופעה במרקטפלייס: מה מוכרים, מתי, איפה, וכמה מרוויחים */
export function showCard(ctx, c) {
  return html`
  <article class="show">
    <a href="/s/${c.id}" class="show-link">${poster(c)}${stamp(money(c.reward_agorot), "לכל כרטיס")}</a>
    <div class="show-body">
      <p class="eyebrow">${c.artist_name}</p>
      <h3><a href="/s/${c.id}">${c.title}</a></h3>
      <p class="meta">${showDate(c.starts_at)} · ${c.city || c.venue}</p>
      <p class="earn-line">הרווח שלך <b>${money(c.reward_agorot)}</b> על כל כרטיס · מחיר ${money(c.price_agorot)}</p>
      ${c.promoting
        ? html`<a class="btn ghost block" href="/s/${c.id}/share">הלינק שלי</a>`
        : html`<form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">שתף והרוויח</button></form>`}
    </div>
  </article>`;
}

// ---------- מסגרת הדף ----------

const BELL = raw(`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`);

export function layout(ctx, title, body, { unread = 0, isArtist = false, isCreator = false, wide = false, description = "", og = {} } = {}) {
  const abs = (u) => (/^https?:\/\//.test(u) ? u : `${ctx.origin ?? ""}${u}`);
  const desc = description || "אמנות צריכה קהל. בוחרים הופעה, משתפים, ומרוויחים מכל כרטיס שנמכר בזכותכם.";
  const ogTitle = og.title || (title ? `${title} · jocares.` : "jocares. · אמנות צריכה קהל");
  const u = ctx.user;
  const nav = [
    ["/shows", "הופעות"],
    ["/creators", "יוצרים"],
    u && isCreator && ["/creator", "יצירה"],
    u && isArtist && ["/artist", "האמן"],
    u?.is_admin && ["/admin", "ניהול"],
  ].filter(Boolean);
  const path = ctx.url.pathname;
  const flash = ctx.flash;
  return html`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} · jocares.` : "jocares. · אמנות צריכה קהל"}</title>
<meta name="description" content="${desc}">
<meta property="og:site_name" content="jocares.">
<meta property="og:type" content="${og.type || "website"}">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${og.description || desc}">
<meta property="og:url" content="${abs(og.url || ctx.url.pathname)}">
<meta property="og:image" content="${abs(og.image || "/static/og.png")}">
${og.image ? "" : html`<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#EDECE4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151515" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/static/joker.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Heebo:wght@700;800;900&family=Assistant:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
${config.isStaging ? html`<div class="staging-bar" role="note">סביבת בדיקה · הנתונים לדוגמה · אין כאן כסף אמיתי</div>` : ""}
<header class="top">
  <div class="top-in">
    <a href="/" class="logo" aria-label="Jocares, דף הבית">jocares<i aria-hidden="true">.</i></a>
    <nav aria-label="ראשי">
      ${nav.map(([href, label]) => html`<a href="${href}"${(path === href || path.startsWith(href + "/")) ? raw(' aria-current="page"') : ""}>${label}</a>`)}
    </nav>
    <div class="top-end">
      ${u
        ? html`<a href="/me/notifications" class="bell" aria-label="התראות${unread ? ` (${unread} חדשות)` : ""}">${BELL}${unread ? html`<i>${unread}</i>` : ""}</a>
               <a href="/me/sales" class="me" title="${u.email}">${(u.name || u.email)[0]}</a>`
        : html`<a href="/login?next=${encodeURIComponent(path)}" class="btn small ghost">כניסה</a>`}
    </div>
  </div>
</header>
<main id="main" class="${wide ? "wide" : ""}">
${flash ? html`<div class="flash ${flash.ok === false ? "bad" : "good"}" role="status">${flash.m}</div>` : ""}
${config.showLoginCodes && flash?.dev ? html`<div class="flash dev">${config.isStaging ? "סביבת בדיקה" : "מצב פיתוח"} · ${flash.dev}</div>` : ""}
${body}
</main>
<footer class="foot">
  <p class="foot-big" dir="ltr">jocares.</p>
  <p class="foot-tag" dir="ltr" lang="en">Who cares? Jo cares. Because art deserves an audience.</p>
  <nav aria-label="תחתון"><a href="/how">איך זה עובד</a><a href="/terms">תנאים ופרטיות</a></nav>
</footer>
</body>
</html>`.s;
}
