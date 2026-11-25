// מדריך סגנון חי: /design. מציג את הטוקנים והרכיבים האמיתיים מאותו CSS, כך שאי אפשר שיתיישן.
import { empty, html, imageInput, layout, money, poster, stamp, stat, statusBadge } from "./kit.js";
import { orderBadge, avatar } from "./content.js";
import { TREATMENTS } from "./kit.js";
import { demoImage, DEMO_STYLES } from "../demo-images.js";

// תמונות הדגמה קטנות למדריך (נוצרות פעם אחת)
let demo;
const demoSrc = (i) => (demo ??= DEMO_STYLES.map((st, k) => `data:image/png;base64,${demoImage(101 + k, st, 480, 360).toString("base64")}`))[i % DEMO_STYLES.length];

const SWATCHES = [
  ["--jo-ink", "Ink Black", "#151515", "#EDECE4"],
  ["--jo-paper", "Paper White", "#EDECE4", "#151515"],
  ["--jo-acid", "Joker Acid", "#DFFF45", "#151515"],
  ["--jo-red", "Rebel Red", "#FF493D", "#151515"],
];

const sample = (artist_name, title, i = 0) => ({ artist_name, title, image_url: demoSrc(i) });

export function designPage(ctx, opts) {
  return layout(
    ctx,
    "שפה עיצובית",
    html`
<section class="hero">
  <p class="eyebrow">JoCares. · שפה עיצובית · גרסה 2</p>
  <h1 class="display" dir="ltr" lang="en" style="text-align:right">Be Jo.</h1>
  <p class="lead">מותג תרבות עצמאי, אנושי, נועז ומינימליסטי. הממשק נקי ושקט, הצילום בשחור לבן, והחומצה מסמנת את מה שחשוב.</p>
  <p class="meta" dir="ltr" lang="en" style="text-align:right">Who cares? Jo cares. Because art deserves an audience.</p>
</section>

<section class="ds-section">
  <h2>עקרונות</h2>
  <ol class="principles">
    <li><div><b>נייר, דיו, חומצה</b><span>הממשק על נייר חם בדיו שחורה. Joker Acid מסמן את מה שהכי חשוב, Rebel Red הוא מבטא. בלי גרדיאנטים ובלי צללים מטושטשים.</span></div></li>
    <li><div><b>שלושה קולות</b><span>כותרות חזקות וצפופות (Space Grotesk ללטינית, Heebo לעברית), טקסט פשוט ב-Assistant, ומספרים ב-IBM Plex Mono, כמו על כרטיס.</span></div></li>
    <li><div><b>פינות ישרות, עיגול אחד</b><span>כל קופסה, כפתור, שדה ותמונה בפינות של 0. העיגול שמור למה שהכי חשוב: הסכום שמרוויחים, נקודת סטטוס, אווטאר.</span></div></li>
    <li><div><b>קווי שיער במקום קופסאות</b><span>היררכיה בעזרת קו מבני שחור וקו שיער אפור, לא צללים ולא רקעים. רשימות הן שורות על קווים.</span></div></li>
    <li><div><b>תמיד יש תמונה, בשחור לבן</b><span>צילום אמנים וקהל בשחור לבן. הצבע מגיע רק מהטיפול: קווי בנייה, מסגרת חומצה או אדום, או פס עם שם האמן.</span></div></li>
    <li><div><b>בלי אימוג'ים</b><span>אייקונים בקו דק אחד (1.25px) בצבע הטקסט, או מילה במקומם.</span></div></li>
  </ol>
</section>

<section class="ds-section">
  <h2>צבע <span>ארבעה צבעים, זהו</span></h2>
  <div class="swatches">
    ${SWATCHES.map(([v, name, hex, on]) => html`<div class="swatch" style="background:var(${v});color:${on}${v === "--jo-paper" ? ";box-shadow:inset 0 0 0 1px #151515" : ""}"><b>${name}</b><code dir="ltr">${v}</code><code dir="ltr">${hex}</code></div>`)}
  </div>
  <p class="note">דיו על נייר לכל הטקסט. חומצה היא הדגשה: חותמת הסכום, סימון כסף, פעולה ראשית לקהל. אדום הוא מבטא (סמל הג׳וקר, התראות, מסגרות) ולא טקסט קטן; לטקסט שגיאה יש אדום כהה (‎--bad). דיו על חומצה 16:1, דיו על אדום 5.3:1.</p>
</section>

<section class="ds-section">
  <h2>סמל ופוסטרים <span>מערכת המותג</span></h2>
  <p class="muted">הג׳וקר הוא הקלף החסר: האדם שעוזר לאמן להגיע לקהל. אין קשר להימורים, ואין צורך במטאפורות קלפים בכל מסך.
  הפוסטרים משמשים לקמפיינים מחוץ למוצר (רשתות, הדפסה). בתוך המוצר השפה שקטה.</p>
  <div class="ds-row" style="align-items:flex-end;gap:24px">
    <img src="/static/joker.svg" alt="סמל הג׳וקר" width="96" height="96" class="ds-mark">
    ${["poster-be-jo", "poster-manifesto", "poster-missing-card"].map((f) => html`<img src="/static/${f}.svg" alt="" width="216" height="270" class="ds-poster">`)}
  </div>
</section>

<section class="ds-section">
  <h2>טיפוגרפיה <span>Space Grotesk + Heebo לכותרות · Assistant לטקסט · IBM Plex Mono למספרים</span></h2>
  <div class="typescale">
    <p class="display" dir="ltr" style="text-align:right"><small>display · Space Grotesk 700</small>Art deserves an audience.</p>
    <p class="display"><small>display · Heebo 900</small>אמנות צריכה קהל.</p>
    <h1><small>h1 · Heebo 800</small>שתף והרוויח</h1>
    <p class="price"><small>מספרים · IBM Plex Mono</small>₪1,240 · 24 כרטיסים</p>
    <h2><small>h2 · 700</small>הזמנות פתוחות</h2>
    <p class="lead"><small>lead · Assistant 400</small>בוחרים הופעה, משתפים, ומקבלים על כל כרטיס.</p>
    <p><small>body · Assistant 400</small>הכסף ממתין לאישור עד שלושה ימים אחרי ההופעה, ואז עובר לזמין.</p>
    <p class="meta"><small>meta · Assistant 400</small>יום ה׳, 3 בדצמבר · הבארבי, תל אביב</p>
  </div>
</section>

<section class="ds-section">
  <h2>תמונה וטיפול <span>לכל הופעה יש תמונה. העיצוב עוטף אותה</span></h2>
  <p class="muted">אין הופעה ואין יוצר בלי תמונה: מעלים מהטלפון, או שהתמונה נמשכת מעמוד ההופעה. כל תמונה מקבלת טיפול אחד מתוך שלושה, לפי השם, כך שאותה הופעה נראית תמיד אותו דבר, והמרקטפלייס נראה כמו קיר פוסטרים.</p>
  <div class="ds-grid">
    ${TREATMENTS.map((t, i) => html`<figure class="ds-fig"><a class="show-link" href="#" aria-label="דוגמה">${poster(sample(["נועה ברק", "הקרוואן", "DJ Lila"][i], "הופעה", i + 1), "", t)}${i === 0 ? stamp("₪20", "לכל כרטיס") : ""}</a><figcaption>${{ lines: "קווי בנייה", frame: "מסגרת צבע", band: "פס עם שם האמן" }[t]}</figcaption></figure>`)}
  </div>
  <h3 style="margin-top:24px">העלאת תמונה</h3>
  <div style="max-width:420px">${imageInput({ current: demoSrc(4) })}</div>
  <h3 style="margin-top:24px">יוצרים</h3>
  <div class="ds-row">${[0, 1, 2, 3].map((i) => avatar({ image_url: demoSrc(i), display_name: "x" }, "big"))}</div>
</section>

<section class="ds-section">
  <h2>חותמת <span>העיגול היחיד במערכת</span></h2>
  <div class="ds-row">${stamp("₪20", "לכל כרטיס")} ${stamp("₪180", "בשבילך")} <span class="stamp hero-stamp" style="position:static" lang="en" dir="ltr"><b>Be Jo.</b></span></div>
</section>

<section class="ds-section">
  <h2>כפתורים ושדות</h2>
  <div class="ds-row"><button class="btn">פעולה ראשית</button><button class="btn ghost">משנית</button><button class="btn danger">ביטול</button><button class="btn small">קטן</button></div>
  <div class="stack" style="margin-top:20px;max-width:420px">
    <label class="field">שדה טקסט<input placeholder="https://"></label>
    <fieldset class="seg"><legend class="field">בחירה</legend><label><input type="radio" name="x" checked> ביט</label><label><input type="radio" name="x"> בנק</label></fieldset>
    <label class="check"><input type="checkbox" checked> תיבת סימון</label>
  </div>
</section>

<section class="ds-section">
  <h2>נתונים</h2>
  <div class="stats">${stat(12, "כרטיסים דרך מקדמים")}${stat(money(71200), "הכנסה שנוצרה")}${stat(4, "קנו לראשונה")}</div>
  <div class="money-buckets">
    <div class="bucket pending"><span>ממתין לאישור</span><b>₪195</b><small>מתפנה 3 ימים אחרי ההופעה</small></div>
    <div class="bucket available"><span>זמין לתשלום</span><b>₪60</b><small>אפשר לבקש מ-₪50</small></div>
    <div class="bucket paid"><span>שולם</span><b>₪0</b><small>סה"כ עד היום</small></div>
  </div>
</section>

<section class="ds-section">
  <h2>סטטוס ורשימות</h2>
  <div class="ds-row">${statusBadge("active")} ${statusBadge("paused")} ${statusBadge("cancelled")} ${orderBadge("submitted")} ${orderBadge("accepted")} ${orderBadge("completed")}</div>
  <ul class="list">
    <li><div class="grow"><b>ערב אקוסטי</b><div class="meta">3 כרטיסים · 14 נכנסו</div></div><div class="end"><b class="money">₪60</b><small>ממתין</small></div></li>
    <li class="unread"><div class="grow"><b>ריל לקידום</b><div class="meta">${orderBadge("submitted")}</div></div><div class="end"><b>₪200</b></div></li>
  </ul>
  ${empty("עוד אין כאן כלום", "מצב ריק: משפט אחד שמסביר מה יקרה כאן, ופעולה אחת.", html`<a class="btn" href="#">פעולה</a>`)}
</section>

<section class="ds-section">
  <h2>טון</h2>
  <ul class="facts">
    <li>בגובה העיניים, בגוף שני רבים או בלשון כפולה (מקבל/ת).</li>
    <li>משפט אחד לכל רעיון. מספרים מדויקים במקום "הרבה".</li>
    <li>כסף תמיד עם המצב שלו: ממתין, זמין, שולם.</li>
    <li>לא מבטיחים מה שלא נמדד. "לא מאומת" כתוב במפורש.</li>
  </ul>
</section>`,
    { ...opts, wide: true }
  );
}
