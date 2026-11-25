import { config, shortDate } from "../util.js";
import { csrfField, empty, html, inviteBox, layout, mediaTile, money, poster, priceTag, showCard, showDate, stat, stamp, raw } from "./kit.js";

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
  <p class="lead">JoCares היא מערכת כרטיסים להופעות, עם רשת של אנשים שאוהבים את האמנים וממליצים עליהם לחברים: הג׳וקרים.</p>

  <h2>לאמנים, למקומות ולהפקות</h2>
  <ol>
    <li>פותחים הופעה: פרטים, תמונה, מחיר, כמה כרטיסים יש, וכמה תתנו לג׳וקר על כל כרטיס שנמכר דרכו. מקום או הפקה פותחים חשבון אחד ומוכרים בו הופעות של כל האמנים שלהם.</li>
    <li>אנחנו מוכרים את הכרטיסים. הקונה מקבל כרטיס עם קוד לטלפון, ואתם מקבלים קישור לסריקה בכניסה.</li>
    <li>ג׳וקרים משתפים, החברים שלהם קונים, ואתם רואים הכל בזמן אמת: מכירות, הזמנות, החזרים, ומי נכנס בדלת.</li>
  </ol>
  <p>אפשר גם: מחיר מוקדם עד תאריך או כמות, ערכת שיתוף עם סרטונים ותמונות לג׳וקרים, והזמנת תוכן מיוצרים (סרטון המלצה, ריל, סקירת שיר, צילום בהופעה) במחיר ידוע מראש.</p>
  <p><b>מה זה עולה:</b> אין דמי מנוי. על כרטיס שנמכר דרך ג׳וקר: ${config.feeBps / 100}% ממחיר הכרטיס. על מכירה ישירה בלי ג׳וקר: לא לוקחים כלום${config.ticketFeeAgorot ? `. הקונה משלם ${money(config.ticketFeeAgorot)} דמי שירות לכרטיס` : ""}. על הזמנת תוכן: ${config.contentFeeBps / 100}% מהמחיר, מהחלק של היוצר.</p>
  <p>כבר יש לכם קופה או שהמקום מוכר? אפשר גם ככה: כל ג׳וקר מקבל קוד אישי, ואנחנו מעדכנים את המכירות בשבילכם.</p>

  <h2>לג׳וקרים</h2>
  <ol>
    <li>בוחרים הופעה ולוחצים <b>שתף והרוויח</b>. מקבלים לינק אישי, הודעה מוכנה, וסטורי עם הקוד שלכם.</li>
    <li>כותבים לחברים משפט אישי. מי שנכנס דרככם רואה "מזמין/ה אותך" ואת מה שכתבתם. אפשר גם לתת לחברים הנחה מתוך התגמול שלכם.</li>
    <li>על כל כרטיס שנקנה דרך הלינק מקבלים את הסכום שמופיע על ההופעה.</li>
  </ol>
  <p>הכסף <b>ממתין לאישור</b> עד ${config.holdDaysAfterShow} ימים אחרי ההופעה (למקרה של ביטול או החזר), ואז הוא <b>זמין לתשלום</b>.
     אפשר לבקש העברה מ-${money(config.minPayoutAgorot)}. אין דמי הצטרפות, אין יעדים, ואין התחייבות.</p>
  <p>הרכישה נזקפת לזכותכם אם הקונה לחץ על הלינק שלכם ב-${config.attributionDays} הימים שלפני הקנייה, והלינק שלכם הוא האחרון שהוא לחץ עליו. קנייה לעצמכם לא מזכה.</p>
  <p>מרוויחים רק ממכירות של כרטיסים. אין תגמול על צירוף ג׳וקרים אחרים, ואף פעם לא יהיה.</p>
  <p>יש לכם קהל או כישרון? אפשר לפתוח פרופיל יוצר ולהציע לאמן שירות בתשלום, למשל סרטון המלצה.</p>

  <h2>לקונים</h2>
  <p>קונים בקופה שלנו, מקבלים את הכרטיסים מיד לטלפון ולמייל, ומציגים בכניסה. כל כרטיס אפשר להעביר לחבר בקישור משלו. אם ההופעה מתבטלת, הכסף חוזר אוטומטית.</p>
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

  <h2>כרטיסים</h2>
  <ul>
    <li>המוכר של הכרטיס הוא האמן או המפיק. JoCares מפעילה את הקופה, את הכרטיסים ואת הכניסה.</li>
    <li>הכרטיס הוא קוד אחד שנסרק פעם אחת בכניסה. מי שמחזיק בקוד נכנס.</li>
    <li>ביטול הופעה: הכסף מוחזר במלואו לאמצעי התשלום, אוטומטית.</li>
    <li>ביטול עסקה על ידי הקונה: לפי מדיניות האמן ולפי חוק הגנת הצרכן. פונים אלינו או לאמן.</li>
    <li>פרטי הכרטיס (האשראי) מוזנים בעמוד של חברת הסליקה ולא עוברים דרכנו.</li>
  </ul>

  <h2>מה אנחנו שומרים</h2>
  <ul>
    <li>קונים: שם, מייל, וטלפון אם נמסר. האמן מקבל את רשימת הקונים של ההופעה שלו, כדי לנהל אותה. עדכונים שיווקיים נשלחים רק למי שסימן שהוא מסכים.</li>
    <li>"תזכירו לי": מייל אחד בלבד, לפי בקשה מפורשת, עם קישור לביטול.</li>
    <li>ג׳וקרים ויוצרים: מייל, שם, ופרטים לתשלום. פרטי תשלום (גם של אמנים) נשמרים מוצפנים.</li>
    <li>לחיצה על לינק: מזהה אנונימי של הדפדפן (מגובב), הזמן, ומאיזה אתר הגיעה. בלי כתובת IP.</li>
    <li>לצורך שיוך מכירות נשמר מייל הקונה גם בצורה מגובבת (כדי לזהות רכישה עצמית וקונים חוזרים).</li>
    <li>לא ניגשים לאנשי הקשר שלכם, אף פעם.</li>
  </ul>

  <h2>גילוי נאות</h2>
  <p>ג׳וקרים מקבלים תגמול על רכישות דרך הלינק שלהם. ההודעה המוכנה לשיתוף כוללת גילוי נאות, ודף ההופעה מציג אותו לכל מי שהגיע דרך לינק של ג׳וקר. יוצרים שמפרסמים בתשלום בערוץ שלהם מסמנים "שיתוף פעולה בתשלום".</p>

  <h2>תוכן</h2>
  <p>הזכויות בתוכן שמוזמן מיוצרים נקבעות לפי המסלול שנבחר בהזמנה, ומוצגות לפני שמזמינים. כשההזמנה קשורה להופעה, הג׳וקרים של ההופעה רשאים לשתף את התוכן בערוצים שלהם עם קרדיט ליוצר. אמן שמעלה חומרים לערכת השיתוף מאשר שיש לו זכות להפיץ אותם.</p>

  <h2>תשלומים</h2>
  <p>כדי לקבל תשלום כג׳וקר או כיוצר צריך להיות מעל גיל 18. ייתכן שיידרשו פרטים נוספים לצורכי מס.</p>
