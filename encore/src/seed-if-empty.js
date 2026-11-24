// לסביבת בדיקה: טוען נתוני הדגמה רק אם עדיין אין מסד נתונים.
// חריג מפורש אחד: אם DEMO_DATA_VERSION שונה מהגרסה שנטענה, נתוני ההדגמה נטענים מחדש
// (רק כשמשנים את המשתנה בכוונה. בלי המשתנה, אף פעם לא דורסים נתונים קיימים).
import fs from "node:fs";

const file = process.env.ENCORE_DB ?? "data/encore.db";
const marker = `${file}.demo-version`;
const want = process.env.DEMO_DATA_VERSION ?? "";
const have = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";

if (!fs.existsSync(file)) {
  console.log("[seed] אין מסד נתונים, טוענים נתוני הדגמה");
  await import("./seed.js");
  if (want) fs.writeFileSync(marker, want);
} else if (want && want !== have) {
  console.log(`[seed] גרסת נתוני ההדגמה ${have || "(אין)"} → ${want}, טוענים מחדש`);
  await import("./seed.js");
  fs.writeFileSync(marker, want);
} else {
  console.log(`[seed] ${file} קיים, לא נוגעים`);
}
