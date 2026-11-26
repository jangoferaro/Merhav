// מערכת ניהול פנימית (PRD §24) + הקופה המדומה של ספק הכרטוס
import { shortDate } from "../util.js";
import { ATTRIBUTION_LABEL } from "../domain/ingest.js";
import { csrfField, html, layout, money, postButton, statusBadge } from "./kit.js";
import { adminContent } from "./content.js";

const COMMISSION_HE = { pending: "ממתין", payable: "זמין", paid: "שולם", reversed: "בוטל", disputed: "מוקפא" };

const TABS = [
  ["", "סקירה"], ["tickets", "כרטיסים"], ["coupons", "קופונים"], ["payouts", "תשלומים"], ["disputes", "פניות"], ["orders", "עסקאות"],
  ["content", "תוכן"], ["campaigns", "קמפיינים"], ["users", "משתמשים"], ["audit", "יומן פעולות"], ["sim", "ספק מדומה"],
];

function shell(ctx, tab, body, opts) {
  return layout(
    ctx,
    "ניהול",
    html`
<h1>ניהול</h1>
<nav class="tabs scroll" aria-label="ניהול">${TABS.map(
      ([t, l]) => html`<a href="/admin${t ? `?tab=${t}` : ""}"${tab === t ? html` aria-current="page"` : ""}>${l}</a>`
    )}</nav>
${body}`,
    { ...opts, wide: true }
  );
}

const table = (head, rows) => html`<div class="table-wrap"><table><thead><tr>${head.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`;

// ---------- כרטיסים: הקופה של JoCares ----------

const TICKET_STATUS = { pending: "ממתין לתשלום", paid: "שולם", expired: "פג", failed: "נכשל", rejected: "נדחה והוחזר" };
const REFUND_STATUS = { pending: "ממתין", done: "בוצע", failed: "נכשל" };

export function adminTickets(ctx, { totals, orders, refunds }, opts) {
  return shell(ctx, "tickets", html`
<div class="stats">
  <div class="stat"><b>${totals.tickets}</b><span>כרטיסים נמכרו</span></div>
  <div class="stat"><b>${money(totals.gross)}</b><span>מחזור</span></div>
  <div class="stat"><b>${totals.failed}</b><span>החזרים שנכשלו</span></div>
  <div class="stat"><b>${totals.pending}</b><span>החזרים ממתינים</span></div>
</div>
${refunds.length
  ? html`<section class="card"><h2>החזרים שלא הושלמו</h2>
    ${table(["#", "הזמנה", "קונה", "כרטיסים", "סכום", "סיבה", "מצב", "שגיאה"], refunds.map((r) => html`<tr>
      <td>${r.id}</td><td>${r.order_id}</td><td>${r.buyer_name}</td><td>${r.qty}</td><td>${money(r.amount_agorot)}</td><td>${r.reason}</td><td>${REFUND_STATUS[r.status]}</td><td class="muted">${r.error ?? ""}</td></tr>`))}
    ${postButton(ctx, "/admin/tickets/retry-refunds", "ניסיון חוזר עכשיו", { cls: "btn" })}
  </section>`
  : html`<p class="flash good">אין החזרים פתוחים.</p>`}
<section class="card"><h2>הזמנות אחרונות</h2>
${table(["#", "הופעה", "קונה", "מייל", "כרטיסים", "סכום", "מצב", "מתי"], orders.map((o) => html`<tr>
  <td>${o.id}</td><td>${o.title}</td><td>${o.buyer_name}</td><td dir="ltr">${o.buyer_email}</td>
  <td>${o.qty}${o.refunded_qty ? html` <small class="muted">(${o.refunded_qty} הוחזרו)</small>` : ""}</td>
  <td>${money(o.total_agorot)}</td><td>${TICKET_STATUS[o.status] ?? o.status}</td><td>${shortDate(o.paid_at || o.created_at)}</td></tr>`))}
</section>`, opts);
}

