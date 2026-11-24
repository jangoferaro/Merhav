// לסביבת בדיקה: טוען נתוני הדגמה רק אם עדיין אין מסד נתונים. אף פעם לא דורס נתונים קיימים.
import fs from "node:fs";

const file = process.env.ENCORE_DB ?? "data/encore.db";
if (fs.existsSync(file)) {
  console.log(`[seed] ${file} קיים, לא נוגעים`);
} else {
  console.log(`[seed] אין מסד נתונים, טוענים נתוני הדגמה`);
  await import("./seed.js");
}
