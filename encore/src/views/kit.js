// רכיבי תצוגה משותפים. כל ערך שעובר דרך html`` מקבל escape, חוץ מתוצאות html`` אחרות.
import { config, money, showDate } from "../util.js";
import { STATUS_LABEL } from "../domain/campaigns.js";
import { posterSvg, pixelAvatarSvg } from "./art.js";
export { pixelAvatarSvg };

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

/**
 * פוסטר: תמונה אם יש, אחרת פוסטר גנרטיבי מתוך סדרת פריסות (ראו art.js ו-DESIGN.md).
 * אותה הופעה = תמיד אותו פוסטר.
 */
export function poster(c, cls = "", layout) {
  if (c.image_url) return html`<div class="poster ${cls}"><img src="${c.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const size = cls.includes("big") ? "big" : cls.includes("thumb") ? "square" : "card";
  return html`<div class="poster ${cls}">${raw(posterSvg(c, { size, layout }))}</div>`;
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
        : html`<form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">שיתוף והרווחה</button></form>`}
    </div>
  </article>`;
}

// ---------- מסגרת הדף ----------

const BELL = raw(`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`);

export function layout(ctx, title, body, { unread = 0, isArtist = false, isCreator = false, wide = false, description = "" } = {}) {
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
<title>${title ? `${title} · ENCORE` : "ENCORE · הקהל מקדם את ההופעה"}</title>
<meta name="description" content="${description || "בוחרים הופעה, משתפים, ומרוויחים מכל כרטיס שנמכר בזכותכם."}">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;700;800;900&family=Assistant:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
<header class="top">
  <div class="top-in">
    <a href="/" class="logo" aria-label="ENCORE, דף הבית">encore<i aria-hidden="true"></i></a>
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
${!config.isProd && flash?.dev ? html`<div class="flash dev">מצב פיתוח · ${flash.dev}</div>` : ""}
${body}
</main>
<footer class="foot">
  <p class="foot-big">encore</p>
  <p>הקהל מקדם את ההופעה</p>
  <nav aria-label="תחתון"><a href="/how">איך זה עובד</a><a href="/terms">תנאים ופרטיות</a><a href="/design">שפה עיצובית</a></nav>
</footer>
</body>
</html>`.s;
}
