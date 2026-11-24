// תבניות HTML. כל ערך שמוכנס דרך html`` עובר escape אוטומטית,
// חוץ מתוצאות של html`` אחרות (מסומנות כ-Raw).

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const render = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join("") : v === false || v == null ? "" : esc(v));

export function html(strings, ...values) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

export const money = (agorot) =>
  "₪" + (agorot / 100).toLocaleString("he-IL", { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 });

export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** זמן שנשמר ב-SQLite (UTC) → שעון ישראל */
export const stamp = (sqlUtc) =>
  new Date(sqlUtc.replace(" ", "T") + "Z").toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

export function layout(title, body, { flash } = {}) {
  return html`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · קהל</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top"><a href="/" class="logo">קהל<span>.</span></a></header>
<main>
${flash ? html`<div class="flash ${flash.ok === false ? "bad" : "good"}">${flash.message}</div>` : ""}
${body}
</main>
<footer>קהל — הקהל שלך הוא צוות המכירות שלך</footer>
<script>
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => {
    const t = b.textContent; b.textContent = "הועתק ✓"; setTimeout(() => (b.textContent = t), 1500);
  });
});
</script>
</body>
</html>`.s;
}

const field = (name, label, attrs = "", value = "") =>
  html`<label>${label}<input name="${name}" value="${value}" ${new Raw(attrs)}></label>`;

// ---------- דף הבית: אומן יוצר אירוע ----------

export function homePage() {
  return layout(
    "מכירת כרטיסים דרך הקהל",
    html`
<section class="hero">
  <h1>הקהל שלך מוכר את ההופעה שלך</h1>
  <p>כל מי שאוהב אותך יכול להפוך לשגריר: מקבל קישור אישי, משתף עם חברים,
     ומרוויח אחוזים מכל כרטיס שנקנה דרכו. את/ה מקבל/ת קהל חדש — הם מקבלים כסף.</p>
  <ol class="steps">
    <li><b>פותחים אירוע</b> וקובעים כמה אחוזים מקבל שגריר</li>
    <li><b>משתפים</b> — כל אחד מהקהל מצטרף כשגריר בלחיצה</li>
    <li><b>הם מפיצים</b>, ורואים כמה הרוויחו בזמן אמת</li>
    <li><b>את/ה רואה</b> מי הביא הכי הרבה אנשים, ומשלם/ת להם</li>
  </ol>
</section>
<section class="card">
  <h2>פתיחת אירוע חדש</h2>
  <form method="post" action="/events" class="grid">
    ${field("artist_name", "שם האומן/ית", "required maxlength=120")}
    ${field("artist_contact", "טלפון או אימייל שלך", "required maxlength=120")}
    ${field("title", "שם האירוע", "required maxlength=120")}
    ${field("venue", "מקום", "required maxlength=120")}
    ${field("starts_at", "תאריך ושעה", "type=datetime-local required")}
    ${field("price", "מחיר כרטיס (₪)", "type=number min=0 step=0.01 required", "80")}
    ${field("capacity", "כמה כרטיסים יש", "type=number min=1 required", "100")}
    ${field("commission_pct", "אחוז לשגריר מכל כרטיס", "type=number min=0 max=50 required", "10")}
    <label class="wide">תיאור (לא חובה)<textarea name="description" rows="3" maxlength="2000"></textarea></label>
    <button class="wide">פתיחת האירוע</button>
  </form>
</section>`
  );
}

// ---------- דף אירוע ציבורי: קנייה + הצטרפות כשגריר ----------

