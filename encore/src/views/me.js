// המכירות שלי / הכסף שלי / התראות — אזור המקדם
import { config, shortDate } from "../util.js";
import { availableFrom } from "../domain/money.js";
import { csrfField, empty, html, layout, money, showDate, stat, statusBadge } from "./kit.js";

const COMMISSION_LABEL = {
  pending: "ממתין לאישור", payable: "זמין", paid: "שולם", reversed: "בוטל", disputed: "בבדיקה",
};

const tabs = (ctx) => html`
<nav class="tabs" aria-label="האזור שלי">
  ${[["/me/sales", "המכירות שלי"], ["/me/money", "הכסף שלי"], ["/me/notifications", "התראות"]].map(
    ([h, l]) => html`<a href="${h}"${ctx.url.pathname === h ? html` aria-current="page"` : ""}>${l}</a>`
  )}
</nav>`;

export function salesPage(ctx, { rows, balances }, opts) {
  const tickets = rows.reduce((s, r) => s + r.tickets, 0);
  const earned = rows.reduce((s, r) => s + r.earned, 0);
  return layout(
    ctx,
    "המכירות שלי",
    html`
${tabs(ctx)}
<div class="stats three">
  ${stat(tickets, "כרטיסים נמכרו בזכותך")}
  ${stat(money(earned), "סך התגמולים", "money")}
  ${stat(rows.length, "הופעות שקידמת")}
</div>
${rows.length
  ? html`
<ul class="list">
  ${rows.map(
    (r) => html`
  <li>
    <div class="grow">
      <a href="/s/${r.campaign_id}/share"><b>${r.title}</b></a> <span class="muted">· ${r.artist_name}</span>
      <div class="meta">${showDate(r.starts_at)} · ${r.clicks} נכנסו · ${r.tickets} כרטיסים ${r.campaign_status !== "active" ? html`· ${statusBadge(r.campaign_status)}` : ""}</div>
    </div>
    <div class="end"><b class="money">${money(r.earned)}</b>${r.pending ? html`<small class="muted">${money(r.pending)} ממתין</small>` : ""}</div>
  </li>`
  )}
</ul>`
  : empty("עוד לא קידמת הופעות", "בוחרים הופעה ומשתפים. זה לוקח פחות מדקה.", html`<a class="btn" href="/shows">להופעות</a>`)}

<details class="card">
  <summary>מכירה שלא נספרה?</summary>
  <form method="post" action="/me/disputes" class="stack">
    ${csrfField(ctx)}
    <label class="field">איזו הופעה?
      <select name="campaign_id"><option value="">לא בטוח/ה</option>${rows.map((r) => html`<option value="${r.campaign_id}">${r.title}</option>`)}</select>
    </label>
    <label class="field">מה קרה?<textarea name="message" rows="3" required maxlength="1000" placeholder="למשל: חברה קנתה 2 כרטיסים ביום ראשון בערב דרך הלינק שלי"></textarea></label>
    <button class="btn ghost">שליחה לבדיקה</button>
  </form>
  <p class="note">כדי שרכישה תיזקף לך, הקונה צריך ללחוץ על הלינק שלך ולקנות מאותו מכשיר תוך ${config.attributionDays} יום.</p>
</details>`,
    opts
  );
}

