// הקופה של Jocares: אנחנו ספק הכרטוס. הקונה קונה אצלנו, מקבל כרטיס עם QR, והמכירה נרשמת
// באותו מנוע שיוך ותגמולים כמו כל ספק אחר (tickets.js שולח אליו אירועים פנימיים).
import { randomToken, UserError } from "../util.js";

export const jocaresProvider = {
  name: "jocares",

  registerEvent() {
    return `jo_${randomToken(9)}`;
  },

  checkoutUrl(campaign) {
    return `/checkout/${campaign.id}`;
  },

  /** אירועים של הקופה נוצרים בתוך המערכת ולא מגיעים מבחוץ */
  verifyWebhook() {
    throw new UserError("לקופה של Jocares אין webhooks חיצוניים", 404);
  },
};
