// מודול התוכן: מסך מטרה לאמן, גילוי יוצרים, פרופיל, הזמנה, דף הזמנה משותף, ואזור היוצר.
import { clock, config, shortDate } from "../util.js";
import { GOALS, KIND_LABEL, LICENSES, ORDER_STATUS, TEMPLATES, serviceSplit } from "../domain/content.js";
import { csrfField, empty, html, layout, money, postButton, showDate, stat, imageInput } from "./kit.js";

const days = (n) => (n === 1 ? "יום אחד" : `${n} ימים`);

export function avatar(p, cls = "") {
  if (p.image_url) return html`<span class="avatar ${cls}"><img src="${p.image_url}" alt="" referrerpolicy="no-referrer"></span>`;
  return html`<span class="avatar ${cls}" aria-hidden="true">${String(p.display_name || "?").trim()[0]}</span>`;
}

export const orderBadge = (s) => html`<span class="badge os-${s}">${ORDER_STATUS[s]}</span>`;

// ---------- "מה תרצה שיקרה?" (PRD §7.1) ----------

export function growPage(ctx, opts) {
  const goals = [
    ["/artist/new", "שיותר אנשים יגיעו להופעה שלי", "הקהל משתף את ההופעה ומקבל על כל כרטיס. משלמים רק על מכירות."],
    ["/creators?kind=exposure&goal=music", "שיותר אנשים יכירו את המוזיקה שלי", "אנשים עם קהל משלהם ממליצים עליך בערוצים שלהם."],
    ["/creators?kind=content&goal=content", "שייצרו עבורי תוכן", "ריל, סרטון המלצה, צילום בהופעה או פוסטר. במחיר ידוע מראש."],
    ["/creators?kind=exposure&goal=buzz", "שידברו עליי ברשתות", "פרסום בסטורי, בפוסט או בקהילה של יוצרים שמתחברים למוזיקה שלך."],
  ];
  return layout(
    ctx,
    "מה תרצה שיקרה?",
    html`
<section class="narrow">
  <h1>מה תרצה שיקרה?</h1>
  <p class="lead">בוחרים מטרה אחת. את השאר נסדר.</p>
  <div class="goal-list">
    ${goals.map(([href, title, sub]) => html`<a class="goal" href="${href}"><b>${title}</b><span>${sub}</span></a>`)}
  </div>
</section>`,
    opts
  );
}

// ---------- גילוי יוצרים ----------

function creatorCard(c, goal) {
  const s = c.services[0];
  return html`
<article class="creator">
  <a class="creator-head" href="/creators/${c.user_id}${goal ? `?goal=${goal}` : ""}">
    ${avatar(c)}
    <div><b>${c.display_name}</b><span class="meta">${[c.city, ...(c.genres ? c.genres.split(",").slice(0, 3) : [])].filter(Boolean).join(" · ")}</span></div>
  </a>
  ${c.match?.length ? html`<p class="match">מתאים לסגנון שלך: ${c.match.join(", ")}</p>` : ""}
  ${c.bio ? html`<p class="bio">${c.bio}</p>` : ""}
  <div class="svc-mini">
    <div><b>${s.title}</b><span class="meta">${days(s.delivery_days)} · ${KIND_LABEL[TEMPLATES[s.template].kind]}</span></div>
    <b class="price-tag">${money(s.price_agorot)}</b>
  </div>
  <p class="meta">${c.stats.completed ? `${c.stats.completed} עבודות הושלמו · ${Math.round((c.stats.on_time / c.stats.completed) * 100)}% בזמן` : "חדש/ה ב-Jocares"}${c.services.length === 2 ? " · ועוד שירות אחד" : c.services.length > 2 ? ` · ועוד ${c.services.length - 1} שירותים` : ""}</p>
  <a class="btn ghost block" href="/creators/${c.user_id}${goal ? `?goal=${goal}` : ""}">לפרופיל ולהזמנה</a>
</article>`;
}

