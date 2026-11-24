// נתוני הדגמה: npm run seed (מוחק ויוצר מחדש את data/encore.db)
import fs from "node:fs";
import { openDb, insert } from "./db.js";
import { clock, emailHash, isoToIsraelLocal, addDays } from "./util.js";
import * as C from "./domain/campaigns.js";
import * as R from "./domain/referrals.js";
import * as I from "./domain/ingest.js";
import * as M from "./domain/money.js";
import { setSimDeliver, simBuy } from "./providers/sim.js";
import * as K from "./domain/content.js";
import { saveImage, mediaDir } from "./media.js";
import { demoImage } from "./demo-images.js";

let imgSeed = 1;
/** תמונת הדגמה, נשמרת בדיוק כמו העלאה אמיתית */
const img = (style) => saveImage({ data: demoImage(imgSeed++ * 7919, style) });

const file = process.env.ENCORE_DB ?? "data/encore.db";
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(mediaDir(), { recursive: true, force: true });
const db = openDb(file);
setSimDeliver((raw, h) => I.ingestWebhook(db, "sim", raw, h));

const user = (email, name, isAdmin = 0) => {
  const id = insert(db, "users", { email, email_hash: emailHash(email), name, is_admin: isAdmin, created_at: clock.iso() });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
};
const inDays = (d, h = 21) => isoToIsraelLocal(addDays(new Date(new Date().setHours(h - 2, 0, 0, 0)).toISOString(), d));

const admin = user("ops@encore.local", "צוות ENCORE", 1);
const noa = user("noa@encore.local", "נועה ברק");
const band = user("band@encore.local", "אורי לוי");
const dani = user("dani@encore.local", "דני כהן");
const maya = user("maya@encore.local", "מאיה פרץ");
const tom = user("tom@encore.local", "תום אדלר");

const shows = [
  [noa, { artist_name: "נועה ברק", title: "ערב אקוסטי באינטימי", venue: "הבארבי", city: "תל אביב", genre: "אינדי", starts_at: inDays(9), price: "89", reward: "20", description: "שירים מהאלבום החדש, גיטרה, פסנתר וכמה הפתעות." , image_url: img("blur") }],
  [band, { artist_name: "הקרוואן", title: "השקת אלבום", venue: "זאפה", city: "ירושלים", genre: "רוק", starts_at: inDays(16), price: "120", reward: "25", promo_limit: "100" , image_url: img("rays") }],
  [noa, { artist_name: "נועה ברק", title: "הופעה בצפון", venue: "האנגר 11", city: "חיפה", genre: "אינדי", starts_at: inDays(30), price: "75", reward: "15" , image_url: img("rings") }],
  [band, { artist_name: "שקד וחברים", title: "ג'אם ג'אז של חמישי", venue: "בית העם", city: "תל אביב", genre: "ג'אז", starts_at: inDays(4), price: "60", reward: "10" , image_url: img("stripes") }],
  [band, { artist_name: "DJ Lila", title: "Lila All Night", venue: "הבלוק", city: "תל אביב", genre: "אלקטרוני", starts_at: inDays(22), price: "110", reward: "30" , image_url: img("pixels") }],
];
const ids = shows.map(([u, s]) => C.createCampaign(db, u, s));

let n = 0;
const sell = (promoter, cid, buys) => {
  const c = C.getCampaign(db, cid);
  const link = R.getOrCreateLink(db, promoter, cid);
  for (let i = 0; i < buys.clicks; i++) R.recordClick(db, link, `seed-${n++}`);
  for (const qty of buys.orders) {
    const click = R.recordClick(db, link, `seed-${n++}`);
    simBuy(db, c.external_event_id, { name: "קונה לדוגמה", email: `buyer${n++}@example.com`, qty, ref: click.token });
  }
};
sell(dani, ids[0], { clicks: 14, orders: [2, 1, 3] });
sell(maya, ids[0], { clicks: 6, orders: [2] });
sell(dani, ids[1], { clicks: 9, orders: [1, 2] });
sell(tom, ids[3], { clicks: 3, orders: [1] });
simBuy(db, C.getCampaign(db, ids[0]).external_event_id, { name: "ישיר", email: "direct@example.com", qty: 2 });

