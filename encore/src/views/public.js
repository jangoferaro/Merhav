import { config } from "../util.js";
import { csrfField, empty, html, layout, money, poster, showCard, showDate, stat, stamp, raw } from "./kit.js";

// ---------- כניסה למוצר: שתי אפשרויות בלבד (PRD §7) ----------

export function landing(ctx, shows, opts) {
  return layout(
    ctx,
    "",
    html`
<section class="hero">
  <h1 class="display">אמנות<br>צריכה קהל.</h1>
  <span class="stamp hero-stamp" lang="en" dir="ltr"><b>Be Jo.</b></span>
  <p class="lead">אמנים מפרסמים הופעה. כל אחד יכול לעזור לה להגיע לקהל, ולהרוויח מכל כרטיס שנמכר בזכותו.</p>
  <div class="choices">
    <a class="choice artist" href="/grow">
      <span class="choice-tag">לאמנים</span>
      <b>אני רוצה להגדיל את הקהל שלי</b>
      <small>למלא הופעה, להזמין תוכן, או להגיע לקהלים חדשים. משלמים על תוצאות.</small>
    </a>
    <a class="choice promoter" href="/shows">
      <span class="choice-tag" lang="en" dir="ltr">Be Jo.</span>
      <b>אני רוצה להרוויח מקידום הופעות</b>
      <small>בוחרים הופעה, משתפים בוואטסאפ, ומקבלים על כל כרטיס.</small>
    </a>
    <a class="choice creator-choice" href="/creator">
      <span class="choice-tag">ליוצרים</span>
      <b>אני רוצה להרוויח מיצירת תוכן</b>
      <small>ריל, המלצה, צילום או פרסום בערוץ שלך. לא צריך אלפי עוקבים.</small>
    </a>
  </div>
</section>
${shows.length
  ? html`
<section>
  <div class="row-head"><h2>הופעות שאפשר לקדם עכשיו</h2><a href="/shows">לכל ההופעות ←</a></div>
  <div class="grid-shows">${shows.slice(0, 3).map((c) => showCard(ctx, c))}</div>
</section>`
  : ""}`,
    opts
  );
}

export function how(ctx, opts) {
  return layout(
    ctx,
    "איך זה עובד",
    html`
<section class="prose">
  <h1>איך זה עובד</h1>
  <h2>למקדמים</h2>
  <ol>
    <li>בוחרים הופעה ולוחצים על <b>שתף והרוויח</b>. מקבלים לינק אישי.</li>
    <li>משתפים עם מי שרוצים. הודעה מוכנה כבר מחכה, ואפשר לערוך אותה.</li>
    <li>כשמישהו קונה דרך הלינק, מקבלים את הסכום שמופיע על ההופעה, על כל כרטיס.</li>
  </ol>
  <p>הכסף <b>ממתין לאישור</b> עד ${config.holdDaysAfterShow} ימים אחרי ההופעה (למקרה של ביטול או החזר), ואז הוא <b>זמין לתשלום</b>.
     אפשר לבקש העברה מ-${money(config.minPayoutAgorot)}. אין דמי הצטרפות, אין יעדים, ואין התחייבות.</p>
  <p>הרכישה נזקפת לזכותכם אם הקונה לחץ על הלינק שלכם ב-${config.attributionDays} הימים שלפני הקנייה,
     והלינק שלכם הוא האחרון שהוא לחץ עליו. קנייה של כרטיסים לעצמכם לא מזכה בתגמול.</p>
  <p>מרוויחים רק ממכירות של כרטיסים. אין תגמול על צירוף מקדמים אחרים, ואף פעם לא יהיה.</p>
  <h2>לאמנים</h2>
  <ol>
    <li>מדביקים לינק להופעה. אנחנו מנסים למלא את הפרטים לבד.</li>
    <li>בוחרים כמה לתת על כל כרטיס שנמכר. רואים בדיוק כמה נשאר לכם.</li>
    <li>מפרסמים. משלמים רק על כרטיסים שנמכרו בפועל.</li>
  </ol>
  <p>עמלת הפלטפורמה: ${config.feeBps / 100}% ממחיר כרטיס שנמכר דרך מקדם. על כרטיסים שנמכרים בלי מקדם אין עמלה.</p>
</section>`,
    opts
  );
}

