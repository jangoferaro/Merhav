// מערכת ניהול פנימית (PRD §24) + הקופה המדומה של ספק הכרטוס
import { shortDate } from "../util.js";
import { ATTRIBUTION_LABEL } from "../domain/ingest.js";
import { csrfField, html, layout, money, postButton, statusBadge } from "./kit.js";
import { adminContent } from "./content.js";

const COMMISSION_HE = { pending: "ממתין", payable: "זמין", paid: "שולם", reversed: "בוטל", disputed: "מוקפא" };

const TABS = [
  ["", "סקירה"], ["payouts", "תשלומים"], ["disputes", "פניות"], ["orders", "עסקאות"],
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
    table(
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
    ),
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
