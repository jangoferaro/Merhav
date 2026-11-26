// שחזור מגיבוי. שימוש:
//   node ops/restore.mjs <קובץ גיבוי (.db או .db.enc)> <יעד, למשל data/encore.db>
// קובץ מוצפן דורש BACKUP_ENCRYPTION_KEY בסביבה. לפני השחזור: לעצור את השרת. הקובץ הקיים נשמר בצד (.before-restore).
import fs from "node:fs";
import { decrypt, verifyBackup } from "../src/backup.js";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("שימוש: node ops/restore.mjs <גיבוי> <יעד>");
  process.exit(1);
}
let buf = fs.readFileSync(src);
if (src.endsWith(".enc")) buf = decrypt(buf);
const tmp = `${dest}.restore-tmp`;
fs.writeFileSync(tmp, buf);
const counts = verifyBackup(tmp);
if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}.before-restore`);
for (const ext of ["-wal", "-shm"]) fs.rmSync(`${dest}${ext}`, { force: true });
fs.renameSync(tmp, dest);
console.log(`שוחזר: ${counts.tickets} כרטיסים, ${counts.orders} הזמנות → ${dest}`);