export function moneyPage(ctx, { balances: b, commissions, payouts, details, detailsMasked, nextRelease }, opts) {
  const canRequest = b.available >= config.minPayoutAgorot && !b.inTransit;
  return layout(
    ctx,
    "הכסף שלי",
    html`
${tabs(ctx)}
<div class="money-buckets">
  <div class="bucket pending"><span>ממתין לאישור</span><b>${money(b.pending)}</b>
    <small>${nextRelease ? `הבא מתפנה ב-${showDate(nextRelease, { weekday: undefined, hour: undefined, minute: undefined })}` : `מתפנה ${config.holdDaysAfterShow} ימים אחרי ההופעה`}</small></div>
  <div class="bucket available"><span>זמין לתשלום</span><b>${money(b.available)}</b>
    <small>${b.inTransit ? `${money(b.inTransit)} בדרך אליך` : `אפשר לבקש מ-${money(config.minPayoutAgorot)}`}</small></div>
  <div class="bucket paid"><span>שולם</span><b>${money(b.paid)}</b><small>סה"כ עד היום</small></div>
</div>
${b.disputed ? html`<p class="note center">${money(b.disputed)} בבדיקה של הצוות.</p>` : ""}
${b.available < 0 ? html`<p class="note center">היתרה שלילית בגלל החזר על כרטיס שכבר שולם. זה יקוזז מהתגמולים הבאים.</p>` : ""}

<section class="card">
  ${details
    ? html`
  <div class="row-head"><h2>לאן להעביר</h2><span class="muted">${detailsMasked}</span></div>
  <form method="post" action="/me/payouts">${csrfField(ctx)}
    <button class="btn big block" ${canRequest ? "" : html`disabled`}>${b.inTransit ? "יש בקשה בטיפול" : `בקשת העברה של ${money(Math.max(0, b.available))}`}</button>
  </form>
  <details><summary>עדכון פרטים</summary>${detailsForm(ctx)}</details>`
    : html`<h2>לאן להעביר לך את הכסף?</h2><p class="muted">ממלאים פעם אחת. הפרטים נשמרים מוצפנים.</p>${detailsForm(ctx)}`}
</section>

${commissions.length
  ? html`
<section>
  <h2>פירוט</h2>
  <ul class="list compact">
    ${commissions.map(
      (m) => html`<li>
        <div class="grow"><b>${m.kind === "sale" ? m.title : m.kind === "clawback" ? `קיזוז · ${m.title ?? ""}` : `התאמה`}</b>
          <div class="meta">${shortDate(m.created_at)}${m.kind === "sale" ? ` · ${m.rewarded_qty} כרטיסים${m.refunded_qty ? ` (${m.refunded_qty} הוחזרו)` : ""}` : m.note ? ` · ${m.note}` : ""}
          ${m.status === "pending" && m.starts_at ? ` · יתפנה ב-${shortDate(availableFrom(m.starts_at))}` : ""}</div></div>
        <div class="end"><b class="${m.amount_agorot < 0 ? "neg" : "money"}">${money(m.amount_agorot)}</b>
          <small class="st st-c-${m.status}">${m.payout_id && m.status === "payable" ? "בתהליך תשלום" : COMMISSION_LABEL[m.status]}</small></div>
      </li>`
    )}
  </ul>
</section>`
  : ""}
${payouts.length
  ? html`
<section>
  <h2>העברות</h2>
  <ul class="list compact">${payouts.map(
    (p) => html`<li><div class="grow">${shortDate(p.created_at)}${p.reference && p.status === "paid" ? html` <span class="muted">· אסמכתא ${p.reference}</span>` : ""}</div>
      <div class="end"><b>${money(p.amount_agorot)}</b><small>${{ requested: "בטיפול", paid: "הועבר ✓", failed: "נכשל" }[p.status]}</small></div></li>`
  )}</ul>
</section>`
  : ""}`,
    opts
  );
}

function detailsForm(ctx) {
  return html`
<form method="post" action="/me/payout-details" class="stack">
  ${csrfField(ctx)}
  <label class="field">שם מלא (כמו בחשבון)<input name="full_name" required maxlength="80" autocomplete="name"></label>
  <fieldset class="seg">
    <label><input type="radio" name="method" value="bit" checked> ביט / פייבוקס</label>
    <label><input type="radio" name="method" value="bank"> העברה בנקאית</label>
  </fieldset>
  <label class="field" data-method="bit">טלפון נייד<input name="phone" inputmode="tel" autocomplete="tel" placeholder="05X-XXXXXXX"></label>
  <div class="row3" data-method="bank" hidden>
    <label class="field">בנק<input name="bank" maxlength="30"></label>
    <label class="field">סניף<input name="branch" inputmode="numeric" maxlength="10"></label>
    <label class="field">חשבון<input name="account" inputmode="numeric" maxlength="20"></label>
  </div>
  <label class="check"><input type="checkbox" name="adult" required> מלאו לי 18</label>
  <button class="btn ghost block">שמירה</button>
</form>`;
}

export function notificationsPage(ctx, { items, notifySales }, opts) {
  return layout(
    ctx,
    "התראות",
    html`
${tabs(ctx)}
${items.length
  ? html`<ul class="list compact">${items.map(
      (n) => html`<li class="${n.read_at ? "" : "unread"}"><div class="grow">${n.url ? html`<a href="${n.url}">${n.body}</a>` : n.body}<div class="meta">${shortDate(n.created_at)}</div></div></li>`
    )}</ul>`
  : empty("אין התראות", "כשמישהו יקנה כרטיס בזכותך, נספר לך כאן.")}
<form method="post" action="/me/settings" class="card row-head">
  ${csrfField(ctx)}
  <label class="check"><input type="checkbox" name="notify_sales" ${notifySales ? html`checked` : ""} data-autosubmit> התראה על כל מכירה</label>
  <button class="btn small ghost">שמירה</button>
</form>
<form method="post" action="/logout" class="center">${csrfField(ctx)}<button class="linklike">יציאה מהחשבון</button></form>`,
    opts
  );
}
