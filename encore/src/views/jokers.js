// פרופיל הג׳וקר, הקלף הציבורי, ותצוגת האמן לגילוי ג׳וקרים והזמנתם.
import { CARD_FIELDS, GENRES, INVITE_KINDS, SKILLS, SOCIAL_PLATFORMS, list } from "../domain/jokers.js";
import { csrfField, html, imageInput, layout, money, postButton, showDate, stat } from "./kit.js";

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const face = (j, cls = "") =>
  j.image_url ? html`<span class="avatar ${cls}"><img src="${j.image_url}" alt=""></span>` : html`<span class="avatar ${cls}" aria-hidden="true">${(j.nickname || "?")[0]}</span>`;
const checks = (name, options, selected) =>
  html`<div class="tags-pick">${options.map(([v, label]) => html`<label class="tag-pick"><input type="checkbox" name="${name}" value="${v}" ${selected.includes(v) ? html`checked` : ""}><span>${label}</span></label>`)}</div>`;

export function profilePage(ctx, { j, p, b, invitations, recs, cardUrl }, opts) {
  const genres = list(j.genres);
  const earned = b.pending + b.available + b.inTransit + b.paid;
  const open = invitations.filter((i) => i.status === "open");
  return layout(
    ctx,
    "הפרופיל שלי",
    html`
<nav class="tabs" aria-label="האזור שלי">
  ${[["/me/profile", "הפרופיל שלי"], ["/me/sales", "המכירות שלי"], ["/me/money", "הכסף שלי"], ["/creator", "יצירת תוכן"], ["/me/notifications", "התראות"]].map(
    ([h, l]) => html`<a href="${h}"${ctx.url.pathname === h ? html` aria-current="page"` : ""}>${l}</a>`
  )}
</nav>

<section class="joker-head">
  <div class="jh-id">${face(j, "big")}<div>
    <p class="eyebrow" dir="ltr">JOKER ${j.public_id}</p>
    <h1>${j.nickname}</h1>
    <p class="meta">${[j.city, genres.slice(0, 3).join(" · ")].filter(Boolean).join(" · ") || "הפרופיל עוד ריק. אפשר למלא רק מה שרוצים."}</p>
  </div></div>
  <div class="jh-stats">
    <div><b>${money(earned)}</b><span>הרווחת (רק את/ה רואה)</span></div>
    <div><b>${p.tickets}</b><span>כרטיסים נמכרו בזכותך</span></div>
    <div><b>${p.artists}</b><span>אמנים שקידמת</span></div>
  </div>
</section>

${open.length
  ? html`<section class="card" id="invitations">
  <h2>הזמנות מאמנים (${open.length})</h2>
  ${open.map((i) => html`<div class="invite-row">
    <div>
      <p><b>${i.artist_name}</b> מזמינים אותך: ${INVITE_KINDS[i.kind]} של <a href="/s/${i.campaign_id}">${i.title}</a></p>
      <p class="meta">${showDate(i.starts_at)}${i.city ? ` · ${i.city}` : ""}</p>
      ${i.kind === "promote" ? html`<p><b class="money">${money(i.reward_agorot + i.bonus_agorot)}</b> לכל כרטיס${i.bonus_agorot ? html` <small class="muted">(התגמול הרגיל ${money(i.reward_agorot)} ועוד ${money(i.bonus_agorot)} רק בשבילך)</small>` : ""}</p>` : ""}
      ${i.message ? html`<blockquote>${i.message}</blockquote>` : ""}
    </div>
    <div class="row2">
      ${postButton(ctx, `/me/invitations/${i.id}/accept`, i.kind === "promote" ? "מקבל/ת, תנו לי לינק" : "מעוניין/ת", { cls: "btn" })}
      ${postButton(ctx, `/me/invitations/${i.id}/decline`, "לא הפעם", { cls: "btn ghost" })}
    </div>
  </div>`)}
  <p class="note">הזמנה היא לא התחייבות להכנסה. מרוויחים על כרטיסים שנמכרים בפועל.</p>
</section>`
  : ""}

${recs.length
  ? html`<section>
  <h2>הופעות שמתאימות לך</h2>
  <div class="recs">${recs.map((c) => html`<a class="rec" href="/s/${c.id}">
    <b>${c.artist_name} · ${c.title}</b>
    <span class="meta">${showDate(c.starts_at)} · ${c.city || c.venue}</span>
    <span class="earn-line"><b>${money(c.reward_agorot)}</b> לכרטיס</span>
    <small class="why">${c.why}</small>
  </a>`)}</div>
</section>`
  : ""}

<section class="card">
  <h2>הכוח שלך</h2>
  <div class="powers">
    <div><h3>מכירות</h3><p><b>${p.tickets}</b> כרטיסים בתוקף · <b>${p.promoted}</b> הופעות שקידמת${p.refunded ? html` · ${p.refunded} הוחזרו` : ""}</p>
      ${p.byGenre.length ? html`<p class="meta">${p.byGenre.slice(0, 3).map((g) => `${g.genre}: ${g.tickets}`).join(" · ")}</p>` : html`<p class="meta">עוד אין מכירות. זה בסדר, גם ג׳וקרים חדשים מקבלים הזדמנויות.</p>`}</div>
    <div><h3>רשת</h3>${j.social_followers != null
      ? html`<p><b>${fmtK(j.social_followers)}</b> עוקבים ב-${j.social_platform || "רשת"} <span class="badge unverified">הצהרה עצמית</span></p>`
      : html`<p class="meta">לא מילאת. נתון חסר לא נחשב אפס.</p>`}</div>
    <div><h3>יצירה</h3><p><b>${p.completed}</b> עבודות שהושלמו${p.completed ? html` · ${p.on_time} בזמן` : ""} · <b>${p.portfolio}</b> בתיק העבודות</p>
      <p class="meta"><a href="/creator">לפרופיל היוצר ולשירותים</a></p></div>
  </div>
</section>

<details class="card" ${!j.genres && !j.city ? html`open` : ""} id="edit">
  <summary>עריכת הפרופיל</summary>
  <form method="post" action="/me/profile" class="stack" enctype="multipart/form-data" data-busy="שומרים…">
    ${csrfField(ctx)}
    <div class="row2">
      <label class="field">שם או כינוי<input name="nickname" required maxlength="40" value="${j.nickname}"></label>
      <label class="field">אזור<input name="city" maxlength="40" value="${j.city}" placeholder="למשל תל אביב"></label>
    </div>
    <div class="field">תמונה (לא חובה)${imageInput({ current: j.image_url, label: "העלאת תמונה" })}</div>
    <label class="field">כמה מילים עליך (לא חובה)<textarea name="bio" rows="2" maxlength="280">${j.bio}</textarea></label>
    <label class="field">שפות (לא חובה)<input name="languages" maxlength="80" value="${list(j.languages).join(", ")}" placeholder="עברית, English"></label>
    <fieldset><legend class="field">מה אני יכול/ה לעשות</legend>${checks("skills", Object.entries(SKILLS), list(j.skills))}</fieldset>

    <h3 id="music">הטעם המוזיקלי שלך</h3>
    <p class="muted">לפי זה נציע לך הופעות, ואמנים ימצאו אותך. אפשר לשנות בכל רגע.</p>
    ${checks("genres", GENRES.map((g) => [g, g]), list(j.genres))}
    <label class="field">אמנים שאת/ה אוהב/ת (לא חובה, מופרד בפסיקים)<input name="fav_artists" maxlength="300" value="${list(j.fav_artists).join(", ")}"></label>

    <h3>הרשת שלך (לא חובה)</h3>
    <p class="muted">מוצג כהצהרה עצמית. הרבה עוקבים יכולים להביא יותר הזדמנויות, אבל לא מבטיחים מכירות. לא מבקשים סיסמה, אף פעם.</p>
    <div class="row3">
      <label class="field">רשת<select name="social_platform"><option value="">בחירה</option>${SOCIAL_PLATFORMS.map((s) => html`<option ${s === j.social_platform ? html`selected` : ""}>${s}</option>`)}</select></label>
      <label class="field">קישור לפרופיל<input name="social_url" type="url" dir="ltr" value="${j.social_url}" placeholder="https://"></label>
      <label class="field">כמה עוקבים<input name="social_followers" inputmode="numeric" value="${j.social_followers ?? ""}"></label>
    </div>
    <button class="btn big block">שמירה</button>
  </form>
</details>

<section class="card" id="connections">
  <h2>חיבורים</h2>
  <div class="conn"><span>Spotify</span><span class="badge">בקרוב</span></div>
  <div class="conn"><span>Apple Music</span><span class="badge">בקרוב</span></div>
  <div class="conn"><span>Instagram</span><span class="badge">בקרוב</span></div>
  <p class="note">חיבורים אופציונליים, שיגיעו אחרי בדיקת התנאים של כל ספק. בינתיים בוחרים טעם ידנית ומצהירים על הרשת. אף פעם לא ניגשים לאנשי הקשר שלך.</p>
</section>

<section class="card" id="card">
  <h2>הקלף שלך</h2>
  <p class="muted">קלף ציבורי לשיתוף. את/ה בוחר/ת מה מופיע בו. רווחים, פרטי תשלום ופרטי קשר לא מופיעים אף פעם.</p>
  <form method="post" action="/me/profile/card" class="stack">
    ${csrfField(ctx)}
    ${checks("fields", Object.entries(CARD_FIELDS), list(j.card_fields))}
    <div class="row2">
      <button class="btn" name="publish" value="1">${j.card_public ? "עדכון הקלף" : "פרסום הקלף"}</button>
      ${j.card_public ? html`<button class="btn ghost" name="publish" value="0">הסתרת הקלף</button>` : ""}
    </div>
  </form>
  ${j.card_public
    ? html`<div class="linkbox"><code dir="ltr">${cardUrl}</code><button type="button" class="btn small" data-copy="${cardUrl}">העתקה</button></div>
           <p><a href="/j/${j.public_id}">לתצוגה של הקלף</a></p>`
    : html`<p class="note">הקלף מוסתר. <a href="/j/${j.public_id}?preview=1">תצוגה מקדימה</a> (רק את/ה רואה).</p>`}
</section>

<section class="card">
  <h2>הזמנות מאמנים</h2>
  <p class="muted">${j.invitations_on ? "אמנים יכולים למצוא אותך ולהזמין אותך לקדם הופעות או ליצור תוכן." : "כבוי: אמנים לא רואים אותך בחיפוש ולא יכולים להזמין."}</p>
  ${postButton(ctx, "/me/profile/invitations", j.invitations_on ? "כיבוי הזמנות" : "הפעלת הזמנות", { cls: "btn ghost", fields: { on: j.invitations_on ? "0" : "1" } })}
  ${invitations.filter((i) => i.status !== "open").length
    ? html`<details><summary>הזמנות קודמות</summary><ul class="plain-list">${invitations.filter((i) => i.status !== "open").map((i) => html`<li>${i.artist_name} · ${i.title} · ${{ accepted: "התקבלה", declined: "נדחתה", withdrawn: "בוטלה" }[i.status]}</li>`)}</ul></details>`
    : ""}
</section>`,
    opts
  );
}