export function creatorsPage(ctx, { creators, kind, goal }, opts) {
  const chip = (k, label) => html`<a class="chip${kind === k ? " on" : ""}" href="/creators${k ? `?kind=${k}` : ""}">${label}</a>`;
  return layout(
    ctx,
    "יוצרים",
    html`
<section class="page-head">
  <h1>אנשים שיעזרו לך להגיע לקהל</h1>
  <p class="lead">מחירים ידועים מראש. משלמים רק כשהעבודה מאושרת.</p>
</section>
<nav class="chips" aria-label="סוג שירות">
  ${chip("", "הכל")}${chip("content", KIND_LABEL.content)}${chip("exposure", KIND_LABEL.exposure)}
</nav>
${creators.length
  ? html`<div class="grid-shows">${creators.map((c) => creatorCard(c, goal))}</div>`
  : empty("עוד אין יוצרים בקטגוריה הזו", "אנחנו מגייסים יוצרים לפיילוט. אפשר לנסות קטגוריה אחרת.")}
<p class="note center">הדירוג מבוסס על התאמה לסגנון שלך ועל עבודות שהושלמו, לא על מספר עוקבים.</p>
<p class="center"><a href="/creator">רוצים להרוויח מיצירת תוכן? פותחים פרופיל</a></p>`,
    { ...opts, wide: true }
  );
}

function serviceBlock(s, { orderHref } = {}) {
  const lic = LICENSES[s.license];
  return html`
<article class="svc">
  <div class="row-head"><h3>${s.title}</h3><b class="price-tag">${money(s.price_agorot)}</b></div>
  <p>${s.deliverable}</p>
  ${s.description ? html`<p class="muted">${s.description}</p>` : ""}
  <ul class="facts">
    <li>אספקה: ${days(s.delivery_days)}</li>
    <li>תיקונים: ${s.revisions ? `${s.revisions} סבבים` : "ללא"}</li>
    <li>${s.includes_publication ? "כולל פרסום בערוץ של היוצר" : "תוכן לערוצים שלך"}</li>
    <li>זכויות: ${lic.label}</li>
  </ul>
  ${orderHref ? html`<a class="btn block" href="${orderHref}">הזמנה</a>` : ""}
</article>`;
}

export function creatorProfilePage(ctx, { c, goal }, opts) {
  return layout(
    ctx,
    c.display_name,
    html`
<section class="profile-head">
  ${avatar(c, "big")}
  <div>
    <h1>${c.display_name}</h1>
    <p class="meta">${[c.city, c.genres.split(",").filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
  </div>
</section>
${c.bio ? html`<p class="bio">${c.bio}</p>` : ""}
<div class="stats three">
  ${stat(c.stats.completed, "עבודות שהושלמו")}
  ${stat(c.stats.completed ? `${Math.round((c.stats.on_time / c.stats.completed) * 100)}%` : "–", "סופקו בזמן")}
  ${stat(c.stats.artists, "אמנים שעבדו איתו/ה")}
</div>
${c.portfolio.length
  ? html`<section><h2>עבודות</h2><ul class="links">${c.portfolio.map((w) => html`<li><a href="${w.url}" target="_blank" rel="noopener nofollow ugc">${w.title || w.url}</a></li>`)}</ul></section>`
  : ""}
${c.channels.length
  ? html`<section><h2>ערוצים</h2><ul class="links">${c.channels.map(
      (ch) => html`<li><a href="${ch.url}" target="_blank" rel="noopener nofollow ugc">${ch.platform}</a>${ch.followers ? html` <span class="muted">· ${ch.followers.toLocaleString("he-IL")} עוקבים (לפי היוצר, לא מאומת)</span>` : ""}</li>`
    )}</ul></section>`
  : ""}
<section>
  <h2>שירותים</h2>
  ${c.services.map((s) => serviceBlock(s, { orderHref: `/services/${s.id}/order${goal ? `?goal=${goal}` : ""}` }))}
</section>`,
    opts
  );
}

// ---------- הזמנה: מטרה, תקציב (=המחיר), אישור ----------

