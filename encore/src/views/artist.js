// אזור האמן: מסך בית ממוקד תוצאות, פתיחת קמפיין בשלושה צעדים, וניהול קמפיין.
import { artistSales, earlyFields } from "./tickets.js";
import { config, isoToIsraelLocal } from "../util.js";
import { split, STATUS_LABEL, TRANSITIONS } from "../domain/campaigns.js";
import { csrfField, empty, html, imageInput, layout, mediaInput, mediaTile, money, postButton, poster, showDate, stat, statusBadge } from "./kit.js";
import { orderBadge } from "./content.js";

function contentOrdersBlock(orders) {
  return html`
<section>
  <div class="row-head"><h2>תוכן וחשיפה</h2><a class="btn small ghost" href="/creators">הזמנת תוכן</a></div>
  ${orders.length
    ? html`<ul class="list">${orders.map(
        (o) => html`<li class="${["submitted", "published"].includes(o.status) ? "unread" : ""}"><a class="row-link" href="/orders/${o.id}">
          <div class="grow"><b>${o.title}</b> <span class="muted">· ${o.creator_name}</span><div class="meta">${orderBadge(o.status)}</div></div>
          <b>${money(o.price_agorot)}</b></a></li>`
      )}</ul>`
    : html`<p class="muted">גם בלי הופעה קרובה אפשר להמשיך לגדול: ריל, סקירת שיר או פרסום אצל יוצרים שמתחברים למוזיקה שלך.</p>`}
</section>`;
}

export function artistHome(ctx, { list, totals, contentOrders = [] }, opts) {
  return layout(
    ctx,
    "ההופעות שלי",
    html`
<div class="row-head"><h1>האזור שלי כאמן</h1><a class="btn" href="/grow">+ מטרה חדשה</a></div>
${list.length
  ? html`
<div class="stats">
  ${stat(totals.tickets, "כרטיסים דרך ג׳וקרים")}
  ${stat(totals.promoters, "ג׳וקרים מקדמים אותך")}
  ${stat(money(totals.revenue), "הכנסות שנוצרו")}
  ${stat(totals.first_time, "קנו ממך לראשונה דרכנו", "", )}
</div>
<p class="note">"קנו לראשונה" = רוכשים שזו הרכישה הראשונה שלהם ממך דרך JoCares. ייתכן שהם כבר הכירו אותך מקודם.</p>
<ul class="list cards">
  ${list.map(
    (c) => html`<li>
      <a href="/artist/c/${c.id}" class="row-link">
        ${poster(c, "thumb")}
        <div class="grow"><b>${c.title}</b> ${statusBadge(c.status)}
          <div class="meta">${showDate(c.starts_at)} · ${c.venue}</div>
          <div class="meta">${c.results.tickets} כרטיסים · ${c.results.promoters} מקדמים · ${money(c.reward_agorot)} לכרטיס</div>
        </div>
        <span class="chev" aria-hidden="true">‹</span>
      </a>
    </li>`
  )}
</ul>`
  : empty("עוד אין הופעות", "מפרסמים הופעה אחת ורואים איך הקהל מתחיל להפיץ אותה.", html`<a class="btn big" href="/artist/new">פרסום הופעה ראשונה</a>`)}
${contentOrdersBlock(contentOrders)}`,
    opts
  );
}

// ---------- פתיחת קמפיין ----------

const steps = (n) => html`<ol class="steps-bar" aria-label="שלב ${n} מתוך 3">${["לינק", "פרטים ותגמול", "אישור"].map(
  (s, i) => html`<li class="${i + 1 === n ? "on" : i + 1 < n ? "done" : ""}">${s}</li>`
)}</ol>`;

export function newStep1(ctx, opts) {
  return layout(
    ctx,
    "הופעה חדשה",
    html`
<section class="narrow">
  ${steps(1)}
  <h1>הדביקו לינק להופעה</h1>
  <p class="muted">לינק לעמוד ההופעה באתר הכרטוס או באתר שלכם. ננסה למלא את הפרטים לבד.</p>
  <form method="post" action="/artist/new/extract" class="stack" data-busy="מחפשים את הפרטים…">
    ${csrfField(ctx)}
    <input type="url" name="url" required placeholder="https://…" dir="ltr" inputmode="url" autofocus>
    <button class="btn big block">המשך</button>
  </form>
  <p class="center"><a href="/artist/new/details">אין לינק? ממלאים ידנית</a></p>
</section>`,
    opts
  );
}

