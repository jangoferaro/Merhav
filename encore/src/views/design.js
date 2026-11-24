// מדריך סגנון חי: /design. מציג את הטוקנים והרכיבים האמיתיים מאותו CSS, כך שאי אפשר שיתיישן.
import { empty, html, layout, money, poster, stamp, stat, statusBadge } from "./kit.js";
import { orderBadge, avatar } from "./content.js";
import { LAYOUTS } from "./art.js";

const SWATCHES = [
  ["--paper", "נייר", "#ffffff", "#111"],
  ["--ink", "דיו", "#111111", "#fff"],
  ["--c0", "כתום", "#ff4d00", "#111"],
  ["--c1", "ורוד", "#ffb3d1", "#111"],
  ["--c2", "ירוק", "#007a37", "#fff"],
  ["--c3", "סגול", "#6e4cff", "#fff"],
  ["--c4", "כחול", "#0034d1", "#fff"],
  ["--c5", "צהוב", "#ffc400", "#111"],
];

const sample = (artist_name, title) => ({ artist_name, title, image_url: "" });

export function designPage(ctx, opts) {
  return layout(
    ctx,
    "שפה עיצובית",
    html`
<section class="hero">
  <p class="eyebrow">שפה עיצובית · גרסה 1</p>
  <h1 class="display">דף שקט.<br>צבע רועש.</h1>
  <p class="lead">הקהל, האמנים והיוצרים מביאים את הצבע. הממשק נשאר לבן, ישר ונקי, כדי שהם יבלטו.</p>
</section>

<section class="ds-section">
  <h2>עקרונות</h2>
  <ol class="principles">
    <li><div><b>הדף לבן, הצבע בפוסטר</b><span>הממשק עצמו שחור-לבן. צבע מופיע רק בפוסטרים, בחותמות ובבלוקים גדולים, ותמיד שטוח, בלי גרדיאנטים.</span></div></li>
    <li><div><b>שני גופנים, שני תפקידים</b><span>Heebo לכותרות (900, צפוף וענק) ולמספרים גדולים (300). IBM Plex Sans Hebrew פשוט וגנרי לכל טקסט התוכן.</span></div></li>
    <li><div><b>פינות ישרות, עיגול אחד</b><span>כל קופסה, כפתור, שדה ותמונה בפינות של 0. העיגול שמור למה שהכי חשוב: הסכום שמרוויחים, נקודת סטטוס, אווטאר.</span></div></li>
    <li><div><b>קווי שיער במקום קופסאות</b><span>היררכיה בעזרת קו מבני שחור וקו שיער אפור, לא צללים ולא רקעים. רשימות הן שורות על קווים.</span></div></li>
    <li><div><b>הגרפיקה מגיעה מעולם הפוסטר</b><span>אות ענקית מוטה, אלפבית צבעוני על שחור, קרני שמש, קשת, פיקסל-ארט, פסים עם מדבקת כוכב, שחמט, ומילה ענקית עם קווי בנייה. בהשראת העבודות של Under ושל הדר לוזון.</span></div></li>
    <li><div><b>בלי אימוג'ים</b><span>אייקונים בקו דק אחד (1.25px) בצבע הטקסט, או מילה במקומם.</span></div></li>
  </ol>
</section>

<section class="ds-section">
  <h2>צבע <span>6 צבעי פלטה + נייר ודיו</span></h2>
  <div class="swatches">
    ${SWATCHES.map(([v, name, hex, on]) => html`<div class="swatch" style="background:var(${v});color:${on}${v === "--paper" ? ";box-shadow:inset 0 0 0 1px #111" : ""}"><b>${name}</b><code dir="ltr">${v}</code><code dir="ltr">${hex}</code></div>`)}
  </div>
  <p class="note">טקסט על צבע רק בזוגות שנבדקו (AA): דיו על כתום, ורוד וצהוב; נייר על ירוק, סגול וכחול. כסף בירוק, שגיאה באדום. כתום לא משמש לטקסט קטן.</p>
</section>

<section class="ds-section">
  <h2>טיפוגרפיה <span>Heebo לכותרות ומספרים · IBM Plex Sans Hebrew לטקסט</span></h2>
  <div class="typescale">
    <p class="display"><small>display · 900 · ‎-0.045em</small>הופעה הלילה</p>
    <h1><small>h1 · 800</small>שיתוף והרווחה</h1>
    <h2><small>h2 · 700</small>הזמנות פתוחות</h2>
    <p class="lead"><small>lead · IBM Plex Sans Hebrew 400</small>בוחרים הופעה, משתפים, ומקבלים על כל כרטיס.</p>
    <p><small>body · IBM Plex Sans Hebrew 400</small>הכסף ממתין לאישור עד שלושה ימים אחרי ההופעה, ואז עובר לזמין.</p>
    <p class="meta"><small>meta · IBM Plex Sans Hebrew 400</small>יום ה׳, 3 בדצמבר · הבארבי, תל אביב</p>
  </div>
</section>

<section class="ds-section">
  <h2>סדרת פוסטרים <span>8 פריסות, נבחרות לפי שם ההופעה</span></h2>
  <p class="muted">כשאין תמונה, כל הופעה מקבלת פוסטר משלה. הפריסה, הצבעים והזווית נגזרים מהשם, כך שאותה הופעה נראית תמיד אותו דבר, והמרקטפלייס נראה כמו קיר פוסטרים ולא כמו טבלה.</p>
  <div class="ds-grid">
    ${Object.keys(LAYOUTS).map((l, i) => {
      const [a, t] = [["נועה ברק", "ערב אקוסטי"], ["הקרוואן", "השקת אלבום"], ["שקד", "ג'אם ג'אז"], ["DJ Lila", "All Night"], ["מיה", "הופעה"], ["אורי", "סיבוב"], ["תמר", "בכורה"], ["רוני", "לילה לבן"]][i];
      return html`<figure class="ds-fig"><a class="show-link" href="#" aria-label="דוגמה">${poster(sample(a, t), "", l)}${i % 3 === 0 ? stamp("₪20", "לכל כרטיס") : ""}</a><figcaption>${{ letter: "אות ענקית", alphabet: "אלפבית על שחור", sunburst: "קרני שמש", rainbow: "קשת", pixels: "יצור פיקסלים", stripes: "פסים ומדבקה", checker: "שחמט מתרחב", bigword: "מילה ענקית" }[l]}</figcaption></figure>`;
    })}
  </div>
  <h3 style="margin-top:24px">אווטארים ליוצרים</h3>
  <div class="ds-row">${[1, 2, 3, 4, 5, 6, 7, 8].map((id) => avatar({ user_id: id, display_name: "x" }, "big"))}</div>
</section>

<section class="ds-section">
  <h2>חותמת <span>העיגול היחיד במערכת</span></h2>
  <div class="ds-row">${stamp("₪20", "לכל כרטיס")} ${stamp("₪180", "בשבילך")} <span class="stamp" style="background:var(--c0)"><b>וכולם</b><small>מרוויחים</small></span></div>
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