export function orderNewPage(ctx, { s, creator, artistName, campaigns, goal }, opts) {
  const split = serviceSplit(s.price_agorot);
  const lic = LICENSES[s.license];
  return layout(
    ctx,
    "הזמנה",
    html`
<section class="narrow">
  <p class="eyebrow">${creator.display_name}</p>
  <h1>${s.title}</h1>
  <p>${s.deliverable}</p>
  <form method="post" action="/services/${s.id}/order" class="stack">
    ${csrfField(ctx)}
    <label class="field">בשביל איזה אמן?<input name="artist_name" value="${artistName}" required maxlength="120"></label>
    <label class="field">מה המטרה?
      <select name="goal">${Object.entries(GOALS).map(([k, v]) => html`<option value="${k}"${k === goal ? html` selected` : ""}>${v}</option>`)}</select>
    </label>
    ${campaigns.length
      ? html`<label class="field">קשור להופעה? (לא חובה)
          <select name="campaign_id"><option value="">לא</option>${campaigns.map((c) => html`<option value="${c.id}">${c.title} · ${showDate(c.starts_at, { weekday: undefined, hour: undefined, minute: undefined })}</option>`)}</select>
          <small class="hint">אם כן, היוצר יקבל גם לינק אישי ותגמול על כל כרטיס שנמכר דרכו.</small></label>`
      : ""}
    <label class="field">קישור לשיר / לקליפ (לא חובה)<input name="music_url" type="url" dir="ltr" placeholder="https://"></label>
    <label class="field">משהו שחשוב שהיוצר יידע? (לא חובה)<textarea name="notes" rows="3" maxlength="1000"></textarea></label>
    <p class="note">את שאר הבריף נכין אוטומטית מהפרטים שכבר יש לנו.</p>

    <div class="terms-box">
      <h2>מה מקבלים</h2>
      <ul class="facts">
        <li>אספקה תוך ${days(s.delivery_days)}</li>
        <li>${s.revisions ? `${s.revisions} סבבי תיקונים` : "בלי סבבי תיקונים"}</li>
        ${s.includes_publication ? html`<li>פרסום בערוץ של היוצר, עם גילוי נאות, ואימות לפי קישור</li>` : ""}
      </ul>
      <h3>זכויות שימוש: ${lic.label}</h3>
      <ul class="facts">${lic.points.map((p) => html`<li>${p}</li>`)}</ul>
      <div class="total"><span>לתשלום</span><b>${money(split.price)}</b></div>
      <p class="note">הסכום נתפס בכרטיס ונגבה רק כשהעבודה מאושרת. אם היוצר לא מאשר תוך ${days(config.acceptWindowDays)} או מסרב, לא תחויבו.
        היוצר מקבל ${money(split.creator)} ו-Jocares ${money(split.fee)}.</p>
    </div>
    <label class="check"><input type="checkbox" name="rights" required> יש לי זכות להעביר ליוצר את החומרים והמוזיקה לצורך העבודה</label>
    <p class="note">היוצר רשאי להביע דעה כנה. אנחנו לא מוכרים מחמאות.</p>
    <button class="btn big block">הזמנה ותשלום ${money(split.price)}</button>
  </form>
  <p class="note center">תשלום Sandbox בפיילוט: לא מחויב כסף אמיתי.</p>
</section>`,
    opts
  );
}

// ---------- דף הזמנה: אותו דף לשני הצדדים, עם הפעולה הבאה בראש ----------

function timeline(o) {
  const steps = [["requested", "הוזמן"], ["accepted", "בעבודה"], ["submitted", "תוצר"], ...(o.includes_publication ? [["approved", "אושר"], ["published", "פורסם"]] : []), ["completed", "הושלם"]];
  const order = steps.map((s) => s[0]);
  const at = o.status === "revision_requested" ? "submitted" : o.status === "disputed" ? o.disputed_from === "revision_requested" ? "submitted" : o.disputed_from : o.status;
  const idx = order.indexOf(at);
  if (o.status === "cancelled") return html`<p class="flash bad">ההזמנה בוטלה. ${o.payment_status === "voided" ? "לא חויבתם." : ""}</p>`;
  return html`<ol class="steps-bar">${steps.map(([k, l], i) => html`<li class="${i === idx ? "on" : i < idx ? "done" : ""}">${l}</li>`)}</ol>`;
}