export function newForm(ctx, { v, found = [], error = "" }, opts) {
  const reward = v.reward ?? "";
  const field = (name, label, attrs = "", extra = "") =>
    html`<label class="field${found.includes(name) ? " found" : ""}">${label}${found.includes(name) ? html` <small>מולא אוטומטית</small>` : ""}
      <input name="${name}" value="${v[name] ?? ""}" ${html([attrs])}>${extra}</label>`;
  return layout(
    ctx,
    "פרטי ההופעה",
    html`
<section class="narrow">
  ${steps(2)}
  ${found.length ? html`<p class="flash good">מצאנו ${found.length} פרטים. בדקו שהכל נכון והשלימו את מה שחסר.</p>` : ""}
  ${error ? html`<p class="flash bad">${error}</p>` : ""}
  <form method="post" action="/artist/new/preview" class="stack" enctype="multipart/form-data" data-busy="מעלים…">
    ${csrfField(ctx)}
    <fieldset class="seg ticketing" data-ticketing><legend class="field">איך מוכרים את הכרטיסים?</legend>
      <label><input type="radio" name="ticketing" value="jocares" ${!["coupon", "sim"].includes(v.ticketing) ? html`checked` : ""}> JoCares מוכרת (מומלץ)</label>
      <label><input type="radio" name="ticketing" value="coupon" ${v.ticketing === "coupon" ? html`checked` : ""}> יש לי כבר קופה</label>
    </fieldset>
    <div class="ticketing-opt" data-when="jocares">
      <label class="field">כמה כרטיסים יש למכירה?
        <input name="capacity" type="number" min="1" max="20000" inputmode="numeric" value="${v.capacity ?? ""}" placeholder="למשל 150">
        <small class="hint">קופה מלאה בלי הגדרות: קונים אצלנו, מקבלים כרטיס עם קוד לסריקה, ואת/ה מקבל/ת קישור לסריקה בכניסה. ג׳וקרים מקבלים תגמול אוטומטית.</small></label>
      <details${v.early_price ? html` open` : ""}><summary>מחיר מוקדם (לא חובה)</summary>${earlyFields(ctx, v, { form: false })}</details>
    </div>
    <div class="ticketing-opt" data-when="coupon">
      <label class="field">לינק לעמוד הכרטיסים שלך
        <input name="source_url" type="url" dir="ltr" value="${v.source_url ?? ""}" placeholder="https://">
        <small class="hint">כשהמקום או מערכת אחרת מוכרים. כל ג׳וקר מקבל קוד אישי, ואנחנו מעדכנים את המכירות. את/ה לא צריך/ה לעשות כלום.</small></label>
    </div>
    ${field("artist_name", "שם האמן / הלהקה", "required maxlength=120")}
    ${field("title", "שם ההופעה", "required maxlength=120")}
    <div class="field${found.includes("image_url") ? " found" : ""}">תמונה של ההופעה${found.includes("image_url") ? html` <small>נמצאה בעמוד ההופעה</small>` : ""}
      ${imageInput({ current: v.image_url ?? "", label: "העלאת תמונה מהטלפון או מהמחשב" })}</div>
    ${field("starts_at", "מתי", "type=datetime-local required")}
    <div class="row2">
      ${field("venue", "איפה (מקום)", "required maxlength=120")}
      ${field("city", "עיר", "maxlength=40")}
    </div>
    ${field("price", "מחיר כרטיס (₪)", "type=number min=1 step=0.01 required inputmode=decimal data-price")}

    <div class="reward-box">
      <label class="field big-field">כמה תתנו על כל כרטיס שנמכר? (₪)
        <input name="reward" value="${reward}" type="number" min="1" step="1" required inputmode="numeric" data-reward>
      </label>
      <p class="hint" data-suggest>טיפ: תגמול של כ-20% מהמחיר מושך יותר מקדמים.</p>
      <div class="split" data-split data-fee-bps="${config.feeBps}" aria-live="polite">
        <div><span>מקדם</span><b data-s="reward">—</b></div>
        <div><span>JoCares (${config.feeBps / 100}%)</span><b data-s="fee">—</b></div>
        <div class="you"><span>נשאר לכם</span><b data-s="artist">—</b></div>
      </div>
      <p class="note">משלמים רק על כרטיסים שנמכרו דרך מקדמים. על מכירות אחרות אין עמלה.</p>
    </div>

    <details>
      <summary>עוד אפשרויות (לא חובה)</summary>
      <div class="stack">
        ${field("genre", "סגנון", "maxlength=40 list=genres", html`<datalist id="genres"><option>פופ</option><option>רוק</option><option>אינדי</option><option>ג'אז</option><option>היפ הופ</option><option>אלקטרוני</option><option>ים תיכוני</option><option>סטנדאפ</option></datalist>`)}
        <label class="field">תיאור<textarea name="description" rows="3" maxlength="2000">${v.description ?? ""}</textarea></label>
        ${field("promo_limit", "מקסימום כרטיסים למכירה דרך מקדמים", "type=number min=1 inputmode=numeric")}
        <label class="field">משפט פתיחה להודעת השיתוף<textarea name="share_text" rows="2" maxlength="600" placeholder="למשל: ההופעה הכי מרגשת שלנו השנה">${v.share_text ?? ""}</textarea></label>
      </div>
    </details>
    <button class="btn big block">לתצוגה מקדימה</button>
  </form>
</section>`,
    opts
  );
}

export function previewPage(ctx, { c, form }, opts) {
  const s = split(c.price_agorot, c.reward_agorot);
  return layout(
    ctx,
    "תצוגה מקדימה",
    html`
<section class="narrow">
  ${steps(3)}
  <h1>ככה זה ייראה למקדמים</h1>
  <article class="show preview">
    ${poster(c)}
    <div class="show-body">
      <p class="eyebrow">${c.artist_name}</p>
      <h3>${c.title}</h3>
      <p class="meta">${showDate(c.starts_at)} · ${c.city || c.venue}</p>
      <div class="earn"><span>הרווח שלך</span><b>${money(c.reward_agorot)}</b><small>לכל כרטיס · מחיר ${money(c.price_agorot)}</small></div>
    </div>
  </article>
  <div class="split static">
    <div><span>מקדם</span><b>${money(s.reward)}</b></div>
    <div><span>JoCares</span><b>${money(s.fee)}</b></div>
    <div class="you"><span>נשאר לכם מכל כרטיס</span><b>${money(s.artist)}</b></div>
  </div>
  ${c.promo_limit ? html`<p class="muted center">עד ${c.promo_limit} כרטיסים דרך מקדמים.</p>` : ""}
  <form method="post" action="/artist/new" class="stack">
    ${csrfField(ctx)}
    ${Object.entries(form).filter(([k, val]) => k !== "_csrf" && typeof val === "string").map(([k, val]) => html`<input type="hidden" name="${k}" value="${val}">`)}
    <button class="btn big block" name="publish" value="1">פרסום</button>
    <button class="btn ghost block" name="publish" value="0">שמירה כטיוטה</button>
  </form>
  <form method="post" action="/artist/new/details" class="center">
    ${csrfField(ctx)}
    ${Object.entries(form).filter(([k, val]) => k !== "_csrf" && typeof val === "string").map(([k, val]) => html`<input type="hidden" name="${k}" value="${val}">`)}
    <button class="linklike">חזרה לעריכה</button>
  </form>
</section>`,
    opts
  );
}

// ---------- ניהול קמפיין ----------

const ACTION_LABEL = { active: "הפעלה", paused: "השהיה", ended: "סיום הקמפיין", cancelled: "ההופעה בוטלה" };
const ACTION_CONFIRM = {
  ended: "לסיים את הקמפיין? מכירות חדשות לא יזכו מקדמים בתגמול. מה שכבר נצבר נשמר.",
  cancelled: "לסמן שההופעה בוטלה? כל התגמולים של המקדמים יבוטלו. אי אפשר לחזור מזה.",
};

export function manageCampaign(ctx, { c, r, top, publicUrl, lastImport = null, sales = null, assets = [], offers = [] }, opts) {
  const s = split(c.price_agorot, c.reward_agorot);
  const actions = TRANSITIONS[c.status].filter((t) => t !== "sold_out");
  return layout(
    ctx,
    c.title,
    html`
<p><a href="/artist">→ כל ההופעות</a></p>
<div class="row-head">
  <div><p class="eyebrow">${c.artist_name}</p><h1>${c.title} ${statusBadge(c.status)}</h1>
  <p class="meta">${showDate(c.starts_at)} · ${c.venue}${c.city ? `, ${c.city}` : ""}</p></div>
</div>

<div class="stats">
  ${stat(r.tickets, "כרטיסים דרך ג׳וקרים")}
  ${stat(r.promoters, "ג׳וקרים")}
  ${stat(money(r.revenue), "הכנסה שנוצרה")}
  ${stat(r.first_time, "קנו ממך לראשונה דרכנו")}
  ${stat(money(r.rewards), "תגמולים למקדמים")}
  ${stat(r.clicks, "כניסות ללינקים")}
</div>

${c.status === "draft" || c.status === "active"
  ? html`<div class="linkbox"><code dir="ltr">${publicUrl}</code><button type="button" class="btn small" data-copy="${publicUrl}">העתקה</button></div>
         <p class="note">שתפו את דף ההופעה עם הקהל שלכם. מי שירצה יוכל להפוך למקדם בלחיצה.</p>`
  : ""}

${c.provider === "coupon"
  ? html`<p class="note">הכרטיסים נמכרים באתר הכרטוס שלך, וכל ג׳וקר מקבל קוד אישי. אנחנו מגדירים את הקודים ומעדכנים את המכירות כאן. עדכון אחרון: ${lastImport ? showDate(lastImport) : "עוד לא"}.</p>`
  : ""}
${sales ? artistSales(ctx, { c, ...sales }) : ""}
${offers.length
  ? html`<section class="card" id="offers">
  <h2>הצעות מג׳וקרים</h2>
  <p class="muted">ג׳וקרים של ההופעה שמציעים לך שירות בתשלום. משלמים רק אחרי שמאשרים את העבודה.</p>
  ${offers.map((f) => html`<div class="offer">
    ${f.image_url ? html`<span class="avatar"><img src="${f.image_url}" alt=""></span>` : html`<span class="avatar">${f.display_name[0]}</span>`}
    <div>
      <p><b>${f.display_name}</b> · ${f.title} · <b class="money">${money(f.price_agorot)}</b></p>
      ${f.sales ? html`<p class="muted">כבר מכר/ה ${f.sales} הזמנות להופעה הזאת</p>` : ""}
      ${f.message ? html`<blockquote>${f.message}</blockquote>` : ""}
      <div class="row2">
        <a class="btn small" href="/services/${f.service_id}/order?campaign=${c.id}">להזמנה</a>
        <a class="btn ghost small" href="/creators/${f.creator_user_id}">לפרופיל</a>
        ${postButton(ctx, `/artist/c/${c.id}/offers/${f.id}/dismiss`, "לא תודה", { cls: "linklike" })}
      </div>
    </div>
  </div>`)}
</section>`
  : ""}

<section class="card" id="kit">
  <h2>ערכת שיתוף לג׳וקרים</h2>
  <p class="muted">סרטונים קצרים ותמונות מההופעות, מהחזרות או מהסטודיו. הג׳וקרים מורידים ומשתפים. סרטון אנכי קצר עובד הכי טוב. כל ג׳וקר מקבל גם עיצוב מוכן עם הקוד שלו, ותוכן שהזמנת מיוצרים ואישרת נכנס לכאן אוטומטית.</p>
  ${assets.length ? html`<div class="asset-grid">${assets.map((a) => html`<figure>${mediaTile(a.image_url)}<figcaption>${a.credit ? html`<span class="muted">${a.credit}</span> · ` : ""}${postButton(ctx, `/artist/c/${c.id}/assets/${a.id}/delete`, "מחיקה", { cls: "linklike", confirm: "למחוק מהערכה?" })}</figcaption></figure>`)}</div>` : ""}
  <form method="post" action="/artist/c/${c.id}/assets" enctype="multipart/form-data" class="stack" data-busy="מעלים…">
    ${csrfField(ctx)}
    ${mediaInput({ label: "הוספת סרטון או תמונה" })}
    <button class="btn ghost">הוספה לערכה</button>
  </form>
</section>

<section class="card">
  <div class="row-head"><h2>הג׳וקרים המובילים</h2>${["active", "paused"].includes(c.status) ? html`<a class="btn small" href="/artist/c/${c.id}/jokers">מציאת ג׳וקרים והזמנה</a>` : ""}</div>
  ${top.length
    ? html`<ol class="leaders">${top.map((p, i) => html`<li><span>${i + 1}</span><b>${(p.name || "מקדם/ת").split(" ")[0]}</b><span class="muted">${p.clicks} כניסות</span><b>${p.tickets} כרטיסים</b></li>`)}</ol>`
    : html`<p class="muted">עוד אין מקדמים. ${c.status === "active" ? "ההופעה כבר מופיעה במרקטפלייס." : ""}</p>`}
</section>

${["ended", "cancelled"].includes(c.status)
  ? ""
  : html`
<section class="card">
  <h2>תגמול לכרטיס</h2>
  <div class="split static"><div><span>מקדם</span><b>${money(s.reward)}</b></div><div><span>עמלת JoCares</span><b>${money(s.fee)}</b></div><div class="you"><span>נשאר לכם</span><b>${money(s.artist)}</b></div></div>
  <form method="post" action="/artist/c/${c.id}/reward" class="inline">
    ${csrfField(ctx)}
    <input name="reward" type="number" min="1" step="1" value="${c.reward_agorot / 100}" inputmode="numeric" aria-label="תגמול חדש בשקלים">
    <button class="btn ghost">עדכון</button>
  </form>
  <p class="note">השינוי חל רק על מכירות מעכשיו. מה שמקדמים כבר הרוויחו לא משתנה.</p>
</section>

<details class="card">
  <summary>חומרי שיווק והגבלות</summary>
  <form method="post" action="/artist/c/${c.id}/details" class="stack" enctype="multipart/form-data">
    ${csrfField(ctx)}
    <div class="field">תמונה${imageInput({ current: c.image_url })}</div>
    <label class="field">תיאור<textarea name="description" rows="3" maxlength="2000">${c.description}</textarea></label>
    <label class="field">משפט פתיחה להודעת השיתוף<textarea name="share_text" rows="2" maxlength="600">${c.share_text}</textarea></label>
    <label class="field">מקסימום כרטיסים דרך מקדמים<input name="promo_limit" type="number" min="1" value="${c.promo_limit ?? ""}" placeholder="ללא הגבלה"></label>
    <button class="btn ghost">שמירה</button>
  </form>
</details>`}

${actions.length
  ? html`<section class="actions">${actions.map((a) =>
      postButton(ctx, `/artist/c/${c.id}/status`, ACTION_LABEL[a], {
        cls: a === "cancelled" ? "btn danger" : a === "active" ? "btn" : "btn ghost",
        confirm: ACTION_CONFIRM[a] ?? "",
        fields: { to: a },
      })
    )}</section>`
  : ""}
<p class="note">מצב נוכחי: ${STATUS_LABEL[c.status]} · תנאים בגרסה ${c.terms_version}</p>`,
    opts
  );
}

export const formFromCampaign = (c) => ({
  artist_name: c.artist_name, title: c.title, starts_at: isoToIsraelLocal(c.starts_at), venue: c.venue, city: c.city,
  price: c.price_agorot / 100, reward: c.reward_agorot / 100,
});

// ---------- פרטים לקבלת הכסף ----------

export function payoutPage(ctx, { artist, d, types }, opts) {
  const v = d ?? {};
  return layout(
    ctx,
    "פרטים לקבלת הכסף",
    html`
<section class="narrow">
  <p><a href="/artist">→ האזור שלי</a></p>
  <h1>פרטים לקבלת הכסף</h1>
  <p class="lead">${artist.name}: לאן להעביר את הכסף ממכירת הכרטיסים.</p>
  <p class="muted">הפרטים מוצפנים, ומשמשים רק להעברת הכסף ולרישום אצל חברת הסליקה. ${d ? "כבר מילאת. אפשר לעדכן." : ""}</p>
  <form method="post" action="/artist/payout/${artist.id}" class="stack">
    ${csrfField(ctx)}
    <fieldset class="seg"><legend class="field">סוג עסק</legend>
      ${Object.entries(types).map(([k, label]) => html`<label><input type="radio" name="type" value="${k}" ${v.type === k ? html`checked` : ""} required> ${label}</label>`)}
    </fieldset>
    <label class="field">שם מלא או שם העסק<input name="legal_name" required maxlength="100" value="${v.legal_name ?? ""}"></label>
    <div class="row2">
      <label class="field">ת״ז / מספר עוסק / ח״פ<input name="tax_id" required inputmode="numeric" dir="ltr" value="${v.tax_id ?? ""}"></label>
      <label class="field">טלפון<input name="phone" required inputmode="tel" dir="ltr" value="${v.phone ?? ""}"></label>
    </div>
    <div class="row3">
      <label class="field">בנק<input name="bank" required maxlength="30" value="${v.bank ?? ""}"></label>
      <label class="field">סניף<input name="branch" required maxlength="10" inputmode="numeric" value="${v.branch ?? ""}"></label>
      <label class="field">מספר חשבון<input name="account" required maxlength="20" inputmode="numeric" dir="ltr" value="${v.account ?? ""}"></label>
    </div>
    <label class="check"><input type="checkbox" name="confirm" required> החשבון רשום על שמי או על שם העסק שלי</label>
    <button class="btn big block">שמירה</button>
  </form>
</section>`,
    opts
  );
}
