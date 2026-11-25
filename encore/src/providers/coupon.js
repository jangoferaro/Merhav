// מסלול הקופונים: האמן ממשיך למכור במערכת הכרטוס שלו, וכל ג׳וקר מקבל קוד אישי.
// אין חיבור טכני לספק. צוות JoCares מגדיר את הקודים אצל הספק ומעלה את ייצוא המכירות (coupons.js).
// לא האמן ולא הג׳וקר צריכים לעשות שום דבר.
import { randomToken, UserError } from "../util.js";

export const couponProvider = {
  name: "coupon",

  registerEvent() {
    return `cpn_${randomToken(9)}`;
  },

  /** הקונה עובר לעמוד הכרטיסים של האמן עצמו */
  checkoutUrl(campaign) {
    return campaign.source_url;
  },

  verifyWebhook() {
    throw new UserError("למסלול הקופונים אין webhooks", 404);
  },
};
