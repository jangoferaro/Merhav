// אפליקציית הכניסה: מסך נפרד מהאתר, כהה, במסך מלא, עם כפתורים גדולים. בלי תפריט האתר.
import { html, showDate } from "./kit.js";

function shell(ctx, title, body) {
  return html`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#151515">
<meta name="robots" content="noindex, nofollow">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>${title} · JoCares Door</title>
<link rel="manifest" href="/static/door.webmanifest">
<link rel="icon" href="/static/joker.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;800&family=Assistant:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="door-app">
${body}
</body>
</html>`.s;
}

/** מסך הבית של איש צוות: ההופעות של הערב והשבוע */
export function staffHome(ctx, { staff, organizer, events, token }) {
  return shell(
    ctx,
    "כניסה",
    html`
<main class="da-home">
  <header class="da-head"><b dir="ltr">JoCares<i>.</i> Door</b><span>${staff.name} · ${organizer}</span></header>
  <h1>איזו הופעה?</h1>
  ${events.length
    ? html`<ul class="da-events">${events.map((c) => html`<li><a href="/door/s/${token}/e/${c.id}">
        <b>${c.artist_name}</b><span>${c.title}</span><small>${showDate(c.starts_at)} · ${c.venue}</small>
        <span class="da-count"><b>${c.stats.inside}</b> / ${c.stats.total}</span></a></li>`)}</ul>`
    : html`<p class="da-empty">אין הופעות היום או בשבוע הקרוב.</p>`}
</main>`
  );
}

/** הסורק */
export function scanner(ctx, { c, apiBase, staffName = "", back = "", stats, fallbackAction = "" }) {
  return shell(
    ctx,
    c.title,
    html`
<main class="da" data-door data-api="${apiBase}" data-csrf="${ctx.csrf}" data-campaign="${c.id}">
  <header class="da-head">
    ${back ? html`<a href="${back}" class="da-back" aria-label="כל ההופעות">‹</a>` : html`<b dir="ltr">JoCares<i>.</i></b>`}
    <div class="da-title"><b>${c.artist_name}</b><span>${c.title}${staffName ? ` · ${staffName}` : ""}</span></div>
    <div class="da-stats" aria-live="polite"><b data-inside>${stats.inside}</b><span>/ <span data-total>${stats.total}</span></span></div>
  </header>

  <div class="da-net" data-net hidden>אין קליטה. ממשיכים לסרוק, והכניסות יסונכרנו כשהקליטה תחזור. <b data-pending>0</b> ממתינות</div>

  <section class="da-result idle" data-result role="status" aria-live="assertive">
    <b data-r-title>מוכנים לסריקה</b>
    <span data-r-name></span>
    <small data-r-detail>מכוונים את המצלמה ל-QR שעל הכרטיס</small>
    <button type="button" class="da-undo" data-undo hidden>ביטול הכניסה הזאת</button>
  </section>

  <div class="da-cam" data-cam>
    <video playsinline muted autoplay></video>
    <canvas hidden></canvas>
    <div class="da-frame" aria-hidden="true"></div>
    <button type="button" class="da-start" data-start>הפעלת מצלמה</button>
  </div>

  <form class="da-manual" data-manual ${fallbackAction ? html`method="post" action="${fallbackAction}"` : ""}>
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <input name="code" dir="ltr" autocomplete="off" autocapitalize="characters" placeholder="קוד כרטיס" aria-label="קוד כרטיס" data-code>
    <button class="btn acid">בדיקה</button>
  </form>

  <details class="da-search">
    <summary>חיפוש לפי שם (אורח בלי טלפון)</summary>
    <input type="search" placeholder="שם או סוף הקוד" aria-label="חיפוש לפי שם" data-q>
    <ul data-results></ul>
  </details>

  <p class="da-foot"><span data-synced>הרשימה נטענה</span> · <span data-last15>0</span> נכנסו ב-15 הדקות האחרונות</p>
</main>
<script src="/static/jsqr.js" defer></script>
<script src="/static/door-app.js" defer></script>`
  );
}