// ---------- קופונים: עבודת הצוות מאחורי הקלעים ----------

const fmt = (iso) => (iso ? shortDate(iso) : "עוד לא");
const REASON_HE = {
  ok: "שויך לג׳וקר", direct: "בלי קוד", unknown_ref: "קוד לא מוכר", wrong_campaign: "קוד של הופעה אחרת",
  campaign_paused: "הקמפיין היה מושהה", campaign_draft: "לפני שהקמפיין פורסם", campaign_ended: "אחרי שהקמפיין הסתיים",
  campaign_cancelled: "הקמפיין בוטל", campaign_sold_out: "מכסת הקידום מלאה", promoter_frozen: "ג׳וקר מוקפא",
  self_purchase: "רכישה עצמית", promo_limit: "מכסת הקידום מלאה",
};

export function adminCoupons(ctx, { queue }, opts) {
  return shell(
    ctx,
    "coupons",
    html`
<p class="muted">הופעות במסלול הקופונים. האמן והג׳וקרים לא עושים כלום: אנחנו מגדירים את הקודים במערכת הכרטוס של האמן ומעלים את ייצוא המכירות.</p>
${queue.length
  ? table(["הופעה", "מתי", "קודים", "ממתינים להגדרה", "עדכון מכירות אחרון", ""],
      queue.map((q) => html`<tr${q.pending ? html` class="unread"` : ""}><td><b>${q.title}</b><br><small>${q.artist_name}</small></td><td>${shortDate(q.starts_at)}</td>
        <td>${q.codes}</td><td>${q.pending ? html`<b>${q.pending}</b>` : "0"}</td><td>${fmt(q.last_import)}</td>
        <td><a class="btn small" href="/admin/coupons/${q.campaign_id}">טיפול</a></td></tr>`))
  : html`<p class="muted">אין עדיין הופעות במסלול הקופונים.</p>`}`,
    opts
  );
}

export function adminCouponCampaign(ctx, { c, codes, imports, lastImport }, opts) {
  const pending = codes.filter((x) => !x.coupon_registered_at);
  return shell(
    ctx,
    "coupons",
    html`
<p><a href="/admin?tab=coupons">→ כל ההופעות</a></p>
<h2>${c.title} <small class="muted">· ${c.artist_name}</small></h2>
<p class="meta">עמוד הכרטיסים של האמן: ${c.source_url ? html`<a href="${c.source_url}" target="_blank" rel="noopener" dir="ltr">${c.source_url}</a>` : "חסר"} · עדכון מכירות אחרון: ${fmt(lastImport)}</p>

<section class="card">
  <h2>1. קודים להגדרה במערכת הכרטוס (${pending.length})</h2>
  ${pending.length
    ? html`<p class="muted">מגדירים קוד הנחה של 0% לכל אחד מהקודים, ואז מסמנים.</p>
      <textarea class="codes-box" rows="${Math.min(10, pending.length + 1)}" readonly id="pending-codes" dir="ltr">${pending.map((x) => x.coupon_code).join("\n")}</textarea>
      <div class="inline">
        <button type="button" class="btn small ghost" data-copy-from="pending-codes">העתקת כל הקודים</button>
        <a class="btn small ghost" href="/admin/coupons/${c.id}/codes.csv">הורדה כקובץ</a>
        ${postButton(ctx, `/admin/coupons/${c.id}/registered`, `סימון ${pending.length} הקודים כמוגדרים`, { cls: "btn small" })}
      </div>`
    : html`<p class="ok">כל הקודים מוגדרים.</p>`}
  <details><summary>כל הקודים (${codes.length})</summary>
    ${table(["קוד", "ג׳וקר", "נוצר", "הוגדר"], codes.map((x) => html`<tr><td dir="ltr"><code>${x.coupon_code}</code></td><td>${x.name ?? ""}</td><td>${shortDate(x.created_at)}</td><td>${fmt(x.coupon_registered_at)}</td></tr>`))}
  </details>
</section>

<section class="card">
  <h2>2. עדכון מכירות</h2>
  <p class="muted">מעלים את ייצוא המכירות ממערכת הכרטוס (CSV, גם בעברית). אפשר להעלות את כל המכירות מההתחלה בכל פעם: הזמנות קיימות לא נספרות פעמיים, והחזרים מתעדכנים.</p>
  <form method="post" action="/admin/coupons/${c.id}/import" enctype="multipart/form-data" class="inline">
    ${csrfField(ctx)}
    <input type="file" name="file" accept=".csv,text/csv,text/plain" required>
    <button class="btn">העלאה ותצוגה מקדימה</button>
  </form>
  ${imports.length
    ? table(["מתי", "קובץ", "מצב", "תוצאה"], imports.map((i) => html`<tr><td>${shortDate(i.created_at)}</td><td><a href="/admin/imports/${i.id}">${i.filename || "ללא שם"}</a></td><td>${{ preview: "ממתין לאישור", applied: "הוחל", discarded: "בוטל" }[i.status]}</td><td><small dir="ltr">${i.summary !== "{}" ? i.summary : ""}</small></td></tr>`))
    : ""}
</section>`,
    opts
  );
}