</section>`,
    opts
  );
}

/** מחיקת מידע: דרישה של Meta, TikTok ו-Google לאפליקציות עם חיבור חשבון */
export function dataDeletion(ctx, opts) {
  return layout(
    ctx,
    "מחיקת מידע",
    html`
<section class="prose">
  <h1>מחיקת מידע</h1>
  <p lang="en" dir="ltr">Data deletion instructions for JoCares users (English below).</p>
  <h2>ניתוק חשבון שחובר (Instagram, TikTok, YouTube, Facebook, Spotify, Apple Music)</h2>
  <ol>
    <li>נכנסים ל-JoCares ופותחים את "הפרופיל שלי".</li>
    <li>בחלק "חיבורים" לוחצים "ניתוק" ליד החשבון.</li>
    <li>מיד נמחקים: האסימונים, מספרי העוקבים שנמדדו, והאמנים והסגנונות שסונכרנו. נשאר רק רישום ביומן שהחיבור היה קיים.</li>
  </ol>
  <p>אפשר גם לבטל את ההרשאה אצל הספק עצמו (בהגדרות האפליקציות המחוברות שלו). בסנכרון הבא החיבור יסומן "ההרשאה פגה", ואפשר לנתק אותו.</p>
  <h2>מחיקת החשבון כולו</h2>
  <p>כותבים לנו מהמייל של החשבון ל-<span dir="ltr">${process.env.SUPPORT_EMAIL || "privacy@jocares.co.il"}</span> עם הכותרת "מחיקת חשבון". נמחק תוך 30 יום את הפרופיל, החיבורים והנתונים האישיים. רישומים כספיים (מכירות, תגמולים ותשלומים) נשמרים לפי חובה חוקית, בלי פרטים שאינם נדרשים.</p>
  <hr>
  <div lang="en" dir="ltr">
    <h2>Disconnecting a connected account</h2>
    <p>Sign in to JoCares, open "My profile", and press "Disconnect" next to the account in "Connections". Access tokens, follower measurements and synced artists and genres are deleted immediately. You can also remove JoCares from the provider's connected apps settings.</p>
    <h2>Deleting your account</h2>
    <p>Email ${process.env.SUPPORT_EMAIL || "privacy@jocares.co.il"} from your account email with the subject "Account deletion". We delete your profile, connections and personal data within 30 days. Financial records are kept only as required by law.</p>
  </div>
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

