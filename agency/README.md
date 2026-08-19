# Merhav Media Group — חברת מדיה אוטונומית מבוססת סוכנים

חברה שלמה שמורכבת מ‑18 סוכנים ב‑10 מחלקות. הם בונים משפיענים מבוססי AI,
מייצרים להם תוכן, מפרסמים אותו, מנהלים את הקהילה, גובים כסף, ומקצים מחדש את
התקציב של מחר לפי מה שבאמת החזיר היום. הכל רץ מקצה לקצה בלי מפתח API אחד.

```bash
python3 -m agency org                 # מי עובד כאן ואיך זה מחווט
python3 -m agency run --days 30 --fresh -v
python3 -m agency personas            # הרוסטר
python3 -m agency decisions           # כל החלטה עסקית + הנימוק שלה
python3 -m agency audit               # מבחן חדירה לשער הציות
python3 -m agency report              # לוח בקרה HTML
python3 -m unittest discover -s agency/tests -t .
```

דרישות: Python 3.11+ בלבד. אין תלויות חיצוניות.

## איך זה בנוי

```
agency/
  core/         orchestrator, agent base, ledger, policy, store, routing, bus
  agents/       18 הסוכנים, מקובצים לפי מחלקה
  providers/    llm · image · video · voice · social · payments  (live + offline)
  sim/          מודל השוק שהסוכנים לומדים מולו כשאין API אמיתי
  report/       לוח הבקרה + סט הבדיקות של שער הציות
  tests/        24 בדיקות
  config/       company.toml
```

**המסלול של יום עבודה** — שלד קבוע (`DAY_PLAN` ב‑`core/orchestrator.py`),
וכל השאר נוצר בזמן ריצה: סוכן מחזיר `Result(emit=[Task(...)])`, והתזמורת
מנתבת כל משימה לסוכן שמצהיר שהוא מטפל בסוג הזה, לפי `stage`.

```
day.open → finance.open_day → analytics.collect → analytics.report → exec.review
   ↳ research.scan → talent.create_persona
   ↳ content.plan → content.write → art.prompt → prod.image → prod.video
                  → copy.write → compliance.review → dist.publish
growth.experiment → growth.amplify → community.engage → revenue.funnel
   → revenue.deals → finance.close_day → ops.close
```

**המחלקות**

| מחלקה | סוכן | מה הוא באמת מחליט |
|---|---|---|
| Executive | CEO | פותח נישה, משיק/עוצר פרסונה, קובע את תקציב מחר ואת נתח ההגברה |
| Finance | CFO | תקרת הוצאה יומית קשיחה, סגירת ספרים, אזהרת מזומן |
| Research | Market Research | מדרג נישות: ביקוש · CPM · תחרות · נכונות לשלם − סיכון |
| Talent | Persona Architect | מייצר את המשפיען ואת **נעילת הזהות** (seed + משפט מראה קבוע) |
| Creative | Strategist · Writer · Art Director · Copywriter | לוח תוכן, תסריט, פרומפט רינדור, קופי לכל פלטפורמה בנפרד |
| Production | Image Studio · Video Studio | רינדור, קריינות, עריכה |
| Compliance | Compliance Officer | השער — פר יעד פרסום, לא פר פריט |
| Distribution | Publisher | הסוכן היחיד שמדבר עם פלטפורמה; אוכף מכסות וניתוב |
| Growth | Growth Lead · Community Manager | A/B מתמשך, הגברה בתשלום, מענה לתגובות |
| Revenue | Monetization · Brand Partnerships | מנויים, PPV, אפיליאייט, תמחור דינמי, עסקאות מותג |
| Analytics | Head of Analytics | KPI: ROAS, עלות לאלף צפיות, עלות לעוקב |
| Operations | Head of Operations | בריאות המערכת, שגיאות, פתיחה וסגירה של היום |

## למה זה לא רק סימולציה

כל ספק הוא אדפטר מתחלף. אם המפתח קיים — הסוכנים עובדים מול השירות האמיתי;
אם לא — נופלים לגרסה דטרמיניסטית. זה מה שמאפשר גם להריץ הכל מיד וגם לעבור
לייב פלטפורמה־פלטפורמה בלי לגעת בלוגיקה של אף סוכן.

| שכבה | לייב | מפתח |
|---|---|---|
| LLM | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| תמונות | **eromify.com** / כל endpoint בסגנון OpenAI-Replicate | `EROMIFY_API_KEY` / `IMAGE_API_KEY` |
| וידאו | ffmpeg (רינדור אנכי אמיתי) | — |
| קול | ElevenLabs | `ELEVENLABS_API_KEY` |
| הפצה | Instagram Graph · TikTok · X · YouTube · Reddit · Fanvue | טוקן לכל פלטפורמה |
| תשלומים | Stripe | `STRIPE_API_KEY` |

`agency/.env.example` מכיל את הרשימה המלאה. החלפת ספק = שורה אחת ב‑`config/company.toml`.

## שער הציות

ארבעה כללים שלא ניתן לכבות מקובץ קונפיג (`core/policy.py`):

1. **בלי דמות של אדם אמיתי** — שמות ידוענים, "נראית כמו…", deepfake, face-swap,
   undress/nudify: חסום בכל מצב, גם כשה‑tier למבוגרים דלוק.