export function terms(ctx, opts) {
  return layout(
    ctx,
    "תנאים ופרטיות",
    html`
<section class="prose">
  <h1>תנאים ופרטיות, בקצרה</h1>
  <p class="note">טיוטה לפיילוט. הנוסח המחייב ייכתב עם יועץ משפטי לפני השקה מסחרית.</p>
  <h2>מה אנחנו שומרים</h2>
  <ul>
    <li>מקדמים: מייל, שם, ופרטים לתשלום. פרטי התשלום נשמרים מוצפנים.</li>
    <li>לחיצה על לינק: מזהה אנונימי של הדפדפן (מגובב), הזמן, ומאיזה אתר הגיעה. בלי כתובת IP.</li>
    <li>רכישות: מספר הכרטיסים, הסכום, ומייל הרוכש בצורה מגובבת בלבד (כדי לזהות רכישה עצמית ורוכשים חוזרים).</li>
    <li>לא ניגשים לאנשי הקשר שלכם, אף פעם.</li>
  </ul>
  <h2>גילוי נאות</h2>
  <p>מקדמים מקבלים עמלה על רכישות דרך הלינק שלהם. ההודעה המוכנה לשיתוף כוללת גילוי נאות, ודף ההופעה מציג אותו לכל מי שהגיע דרך לינק.</p>
  <h2>תשלומים</h2>
  <p>כדי לקבל תשלום צריך להיות מעל גיל 18. ייתכן שיידרשו פרטים נוספים לצורכי מס.</p>
</section>`,
    opts
  );
}

// ---------- מרקטפלייס ----------

export function marketplace(ctx, { shows, cities, city, when }, opts) {
  const chip = (href, label, on) => html`<a class="chip${on ? " on" : ""}" href="${href}">${label}</a>`;
  const q = (c, w) => {
    const p = new URLSearchParams();
    if (c) p.set("city", c);
    if (w) p.set("when", w);
    const s = p.toString();
    return `/shows${s ? `?${s}` : ""}`;
  };
  return layout(
    ctx,
    "הופעות לקידום",
    html`
<section class="page-head">
  <h1>בוחרים הופעה. משתפים. מרוויחים.</h1>
  <p class="lead">הסכום המסומן הוא מה שתקבלו על כל כרטיס שנמכר דרך הלינק שלכם.</p>
</section>
<nav class="chips" aria-label="סינון">
  ${chip(q("", when), "בכל הארץ", !city)}
  ${cities.map((c) => chip(q(c, when), c, c === city))}
  <span class="sep"></span>
  ${chip(q(city, ""), "כל התאריכים", !when)}
  ${chip(q(city, "week"), "השבוע", when === "week")}
  ${chip(q(city, "month"), "החודש", when === "month")}
</nav>
${shows.length
  ? html`<div class="grid-shows">${shows.map((c) => showCard(ctx, c))}</div>`
  : empty("אין כרגע הופעות שמתאימות לסינון", "נסו להרחיב את הסינון, או לחזור בעוד כמה ימים.", html`<a class="btn ghost" href="/shows">לכל ההופעות</a>`)}`,
    { ...opts, wide: true }
  );
}

// ---------- דף הופעה: לרוכש ולמקדם ----------

