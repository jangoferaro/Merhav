// Ticketing Integration Layer.
// כל ספק כרטוס הוא מתאם עם אותו ממשק:
//   name                               מזהה הספק
//   registerEvent(db, {title, price})  → מזהה ההופעה אצל הספק
//   checkoutUrl(campaign, ref)         → לאן לשלוח את הרוכש (ref חוזר אלינו ב-webhook)
//   verifyWebhook(rawBody, headers)    → אירוע מאומת { id, type, data } או זריקת שגיאה
// כרגע יש רק ספק Sandbox. ספק אמיתי (מסלול A ב-PRD) מתווסף כאן בלי לגעת בשאר המערכת.
import { simProvider } from "./sim.js";
import { couponProvider } from "./coupon.js";

const providers = { sim: simProvider, coupon: couponProvider };

export function provider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown ticketing provider: ${name}`);
  return p;
}