export function adminImport(ctx, d, opts) {
  const { imp, c, parsed, mapping, missing, sales, errors, counts } = d;
  const FIELDS = [["order", "מספר הזמנה *"], ["coupon", "קוד קופון *"], ["qty", "כמות"], ["amount", "סכום"], ["date", "תאריך"], ["email", "מייל הקונה"], ["status", "סטטוס (להחזרים)"]];
  const outcome = (s) =>
    s.action === "new" ? html`<span class="badge ${s.attribution.reason === "ok" ? "os-completed" : ""}">${s.attribution.reason === "ok" ? "חדש, שויך" : `חדש · ${REASON_HE[s.attribution.reason] ?? s.attribution.reason}`}</span>`
      : s.action === "refund" ? html`<span class="badge os-cancelled">עדכון החזר</span>` : html`<span class="badge">כבר קיים</span>`;
  return shell(
    ctx,
    "coupons",
    html`
<p><a href="/admin/coupons/${c.id}">→ ${c.title}</a></p>
<h2>ייבוא מכירות · ${imp.filename || "קובץ"}</h2>
<form method="post" action="/admin/imports/${imp.id}/map" class="card">
  ${csrfField(ctx)}
  <h3>אילו עמודות?</h3>
  <div class="map-grid">${FIELDS.map(([f, label]) => html`<label class="field">${label}
    <select name="${f}"><option value="">—</option>${parsed.header.map((h, i) => html`<option value="${i}"${mapping[f] === i ? html` selected` : ""}>${h}</option>`)}</select></label>`)}</div>
  ${imp.status === "preview" ? html`<button class="btn small ghost">עדכון התצוגה</button>` : ""}
</form>
${missing.length
  ? html`<p class="flash bad">צריך לבחור עמודה למספר הזמנה ולקוד הקופון.</p>`
  : html`
<div class="stats">
  <div class="stat"><b>${counts.total}</b><span>הזמנות בקובץ</span></div>
  <div class="stat"><b>${counts.newMatched}</b><span>חדשות ששויכו לג׳וקרים</span></div>
  <div class="stat"><b>${counts.newOther}</b><span>חדשות בלי תגמול</span></div>
  <div class="stat"><b>${counts.refunds}</b><span>עדכוני החזר</span></div>
  <div class="stat"><b>${counts.unchanged}</b><span>כבר קיימות</span></div>
</div>
${counts.unknownCodes.length ? html`<p class="flash bad">קודים לא מוכרים: <span dir="ltr">${counts.unknownCodes.join(", ")}</span>. אולי טעות הקלדה במערכת הכרטוס.</p>` : ""}
${errors.length ? html`<details class="card"><summary>${errors.length} שורות לא נקראו</summary><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></details>` : ""}
${imp.status === "preview"
  ? html`<div class="actions">${postButton(ctx, `/admin/imports/${imp.id}/apply`, `אישור והחלה (${counts.newMatched + counts.refunds} שינויים בתגמולים)`, { cls: "btn" })}${postButton(ctx, `/admin/imports/${imp.id}/discard`, "ביטול", { cls: "btn ghost" })}</div>`
  : html`<p class="ok">הייבוא הוחל ב-${shortDate(imp.applied_at)}.</p>`}
${table(["הזמנה", "קוד", "כמות", "הוחזרו", "תאריך", "מה יקרה"], sales.slice(0, 300).map((s) => html`<tr><td>${s.orderId}</td><td dir="ltr">${s.coupon || "—"}</td><td>${s.qty}</td><td>${s.refundedQty || ""}</td><td>${s.orderedAt ? shortDate(s.orderedAt) : "—"}</td><td>${outcome(s)}</td></tr>`))}`}`,
    opts
  );
}