export function showPage(ctx, { c, referrer, link, stats, buyable }, opts) {
  return layout(
    ctx,
    `${c.artist_name} · ${c.title}`,
    html`
<article class="show-page">
  <div class="show-media">${poster(c, "big")}${c.status === "active" ? stamp(money(c.reward_agorot), "למקדם על כרטיס") : ""}</div>
  <div class="show-main">
    <p class="eyebrow">${c.artist_name}</p>
    <h1>${c.title}</h1>
    <p class="meta big">${showDate(c.starts_at)}<br>${c.venue}${c.city ? `, ${c.city}` : ""}</p>
    ${referrer
      ? html`<p class="ref"><b>${referrer}</b> המליץ/ה לך על ההופעה. <small>(מקבל/ת עמלה קטנה אם תקנו דרך הקישור, בלי עלות נוספת לכם)</small></p>`
      : ""}
    ${c.description ? html`<p class="desc">${c.description}</p>` : ""}

    <div class="buy-box">
      <div><span class="muted">כרטיס</span> <b class="price">${money(c.price_agorot)}</b></div>
      ${buyable
        ? html`<a class="btn big block" href="/s/${c.id}/buy">לרכישת כרטיסים</a>`
        : html`<p class="muted">${c.status === "cancelled" ? "ההופעה בוטלה." : "המכירה דרך Jocares סגורה כרגע."}</p>
               ${c.source_url ? html`<a class="btn ghost block" href="${c.source_url}" rel="noopener nofollow">לאתר ההופעה</a>` : ""}`}
    </div>

    ${c.status === "active"
      ? html`
    <div class="promo-box">
      <h2>אוהבים את ההופעה? תרוויחו ממנה.</h2>
      <p>על כל כרטיס שנמכר דרך הלינק שלכם תקבלו <b class="money">${money(c.reward_agorot)}</b>.</p>
      ${link
        ? html`<a class="btn ghost block" href="/s/${c.id}/share">הלינק שלי · ${stats.tickets} כרטיסים עד עכשיו</a>`
        : html`<form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">שתף והרוויח</button></form>`}
    </div>`
      : ""}
  </div>
</article>`,
    {
      ...opts,
      description: `${c.artist_name} · ${c.title} · ${showDate(c.starts_at)} · ${c.venue}`,
      og: {
        type: "music.event",
        title: `${c.artist_name}: ${c.title}`,
        description: `${showDate(c.starts_at)} · ${c.venue}${c.city ? `, ${c.city}` : ""} · כרטיסים ${money(c.price_agorot)}`,
        image: c.image_url,
        url: `/s/${c.id}`,
      },
    }
  );
}

// ---------- ערכת שיתוף ----------

export function sharePage(ctx, { c, url, text, stats }, opts) {
  const enc = encodeURIComponent;
  return layout(
    ctx,
    "שיתוף",
    html`
<section class="share-page">
  <p class="eyebrow">${c.artist_name} · ${c.title}</p>
  <div class="share-head"><h1>הלינק האישי שלך מוכן</h1>${stamp(money(c.reward_agorot), "לכל כרטיס")}</div>
  <p class="lead">כל כרטיס שנקנה דרכו = <b class="money">${money(c.reward_agorot)}</b> בשבילך.</p>

  <div class="linkbox"><code dir="ltr">${url}</code><button type="button" class="btn small" data-copy="${url}">העתקה</button></div>

  <button type="button" class="btn big block native-share" data-share-title="${c.title}" data-share-url="${url}" hidden>שיתוף…</button>
  <div class="share-grid" id="share-targets">
    <a class="share wa" data-share-target="wa" href="https://wa.me/?text=${enc(text)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="share tg" data-share-target="tg" href="https://t.me/share/url?url=${enc(url)}&text=${enc(text.replace(url, "").trim())}" target="_blank" rel="noopener">Telegram</a>
    <a class="share fb" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener">Facebook</a>
    <a class="share sms" data-share-target="sms" href="sms:?&body=${enc(text)}">הודעה</a>
    <button type="button" class="share ig" data-copy-from="share-text" data-copied="הטקסט הועתק. הדביקו בסטורי או בפוסט">Instagram</button>
  </div>

  <label class="field">ההודעה (אפשר לערוך, לא חובה)
    <textarea id="share-text" rows="7" data-share-url="${url}">${text}</textarea>
  </label>
  <p class="note">הגילוי הנאות בסוף ההודעה הוא חובה כשמרוויחים מהמלצה. השאירו אותו.</p>

  <div class="stats three">
    ${stat(stats.clicks, "נכנסו ללינק")}
    ${stat(stats.tickets, "כרטיסים נמכרו")}
    ${stat(money(stats.tickets * c.reward_agorot), "הרווחת (לפני החזרים)")}
  </div>
  <p class="center"><a href="/me/sales">כל המכירות שלי ←</a></p>
</section>`,
    opts
  );
}