/** הקלף הציבורי: מה שהג׳וקר בחר להציג, ולא יותר */
export function cardPage(ctx, { v, preview }, opts) {
  return layout(
    ctx,
    `${v.nickname} · Joker`,
    html`
<section class="narrow">
  ${preview ? html`<p class="flash dev">תצוגה מקדימה. הקלף עוד לא פורסם.</p>` : ""}
  <article class="joker-card" dir="ltr">
    <div class="jc-top"><small>JOKER / ${v.public_id}</small><img class="jc-star" src="/static/joker.svg" alt=""></div>
    ${v.image_url ? html`<div class="jc-photo"><img src="${v.image_url}" alt=""></div>` : ""}
    <h1>${v.nickname}</h1>
    ${v.genres.length ? html`<p class="jc-genres">${v.genres.join(" / ")}</p>` : ""}
    ${v.city ? html`<p class="jc-city" dir="rtl">${v.city}</p>` : ""}
    ${v.bio ? html`<p class="jc-bio" dir="rtl">${v.bio}</p>` : ""}
    <div class="jc-stats">
      ${v.social ? html`<div><b>${fmtK(v.social.followers)}</b><span>Followers*</span></div>` : ""}
      ${v.tickets !== null ? html`<div><b>${v.tickets}</b><span>Tickets sold</span></div>` : ""}
      ${v.artists !== null ? html`<div><b>${v.artists}</b><span>Artists</span></div>` : ""}
    </div>
    <p class="jc-be">Be Jo.</p>
    ${v.social ? html`<small class="jc-foot">*Self-reported</small>` : ""}
  </article>
  <p class="center"><a class="btn ghost" href="/shows">הופעות לקידום</a></p>
</section>`,
    { ...opts, description: `${v.nickname} · ג׳וקר/ית ב-JoCares`, og: { title: `${v.nickname} · Be Jo.`, image: v.image_url || undefined } }
  );
}

