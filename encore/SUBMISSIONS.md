# הגשת האפליקציה לאישור: Meta, TikTok, Google

החומר מוכן להעתקה. הוא באנגלית, כי בודקים באנגלית. את ההגשה עצמה עושים מהחשבון שלכם אצל כל ספק.

## פרטים קבועים לכל ההגשות
| שדה | ערך |
|---|---|
| App name | JoCares |
| Website | https://web-staging-7cb1719a.up.railway.app (להחליף בדומיין כשיהיה) |
| Privacy policy / Terms | https://web-staging-7cb1719a.up.railway.app/terms |
| Data deletion instructions | https://web-staging-7cb1719a.up.railway.app/data-deletion |
| Category | Entertainment / Music |
| App icon | `public/joker.svg` (לייצא ל-PNG בגודל 1024×1024) |

**גישה לבודקים** (להדביק ב-"Instructions for reviewers", ולהשלים את סיסמת הפיילוט ממסמך הגישות. הסיסמה לא נשמרת בקוד):
> The site is a private pilot. Password: <PILOT PASSWORD>. Sign in with any email address: the one-time login code is shown on screen in this test environment. Then open "My profile" → "Connections" and press "Connect" next to the provider.

אחרי שהאתר יעבור לדומיין ולמיילים אמיתיים, נפתח משתמש בדיקה קבוע ונעדכן.

## תיאור האפליקציה (לכולם)
> JoCares is a ticketing platform for live music in Israel and the US. Fans ("Jokers") share personal links to shows and earn a fixed reward per ticket sold through them. Jokers can optionally connect their music and social accounts so that artists can find Jokers whose taste matches their music, and see a verified follower count instead of a self-reported number. We never post on the user's behalf, never access contacts or messages, and users can disconnect at any time, which deletes all synced data.

## Meta: Instagram (instagram_business_basic)
**Use case:** Instagram API with Instagram Login.
**Why we need it:**
> We read the connected professional account's username, follower count and media count. We show the follower count on the user's own profile and, only if the user chooses, on their public Joker card and to artists inviting them to promote a show. This replaces a self-reported number with a verified one. We refresh it once a day and keep a dated history so the user can see real growth. Nothing is posted, and no other user's data is accessed.

## Meta: Facebook (pages_show_list, pages_read_engagement)
> We list the Pages the user manages and read each Page's name, link and follower count. We use the Page with the most followers as the user's verified reach on their own profile and, if they choose, on their public card. We never post to the Page and do not read Page messages or insights.

**Business Verification:** ייתכן ש-Meta תבקש אימות עסק (מסמכי החברה). עדיף להגיש אחרי שהחברה רשומה.

## TikTok (user.info.basic, user.info.profile, user.info.stats)
> Login Kit for Web. We read the user's display name, username, profile link, follower count, likes count and video count. The follower count is shown as verified reach on the user's JoCares profile and, if they choose, on their public card and to artists. We do not post, upload or read videos or messages.

## Google: YouTube (youtube.readonly)
**OAuth consent screen → Scopes justification:**
> We call channels.list (mine=true) to read the user's channel title, URL, subscriber count and video count. We show the subscriber count as verified reach on the user's JoCares profile and, if they choose, on their public card and to artists. We never modify the channel or read private videos, comments or analytics.

**דרישה של Google:** סרטון שמראה את מסך ההסכמה ואת השימוש בנתונים, ואימות בעלות על הדומיין ב-Search Console. גם כאן עדיף להגיש אחרי שיש דומיין.

## סרטון הדגמה (Meta ו-TikTok דורשים, Google מבקשת)
עד 2 דקות, הקלטת מסך מהטלפון:
1. כניסה ל-JoCares → "הפרופיל שלי".
2. גלילה ל"חיבורים" → לחיצה על "חיבור" ליד הספק.
3. מסך ההרשאה של הספק → אישור.
4. חזרה לפרופיל: "מחובר", המספר המאומת עם התווית "מאומת".
5. "הקלף שלך" → בחירה אם להציג את העוקבים → פרסום → פתיחת הקלף.
6. חזרה ל"חיבורים" → "ניתוק" → הנתון נעלם.

## Spotify ו-Apple Music
- **Spotify:** אין הגשה כרגע. במצב פיתוח מוסיפים ידנית עד 5 משתמשים בדשבורד (User Management). אישור רחב דורש 250 אלף משתמשים פעילים בחודש.
- **Apple Music:** אין הגשה. צריך מנוי Apple Developer ומפתח MusicKit (ראו `CONNECTIONS_SETUP.md`).

## סדר מומלץ
1. **YouTube:** אפשר להתחיל מיד, במצב בדיקה (עד 100 משתמשים). את האימות של Google מגישים אחרי שיש דומיין.
2. **Instagram ו-Facebook:** אפליקציה אחת ב-Meta. אפשר לפתוח ולבדוק עם חשבונות בדיקה כבר עכשיו, ולהגיש לאישור אחרי רישום החברה.
3. **TikTok:** אפשר להגיש כבר עכשיו.