export function eventPage({ event, left, agent }) {
  const soldOut = left <= 0;
  const perTicket = Math.floor((event.price_agorot * event.commission_pct) / 100);
  return layout(
    event.title,
    html`
<section class="hero event">
  <p class="eyebrow">${event.artist_name}</p>
  <h1>${event.title}</h1>
  <p class="meta">${when(event.starts_at)} · ${event.venue}</p>
  ${event.description ? html`<p>${event.description}</p>` : ""}
  ${agent ? html`<p class="ref">הגעת דרך <b>${agent.name}</b> 💛</p>` : ""}
</section>

<section class="card">
  <h2>כרטיסים · ${money(event.price_agorot)}</h2>
  ${soldOut
    ? html`<p class="muted">הכרטיסים אזלו.</p>`
    : html`
  <p class="muted">נשארו ${left} כרטיסים</p>
  <form method="post" action="/e/${event.slug}/buy" class="grid">
    ${field("name", "שם מלא", "required maxlength=120 autocomplete=name")}
    ${field("contact", "טלפון או אימייל", "required maxlength=120")}
    <label>כמות<select name="qty">${Array.from({ length: Math.min(10, left) }, (_, i) => html`<option>${i + 1}</option>`)}</select></label>
    <button class="wide">לקנייה</button>
  </form>
  <p class="note">⚠️ גרסת הדגמה: התשלום מדומה ולא מחויב כסף.</p>`}
</section>

${event.commission_pct > 0
  ? html`
<section class="card accent">
  <h2>רוצה להרוויח מזה?</h2>
  <p>הצטרפו כשגרירים של ${event.artist_name}: מקבלים קישור אישי, ועל כל כרטיס שנקנה דרכו
     מקבלים <b>${event.commission_pct}%</b> — כלומר ${money(perTicket)} לכרטיס.</p>
  <form method="post" action="/e/${event.slug}/join" class="grid">
    ${field("name", "שם", "required maxlength=120")}
    ${field("contact", "טלפון או אימייל (לתשלום)", "required maxlength=120")}
    <button class="wide secondary">קבלו קישור אישי</button>
  </form>
</section>`
  : ""}`
  );
}

// ---------- אחרי קנייה ----------

export function orderPage({ event, order, tickets, baseUrl }) {
  return layout(
    "ההזמנה התקבלה",
    html`
<section class="hero">
  <h1>נתראה שם, ${order.buyer_name}! 🎉</h1>
  <p class="meta">${event.title} · ${when(event.starts_at)} · ${event.venue}</p>
  <p>שמרו את הדף הזה — הקודים למטה הם הכרטיסים. מראים אותם בכניסה.</p>
</section>
<section class="card">
  <h2>${order.qty} כרטיסים · ${money(order.total_agorot)}</h2>
  <ul class="tickets">${tickets.map((t) => html`<li><code>${t.code}</code>${t.checked_in_at ? html` <span class="muted">(נסרק)</span>` : ""}</li>`)}</ul>
  <button type="button" class="secondary" data-copy="${baseUrl}/order/${order.token}">העתקת קישור לכרטיסים</button>
</section>
${event.commission_pct > 0
  ? html`
<section class="card accent">
  <h2>בא לך להביא חברים — ולהרוויח?</h2>
  <p>קבלו קישור אישי. על כל כרטיס שחבר קונה דרכו תקבלו <b>${event.commission_pct}%</b>.</p>
  <form method="post" action="/e/${event.slug}/join">
    <input type="hidden" name="name" value="${order.buyer_name}">
    <input type="hidden" name="contact" value="${order.buyer_contact}">
    <button class="secondary">כן, תנו לי קישור</button>
  </form>
</section>`
  : ""}`
  );
}

// ---------- לוח השגריר ----------

export function agentPage({ event, agent, stats, baseUrl }) {
  const link = `${baseUrl}/e/${event.slug}?ref=${agent.code}`;
  const shareText = `באים איתי ל${event.title} של ${event.artist_name}? ${when(event.starts_at)} ב${event.venue}. כרטיסים כאן: ${link}`;
  return layout(
    "הלוח שלי",
    html`
<section class="hero">
  <p class="eyebrow">שגריר/ה של ${event.artist_name}</p>
  <h1>היי ${agent.name}, הנה הקישור שלך</h1>
  <div class="linkbox"><code>${link}</code><button type="button" data-copy="${link}">העתקה</button></div>
  <div class="share">
    <a class="btn" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
    <button type="button" class="secondary" data-copy="${shareText}">העתקת הודעה מוכנה</button>
  </div>
  <p class="note">שמרו את הדף הזה (סימנייה) — זה הלוח האישי שלך. אל תשתפו את הכתובת שלו, רק את הקישור למעלה.</p>
</section>
<section class="stats">
  <div><b>${stats.clicks}</b><span>נכנסו לקישור</span></div>
  <div><b>${stats.tickets}</b><span>כרטיסים נמכרו</span></div>
  <div><b>${money(stats.earned)}</b><span>הרווחת</span></div>
  <div><b>${money(stats.pending)}</b><span>ממתין לתשלום</span></div>
</section>
<p class="muted center">על כל כרטיס: ${event.commission_pct}% · התשלום מגיע ישירות מ${event.artist_name}.</p>`
  );
}

// ---------- לוח האומן ----------

