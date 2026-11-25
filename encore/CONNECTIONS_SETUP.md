# הגדרת החיבורים של הג׳וקרים

הקוד מוכן לכל שישה החיבורים. כדי שיעבדו, פותחים לכל ספק "אפליקציה" בחשבון מפתחים שלו, ומכניסים את המפתחות ב-Railway (פרויקט `jocares`, שירות `web`, לשונית Variables). לא שולחים מפתחות בצ׳אט או במייל.

**כתובת החזרה (Redirect URI)** לכל ספק:
`https://web-staging-7cb1719a.up.railway.app/connect/<ספק>/callback`
כשיהיה דומיין, מוסיפים גם `https://jocares.co.il/connect/<ספק>/callback`.

כל עוד אין מפתחות, הג׳וקרים רואים "בקרוב". מנהלים רואים בפרופיל שלהם בדיוק אילו משתנים חסרים.

| ספק | איפה פותחים | מה מכניסים ל-Railway | הרשאות | עלות | מה צריך לפני שכולם יכולים להתחבר |
|---|---|---|---|---|---|
| **Spotify** | developer.spotify.com → Dashboard → Create app. Web API | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | user-top-read, user-follow-read | חינם (בעל האפליקציה צריך Premium) | במצב פיתוח עד 5 משתמשים שמוסיפים ידנית. הרחבה דורשת עסק רשום ו-250 אלף משתמשים פעילים בחודש. בפועל: לפיילוט בלבד, עד שנגדל |
| **Apple Music** | developer.apple.com → Certificates, IDs & Profiles → Keys → מפתח עם MusicKit. גם Media ID | `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` (תוכן קובץ ה-.p8) | ספרייה והאזנות אחרונות | 99$ לשנה (Apple Developer Program) | אין אישור נפרד. המשתמש צריך מנוי Apple Music |
| **Instagram** | developers.facebook.com → אפליקציה מסוג Business → מוצר "Instagram API with Instagram Login" | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` (ה-Instagram App ID וה-Secret) | instagram_business_basic | חינם | App Review של Meta. רק חשבונות מקצועיים (עסקי או יוצר) |
| **TikTok** | developers.tiktok.com → Manage apps → Login Kit (Web) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | user.info.basic, user.info.profile, user.info.stats | חינם | אישור אפליקציה של TikTok. בלי user.info.stats אין מספר עוקבים |
| **YouTube** | console.cloud.google.com → אותו פרויקט של הכניסה עם גוגל → להפעיל YouTube Data API v3 → להוסיף את כתובת החזרה ל-OAuth client | (משתמש ב-`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` הקיימים) | youtube.readonly | חינם | אימות אפליקציה של Google (הרשאה רגישה). עד אז עד 100 משתמשי בדיקה |
| **Facebook** | developers.facebook.com → אפליקציה מסוג Business → Facebook Login for Business | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | pages_show_list, pages_read_engagement | חינם | App Review של Meta. רק עמודים (Pages) שהמשתמש מנהל |

## מה נשמר ומה לא
- **נשמר:** אסימונים מוצפנים (רק בשרת), שם החשבון, מספרי עוקבים עם מקור ותאריך, ואמנים וסגנונות מוזיקה.
- **לא נשמר:** סיסמאות, אנשי קשר, הודעות והיסטוריית האזנה גולמית. אמנים לא רואים את ההאזנות.
- **ניתוק מוחק** את האסימונים ואת כל מה שסונכרן. ביומן נשאר רק שהיה חיבור.
- **הסנכרון רץ פעם ביום.** אחרי 5 כשלונות ברצף הוא נעצר עד שהמשתמש לוחץ "נסו שוב". כשל של ספק לא חוסם שום דבר אחר במערכת.

## לפני הגשה לאישור (Meta, TikTok, Google)
הספקים יבקשו מדיניות פרטיות ותנאי שימוש בכתובת קבועה (יש: `/terms`), סרטון שמראה את תהליך החיבור, והסבר למה כל הרשאה נחוצה. ההסבר לכל ההרשאות: "מציגים לג׳וקר ולאמנים שהוא בוחר מספר עוקבים מאומת, כדי להתאים בין אמנים לג׳וקרים שמקדמים הופעות. לא מפרסמים בשם המשתמש".

## כרטיסים ב-Wallet

| ספק | איפה | מה מכניסים ל-Railway | עלות |
|---|---|---|---|
| **Apple Wallet** | developer.apple.com → Identifiers → Pass Type IDs → יוצרים מזהה (למשל pass.com.jocares.ticket) → Create Certificate. מורידים גם את תעודת הביניים של Apple (WWDR G4) | `APPLE_PASS_TYPE_ID`, `APPLE_PASS_TEAM_ID`, `APPLE_PASS_CERT` ו-`APPLE_PASS_KEY` (התעודה והמפתח ב-PEM), `APPLE_WWDR_CERT` (PEM), ואם יש סיסמה למפתח: `APPLE_PASS_KEY_PASSWORD` | כלול במנוי Apple Developer (99$ לשנה), אותו מנוי של Apple Music |
| **Google Wallet** | pay.google.com/business/console → Google Wallet API → חשבון מנפיק (Issuer). ב-Google Cloud: חשבון שירות עם הרשאה ל-Wallet API, ומפתח JSON | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_EMAIL`, `GOOGLE_WALLET_SA_KEY` (ה-private_key מקובץ ה-JSON) | חינם. לפני שימוש ציבורי Google מאשרת את חשבון המנפיק |

את התעודה של Apple ממירים ל-PEM מקובץ ה-.p12 שמורידים:
`openssl pkcs12 -in pass.p12 -clcerts -nokeys -out cert.pem` וגם `openssl pkcs12 -in pass.p12 -nocerts -nodes -out key.pem`