/** האמן מוצא ג׳וקרים להופעה ומזמין */
export function artistJokersPage(ctx, { c, rows }, opts) {
  return layout(
    ctx,
    `ג׳וקרים · ${c.title}`,
    html`
<p><a href="/artist/c/${c.id}">→ ${c.title}</a></p>
<h1>ג׳וקרים שמתאימים להופעה</h1>
<p class="lead">ההתאמה לפי טעם, אזור, מכירות קודמות ורשת. בכל רשימה יש גם ג׳וקרים חדשים, כדי שגם הם יקבלו הזדמנות.</p>
${rows.length
  ? html`<div class="joker-list">${rows.map((x) => html`<article class="card joker-item">
    <div class="ji-head">${face(x.v)}<div>
      <h3>${x.v.nickname}</h3>
      <p class="meta">${[x.v.city, x.v.genres.slice(0, 3).join(" · ")].filter(Boolean).join(" · ")}</p>
    </div></div>
    <p class="why">${x.reasons.join(" · ")}</p>
    ${x.v.social ? html`<p class="meta">${fmtK(x.v.social.followers)} עוקבים ב-${x.v.social.platform || "רשת"} <span class="badge unverified">הצהרה עצמית</span></p>` : ""}
    ${x.v.skills.length ? html`<p class="meta">${x.v.skills.map((s) => SKILLS[s]).join(" · ")}</p>` : ""}
    ${x.promoting
      ? html`<p class="flash good">כבר מקדם/ת את ההופעה</p>`
      : x.invitation === "open"
        ? html`<p class="note">הזמנה נשלחה, מחכה לתשובה</p>`
        : x.invitation === "declined"
          ? html`<p class="note">לא יכול/ה הפעם</p>`
          : html`<details><summary class="btn small">הזמנה</summary>
      <form method="post" action="/artist/c/${c.id}/invite" class="stack">
        ${csrfField(ctx)}<input type="hidden" name="joker_id" value="${x.j.user_id}">
        <label class="field">מה<select name="kind">${Object.entries(INVITE_KINDS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
        <label class="field">תגמול מוגדל לכרטיס, רק לו/ה (₪, לא חובה)<input name="bonus" type="number" min="0" step="1" inputmode="numeric" placeholder="0"><small class="hint">מעל ${money(c.reward_agorot)} הרגילים. משלמים רק על כרטיסים שנמכרו.</small></label>
        <label class="field">כמה מילים (לא חובה)<textarea name="message" rows="2" maxlength="300"></textarea></label>
        <button class="btn">שליחת הזמנה</button>
      </form></details>`}
  </article>`)}</div>`
  : html`<p class="muted">עוד אין ג׳וקרים עם פרופיל. ברגע שיהיו, הם יופיעו כאן.</p>`}`,
    { ...opts, wide: true }
  );
}