export const adminContentTab = (ctx, data, opts) => shell(ctx, "content", adminContent(ctx, data), opts);

export function adminOverview(ctx, { counts, issues, webhooks }, opts) {
  return shell(
    ctx,
    "",
    html`
<div class="stats">
  ${Object.entries(counts).map(([k, v]) => html`<div class="stat"><b>${v}</b><span>${k}</span></div>`)}
</div>
<p class="note"><a href="/design">שפה עיצובית (פנימי)</a></p>
<section class="card">
  <h2>בדיקת התאמה כספית</h2>
  ${issues.length ? html`<ul class="bad-list">${issues.map((i) => html`<li>${i}</li>`)}</ul>` : html`<p class="ok">תקין: היומן, היתרות והתשלומים תואמים.</p>`}
  ${postButton(ctx, "/admin/settle", "הרצת שחרור תגמולים עכשיו", { cls: "btn ghost" })}
</section>
<section class="card">
  <h2>Webhooks אחרונים</h2>
  ${table(["זמן", "ספק", "סוג", "תוצאה"], webhooks.map((w) => html`<tr><td>${shortDate(w.received_at)}</td><td>${w.provider}</td><td>${w.type}</td><td><code>${w.result}</code></td></tr>`))}
</section>`,
    opts
  );
}

export function adminPayouts(ctx, { rows }, opts) {
  return shell(
    ctx,
    "payouts",
    html`${rows.some((p) => p.status === "requested") ? html`<p><a class="btn small ghost" href="/admin/payouts.csv">הורדת הבקשות הפתוחות לקובץ</a></p>` : ""}${table(
      ["#", "משתמש", "סכום", "לאן", "מצב", "פעולה"],
      rows.map(
        (p) => html`<tr><td>${p.id}</td><td>${p.name} <small dir="ltr">${p.email}</small></td><td><b>${money(p.amount_agorot)}</b></td>
        <td>${p.details ? (p.details.method === "bit" ? `ביט ${p.details.phone}` : `${p.details.bank}/${p.details.branch}/${p.details.account}`) : "—"}<br><small>${p.details?.full_name ?? ""}</small></td>
        <td>${{ requested: "ממתין", paid: `שולם · ${p.reference}`, failed: `נכשל · ${p.reference}` }[p.status]}</td>
        <td>${p.status === "requested"
          ? html`<form method="post" action="/admin/payouts/${p.id}" class="inline">${csrfField(ctx)}
              <input name="reference" placeholder="אסמכתא" required size="10">
              <button class="btn small" name="outcome" value="paid">שולם</button>
              <button class="btn small ghost" name="outcome" value="failed" formnovalidate>נכשל</button></form>`
          : ""}</td></tr>`
      )
    )}`,
    opts
  );
}

