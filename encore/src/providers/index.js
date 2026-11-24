// Ticketing Integration Layer.
// כל ספק כרטוס הוא מתאם עם אותו ממשק:
//   name                               מזהה הספק
//   registerEvent(db, {title, price})  → מזהה ההופעה אצל הספק
//   checkoutUrl(campaign, ref)         → לאן לשלוח את הרוכש (ref חוזר אלינו ב-webhook)
//   verifyWebhook(rawBody, headers)    → אירוע מאומת { id, type, data } או זריקת שגיאה
// jocares = הקופה שלנו (ברירת המחדל). coupon = האמן מוכר במקום אחר. sim = ספק חיצוני מדומה לבדיקות.
import { simProvider } from "./sim.js";
import { couponProvider } from "./coupon.js";
import { jocaresProvider } from "./jocares.js";

const providers = { jocares: jocaresProvider, sim: simProvider, coupon: couponProvider };

export function provider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown ticketing provider: ${name}`);
  return p;
}
