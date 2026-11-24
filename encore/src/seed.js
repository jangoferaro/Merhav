// נתוני הדגמה: npm run seed (מוחק ויוצר מחדש את data/encore.db)
import fs from "node:fs";
import { openDb, insert } from "./db.js";
import { clock, emailHash, isoToIsraelLocal, addDays } from "./util.js";
import * as C from "./domain/campaigns.js";
import * as R from "./domain/referrals.js";
import * as I from "./domain/ingest.js";
import * as M from "./domain/money.js";
import { setSimDeliver, simBuy } from "./providers/sim.js";

const file = process.env.ENCORE_DB ?? "data/encore.db";
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
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
  [noa, { artist_name: "נועה ברק", title: "ערב אקוסטי באינטימי", venue: "הבארבי", city: "תל אביב", genre: "אינדי", starts_at: inDays(9), price: "89", reward: "20", description: "שירים מהאלבום החדש, גיטרה, פסנתר וכמה הפתעות." }],
  [band, { artist_name: "הקרוואן", title: "השקת אלבום", venue: "זאפה", city: "ירושלים", genre: "רוק", starts_at: inDays(16), price: "120", reward: "25", promo_limit: "100" }],
  [noa, { artist_name: "נועה ברק", title: "הופעה בצפון", venue: "האנגר 11", city: "חיפה", genre: "אינדי", starts_at: inDays(30), price: "75", reward: "15" }],
  [band, { artist_name: "שקד וחברים", title: "ג'אם ג'אז של חמישי", venue: "בית העם", city: "תל אביב", genre: "ג'אז", starts_at: inDays(4), price: "60", reward: "10" }],
  [band, { artist_name: "DJ Lila", title: "Lila All Night", venue: "הבלוק", city: "תל אביב", genre: "אלקטרוני", starts_at: inDays(22), price: "110", reward: "30" }],
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

// הופעה שכבר עברה: התגמולים של דני שם כבר זמינים לתשלום
const past = C.createCampaign(db, noa, { artist_name: "נועה ברק", title: "הופעת חנוכה", venue: "צוללת צהובה", city: "ירושלים", starts_at: inDays(1), price: "70", reward: "15" });
sell(dani, past, { clicks: 5, orders: [2, 2] });
db.prepare("UPDATE events SET starts_at = ? WHERE id = (SELECT event_id FROM campaigns WHERE id = ?)").run(addDays(new Date().toISOString(), -5), past);
M.settle(db);

console.log(`נוצר ${file}`);
console.log("משתמשים לדוגמה (הקוד מוצג על המסך במצב פיתוח):");
console.log("  ops@encore.local   — צוות תפעול (ניהול)");
console.log("  noa@encore.local   — אמנית");
console.log("  dani@encore.local  — מקדם עם מכירות וכסף זמין");