export function orderPage(ctx, { o, role, deliverables, revisions, publication, linkInfo, disputes }, opts) {
  const isCreator = role === "creator";
  const isArtist = role === "artist" || role === "admin";
  const lic = LICENSES[o.terms.license];
  const last = deliverables[0];
  const overdue = o.status === "accepted" && o.due_at < clock.iso();

  let action = "";
  if (isCreator && o.status === "requested") {
    action = html`<div class="next card">
      <h2>הזמנה חדשה בשבילך</h2>
      <p>תקבל/י <b class="money">${money(o.creator_amount_agorot)}</b> כשהעבודה תאושר. אספקה תוך ${days(o.terms.delivery_days)} מהאישור.</p>
      ${postButton(ctx, `/orders/${o.id}/accept`, "אני בפנים", { cls: "btn big block" })}
      <details><summary>לא מתאים לי</summary>
        <form method="post" action="/orders/${o.id}/decline" class="stack">${csrfField(ctx)}
          <label class="field">סיבה (לא חובה, האמן יראה)<input name="reason" maxlength="200"></label>
          <button class="btn ghost block">לסרב בנימוס</button></form></details>
    </div>`;
  } else if (isCreator && ["accepted", "revision_requested"].includes(o.status)) {
    action = html`<div class="next card">
      <h2>${o.status === "revision_requested" ? "בקשת תיקון" : "העלאת התוצר"}</h2>
      ${o.status === "revision_requested" && revisions[0] ? html`<blockquote>${revisions[0].message}</blockquote>` : ""}
      <p class="muted">עד ${showDate(o.due_at)}. מעלים קישור לקובץ (Google Drive, Dropbox, WeTransfer או סרטון לא רשום).</p>
      <form method="post" action="/orders/${o.id}/deliver" class="stack">${csrfField(ctx)}
        <label class="field">קישור לתוצר<input name="url" type="url" dir="ltr" required placeholder="https://"></label>
        <label class="field">הערה לאמן (לא חובה)<input name="note" maxlength="500"></label>
        <button class="btn big block">שליחה לאמן</button></form>
    </div>`;
  } else if (isCreator && o.status === "approved") {
    action = html`<div class="next card">
      <h2>אושר. עכשיו מפרסמים</h2>
      <p>פרסמו בערוץ שלכם עם גילוי נאות ("שיתוף פעולה בתשלום"), והדביקו כאן את הקישור לפרסום.</p>
      <form method="post" action="/orders/${o.id}/publish" class="stack">${csrfField(ctx)}
        <label class="field">קישור לפרסום<input name="url" type="url" dir="ltr" required placeholder="https://"></label>
        <button class="btn big block">סימון שפורסם</button></form>
    </div>`;
  } else if (isArtist && o.status === "submitted") {
    action = html`<div class="next card">
      <h2>התוצר מוכן</h2>
      <a class="btn ghost block" href="${last.url}" target="_blank" rel="noopener nofollow">צפייה בתוצר${deliverables.length > 1 ? ` (גרסה ${last.version})` : ""}</a>
      ${last.note ? html`<blockquote>${last.note}</blockquote>` : ""}
      ${postButton(ctx, `/orders/${o.id}/approve`, `אישור ותשלום ${money(o.price_agorot)}`, { cls: "btn big block" })}
      ${o.revisions_left
        ? html`<details><summary>צריך תיקון (נשארו ${o.revisions_left})</summary>
            <form method="post" action="/orders/${o.id}/revise" class="stack">${csrfField(ctx)}
              <label class="field">מה לשנות?<textarea name="message" rows="3" required maxlength="1000"></textarea></label>
              <button class="btn ghost block">שליחת בקשת תיקון</button></form></details>`
        : html`<p class="note">סבבי התיקון שנכללו בהזמנה נוצלו.</p>`}
      <p class="note">אם לא תגיבו תוך ${days(config.autoApproveDays)}, התוצר יאושר אוטומטית.</p>
    </div>`;
  } else if (isArtist && o.status === "published") {
    action = html`<div class="next card">
      <h2>היוצר פרסם</h2>
      <a class="btn ghost block" href="${publication.url}" target="_blank" rel="noopener nofollow">לפרסום</a>
      ${postButton(ctx, `/orders/${o.id}/verify`, "ראיתי, הכל תקין", { cls: "btn big block" })}
      <p class="note">אם לא תגיבו תוך ${days(config.publicationVerifyDays)}, הפרסום ייחשב מאומת לפי הקישור. לא מאמתים נתוני חשיפה, רק את קיום הפרסום.</p>
    </div>`;
  } else if (isArtist && (o.status === "requested" || overdue)) {
    action = html`<div class="next card">
      <h2>${overdue ? "עבר מועד האספקה" : `מחכים ל${o.creator_name}`}</h2>
      <p class="muted">${overdue ? "אפשר לחכות עוד קצת, או לבטל בלי חיוב." : `אם לא יגיב/תגיב תוך ${days(config.acceptWindowDays)}, ההזמנה תתבטל ולא תחויבו.`}</p>
      ${postButton(ctx, `/orders/${o.id}/cancel`, "ביטול ההזמנה", { cls: "btn ghost block", confirm: "לבטל את ההזמנה? לא תחויבו." })}
    </div>`;
  }

  const canDispute = ["accepted", "submitted", "revision_requested", "approved", "published"].includes(o.status) && role !== "admin";

  return layout(
    ctx,
    o.title,
    html`
<p><a href="${isCreator ? "/creator" : "/artist"}">→ ${isCreator ? "ההזמנות שלי" : "לאזור האמן"}</a></p>
<p class="eyebrow">${isCreator ? `הזמנה מ${o.artist_name}` : `עם ${o.creator_name}`}</p>
<h1>${o.title} ${orderBadge(o.status)}</h1>
${timeline(o)}
${action}
${o.status === "disputed" ? html`<p class="flash dev">הצוות בודק את ההזמנה ויחזור לשני הצדדים. הכסף מוחזק אצל ספק התשלומים עד להחלטה.</p>` : ""}
${o.status === "completed" ? html`<p class="flash good">הושלם. ${isCreator ? `${money(o.creator_amount_agorot)} נוספו ל"זמין לתשלום".` : `חויבתם ${money(o.captured_agorot)}.`}</p>` : ""}

${linkInfo
  ? html`<section class="card promo-box">
      <h2>בונוס: עמלה על כרטיסים</h2>
      <p>${isCreator ? "צרפו את הלינק האישי שלכם לפרסום, ותקבלו" : "היוצר קיבל לינק אישי ויקבל"} <b class="money">${money(linkInfo.reward)}</b> על כל כרטיס שנמכר דרכו. עד עכשיו: ${linkInfo.tickets} כרטיסים.</p>
      ${isCreator ? html`<a class="btn ghost block" href="/s/${o.campaign_id}/share">ללינק ולערכת השיתוף</a>` : ""}
    </section>`
  : ""}

<section class="card">
  <h2>הבריף</h2>
  <pre class="brief">${o.brief}</pre>
</section>

<details class="card">
  <summary>התנאים שסוכמו</summary>
  <ul class="facts">
    <li>מחיר: ${money(o.price_agorot)} · ליוצר ${money(o.creator_amount_agorot)} · Jocares ${money(o.fee_agorot)}</li>
    <li>מה מקבלים: ${o.terms.deliverable}</li>
    <li>אספקה: ${days(o.terms.delivery_days)} מהאישור${o.accepted_at ? ` (עד ${showDate(o.due_at)})` : ""}</li>
    <li>תיקונים: ${o.terms.revisions} (נשארו ${o.revisions_left})</li>
  </ul>
  <h3>זכויות שימוש: ${lic.label}</h3>
  <ul class="facts">${o.terms.license_points.map((p) => html`<li>${p}</li>`)}</ul>
  <p class="note">סוכם ב-${shortDate(o.terms.agreed_at)}. שינויים בשירות אחרי ההזמנה לא משפיעים עליה.</p>
</details>

${deliverables.length
  ? html`<section><h2>גרסאות</h2><ul class="list compact">${deliverables.map(
      (d) => html`<li><div class="grow"><a href="${d.url}" target="_blank" rel="noopener nofollow">גרסה ${d.version}</a>${d.note ? html` <span class="muted">· ${d.note}</span>` : ""}</div><div class="end"><small>${shortDate(d.created_at)}</small></div></li>`
    )}</ul></section>`
  : ""}
${publication ? html`<p>פרסום: <a href="${publication.url}" target="_blank" rel="noopener nofollow">${publication.url}</a>${publication.verified_at ? html` <span class="muted">· ${{ artist: "אומת ע״י האמן", admin: "אומת ע״י הצוות", auto_link: "לפי קישור בלבד" }[publication.method]}</span>` : ""}</p>` : ""}
${disputes.length ? html`<section><h2>פניות לצוות</h2>${disputes.map((d) => html`<blockquote>${d.message}${d.resolution ? html`<br><b>תשובת הצוות:</b> ${d.resolution}` : ""}</blockquote>`)}</section>` : ""}

${canDispute
  ? html`<details class="card"><summary>משהו לא בסדר?</summary>
      <form method="post" action="/orders/${o.id}/dispute" class="stack">${csrfField(ctx)}
        <label class="field">מה קרה?<textarea name="message" rows="3" required maxlength="1000"></textarea></label>
        <button class="btn ghost">פנייה לצוות</button>
        <p class="note">ההזמנה תוקפא עד להחלטת הצוות. הכסף נשאר אצל ספק התשלומים.</p></form></details>`
  : ""}

${role === "admin" && o.status === "disputed"
  ? html`<section class="card"><h2>החלטת צוות</h2>
      <form method="post" action="/admin/orders/${o.id}/resolve" class="stack">${csrfField(ctx)}
        <label class="field">הסבר לשני הצדדים<input name="resolution" required maxlength="500"></label>
        <label class="field">סכום פשרה בש"ח (רק לפשרה)<input name="amount" inputmode="decimal" dir="ltr"></label>
        <div class="inline">
          <button class="btn small" name="outcome" value="pay">תשלום מלא ליוצר</button>
          <button class="btn small ghost" name="outcome" value="split">פשרה</button>
          <button class="btn small danger" name="outcome" value="refund">החזר מלא לאמן</button>
        </div></form></section>`
  : ""}`,
    opts
  );
}