// ---------- כניסה ----------

export function loginPage(ctx, { next, email = "", step = "email" }, opts) {
  return layout(
    ctx,
    "כניסה",
    html`
<section class="narrow card">
  ${step === "email"
    ? html`
  <h1>כניסה או הרשמה</h1>
  <p class="muted">בלי סיסמה. נשלח לך קוד למייל.</p>
  <form method="post" action="/login" class="stack">
    ${csrfField(ctx)}<input type="hidden" name="next" value="${next}">
    <label class="field">מייל<input type="email" name="email" value="${email}" required autocomplete="email" inputmode="email" autofocus></label>
    <button class="btn big block">שליחת קוד</button>
  </form>`
    : html`
  <h1>מה הקוד?</h1>
  <p class="muted">שלחנו קוד בן 6 ספרות ל-<b dir="ltr">${email}</b></p>
  <form method="post" action="/login/code" class="stack">
    ${csrfField(ctx)}<input type="hidden" name="next" value="${next}"><input type="hidden" name="email" value="${email}">
    <label class="field">קוד<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" class="code-input" autofocus></label>
    <button class="btn big block">כניסה</button>
  </form>
  <p class="center"><a href="/login?next=${encodeURIComponent(next)}">מייל אחר / קוד חדש</a></p>`}
</section>`,
    opts
  );
}

export function welcomePage(ctx, { next }, opts) {
  return layout(
    ctx,
    "נעים להכיר",
    html`
<section class="narrow card">
  <h1>איך קוראים לך?</h1>
  <p class="muted">רק השם הפרטי יוצג למי שתמליצו לו ולאמנים.</p>
  <form method="post" action="/welcome" class="stack">
    ${csrfField(ctx)}<input type="hidden" name="next" value="${next}">
    <label class="field">שם<input name="name" required maxlength="60" autocomplete="name" autofocus></label>
    <button class="btn big block">ממשיכים</button>
  </form>
</section>`,
    opts
  );
}

// ---------- אחרי רכישה ----------

export function thanksPage(ctx, { c, more, followed }, opts) {
  return layout(
    ctx,
    "תודה!",
    html`
<section class="narrow center">
  <h1>נתראה בהופעה</h1>
  <p class="lead">הכרטיסים נשלחו אליך ממערכת הכרטוס.</p>
</section>
<section class="narrow card">
  ${followed
    ? html`<p>נעדכן אותך כש${c.artist_name} מעלים הופעה חדשה.</p>`
    : html`
  <h2>רוצה לשמוע על ההופעה הבאה של ${c.artist_name}?</h2>
  <form method="post" action="/s/${c.id}/follow" class="stack">
    ${csrfField(ctx)}
    <label class="field">מייל<input type="email" name="email" required autocomplete="email"></label>
    <label class="check"><input type="checkbox" name="consent" required> אני מסכים/ה ש${c.artist_name} יעדכנו אותי במייל על הופעות. אפשר לבטל בכל רגע.</label>
    <button class="btn ghost block">כן, תעדכנו אותי</button>
  </form>`}
</section>
<section class="narrow card promo-box">
  <h2>חברים שלך יאהבו את זה?</h2>
  <p>שתפו את ההופעה וקבלו <b class="money">${money(c.reward_agorot)}</b> על כל כרטיס שהם קונים.</p>
  <form method="post" action="/s/${c.id}/promote">${csrfField(ctx)}<button class="btn block">קבלו לינק אישי</button></form>
</section>
${more.length ? html`<section><h2>עוד הופעות</h2><div class="grid-shows">${more.map((m) => showCard(ctx, m))}</div></section>` : ""}`,
    opts
  );
}

export function errorPage(ctx, status, message, opts) {
  return layout(
    ctx,
    "אופס",
    html`<section class="narrow center"><h1>${status === 404 ? "לא מצאנו את הדף" : "אופס"}</h1><p class="lead">${message}</p><p><a class="btn ghost" href="/">לדף הבית</a></p></section>`,
    opts
  );
}

export { raw };