2. **בלי שום תיאור שמרמז על קטין** — כולל גיל מספרי מתחת ל‑18 וכל ניסוח
   בית‑ספרי. חסום מוחלט.
3. **tier למבוגרים** דורש גם `policy.allow_adult_tier` בקונפיג וגם
   `AGENCY_ADULT_TIER=1` בסביבה, ומגיע **רק** ליעדים עם אימות גיל. פרסונה
   בטייר הזה לא תפורסם באינסטגרם/טיקטוק גם אם כל שאר השכבות ישברו — הבדיקה
   חוזרת בניתוב, בציות ובפרסום עצמו.
4. **תווית גילוי** (`AI-generated character. Not a real person.`) נוספת לכל
   פריט שמתפרסם.

`python3 -m agency audit` מריץ 12 מקרי חדירה מול המנוע החי ומדפיס טבלת
pass/fail. אותו סט רץ גם כבדיקה ב‑CI. הוא כבר תפס באג אמיתי בפיתוח: ניסוח
נועז ב‑tier כבוי "הורד דרגה" במקום להיחסם — היום זה חסום, והארט־דירקטור
מנסח מחדש פעם אחת במקום לאבד את הסלוט.

## המודל הכלכלי

הכנסות: מנויים (חיוב חודשי שנרשם כפרוסה יומית), PPV ביעדים עם אימות גיל,
אפיליאייט לפי קליקים יוצאים, ועסקאות מותג שנכנסות מעל ~15K עוקבים.
עלויות: רינדור תמונה/וידאו/קול, טוקנים של המודל, מענה לקהילה, הגברה בתשלום,
והקמת פרסונה. כל עלות נרשמת על הפרסונה שגרמה לה, ולכן ה‑CEO רואה יוניט
אקונומיקס אמיתי ולא ממוצע חברה.

הלולאה שסוגרת את הכל: תוצאות אתמול → KPI → החלטת CEO (הרחבה / עצירה / נישה
חדשה / נתח הגברה) → תקציב מחר. פרסונה שלא החזירה את עלותה תוך 14 יום נעצרת.

**מה מדומה ומה לא:** הקוד, הסוכנים, הניתוב, הציות, הספרים והמזומן — אמיתיים.
תגובת הקהל (צפיות → עוקבים → קליקים → מנויים, כולל דעיכה ונטישה) מגיעה
מ‑`sim/world.py` כל עוד אין טוקנים אמיתיים. זה מודל משוב, לא תחזית: המספרים
בלוח הבקרה מראים שהמערכת עובדת, לא כמה כסף תרוויחו.

## כסף אמיתי מול כסף מודל

בטבלת `revenue` יש עמודה אחת שחשובה יותר מכולן: `source`.

* `real` — כסף שבאמת נחת: קבלות שהתיישבו אצל ספק תשלומים
  (`payments.fetch_receipts`), או דוח תשלומים שיובא ידנית.
* `modelled` — מה שסימולטור השוק ייצר.

**הם אף פעם לא מסוכמים לאותו מספר.** `status`, `run` ולוח הבקרה מציגים כל אחד
בנפרד, ובלוח מופיע באנר מפורש כל עוד `real == 0`. במצב `--live` שום מודל
המרה לא רץ בכלל — נרשם רק מה שספק התשלומים דיווח שהתיישב.

```bash
python3 -m agency golive                          # מה עוד חוסם דולר אמיתי
python3 -m agency run --days 1 --live --dry-run -v # מה בדיוק היה נשלח, בלי לשלוח
python3 -m agency funnel                          # דף לינק-בביו לכל פרסונה
python3 -m agency revenue payouts.csv             # להכניס כסף שבאמת התקבל לספרים
```

`run --live` מסרב לרוץ כש‑`providers.social` הוא `mock` — הרצה כזו הייתה
"מפרסמת" ליעדים מדומים ורושמת מספרים שלא קרו.

תבנית ה‑CSV: `agency/config/revenue-template.csv`
(`day,persona_id,stream,amount,note,external_id`). `external_id` מונע ספירה
כפולה כשמייבאים את אותו דוח פעמיים.

## מעבר ללייב

1. `python3 -m agency golive` — מדפיס בדיוק מה חסר, ומסמן `[you]` על מה
   שרק בן אדם עם זהות יכול לעשות (חשבון פלטפורמה, KYC של ספק תשלומים).
2. למלא מפתחות ב‑`.env` ולהחליף `providers.*` ב‑`company.toml`.
3. `python3 -m agency audit` — חייב 12/12.
4. `python3 -m agency funnel` אחרי שיש `SUBSCRIBE_URL` / `AFFILIATE_URL` /
   `NEWSLETTER_ACTION` — בלי יעד להמרה, קליקים לא שווים כלום.
5. להתחיל מפלטפורמה אחת (`distribution.sfw = ["tiktok"]`), קודם `--dry-run`
   ואז יום אחד אמיתי: `python3 -m agency run --days 1 --live -v`.
6. לוודא מול תנאי השימוש של כל פלטפורמה: חשבון אוטומטי, גילוי תוכן AI,
   ותוכן למבוגרים מותר רק היכן שהוא באמת מותר.
