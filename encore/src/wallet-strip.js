// תמונת הרצועה (strip) לכרטיס ב-Apple Wallet: תמונת ההופעה, חתוכה ל-375x123, בשחור-לבן ומוחשכת
// כך שהטקסט הלבן עליה קריא. כמו בכרטיס באתר.
// רק תמונות שנשמרו אצלנו (/media/...), כדי שהשרת לא יוריד כתובות שמארגן הזין (SSRF).
import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { mediaDir } from "./media.js";

const W = 375;
const H = 123;
const cache = new Map(); // לפי כתובת התמונה: הקבצים המוכנים

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 40 });
    return { w: img.width, h: img.height, data: img.data };
  }
  if (buf.subarray(1, 4).toString("latin1") === "PNG") {
    const img = PNG.sync.read(buf);
    return { w: img.width, h: img.height, data: img.data };
  }
  return null; // WebP ושאר הפורמטים: בלי רצועה
}

/** חיתוך "cover" לגודל היעד, ממוצע של פיקסלי המקור לכל פיקסל יעד, שחור-לבן ומוחשך */
function render(src, scale) {
  const tw = W * scale;
  const th = H * scale;
  const ratio = Math.max(tw / src.w, th / src.h);
  const cw = tw / ratio;
  const ch = th / ratio;
  const ox = (src.w - cw) / 2;
  const oy = (src.h - ch) / 2;
  const png = new PNG({ width: tw, height: th });
  const step = cw / tw;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(ox + x * step);
      const y0 = Math.floor(oy + y * step);
      const n = Math.max(1, Math.floor(step));
      let sum = 0;
      let cnt = 0;
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
        const sx = Math.min(src.w - 1, x0 + dx);
        const sy = Math.min(src.h - 1, y0 + dy);
        const i = (sy * src.w + sx) * 4;
        sum += 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
        cnt++;
      }
      // מוחשך לכ-40% ועם שיפוע למטה, כדי שהכותרת הלבנה תהיה קריאה
      const fade = 0.5 - 0.2 * (y / th);
      const v = Math.round((sum / cnt) * fade);
      const o = (y * tw + x) * 4;
      png.data[o] = v; png.data[o + 1] = v; png.data[o + 2] = v; png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export function stripImages(imageUrl) {
  const m = /^\/media\/([A-Za-z0-9_-]+\.(?:jpg|png))$/.exec(String(imageUrl ?? ""));
  if (!m) return {};
  if (cache.has(m[1])) return cache.get(m[1]);
  let out = {};
  try {
    const src = decode(fs.readFileSync(path.join(mediaDir(), m[1])));
    if (src) out = { "strip.png": render(src, 1), "strip@2x.png": render(src, 2), "strip@3x.png": render(src, 3) };
  } catch {
    out = {};
  }
  if (cache.size > 200) cache.clear();
  cache.set(m[1], out);
  return out;
}
