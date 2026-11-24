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

function hue(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function poster(c, cls = "") {
  if (c.image_url) return html`<div class="poster ${cls}"><img src="${c.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const h = hue(c.artist_name + c.title);
  const initials = String(c.artist_name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  return html`<div class="poster ${cls}" style="--h:${h}" aria-hidden="true"><span>${initials}</span></div>`;
}

export const statusBadge = (s) => html`<span class="badge st-${s}">${STATUS_LABEL[s] ?? s}</span>`;

export const stat = (value, label, cls = "") => html`<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;

export const empty = (title, body, action = "") => html`<div class="empty"><h3>${title}</h3><p>${body}</p>${action}</div>`;

/** כרטיס הופעה במרקטפלייס: מה מוכרים, מתי, איפה, וכמה מרוויחים */
export function showCard(ctx, c) {
  return html`
  <article class="show">
    <a href="/s/${c.id}" class="show-link">${poster(c)}</a>
    <div class="show-body">
      <p class="eyebrow">${c.artist_name}</p>
      <h3><a href="/s/${c.id}">${c.title}</a></h3>
      <p class="meta">${showDate(c.starts_at)} · ${c.city || c.venue}</p>
      <div class="earn"><span>הרווח שלך</span><b>${money(c.reward_agorot)}</b><small>לכל כרטיס · מחיר ${money(c.price_agorot)}</small></div>
      ${c.promoting
        ? html`<a class="btn ghost block" href="/s/${c.id}/share">הלינק שלי</a>`
        : html`<form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">שיתוף והרווחה</button></form>`}
    </div>
  </article>`;
}

// ---------- מסגרת הדף ----------

export function layout(ctx, title, body, { unread = 0, isArtist = false, wide = false, description = "" } = {}) {
  const u = ctx.user;
  const nav = [
    ["/shows", "הופעות"],
    u && ["/me/money", "הכסף שלי"],
    u && isArtist && ["/artist", "לאמנים"],
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
<meta name="theme-color" content="#16121f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
<header class="top">
  <div class="top-in">
    <a href="/" class="logo" aria-label="ENCORE, דף הבית">ENCORE<i>.</i></a>
    <nav aria-label="ראשי">
      ${nav.map(([href, label]) => html`<a href="${href}"${path.startsWith(href) ? raw(' aria-current="page"') : ""}>${label}</a>`)}
    </nav>
    <div class="top-end">
      ${u
        ? html`<a href="/me/notifications" class="bell" aria-label="התראות${unread ? ` (${unread} חדשות)` : ""}">🔔${unread ? html`<i>${unread}</i>` : ""}</a>
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
  <p>ENCORE · הקהל מקדם את ההופעה · <a href="/how">איך זה עובד</a> · <a href="/terms">תנאים ופרטיות</a></p>
</footer>
</body>
</html>`.s;
}