export function managePage({ event, summary, agents, orders, left, baseUrl, flash }) {
  const base = `/manage/${event.admin_token}`;
  const publicLink = `${baseUrl}/e/${event.slug}`;
  return layout(
    `ניהול · ${event.title}`,
    html`
<section class="hero">
  <p class="eyebrow">לוח ניהול · ${event.artist_name}</p>
  <h1>${event.title}</h1>
  <p class="meta">${when(event.starts_at)} · ${event.venue} · ${money(event.price_agorot)} · ${event.commission_pct}% לשגרירים</p>
  <div class="linkbox"><code>${publicLink}</code><button type="button" data-copy="${publicLink}">העתקה</button></div>
  <p class="note">🔒 זה הקישור הציבורי — אותו משתפים. את הכתובת של הדף הנוכחי שמרו לעצמכם בלבד.</p>
</section>

<section class="stats">
  <div><b>${summary.tickets}/${event.capacity}</b><span>כרטיסים נמכרו</span></div>
  <div><b>${money(summary.revenue)}</b><span>הכנסות</span></div>
  <div><b>${summary.via_agents}</b><span>כרטיסים דרך שגרירים</span></div>
  <div><b>${summary.agents}</b><span>שגרירים</span></div>
  <div><b>${money(summary.owed)}</b><span>חוב לשגרירים</span></div>
  <div><b>${money(summary.net)}</b><span>נטו אחרי עמלות</span></div>
</section>

<section class="card">
  <h2>בדיקת כרטיסים בכניסה</h2>
  <form method="post" action="${base}/checkin" class="inline">
    <input name="code" placeholder="קוד כרטיס" required autocomplete="off" autofocus>
    <button>בדיקה</button>
  </form>
  <p class="muted">נכנסו עד עכשיו: ${summary.checkedIn} · נשארו למכירה: ${left}</p>
</section>

<section class="card">
  <h2>השגרירים שלך</h2>
  ${agents.length === 0
    ? html`<p class="muted">עוד אין שגרירים. שתפו את הקישור הציבורי ובקשו מהקהל להצטרף — בדף האירוע יש כפתור לזה.</p>`
    : html`
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>שם</th><th>ליצירת קשר</th><th>כניסות</th><th>כרטיסים</th><th>הרוויח/ה</th><th>לתשלום</th><th></th></tr></thead>
    <tbody>${agents.map(
      (a, i) => html`<tr>
        <td>${i === 0 && a.tickets > 0 ? "🏆" : i + 1}</td><td>${a.name}</td><td dir="ltr">${a.contact}</td>
        <td>${a.clicks}</td><td>${a.tickets}</td><td>${money(a.earned)}</td><td><b>${money(a.pending)}</b></td>
        <td>${a.pending > 0
          ? html`<form method="post" action="${base}/payout/${a.id}"><button class="small">סימון ששולם</button></form>`
          : ""}</td>
      </tr>`
    )}</tbody>
  </table></div>`}
</section>

<section class="card">
  <h2>הזמנות אחרונות</h2>
  ${orders.length === 0
    ? html`<p class="muted">עוד אין הזמנות.</p>`
    : html`
  <div class="scroll"><table>
    <thead><tr><th>מתי</th><th>קונה</th><th>כמות</th><th>סכום</th><th>דרך</th></tr></thead>
    <tbody>${orders.map(
      (o) => html`<tr><td>${stamp(o.created_at)}</td><td>${o.buyer_name}</td><td>${o.qty}</td><td>${money(o.total_agorot)}</td>
        <td>${o.agent_name ?? html`<span class="muted">ישיר</span>`}</td></tr>`
    )}</tbody>
  </table></div>`}
</section>`,
    { flash }
  );
}

export function createdPage({ event, baseUrl }) {
  const manage = `${baseUrl}/manage/${event.admin_token}`;
  return layout(
    "האירוע נפתח",
    html`
<section class="hero">
  <h1>האירוע נפתח 🎤</h1>
  <p><b>שמרו את הקישור הזה — הוא הכניסה שלכם ללוח הניהול.</b> אין סיסמה; מי שמחזיק בקישור יכול לנהל.</p>
  <div class="linkbox"><code>${manage}</code><button type="button" data-copy="${manage}">העתקה</button></div>
  <p><a class="btn" href="/manage/${event.admin_token}">ללוח הניהול</a></p>
</section>`
  );
}

export function errorPage(status, message) {
  return layout("שגיאה", html`<section class="hero"><h1>${status === 404 ? "לא מצאנו את הדף" : "אופס"}</h1><p>${message}</p><p><a href="javascript:history.back()">חזרה</a></p></section>`);
}