// ---------- אזור היוצר ----------

export function creatorHome(ctx, { profile, services, orders, portfolio, channels }, opts) {
  if (!profile) return profileSetup(ctx, opts);
  const open = orders.filter((o) => !["completed", "cancelled"].includes(o.status));
  const done = orders.filter((o) => ["completed", "cancelled"].includes(o.status));
  const needsMe = (o) => ["requested", "accepted", "revision_requested", "approved"].includes(o.status);
  const earned = orders.filter((o) => o.status === "completed").reduce((s, o) => s + o.creator_amount_agorot, 0);
  return layout(
    ctx,
    "יצירת תוכן",
    html`
<div class="row-head"><h1>יצירת תוכן</h1><a href="/creators/${profile.user_id}">הפרופיל שלי כפי שאמנים רואים</a></div>
<div class="stats three">
  ${stat(open.length, "הזמנות פתוחות")}
  ${stat(done.filter((o) => o.status === "completed").length, "הושלמו")}
  ${stat(money(earned), "הרווחת מתוכן", "money")}
</div>

<section>
  <h2>הזמנות</h2>
  ${orders.length
    ? html`<ul class="list">${[...open, ...done].map(
        (o) => html`<li class="${needsMe(o) ? "unread" : ""}"><a class="row-link" href="/orders/${o.id}">
          <div class="grow"><b>${o.title}</b> <span class="muted">· ${o.artist_name}</span>
            <div class="meta">${orderBadge(o.status)}${o.accepted_at && !["completed", "cancelled"].includes(o.status) ? ` · עד ${shortDate(o.due_at)}` : ""}</div></div>
          <b class="money">${money(o.creator_amount_agorot)}</b></a></li>`
      )}</ul>`
    : html`<p class="muted">עוד אין הזמנות. אמנים מוצאים אותך לפי השירותים והסגנונות שבחרת.</p>`}
</section>

<section>
  <div class="row-head"><h2>השירותים שלי</h2><a class="btn small" href="/creator/services/new">+ שירות</a></div>
  ${services.length
    ? html`<ul class="list compact">${services.map(
        (s) => html`<li><div class="grow"><b>${s.title}</b>${s.active ? "" : html` <span class="badge">מוסתר</span>`}
            <div class="meta">${money(s.price_agorot)} · ${days(s.delivery_days)} · אחרי עמלה: ${money(serviceSplit(s.price_agorot).creator)}</div></div>
          <a class="btn small ghost" href="/creator/services/${s.id}/edit">עריכה</a>
          ${postButton(ctx, `/creator/services/${s.id}/toggle`, s.active ? "הסתרה" : "הצגה", { cls: "btn small ghost" })}</li>`
      )}</ul>`
    : empty("אין עדיין שירותים", "בוחרים תבנית, קובעים מחיר, וזהו.", html`<a class="btn" href="/creator/services/new">שירות ראשון</a>`)}
</section>

<details class="card">
  <summary>עבודות וערוצים</summary>
  <h3>עבודות לדוגמה</h3>
  <ul class="list compact">${portfolio.map((w) => html`<li><div class="grow"><a href="${w.url}" target="_blank" rel="noopener">${w.title || w.url}</a></div>${postButton(ctx, `/creator/portfolio/${w.id}/delete`, "הסרה", { cls: "btn small ghost" })}</li>`)}</ul>
  <form method="post" action="/creator/portfolio" class="inline">${csrfField(ctx)}
    <input name="url" type="url" dir="ltr" required placeholder="https://" aria-label="קישור לעבודה">
    <input name="title" maxlength="80" placeholder="תיאור קצר" aria-label="תיאור">
    <button class="btn small ghost">הוספה</button></form>
  <h3>ערוצים (רק אם יש לך קהל משלך)</h3>
  <ul class="list compact">${channels.map((c) => html`<li><div class="grow">${c.platform} · <a href="${c.url}" target="_blank" rel="noopener">${c.url}</a>${c.followers ? ` · ${c.followers.toLocaleString("he-IL")}` : ""}</div>${postButton(ctx, `/creator/channels/${c.id}/delete`, "הסרה", { cls: "btn small ghost" })}</li>`)}</ul>
  <form method="post" action="/creator/channels" class="inline">${csrfField(ctx)}
    <select name="platform" aria-label="פלטפורמה"><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Facebook</option><option>Telegram</option><option>WhatsApp</option><option>ניוזלטר</option><option>אחר</option></select>
    <input name="url" type="url" dir="ltr" required placeholder="https://" aria-label="קישור לערוץ">
    <input name="followers" inputmode="numeric" placeholder="עוקבים (לא חובה)" aria-label="עוקבים">
    <button class="btn small ghost">הוספה</button></form>
  <p class="note">לא מבקשים סיסמאות לרשתות חברתיות, אף פעם. מספר העוקבים מוצג כ"לא מאומת".</p>
</details>
<details class="card"><summary>עריכת פרופיל</summary>${profileForm(ctx, profile)}</details>`,
    opts
  );
}