export function showPage(ctx, { c, link, stats, buyable, left = null, inviter = null, ogInviter = null, price = null }, opts) {
  return layout(
    ctx,
    `${c.artist_name} · ${c.title}`,
    html`
${inviter ? html`<div class="invite-top">${inviteBox(inviter)}</div>` : ""}
<article class="show-page">
  <div class="show-media">${poster(c, "big")}${c.status === "active" ? stamp(money(c.reward_agorot), "למקדם על כרטיס") : ""}</div>
  <div class="show-main">
    <p class="eyebrow">${c.artist_name}</p>
    <h1>${c.title}</h1>
    <p class="meta big">${showDate(c.starts_at)}<br>${c.venue}${c.city ? `, ${c.city}` : ""}</p>
    ${c.description ? html`<p class="desc">${c.description}</p>` : ""}

    <div class="buy-box">
      <div><span class="muted">כרטיס</span> ${priceTag(c, buyable ? price : null)}</div>
      ${buyable && left === 0
        ? html`<p class="muted">הכרטיסים אזלו.</p>`
        : buyable
        ? html`<a class="btn big block" href="/s/${c.id}/buy">לרכישת כרטיסים</a>${left !== null && left <= 20 ? html`<p class="note">נשארו ${left} כרטיסים.</p>` : ""}`
        : html`<p class="muted">${c.status === "cancelled" ? "ההופעה בוטלה." : "המכירה דרך JoCares סגורה כרגע."}</p>
               ${c.source_url ? html`<a class="btn ghost block" href="${c.source_url}" rel="noopener nofollow">לאתר ההופעה</a>` : ""}`}
    </div>

    ${buyable && c.provider === "jocares"
      ? html`<details class="remind">
      <summary>עוד לא בטוחים? נזכיר לכם</summary>
      <form method="post" action="/s/${c.id}/remind" class="stack">
        ${csrfField(ctx)}
        <label class="field">מייל<input name="email" type="email" required autocomplete="email" dir="ltr"></label>
        <label class="check"><input type="checkbox" name="consent" required> שלחו לי תזכורת אחת במייל לפני ההופעה${price?.early ? " או לפני שהמחיר המוקדם נגמר" : ""}. רק על ההופעה הזו.</label>
        <button class="btn ghost block">תזכירו לי</button>
      </form>
    </details>`
      : ""}

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
        title: ogInviter ? `${ogInviter} מזמין/ה אותך: ${c.artist_name} · ${c.title}` : `${c.artist_name}: ${c.title}`,
        description: `${showDate(c.starts_at)} · ${c.venue}${c.city ? `, ${c.city}` : ""} · כרטיסים ${money(price?.price ?? c.price_agorot)}`,
        image: c.image_url,
        url: `/s/${c.id}`,
      },
    }
  );
}

// ---------- ערכת שיתוף ----------

export function sharePage(ctx, { c, url, text, stats, code = null, lastImport = null, link = {}, assets = [], price = null, offer = null }, opts) {
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
  ${code
    ? html`<p class="muted">והקוד האישי שלך: <b class="num" dir="ltr">${code}</b>. הוא כבר בתוך ההודעה, ומי שנכנס דרך הלינק יקבל אותו אוטומטית. גם מי שקונה ישר באתר הכרטיסים עם הקוד נספר לך.</p>`
    : ""}

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

  ${c.provider === "jocares" && c.reward_agorot > 100
    ? html`<section class="card" id="discount">
    <h2>הנחה לחברים מתוך התגמול שלך</h2>
    <p class="muted">לא חובה. מה שתבחרו יורד מהתגמול שלכם ונותן לחברים סיבה לקנות דווקא דרככם. האמן מקבל אותו דבר.</p>
    <form method="post" action="/s/${c.id}/share/discount" class="inline">
      ${csrfField(ctx)}
      <label class="field">הנחה לכרטיס (₪)<input name="discount" type="number" min="0" max="${(c.reward_agorot - 100) / 100}" step="1" value="${(link.discount_agorot ?? 0) / 100}" inputmode="numeric"></label>
      <button class="btn ghost">שמירה</button>
    </form>
    <p class="note">${link.discount_agorot ? html`חברים מקבלים <b>${money(link.discount_agorot)}</b> הנחה, ואת/ה <b>${money(c.reward_agorot - link.discount_agorot)}</b> על כל כרטיס.` : html`כרגע בלי הנחה: <b>${money(c.reward_agorot)}</b> לכרטיס בשבילך.`}</p>
  </section>`
    : ""}

  <section class="card" id="note">
    <h2>משפט אישי לחברים</h2>
    <p class="muted">מי שנכנס דרך הלינק שלך יראה בדף ההופעה "${(ctx.user?.name || "").split(" ")[0] || "את/ה"} מזמין/ה אותך", ואת המשפט הזה. אנשים קונים בגלל חבר, לא בגלל פרסומת.</p>
    <form method="post" action="/s/${c.id}/share/note" class="stack">
      ${csrfField(ctx)}
      <input name="note" maxlength="140" value="${link.note ?? ""}" placeholder="למשל: הייתי בהופעה הקודמת שלהם, מטורף. בואו!">
      <button class="btn ghost">שמירה</button>
    </form>
  </section>

  <section class="card kit" id="kit">
    <h2>ערכת שיתוף</h2>
    <p class="muted">עיצוב מוכן עם הקוד שלך. מורידים ומעלים לאינסטגרם או לסטטוס בוואטסאפ, ומוסיפים מדבקת לינק.</p>
    <div class="seg story-pick" role="radiogroup" aria-label="עיצוב">
      <label><input type="radio" name="story-variant" value="photo" checked> סטורי עם תמונה</label>
      <label><input type="radio" name="story-variant" value="type"> סטורי טקסט</label>
      <label><input type="radio" name="story-variant" value="square"> פוסט מרובע</label>
    </div>
    <div class="story-wrap"><canvas class="story" width="1080" height="1920" data-story
      data-img="${c.image_url}" data-artist="${c.artist_name}" data-title="${c.title}"
      data-when="${showDate(c.starts_at)}" data-where="${c.venue}${c.city ? `, ${c.city}` : ""}"
      data-price="${price?.early ? `מחיר מוקדם ${money(price.price)}` : ""}"
      data-url="${url.replace(/^https?:\/\//, "")}" data-qr="/s/${c.id}/share/qr.svg"
      aria-label="תצוגה של הסטורי"></canvas></div>
    <div class="row2">
      <button type="button" class="btn" data-story-share hidden>שיתוף הסטורי</button>
      <a class="btn ghost" data-story-download download="jocares-story-${c.id}.png" href="#">הורדה</a>
    </div>
    ${assets.length
      ? html`<h3>חומרים מהאמן</h3>
        <div class="asset-grid">${assets.map((a) => html`<figure>${mediaTile(a.image_url)}<figcaption><a href="${a.image_url}" download>הורדה</a>${a.credit ? html` · <span class="muted">${a.credit}</span>` : ""}</figcaption></figure>`)}</div>
        <p class="note">כשמשתפים תוכן של יוצר/ת, מתייגים אותו/ה.</p>`
      : ""}
    <p class="note"><a href="/s/${c.id}/share/qr.svg" download="jocares-qr-${c.id}.svg">הורדת QR של הלינק שלך</a> (להדפסה או לשקופית בהופעה)</p>
  </section>

  ${offer && !offer.isOwner ? offerBox(ctx, c, offer) : ""}

  <div class="stats three">
    ${stat(stats.clicks, "נכנסו ללינק")}
    ${stat(stats.tickets, "כרטיסים נמכרו")}
    ${stat(money(stats.tickets * c.reward_agorot), "הרווחת (לפני החזרים)")}
  </div>
  ${code ? html`<p class="note center">המכירות מאתר הכרטיסים מתעדכנות אצלנו מעת לעת. עדכון אחרון: ${lastImport ? shortDate(lastImport) : "עוד לא"}.</p>` : ""}
  <p class="center"><a href="/me/sales">כל המכירות שלי ←</a></p>
</section>`,
    opts
  );
}