export function adminDisputes(ctx, { rows }, opts) {
  return shell(
    ctx,
    "disputes",
    rows.length
      ? html`${rows.map(
          (d) => html`<section class="card">
        <p><b>#${d.id}</b> · ${d.name} <small dir="ltr">${d.email}</small> · ${d.title ?? "ללא הופעה"} · ${shortDate(d.created_at)} · ${d.status}</p>
        <blockquote>${d.message}</blockquote>
        ${d.status === "open"
          ? html`<form method="post" action="/admin/disputes/${d.id}" class="stack">${csrfField(ctx)}
              <label class="field">תשובה למשתמש<input name="resolution" required maxlength="500"></label>
              <label class="field">התאמה כספית בש"ח (לא חובה, למשל 20 או ‎-20)<input name="adjustment" dir="ltr"></label>
              <div class="inline"><button class="btn small" name="outcome" value="resolved">אישור</button><button class="btn small ghost" name="outcome" value="rejected">דחייה</button></div>
            </form>`
          : html`<p class="muted">${d.resolution}</p>`}
      </section>`
        )}`
      : html`<p class="muted">אין פניות.</p>`,
    opts
  );
}

export function adminOrders(ctx, { rows }, opts) {
  return shell(
    ctx,
    "orders",
    table(
      ["זמן", "הופעה", "כמות", "סכום", "שיוך", "מקדם", "תגמול", ""],
      rows.map(
        (o) => html`<tr><td>${shortDate(o.created_at)}</td><td>${o.title}</td><td>${o.qty}${o.refunded_qty ? ` (−${o.refunded_qty})` : ""}${o.cancelled ? " בוטל" : ""}</td>
        <td>${money(o.total_agorot)}</td><td><small>${ATTRIBUTION_LABEL[o.attribution] ?? o.attribution}</small></td><td>${o.promoter_name ?? ""}</td>
        <td>${o.commission_id ? html`${money(o.amount_agorot)} <small>${COMMISSION_HE[o.commission_status] ?? o.commission_status}</small>` : ""}</td>
        <td>${o.commission_id && ["pending", "payable"].includes(o.commission_status) && !o.payout_id
          ? postButton(ctx, `/admin/commissions/${o.commission_id}/dispute`, "הקפאה", { cls: "btn small ghost", fields: { on: "1" } })
          : o.commission_status === "disputed"
            ? postButton(ctx, `/admin/commissions/${o.commission_id}/dispute`, "שחרור", { cls: "btn small", fields: { on: "0" } })
            : ""}</td></tr>`
      )
    ),
    opts
  );
}

export function adminCampaigns(ctx, { rows }, opts) {
  return shell(
    ctx,
    "campaigns",
    table(
      ["#", "אמן", "הופעה", "מתי", "מצב", "תגמול", ""],
      rows.map(
        (c) => html`<tr><td>${c.id}</td><td>${c.artist_name}</td><td><a href="/artist/c/${c.id}">${c.title}</a></td><td>${shortDate(c.starts_at)}</td>
        <td>${statusBadge(c.status)}</td><td>${money(c.reward_agorot)}</td>
        <td>${c.status === "active" ? postButton(ctx, `/artist/c/${c.id}/status`, "השהיה", { cls: "btn small ghost", fields: { to: "paused" } }) : ""}</td></tr>`
      )
    ),
    opts
  );
}

export function adminUsers(ctx, { rows }, opts) {
  return shell(
    ctx,
    "users",
    table(
      ["#", "שם", "מייל", "הצטרף", "", ""],
      rows.map(
        (u) => html`<tr><td>${u.id}</td><td>${u.name ?? ""}${u.is_admin ? " (מנהל)" : ""}</td><td dir="ltr">${u.email}</td><td>${shortDate(u.created_at)}</td>
        <td>${u.frozen_at ? "מוקפא" : ""}</td>
        <td>${u.is_admin ? "" : postButton(ctx, `/admin/users/${u.id}/freeze`, u.frozen_at ? "שחרור" : "הקפאה", { cls: "btn small ghost", fields: { on: u.frozen_at ? "0" : "1" }, confirm: u.frozen_at ? "" : "להקפיא את המשתמש? התגמולים שלו יעוכבו והלינקים שלו יפסיקו לזכות." })}</td></tr>`
      )
    ),
    opts
  );
}