function profileForm(ctx, p = {}) {
  const kinds = (p.kinds || "content").split(",");
  return html`
<form method="post" action="/creator/profile" class="stack" enctype="multipart/form-data" data-busy="שומרים…">${csrfField(ctx)}
  <div class="field">תמונה שלך${imageInput({ current: p.image_url ?? "", label: "העלאת תמונה", round: true, hint: "אמנים רוצים לראות מי יוצר בשבילם" })}</div>
  <label class="field">שם שיוצג<input name="display_name" value="${p.display_name ?? ctx.user.name ?? ""}" required maxlength="60"></label>
  <label class="field">כמה מילים עליך<textarea name="bio" rows="3" maxlength="600" placeholder="מה את/ה אוהב/ת ליצור, ואיזו מוזיקה מדברת אליך">${p.bio ?? ""}</textarea></label>
  <div class="row2">
    <label class="field">סגנונות מוזיקה (מופרדים בפסיק)<input name="genres" value="${p.genres ?? ""}" placeholder="אינדי, היפ הופ"></label>
    <label class="field">עיר<input name="city" value="${p.city ?? ""}" maxlength="40"></label>
  </div>
  <fieldset class="seg"><legend class="field">מה את/ה מציע/ה?</legend>
    <label><input type="checkbox" name="kinds" value="content" ${kinds.includes("content") ? html`checked` : ""}> יצירת תוכן לאמנים</label>
    <label><input type="checkbox" name="kinds" value="exposure" ${kinds.includes("exposure") ? html`checked` : ""}> פרסום לקהל שלי</label>
  </fieldset>
  <button class="btn block">שמירה</button>
</form>`;
}