/** ג׳וקר מציע לאמן שירות בתשלום, למשל סרטון המלצה */
function offerBox(ctx, c, { profile, services, mine }) {
  const head = html`<h2>מעבר ללינק: להציע לאמן שירות</h2>
    <p class="muted">אוהבים את ${c.artist_name}? אפשר להציע סרטון המלצה, ריל או צילום בהופעה, במחיר שאתם קובעים. ${c.artist_name} מחליטים אם להזמין, והתשלום עובר רק אחרי שהם מאשרים את העבודה.</p>`;
  if (mine && mine.status === "open") return html`<section class="card" id="offer">${head}<p class="flash good">שלחת הצעה: ${mine.title}. ממתינה להחלטת האמן.</p></section>`;
  if (mine && mine.status === "ordered") return html`<section class="card" id="offer">${head}<p class="flash good">${c.artist_name} הזמינו ממך ${mine.title}. <a href="/orders/${mine.order_id}">להזמנה</a></p></section>`;
  if (!profile || !services.length) {
    return html`<section class="card" id="offer">${head}
      <a class="btn ghost block" href="/creator">${profile ? "להוספת שירות, למשל סרטון המלצה" : "פתיחת פרופיל יוצר (דקה אחת)"}</a></section>`;
  }
  return html`<section class="card" id="offer">${head}
    <form method="post" action="/s/${c.id}/offer" class="stack">
      ${csrfField(ctx)}
      <label class="field">מה להציע
        <select name="service_id">${services.map((s) => html`<option value="${s.id}">${s.title} · ${money(s.price_agorot)}</option>`)}</select></label>
      <label class="field">כמה מילים לאמן (לא חובה)<textarea name="message" rows="2" maxlength="300" placeholder="למשל: אני בא לכל ההופעות שלכם, ויש לי קהל שאוהב בדיוק את זה"></textarea></label>
      <button class="btn">שליחת הצעה</button>
    </form></section>`;
}