// מסלול הקופונים: הופעה שנמכרת באתר הכרטוס של האמן. לצוות יש קודים להגדיר ומכירות להעלות.
const cpn = C.createCampaign(db, band, { artist_name: "הקרוואן", title: "ערב קופונים בלבונטין", venue: "לבונטין 7", city: "תל אביב", genre: "רוק", starts_at: inDays(12), price: "90", reward: "20", image_url: img("rays"), source_url: "https://tickets.example.com/caravan", ticketing: "coupon" });
for (const u of [dani, maya, tom]) R.getOrCreateLink(db, u, cpn);

// הופעה שכבר עברה: התגמולים של דני שם כבר זמינים לתשלום
const past = C.createCampaign(db, noa, { artist_name: "נועה ברק", title: "הופעת חנוכה", venue: "צוללת צהובה", city: "ירושלים", starts_at: inDays(1), price: "70", reward: "15", image_url: img("blur") });
sell(dani, past, { clicks: 5, orders: [2, 2] });
db.prepare("UPDATE events SET starts_at = ? WHERE id = (SELECT event_id FROM campaigns WHERE id = ?)").run(addDays(new Date().toISOString(), -5), past);
M.settle(db);

// ---------- יוצרי תוכן והזמנות ----------
const lior = user("lior@encore.local", "ליאור שמש");
const shira = user("shira@encore.local", "שירה אלון");
const yoni = user("yoni@encore.local", "יוני גל");
K.saveProfile(db, lior, { display_name: "ליאור שמש", city: "תל אביב", genres: "אינדי, פופ", kinds: ["content"], bio: "מצלמת ועורכת רילסים להופעות. אוהבת במיוחד אינדי ישראלי ורגעים אמיתיים מהקהל.", image_url: img("blur") });
K.addPortfolio(db, lior, { url: "https://example.com/lior/reel-1", title: "ריל להשקת סינגל" });
K.saveService(db, lior, { template: "reel", price: "200", delivery_days: "4" });
K.saveService(db, lior, { template: "live_shoot", price: "350" });
K.saveProfile(db, shira, { display_name: "שירה אלון", city: "ירושלים", genres: "אינדי, רוק", kinds: ["exposure", "content"], bio: "ממליצה על מוזיקה ישראלית חדשה לקהילה של כ-3,000 אנשים שבאמת מקשיבים.", image_url: img("blur") });
K.addChannel(db, shira, { platform: "Instagram", url: "https://instagram.com/example", followers: "3200" });
K.addChannel(db, shira, { platform: "Telegram", url: "https://t.me/example", followers: "900" });
K.saveService(db, shira, { template: "story_post", price: "120" });
K.saveService(db, shira, { template: "song_review", price: "150" });
K.saveProfile(db, yoni, { display_name: "יוני גל", city: "חיפה", genres: "ג'אז, אלקטרוני", kinds: ["content"], bio: "מעצב פוסטרים להופעות ולסינגלים.", image_url: img("blur") });
K.saveService(db, yoni, { template: "graphic", price: "180" });

const o1 = K.placeOrder(db, noa, K.servicesOf(db, lior.id)[0].id, { artist_name: "נועה ברק", goal: "show", campaign_id: String(ids[0]), rights: "on", notes: "רגע השיא: השיר האחרון" });
K.acceptOrder(db, lior, o1);
K.submitDeliverable(db, lior, o1, { url: "https://example.com/lior/noa-reel-v1", note: "גרסה ראשונה, 38 שניות" });
const o2 = K.placeOrder(db, noa, K.servicesOf(db, shira.id).find((s) => s.template === "song_review").id, { artist_name: "נועה ברק", goal: "music", music_url: "https://example.com/noa/single", rights: "on" });
K.acceptOrder(db, shira, o2);
K.submitDeliverable(db, shira, o2, { url: "https://example.com/shira/review" });
K.approveOrder(db, noa, o2);
K.placeOrder(db, band, K.servicesOf(db, yoni.id)[0].id, { artist_name: "הקרוואן", goal: "content", rights: "on" });

console.log(`נוצר ${file}`);
console.log("משתמשים לדוגמה (הקוד מוצג על המסך במצב פיתוח):");
console.log("  ops@encore.local   — צוות תפעול (ניהול)");
console.log("  noa@encore.local   — אמנית");
console.log("  dani@encore.local  — מקדם עם מכירות וכסף זמין");
console.log("  lior@encore.local  — יוצרת תוכן עם הזמנה שמחכה לאישור האמנית");