export function adminAudit(ctx, { rows }, opts) {
  return shell(
    ctx,
    "audit",
    table(
      ["זמן", "מי", "פעולה", "על מה", "פרטים"],
      rows.map((a) => html`<tr><td>${shortDate(a.created_at)}</td><td>${a.actor ?? "מערכת"}</td><td><code>${a.action}</code></td><td>${a.entity} #${a.entity_id}</td><td><small dir="ltr">${a.data}</small></td></tr>`)
    ),
    opts
  );
}

export function adminSim(ctx, { orders, events }, opts) {
  return shell(
    ctx,
    "sim",
    html`
<p class="note">ספק כרטוס מדומה לפיילוט ולבדיקות. כל פעולה כאן שולחת webhook חתום, כמו ספק אמיתי.</p>
${table(
  ["זמן", "הזמנה", "קונה", "כמות", "ref", ""],
  orders.map(
    (o) => html`<tr><td>${shortDate(o.created_at)}</td><td><code>${o.id}</code></td><td>${o.buyer_name}</td><td>${o.qty}${o.refunded_qty ? ` (הוחזרו ${o.refunded_qty})` : ""}</td>
    <td><small>${o.ref ? "יש" : "—"}</small></td>
    <td>${o.refunded_qty < o.qty
      ? html`${postButton(ctx, `/admin/sim/refund`, "החזר כרטיס", { cls: "btn small ghost", fields: { order: o.id, qty: 1 } })}${postButton(ctx, `/admin/sim/replay`, "שליחה כפולה", { cls: "btn small ghost", fields: { order: o.id } })}`
      : ""}</td></tr>`
  )
)}
<h2>ביטול הופעה אצל הספק</h2>
${table(["הופעה", ""], events.map((e) => html`<tr><td>${e.title}${e.cancelled ? " · בוטלה" : ""}</td><td>${e.cancelled ? "" : postButton(ctx, "/admin/sim/cancel", "ביטול הופעה", { cls: "btn small danger", fields: { event: e.external_id }, confirm: "לבטל את ההופעה אצל הספק?" })}</td></tr>`))}`,
    opts
  );
}

// ---------- קופת הספק המדומה (מה שרוכש רואה אצל ספק כרטוס) ----------

export function simCheckout(ctx, { ev, ref, error }) {
  return simShell(
    html`
<h1>${ev.title}</h1>
<p>${money(ev.price_agorot)} לכרטיס</p>
${error ? html`<p class="flash bad">${error}</p>` : ""}
<form method="post" class="stack">
  ${csrfField(ctx)}<input type="hidden" name="ref" value="${ref}">
  <label class="field">שם מלא<input name="name" required autocomplete="name"></label>
  <label class="field">מייל (לשם יישלחו הכרטיסים)<input name="email" type="email" required autocomplete="email"></label>
  <label class="field">כמות<select name="qty">${[1, 2, 3, 4, 5, 6].map((n) => html`<option>${n}</option>`)}</select></label>
  <button class="btn big block">תשלום</button>
</form>
<p class="note">קופת Sandbox: לא מחויב כסף אמיתי.</p>`
  );
}

export function simReceipt(ctx, { o, backUrl }) {
  return simShell(
    html`
<h1>התשלום התקבל</h1>
<p>${o.buyer_name}, הנה הכרטיסים שלך:</p>
<ul class="codes">${o.codes.split(",").map((c) => html`<li><code>${c}</code></li>`)}</ul>
<a class="btn block" href="${backUrl}">חזרה</a>`
  );
}

function simShell(body) {
  return html`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>קופת כרטיסים (Sandbox)</title><link rel="stylesheet" href="/static/style.css"></head>
<body class="sim"><div class="sim-bar">TicketBox · Sandbox</div><main class="narrow">${body}</main></body></html>`.s;
}
