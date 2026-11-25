// מסכי הקופה של JoCares: קנייה, תשלום, כרטיס, כניסה בדלת, ומכירות לאמן.
import { config, isoToIsraelLocal } from "../util.js";
import { smsEnabled } from "../mailer.js";
import { csrfField, html, inviteBox, layout, money, poster, postButton, priceTag, raw, showDate, stat } from "./kit.js";

const fmtCode = (code) => `${code.slice(0, 5)} ${code.slice(5)}`;

export function checkoutPage(ctx, { c, inv, price, inviter = null, discount = 0, v = {}, error = "" }, opts) {
  const max = Math.min(config.maxTicketsPerOrder, inv.available);
  const fee = config.ticketFeeAgorot;
  const qty = Math.min(Number(v.qty) || 1, Math.max(max, 1));
  return layout(
    ctx,
    `כרטיסים · ${c.title}`,
    html`
<section class="narrow checkout">
  <div class="checkout-show">
    ${poster(c, "mini")}
    <div>
      <p class="eyebrow">${c.artist_name}</p>
      <h1>${c.title}</h1>
      <p class="meta">${showDate(c.starts_at)}<br>${c.venue}${c.city ? `, ${c.city}` : ""}</p>
    </div>
  </div>
  ${inviteBox(inviter)}
  ${error ? html`<p class="flash bad">${error}</p>` : ""}
  ${max < 1
    ? html`<div class="card center"><h2>הכרטיסים אזלו</h2><p class="muted">${inv.held ? "חלק מהכרטיסים שמורים לאנשים שמשלמים עכשיו. אולי יתפנו בעוד כמה דקות." : "אין יותר כרטיסים להופעה הזו."}</p></div>`
    : html`
  <form method="post" action="/checkout/${c.id}" class="stack" data-busy="מעבירים לתשלום…">
    ${csrfField(ctx)}
    <div class="qty-row">
      <label class="field">כמה כרטיסים?
        <select name="qty" data-qty data-unit="${price.price - discount + fee}">
          ${Array.from({ length: max }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === qty ? html`selected` : ""}>${n}</option>`)}
        </select>
      </label>
      <div class="total"><span class="muted">לתשלום</span><b data-total>${money(qty * (price.price - discount + fee))}</b></div>
    </div>
    ${discount ? html`<p class="early-note">הנחה של ${money(discount)} לכרטיס מ${inviter?.name ?? "הג׳וקר"}</p>` : ""}
    <p class="note">${priceTag(c, price)} לכרטיס${fee ? ` + ${money(fee)} דמי שירות` : ". בלי דמי שירות"}.${inv.available <= 20 ? ` נשארו ${inv.available}.` : ""}</p>
    <label class="field">שם מלא<input name="name" required maxlength="80" autocomplete="name" value="${v.name ?? ""}"></label>
    ${c.ticket_mode === "named"
      ? html`<fieldset class="holders" data-holders><legend class="field">שם על כל כרטיס</legend>
          <p class="hint">הכרטיסים שמיים: בכניסה מציגים תעודה מזהה עם אותו שם, ואי אפשר להעביר אותם.</p>
          ${Array.from({ length: Math.max(max, 1) }, (_, i) => html`<label class="field" data-holder="${i + 1}" ${i + 1 > qty ? html`hidden` : ""}>כרטיס ${i + 1}${i === 0 ? " (השאירו ריק אם זה אותו שם)" : ""}<input name="holder_${i + 1}" maxlength="60" autocomplete="${i === 0 ? "name" : "off"}" value="${v[`holder_${i + 1}`] ?? ""}" ${i > 0 && i + 1 <= qty ? html`required` : ""}></label>`)}
        </fieldset>`
      : ""}
    <label class="field">מייל<input name="email" type="email" required autocomplete="email" dir="ltr" value="${v.email ?? ""}"><small class="hint">לכאן נשלחים הכרטיסים.</small></label>
    <label class="field">טלפון (לא חובה)<input name="phone" type="tel" autocomplete="tel" dir="ltr" maxlength="20" value="${v.phone ?? ""}"><small class="hint">${smsEnabled() ? "נשלח לשם גם את הכרטיסים ב-SMS. " : ""}ישמש רק אם תהיה הודעה על שינוי בהופעה.</small></label>
    <label class="check"><input type="checkbox" name="consent" ${v.consent === "on" ? html`checked` : ""}> אשמח ש${c.artist_name} יעדכנו אותי במייל על הופעות הבאות. אפשר לבטל בכל רגע.</label>
    <button class="btn big block acid">לתשלום</button>
    <p class="note center">התשלום בעמוד מאובטח של חברת הסליקה. פרטי הכרטיס לא עוברים דרכנו. <a href="/terms">תנאים</a></p>
  </form>`}
</section>`,
    { ...opts, description: `כרטיסים ל${c.artist_name} · ${c.title}` }
  );
}

/** עמוד התשלום של ספק הניסיון. נראה בכוונה כמו עמוד של צד שלישי. */
export function sandboxPayPage(ctx, { p, error = "" }) {
  return layout(
    ctx,
    "תשלום",
    html`
<section class="narrow paybox">
  <p class="sandbox-note">קופת ניסיון. לא נגבה כסף אמיתי. כרטיס שמתחיל ב-4000 ייכשל, כל מספר אחר יעבור.</p>
  <div class="card">
    <p class="eyebrow" dir="ltr">Sandbox Payments</p>
    <h1>${money(p.amount_agorot)}</h1>
    <p class="muted">${p.description}</p>
    ${error ? html`<p class="flash bad">${error}</p>` : ""}
    <form method="post" action="/pay/sandbox/${p.ref}" class="stack" data-busy="מעבד…">
      ${csrfField(ctx)}
      <label class="field">מספר כרטיס<input name="card" inputmode="numeric" dir="ltr" autocomplete="cc-number" value="4242 4242 4242 4242" required></label>
      <div class="row2">
        <label class="field">תוקף<input name="exp" dir="ltr" value="12/29" autocomplete="cc-exp"></label>
        <label class="field">CVV<input name="cvv" dir="ltr" value="123" inputmode="numeric" autocomplete="cc-csc"></label>
      </div>
      <button class="btn big block">תשלום ${money(p.amount_agorot)}</button>
    </form>
  </div>
</section>`,
    {}
  );
}

export function paymentPendingPage(ctx, { order }) {
  return layout(
    ctx,
    "מאשרים את התשלום",
    html`<section class="narrow center">
      <h1>${order.status === "failed" ? "התשלום לא עבר" : order.status === "expired" ? "הזמן לתשלום עבר" : "מאשרים את התשלום"}</h1>
      <p class="lead">${order.status === "failed"
        ? "לא חויבת. אפשר לנסות שוב עם כרטיס אחר."
        : order.status === "expired"
          ? "הכרטיסים שוחררו. אם חויבת, הכסף יוחזר אוטומטית."
          : "זה לוקח בדרך כלל כמה שניות. הכרטיסים יישלחו למייל ברגע שהתשלום יאושר."}</p>
      <p><a class="btn" href="${order.status === "pending" ? `/checkout/return/${order.token}` : `/checkout/${order.campaign_id}`}">${order.status === "pending" ? "בדיקה שוב" : "חזרה לקנייה"}</a></p>
    </section>`,
    {}
  );
}

export function ticketsPage(ctx, { c, order, tickets, fresh, url, invite = null }, opts) {
  const live = tickets.filter((t) => t.status !== "refunded");
  return layout(
    ctx,
    `הכרטיסים שלך · ${c.title}`,
    html`
<section class="narrow tickets-page">
  ${order.status === "rejected"
    ? html`<div class="card center"><h1>הכרטיסים אזלו בזמן התשלום</h1><p class="lead">מצטערים. כל הסכום (${money(order.total_agorot)}) מוחזר לאמצעי התשלום.</p></div>`
    : html`
  ${fresh ? html`<p class="flash good">שולם. ${order.qty > 1 ? "הכרטיסים נשלחו" : "הכרטיס נשלח"} גם ל-${order.buyer_email}.</p>` : ""}
  <h1 class="sr-only">הכרטיסים שלך: ${c.artist_name} · ${c.title}</h1>
  ${c.status === "cancelled" ? html`<p class="flash bad">ההופעה בוטלה. הכסף על הכרטיסים מוחזר לאמצעי התשלום.</p>` : ""}
  <p class="actions-row">
    <a class="btn ghost small" href="/tickets/${order.token}/calendar.ics">הוספה ליומן</a>
    <button type="button" class="btn ghost small" data-copy="${url}">העתקת הקישור לכרטיסים</button>
  </p>
  <div class="ticket-list">
    ${tickets.map((t) => ticketCard(c, t, { total: order.qty, holder: t.holder_name || order.buyer_name, named: !!t.holder_name, walletBase: `/tickets/${order.token}/wallet/${t.seq}` }))}
  </div>
  <p class="note center">${c.ticket_mode === "named"
    ? "כרטיס שמי: בכניסה מציגים את הקוד ותעודה מזהה עם אותו שם. אי אפשר להעביר אותו."
    : `בכניסה מציגים את הקוד מהטלפון. כל כרטיס נסרק פעם אחת.${live.length > 1 ? " כל כרטיס אפשר להעביר לחבר/ה בקישור משלו." : ""}`}</p>`}
</section>
${invite
  ? html`
<section class="narrow card come-with">
  <h2>בואו איתי</h2>
  <p>שלחו לחברים. הם יראו שכבר קניתם ושאתם מזמינים אותם, ויקנו באותה קופה.</p>
  ${invite.count ? html`<p class="flash good">${invite.count === 1 ? "חבר/ה אחד/ת כבר קנה/תה" : `${invite.count} חברים כבר קנו`} בעקבותיך.</p>` : ""}
  <div class="share-grid">
    <a class="share wa" href="https://wa.me/?text=${encodeURIComponent(`קניתי כרטיס ל${c.artist_name} · ${c.title}, ${showDate(c.starts_at)}. בואו איתי: ${invite.url}`)}" target="_blank" rel="noopener">WhatsApp</a>
    <button type="button" class="share" data-copy="${invite.url}">העתקת הלינק</button>
  </div>
</section>`
  : ""}
${order.status === "paid" && c.status === "active"
  ? html`
<section class="narrow card promo-box">
  <span class="stamp" lang="en" dir="ltr"><b>Be Jo.</b></span>
  <h2>רוצה גם להרוויח מזה?</h2>
  <p>הפכו לג׳וקרים של ההופעה: לינק אישי, ו-<b class="money">${money(c.reward_agorot)}</b> על כל כרטיס שנקנה דרככם.</p>
  <form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">קבלו לינק אישי</button></form>
</section>`
  : ""}`,
    { ...opts, noindex: true }
  );
}

// ---------- כניסה ----------

const RESULT = {
  ok: ["good", "כניסה"],
  used: ["bad", "הכרטיס כבר נסרק"],
  refunded: ["bad", "הכרטיס הוחזר ואינו בתוקף"],
  unknown: ["bad", "קוד לא מוכר"],
  wrong_show: ["bad", "כרטיס להופעה אחרת"],
};

export function doorPage(ctx, { c, token, stats, last = null }) {
  const [tone, label] = last ? RESULT[last.result] : [];
  return layout(
    ctx,
    `כניסה · ${c.title}`,
    html`
<section class="narrow door">
  <p class="eyebrow">כניסה · ${c.artist_name}</p>
  <h1>${c.title}</h1>
  <div class="stats three">${stat(stats.inside, "נכנסו")}${stat(stats.total - stats.inside, "עוד לא הגיעו")}${stat(stats.total, "כרטיסים")}</div>
  ${last
    ? html`<div class="door-result ${tone}" role="status">
        <b>${label}</b>
        ${last.t?.holder_name ? html`<span class="door-holder">${last.t.holder_name}</span><span>בדקו תעודה מזהה עם השם הזה</span>` : ""}
        ${last.t ? html`<span>${last.t.holder_name ? "הזמנה של " : ""}${last.t.buyer_name} · כרטיס ${last.t.seq} מתוך ${last.t.qty}</span>` : ""}
        ${last.result === "used" && last.t?.used_at ? html`<small>נסרק ב-${showDate(last.t.used_at)}</small>` : ""}
        <small dir="ltr">${last.code}</small>
      </div>`
    : ""}
  <div class="scanner" data-scanner hidden><video playsinline muted></video></div>
  <form method="post" action="/door/${token}" class="stack" data-door-form>
    ${csrfField(ctx)}
    <label class="field">קוד הכרטיס<input name="code" autocomplete="off" autocapitalize="characters" dir="ltr" autofocus required data-door-code></label>
    <button class="btn big block">בדיקה</button>
    <button type="button" class="btn ghost block" data-scan hidden>סריקה במצלמה</button>
  </form>
  <p class="note">אפשר לסרוק במצלמה, להקליד את הקוד, או לחבר סורק ברקוד. הדף הזה פתוח רק למי שיש לו את הקישור.</p>
</section>`,
    { noindex: true }
  );
}

// ---------- לאמן: מכירות ----------

export function artistSales(ctx, { c, s, orders, doorUrl, open, price, statement = null, payoutReady = true }) {
  const pct = s.capacity ? Math.round((s.sold / s.capacity) * 100) : 0;
  return html`
<section class="card sales">
  <h2>מכירות</h2>
  <div class="meter" aria-label="${pct}% נמכרו"><span style="--p:${pct}%"></span></div>
  <div class="stats">
    ${stat(`${s.sold} / ${s.capacity}`, "כרטיסים נמכרו")}
    ${stat(money(s.gross), "הכנסות ממכירות")}
    ${stat(s.inside, "נכנסו בדלת")}
  </div>
  <p class="note">${open ? "המכירה פתוחה עד תחילת ההופעה." : "המכירה סגורה."} השהיית הקידום לא עוצרת מכירות, רק תגמולים.</p>
  <div class="row2">
    <form method="post" action="/artist/c/${c.id}/capacity" class="inline">
      ${csrfField(ctx)}
      <label class="field">כמה כרטיסים יש<input name="capacity" type="number" min="${Math.max(1, s.sold + s.held)}" max="20000" value="${s.capacity}" inputmode="numeric"></label>
      <button class="btn ghost">עדכון</button>
    </form>
    <div class="field">רשימת קונים
      <a class="btn ghost" href="/artist/c/${c.id}/buyers.csv">הורדה לאקסל</a>
    </div>
  </div>
</section>

${!payoutReady
  ? html`<p class="flash bad">כדי שהכסף מהמכירות יגיע אליך, צריך למלא פעם אחת את פרטי העסק והחשבון. <a href="/artist/payout/${c.artist_id}">למילוי הפרטים</a></p>`
  : ""}
${statement
  ? html`<section class="card statement">
  <h2>סיכום כספי</h2>
  <div class="sum">
    <div class="row"><span>מכירת כרטיסים (${statement.tickets})</span><b>${money(statement.gross)}</b></div>
    <div class="row"><span>תגמולים לג׳וקרים</span><b dir="ltr">−${money(statement.rewards)}</b></div>
    <div class="row"><span>עמלת JoCares (5% מכרטיסים דרך ג׳וקרים)</span><b dir="ltr">−${money(statement.fees)}</b></div>
    <div class="row total"><span>נשאר לך</span><b>${money(statement.net)}</b></div>
  </div>
  <p class="note">לפני עמלת הסליקה של חברת האשראי. ${statement.joker_discounts ? `ג׳וקרים נתנו לחברים ${money(statement.joker_discounts)} הנחה מתוך התגמול שלהם, וזה לא יורד ממך.` : ""}</p>
</section>`
  : ""}

<details class="card" ${c.early_price_agorot ? html`open` : ""}>
  <summary>מחיר מוקדם ${price?.early ? html`<span class="badge st-active">פעיל · ${money(price.price)}</span>` : c.early_price_agorot ? html`<span class="badge">הסתיים</span>` : ""}</summary>
  <p class="muted">כמה כרטיסים בזול עד תאריך או עד כמות שתבחרו. נותן לאנשים סיבה אמיתית לקנות עכשיו ולא "אחר כך".</p>
  ${earlyFields(ctx, c)}
</details>

<section class="card">
  <h2>כניסה להופעה</h2>
  <p>פותחים את הקישור בטלפון בכניסה וסורקים. עובד גם בלי קליטה. לצוות קבוע שעובד בכל ההופעות: <a href="/artist/door">צוות כניסה</a>.</p>
  <div class="linkbox"><code dir="ltr">${doorUrl}</code><button type="button" class="btn small" data-copy="${doorUrl}">העתקה</button></div>
  ${postButton(ctx, `/artist/c/${c.id}/door/rotate`, "קישור חדש (הישן יפסיק לעבוד)", { cls: "linklike", confirm: "ליצור קישור חדש? הקישור הקודם יפסיק לעבוד מיד." })}
</section>

<details class="card" ${orders.length && orders.length <= 8 ? html`open` : ""}>
  <summary>הזמנות (${orders.length})</summary>
  ${orders.length
    ? html`<div class="table-wrap"><table class="orders">
      <thead><tr><th>#</th><th>שם</th><th>כרטיסים</th><th>סכום</th><th>דרך</th><th>נכנסו</th><th></th></tr></thead>
      <tbody>${orders.map(
        (o) => html`<tr>
          <td>${o.id}</td>
          <td>${o.buyer_name}${o.status === "rejected" ? html` <small class="muted">(נדחתה, הוחזרה)</small>` : ""}</td>
          <td>${o.qty}${o.refunded_qty ? html` <small class="muted">(${o.refunded_qty} הוחזרו)</small>` : ""}</td>
          <td>${money((o.qty - o.refunded_qty) * (o.unit_price_agorot - o.discount_agorot + o.fee_agorot))}</td>
          <td>${o.promoter_name ? o.promoter_name.split(" ")[0] : html`<span class="muted">ישיר</span>`}</td>
          <td>${o.used}</td>
          <td>${o.status === "paid" && o.refunded_qty < o.qty
            ? html`<form method="post" action="/artist/c/${c.id}/refund" class="inline refund" data-confirm="להחזיר את הכסף? הכרטיסים יפסיקו לעבוד מיד.">
                ${csrfField(ctx)}<input type="hidden" name="order" value="${o.id}">
                <select name="qty" aria-label="כמה להחזיר">${Array.from({ length: o.qty - o.refunded_qty }, (_, i) => i + 1).map((n) => html`<option value="${n}">${n}</option>`)}</select>
                <button class="btn ghost small">החזר</button></form>`
            : ""}</td>
        </tr>`
      )}</tbody></table></div>`
    : html`<p class="muted">עוד אין הזמנות.</p>`}
</details>`;
}

/** שדות המחיר המוקדם: בטופס פתיחת הופעה (בלי form), ובניהול ההופעה (עם form) */
export function earlyFields(ctx, c, { form = true } = {}) {
  const v = (k, fallback) => c[k] ?? fallback ?? "";
  const fields = html`
    <div class="row3">
      <label class="field">מחיר מוקדם (₪)<input name="early_price" type="number" min="1" step="0.01" inputmode="decimal" value="${c.early_price_agorot ? c.early_price_agorot / 100 : v("early_price")}"></label>
      <label class="field">עד מתי<input name="early_until" type="datetime-local" value="${c.early_until && c.early_until.includes("Z") ? isoToIsraelLocal(c.early_until) : v("early_until")}"></label>
      <label class="field">עד כמה כרטיסים<input name="early_qty" type="number" min="1" inputmode="numeric" value="${v("early_qty")}"></label>
    </div>
    <p class="note">אפשר למלא תאריך, כמות, או את שניהם. מה שמגיע קודם סוגר את המחיר המוקדם.</p>`;
  if (!form) return fields;
  return html`
  <form method="post" action="/artist/c/${c.id}/early" class="stack">
    ${csrfField(ctx)}${fields}
    <div class="row2"><button class="btn ghost">שמירה</button>${c.early_price_agorot ? html`<button class="linklike" name="clear" value="1">ביטול המחיר המוקדם</button>` : ""}</div>
  </form>`;
}

/** כרטיס אחד שהועבר לחבר */
export function singleTicketPage(ctx, { c, t }, opts) {
  return layout(
    ctx,
    `כרטיס · ${c.title}`,
    html`
<section class="narrow tickets-page">
  ${c.status === "cancelled" ? html`<p class="flash bad">ההופעה בוטלה.</p>` : ""}
  ${ticketCard(c, t, { total: 0, holder: "", from: t.buyer_name.split(" ")[0], walletBase: `/t/${t.share_token}/wallet` })}
  <p class="note center">בכניסה מציגים את הקוד מהטלפון. הכרטיס נסרק פעם אחת.</p>
</section>`,
    { ...opts, noindex: true }
  );
}

// ---------- הכרטיס עצמו ----------

const STATUS_HE = { valid: "בתוקף", used: "נכנס/ה", refunded: "הוחזר" };
const timeOnly = (iso) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayOnly = (iso) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

/**
 * כרטיס כמו כרטיס אמיתי: תמונת ההופעה, פרטים בשדות ברורים, קו קריעה, וספח עם ה-QR.
 * shareUrl: קישור להעברה (רק בכרטיס פתוח). walletBase: קישורים ל-Apple ו-Google Wallet, אם מוגדרים.
 */
export function ticketCard(c, t, { total, holder, named = false, from = "", walletBase = "" }) {
  return html`
<article class="tkt st-${t.status}" aria-label="כרטיס ${t.seq}${total ? ` מתוך ${total}` : ""}">
  <div class="tkt-top">
    ${c.image_url ? html`<img src="${c.image_url}" alt="" referrerpolicy="no-referrer">` : ""}
    <span class="tkt-badge">${named ? "כרטיס שמי" : "כניסה אחת"}</span>
    <span class="tkt-status">${STATUS_HE[t.status]}</span>
  </div>
  <div class="tkt-body">
    <p class="tkt-artist">${c.artist_name}</p>
    <h2 class="tkt-title">${c.title}</h2>
    <dl class="tkt-fields">
      <div><dt>תאריך</dt><dd>${dayOnly(c.starts_at)}</dd></div>
      <div><dt>שעה</dt><dd dir="ltr">${timeOnly(c.starts_at)}</dd></div>
      <div class="wide"><dt>מקום</dt><dd>${c.venue}${c.city ? `, ${c.city}` : ""}</dd></div>
      ${holder ? html`<div class="wide"><dt>${named ? "על שם" : "הוזמן על ידי"}</dt><dd>${holder}</dd></div>` : ""}
      ${from ? html`<div class="wide"><dt>מאת</dt><dd>${from}</dd></div>` : ""}
      ${total ? html`<div><dt>כרטיס</dt><dd dir="ltr">${t.seq} / ${total}</dd></div>` : ""}
    </dl>
  </div>
  <div class="tkt-tear" aria-hidden="true"></div>
  <div class="tkt-stub">
    ${t.status === "refunded" ? html`<div class="qr void"></div>` : html`<div class="qr">${raw(t.qr)}</div>`}
    <p class="ticket-code" dir="ltr">${fmtCode(t.code)}</p>
    ${named ? html`<p class="tkt-id">בכניסה: תעודה מזהה על שם ${holder}</p>` : ""}
  </div>
  ${t.status === "valid" && (t.wallet?.apple || t.wallet?.google)
    ? html`<div class="tkt-wallet">
        ${t.wallet.apple ? html`<a class="wallet-btn apple" href="${walletBase}/apple.pkpass">הוספה ל-Apple Wallet</a>` : ""}
        ${t.wallet.google ? html`<a class="wallet-btn google" href="${walletBase}/google" rel="noopener">שמירה ב-Google Wallet</a>` : ""}
      </div>`
    : ""}
  ${t.shareUrl ? html`<button type="button" class="btn ghost small tkt-share" data-copy="${t.shareUrl}" data-copied="הקישור הועתק. שלחו אותו לחבר/ה">העברת הכרטיס הזה לחבר/ה</button>` : ""}
  <p class="tkt-foot"><span dir="ltr">JoCares<i>.</i></span><span dir="ltr">Be Jo.</span></p>
</article>`;
}