// ---------- כניסה ----------

const GOOGLE_G = raw(`<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`);

export function loginPage(ctx, { next, email = "", step = "email", google = false }, opts) {
  return layout(
    ctx,
    "כניסה",
    html`
<section class="narrow card">
  ${step === "email"
    ? html`
  <h1>כניסה או הרשמה</h1>
  <p class="muted">אותו חשבון לכולם: ג׳וקרים, אמנים ויוצרים. בלי סיסמה.</p>
  ${google
    ? html`<a class="btn btn-google big block" href="/auth/google?next=${encodeURIComponent(next)}">${GOOGLE_G}<span>המשך עם Google</span></a>
           <p class="or-divider"><span>או עם קוד למייל</span></p>`
    : ""}
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

// ---------- דף נחיתה למבקר חדש ----------

export function welcomeLanding(ctx, { shows, google }, opts) {
  const join = (next) => `/login?next=${encodeURIComponent(next)}`;
  const faq = [
    ["צריך הרבה עוקבים?", "לא. מספיק שיש לך חברים, קבוצת וואטסאפ או קהילה שאוהבת מוזיקה. אנשים קונים כי מישהו שהם סומכים עליו המליץ."],
    ["כמה זה עולה לי כג׳וקר?", "כלום. אין דמי הצטרפות, אין יעדים ואין התחייבות. מקבלים כסף רק כשמישהו קונה כרטיס דרך הלינק שלך."],
    ["מתי מקבלים את הכסף?", "הסכום ממתין עד כמה ימים אחרי ההופעה (למקרה של ביטול או החזר), ואז הוא זמין. מבקשים העברה לביט או לחשבון הבנק מ-₪50."],
    ["כמה זה עולה לאמן?", "האמן קובע כמה לתת על כל כרטיס, ומשלם רק על כרטיסים שנמכרו בפועל דרך ג׳וקרים. על כל השאר אין עמלה."],
    ["החברים שלי יודעים שאני מרוויח?", "כן. ההודעה המוכנה כוללת גילוי נאות, ודף ההופעה מציין שמי שהמליץ מקבל עמלה. זה הוגן, וזה גם עובד."],
    ["זה שיווק רשתי?", "לא, ולעולם לא יהיה. מרוויחים רק ממכירת כרטיסים, אף פעם לא מגיוס אנשים."],
    ["מה אם ההופעה מתבטלת?", "הקונים מקבלים החזר ממערכת הכרטוס, והתגמול על אותם כרטיסים מתבטל. הכל מופיע במסך \"הכסף שלי\"."],
  ];
  return layout(
    ctx,
    "",
    html`
<section class="lp-hero">
  <p class="eyebrow" dir="ltr" lang="en">JoCares. · Be Jo.</p>
  <h1 class="display">אמנות<br>צריכה קהל.</h1>
  <p class="lead">JoCares מחברת בין אמנים לאנשים שאוהבים אותם. משתפים הופעה עם החברים, ומרוויחים מכל כרטיס שנמכר בזכותכם.</p>
  <div class="lp-ctas">
    <a class="btn big acid" href="/shows"><span lang="en" dir="ltr">Be Jo.</span> אני רוצה להצטרף</a>
    <a class="btn big ghost" href="${join("/grow")}">אני אמן/ית או מקום</a>
  </div>
  <p class="note">כבר יש לך חשבון? <a href="${join("/shows")}">כניסה</a>${google ? " · אפשר גם עם Google" : ""}</p>
</section>

<section class="lp-section">
  <h2 class="lp-h">איך זה עובד</h2>
  <ol class="lp-steps">
    <li><b>01</b><h3>בוחרים הופעה</h3><p>הופעות של אמנים עצמאיים, וליד כל אחת כתוב כמה תקבלו על כל כרטיס.</p></li>
    <li><b>02</b><h3>משתפים לינק אישי</h3><p>בוואטסאפ, באינסטגרם או בקבוצה. ההודעה כבר מוכנה, ואפשר לערוך אותה.</p></li>
    <li><b>03</b><h3>מרוויחים על כל כרטיס</h3><p>כל מי שקונה דרך הלינק שלכם נספר. רואים הכל בזמן אמת.</p></li>
  </ol>
</section>

<section class="lp-section lp-split-wrap">
  <h2 class="lp-h">שקוף מההתחלה</h2>
  <p class="muted">דוגמה: כרטיס ב-<span class="num">₪80</span></p>
  <div class="split static lp-split">
    <div><span>לג׳וקר שהביא את הקונה</span><b>₪20</b></div>
    <div><span>JoCares</span><b>₪4</b></div>
    <div class="you"><span>לאמן</span><b>₪56</b></div>
  </div>
  <p class="note">האמן קובע את התגמול. הסכום מוצג על כל הופעה לפני ששיתפתם משהו.</p>
</section>

<section class="lp-section">
  <h2 class="lp-h">למי זה</h2>
  <div class="choices lp-aud">
    <a class="choice promoter" href="/shows">
      <span class="choice-tag" lang="en" dir="ltr">Be Jo.</span>
      <b>לכל מי שאכפת לו</b>
      <small>מרוויחים מהמלצה על מוזיקה שאתם אוהבים. בלי השקעה, בלי יעדים, בלי ניסיון.</small>
    </a>
    <a class="choice artist" href="${join("/grow")}">
      <span class="choice-tag">לאמנים</span>
      <b>קהל חדש, ומשלמים על תוצאות</b>
      <small>מפרסמים הופעה, קובעים תגמול לכרטיס, ומקבלים מחלקת שיווק של אנשים שאוהבים אתכם. אפשר גם להזמין תוכן מיוצרים.</small>
    </a>
    <a class="choice creator-choice" href="${join("/creator")}">
      <span class="choice-tag">ליוצרים</span>
      <b>מרוויחים מיצירת תוכן</b>
      <small>ריל, סקירה, צילום בהופעה או פרסום בערוץ שלכם. מחיר שאתם קובעים, ותשלום שמובטח מראש.</small>
    </a>
  </div>
</section>

${shows.length
  ? html`<section class="lp-section">
      <div class="row-head"><h2 class="lp-h">קורה עכשיו</h2><a href="/shows">לכל ההופעות ←</a></div>
      <div class="grid-shows">${shows.map((c) => showCard(ctx, c))}</div>
    </section>`
  : ""}

<section class="lp-section">
  <h2 class="lp-h">שאלות</h2>
  <div class="faq">${faq.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div>
</section>

<section class="lp-final">
  <p class="lp-final-big" lang="en" dir="ltr">Who cares?<br>Jo cares.</p>
  <a class="btn big" href="/shows">מצטרפים עכשיו</a>
</section>`,
    opts
  );
}

export function pilotPage(ctx, { next }, opts) {
  return layout(
    ctx,
    "פיילוט סגור",
    html`
<section class="narrow card">
  <p class="eyebrow">פיילוט סגור</p>
  <h1>כמעט בפנים</h1>
  <p class="muted">JoCares נמצאת כרגע בפיילוט עם קבוצה קטנה של אמנים וג׳וקרים. הכניסו את קוד הגישה שקיבלתם.</p>
  <form method="post" action="/pilot" class="stack">
    ${csrfField(ctx)}<input type="hidden" name="next" value="${next}">
    <label class="field">קוד גישה<input name="code" required autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr" autofocus></label>
    <button class="btn big block">המשך</button>
  </form>
  <p class="center note"><a href="/">מה זה JoCares?</a></p>
</section>`,
    opts
  );
}

// ---------- מסלול הקופונים: מעבר לקופה של האמן עם הקוד ----------

export function couponHandoff(ctx, { c, code, referrer }, opts) {
  return layout(
    ctx,
    "לקופה",
    html`
<section class="narrow center handoff">
  <p class="eyebrow">${c.artist_name} · ${c.title}</p>
  <h1>עוד רגע בקופה</h1>
  <p class="lead">בקופה מדביקים את הקוד של ${referrer}. ככה ${referrer} מקבל/ת על ההמלצה, בלי עלות נוספת לכם.</p>
  <p><span class="code-big" id="coupon">${code}</span></p>
  <a class="btn big block" href="${c.source_url}" rel="noopener" data-copy-then-go="${code}">העתקת הקוד והמשך לקנייה</a>
  <p class="note">הקוד מועתק אוטומטית כשממשיכים. אם לא, אפשר להקליד אותו.</p>
</section>`,
    opts
  );
}

export { raw };