function profileSetup(ctx, opts) {
  return layout(
    ctx,
    "יצירת תוכן",
    html`
<section class="narrow">
  <h1>מרוויחים מיצירת תוכן לאמנים</h1>
  <p class="lead">לא צריך אלפי עוקבים. צריך לדעת לספר סיפור, לצלם, או להמליץ על מוזיקה שאוהבים.</p>
  <div class="card">${profileForm(ctx)}</div>
  <p class="note">אחר כך בוחרים שירות מתבנית וקובעים מחיר. Jocares לוקחת ${config.contentFeeBps / 100}% רק מעבודות שהושלמו.</p>
</section>`,
    opts
  );
}

export function serviceForm(ctx, { s, template }, opts) {
  const t = TEMPLATES[s?.template ?? template];
  if (!t) {
    return layout(
      ctx,
      "שירות חדש",
      html`
<section class="narrow">
  <h1>איזה שירות?</h1>
  <p class="muted">בחרו תבנית. אפשר לשנות כל פרט אחר כך.</p>
  ${Object.entries(KIND_LABEL).map(
    ([k, label]) => html`<h2>${label}</h2><div class="goal-list">${Object.entries(TEMPLATES)
      .filter(([, x]) => x.kind === k)
      .map(([key, x]) => html`<a class="goal" href="/creator/services/new?template=${key}"><b>${x.title}</b><span>${x.deliverable}</span></a>`)}</div>`
  )}
</section>`,
      opts
    );
  }
  const v = s ?? { template, title: t.title, deliverable: t.deliverable, delivery_days: t.days, revisions: t.revisions, license: t.license, price_agorot: "" };
  return layout(
    ctx,
    v.title,
    html`
<section class="narrow">
  <h1>${s ? "עריכת שירות" : t.title}</h1>
  <form method="post" action="${s ? `/creator/services/${s.id}/edit` : "/creator/services/new"}" class="stack">${csrfField(ctx)}
    <input type="hidden" name="template" value="${v.template}">
    <label class="field big-field">מחיר (₪)<input name="price" type="number" min="10" step="1" required inputmode="numeric" value="${v.price_agorot ? v.price_agorot / 100 : ""}" data-service-price data-fee-bps="${config.contentFeeBps}" autofocus></label>
    <p class="hint" data-service-net>Jocares לוקחת ${config.contentFeeBps / 100}% רק מעבודות שהושלמו.</p>
    <label class="field">שם השירות<input name="title" value="${v.title}" required maxlength="80"></label>
    <label class="field">מה האמן מקבל<textarea name="deliverable" rows="2" required maxlength="300">${v.deliverable}</textarea></label>
    <div class="row2">
      <label class="field">ימי אספקה<input name="delivery_days" type="number" min="1" max="60" value="${v.delivery_days}" required></label>
      <label class="field">סבבי תיקונים<select name="revisions">${[0, 1, 2, 3].map((n) => html`<option${n === Number(v.revisions) ? html` selected` : ""}>${n}</option>`)}</select></label>
    </div>
    ${t.pub
      ? html`<input type="hidden" name="license" value="exposure"><p class="note">זכויות: ${LICENSES.exposure.label}. ${LICENSES.exposure.points.join(". ")}.</p>`
      : html`<fieldset class="seg"><legend class="field">זכויות שימוש לאמן</legend>
          ${["organic", "full"].map((k) => html`<label><input type="radio" name="license" value="${k}" ${v.license === k ? html`checked` : ""}> ${LICENSES[k].label}</label>`)}</fieldset>
          <p class="note">"${LICENSES.full.label}" מאפשר לאמן לקדם את התוכן בכסף. בדרך כלל מתמחרים אותו גבוה יותר.</p>`}
    <label class="field">פירוט (לא חובה)<textarea name="description" rows="2" maxlength="1000">${v.description ?? ""}</textarea></label>
    <button class="btn big block">שמירה</button>
  </form>
</section>`,
    opts
  );
}

// ---------- ניהול ----------

export function adminContent(ctx, { orders, creators }) {
  return html`
<h2>הזמנות תוכן</h2>
<div class="table-wrap"><table><thead><tr><th>#</th><th>שירות</th><th>אמן</th><th>יוצר</th><th>מחיר</th><th>מצב</th><th>תשלום</th></tr></thead><tbody>
${orders.map((o) => html`<tr><td><a href="/orders/${o.id}">${o.id}</a></td><td>${o.title}</td><td>${o.artist_name}</td><td>${o.creator_name}</td><td>${money(o.price_agorot)}</td><td>${orderBadge(o.status)}</td><td><small>${o.payment_status}</small></td></tr>`)}
</tbody></table></div>
<h2>יוצרים</h2>
<div class="table-wrap"><table><thead><tr><th>שם</th><th>מייל</th><th>עיר</th><th>שירותים</th><th>מצב</th><th></th></tr></thead><tbody>
${creators.map((c) => html`<tr><td><a href="/creators/${c.user_id}">${c.display_name}</a></td><td dir="ltr">${c.email}</td><td>${c.city}</td><td>${c.services}</td><td>${c.status === "hidden" ? "מוסתר" : "פעיל"}</td>
  <td>${postButton(ctx, `/admin/creators/${c.user_id}/status`, c.status === "hidden" ? "הצגה" : "הסתרה", { cls: "btn small ghost", fields: { status: c.status === "hidden" ? "active" : "hidden" } })}</td></tr>`)}
</tbody></table></div>`;
}
