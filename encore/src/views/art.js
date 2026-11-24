// גרפיקה גנרטיבית: פוסטרים לכל הופעה ואווטארים ליוצרים, נבנים כ-SVG בצד השרת.
// השראה מהעבודות של Under ושל הדר לוזון (ראו DESIGN.md): אות ענקית מוטה, אלפבית צבעוני על שחור,
// קרני שמש, קשתות, פיקסל-ארט, פסים עם מדבקת כוכב, שחמט, ומילה ענקית עם קווי בנייה.
// דטרמיניסטי: אותה הופעה תקבל תמיד אותו פוסטר. דקורטיבי בלבד (aria-hidden).

export const PALETTE = ["#ff4d00", "#ffb3d1", "#007a37", "#6e4cff", "#0034d1", "#ffc400"];
const INK = "#111111";
const PAPER = "#ffffff";
/** צבע טקסט קריא על כל צבע פלטה (ניגודיות AA) */
const ON = ["#111111", "#111111", "#ffffff", "#ffffff", "#ffffff", "#111111"];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

/** מחולל פסאודו-אקראי עם זרע (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const twoColors = (r) => {
  const a = Math.floor(r() * 6);
  let b = Math.floor(r() * 5);
  if (b >= a) b++;
  return [a, b];
};
const letters = (s) => [...String(s).replace(/[\s\-–—'"׳״.,!?()]/g, "")];
const n = (x) => Math.round(x * 10) / 10;

// ---------- פריסות ----------

/** אות ענקית, מוטה וחתוכה, עם קווי בנייה דקים */
function letter({ W, H, r, c }) {
  const [a, b] = twoColors(r);
  const tilt = Math.round(r() * 28 - 14);
  const g = esc(letters(c.artist_name)[0] ?? "");
  const lines = [0.3, 0.74].map((y) => `<line x1="0" x2="${W}" y1="${n(H * y)}" y2="${n(H * y)}"/>`).join("") +
    [0.18, 0.82].map((x) => `<line y1="0" y2="${H}" x1="${n(W * x)}" x2="${n(W * x)}"/>`).join("");
  return `<rect width="${W}" height="${H}" fill="${PALETTE[a]}"/>
<text class="pt" x="${W / 2}" y="${n(H * 0.84)}" font-size="${n(H * 1.05)}" text-anchor="middle" fill="${PALETTE[b]}" transform="rotate(${tilt} ${W / 2} ${H / 2})">${g}</text>
<g stroke="#fff" stroke-opacity=".7" stroke-width="1">${lines}</g>`;
}

/** אלפבית צבעוני על שחור: האותיות של האמן וההופעה, בשורות */
function alphabet({ W, H, r, c }) {
  const chars = letters(c.artist_name + c.title);
  if (!chars.length) return letter({ W, H, r, c });
  const cols = W >= H ? 6 : 5;
  const size = W / cols;
  const rows = Math.ceil(H / (size * 0.92)) + 1;
  const start = Math.floor(r() * 6);
  let out = `<rect width="${W}" height="${H}" fill="${INK}"/>`;
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++, i++) {
      const x = W - (col + 0.5) * size; // מימין לשמאל
      const y = (row + 0.86) * size * 0.92;
      out += `<text class="pt" x="${n(x)}" y="${n(y)}" font-size="${n(size * 1.08)}" text-anchor="middle" fill="${PALETTE[(start + i) % 6]}">${esc(chars[i % chars.length])}</text>`;
    }
  }
  return out;
}

/** קרני שמש סביב עיגול */
function sunburst({ W, H, r, c }) {
  const [a, b] = twoColors(r);
  const cx = W / 2;
  const cy = H * (0.45 + r() * 0.2);
  const R = Math.hypot(W, H);
  const rays = pick(r, [20, 24, 28, 32]);
  let path = "";
  for (let k = 0; k < rays; k += 2) {
    const t1 = (k / rays) * Math.PI * 2;
    const t2 = ((k + 1) / rays) * Math.PI * 2;
    path += `M${n(cx)} ${n(cy)}L${n(cx + R * Math.cos(t1))} ${n(cy + R * Math.sin(t1))}L${n(cx + R * Math.cos(t2))} ${n(cy + R * Math.sin(t2))}Z`;
  }
  const rad = Math.min(W, H) * 0.2;
  const g = esc(letters(c.artist_name)[0] ?? "");
  return `<rect width="${W}" height="${H}" fill="${PAPER}"/>
<path d="${path}" fill="${PALETTE[a]}"/>
<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad)}" fill="${PALETTE[b]}"/>
<text class="pt" x="${n(cx)}" y="${n(cy + rad * 0.36)}" font-size="${n(rad * 1.05)}" text-anchor="middle" fill="${ON[b]}">${g}</text>`;
}

/** קשת: עיגולים קונצנטריים בכל צבעי הפלטה, עולים מתחתית הפוסטר */
function rainbow({ W, H, r }) {
  const cx = W * (0.3 + r() * 0.4);
  const cy = H * 1.02;
  const band = Math.min(W, H) * 0.075;
  const count = 9;
  const start = Math.floor(r() * 6);
  let out = `<rect width="${W}" height="${H}" fill="${INK}"/>`;
  for (let k = count; k >= 1; k--) {
    out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(k * band + band * 1.2)}" fill="${k === 1 ? INK : PALETTE[(start + k) % 6]}"/>`;
  }
  // כוכב פיקסלים קטן
  const px = band * 0.45;
  const sx = W * (r() > 0.5 ? 0.82 : 0.14);
  const sy = H * 0.2;
  for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) {
    out += `<rect x="${n(sx + dx * px)}" y="${n(sy + dy * px)}" width="${n(px)}" height="${n(px)}" fill="${PALETTE[(start + 3) % 6]}"/>`;
  }
  return out;
}

/** יצור פיקסלים סימטרי (כמו תמנון פיקסלים) */
function pixels({ W, H, r }) {
  const [a, b] = twoColors(r);
  const G = 9;
  const px = Math.floor(Math.min(W, H) / 14);
  const ox = (W - G * px) / 2;
  const oy = (H - G * px) / 2 + px * 0.5;
  let cells = "";
  const half = Math.ceil(G / 2);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < half; x++) {
      const edge = y === 0 || y === G - 1 || x === 0;
      const on = r() < (edge ? 0.35 : 0.62) || (x === half - 1 && y > 1 && y < G - 2);
      if (!on) continue;
      for (const xx of new Set([x, G - 1 - x])) cells += `<rect x="${n(ox + xx * px)}" y="${n(oy + y * px)}" width="${px}" height="${px}"/>`;
    }
  }
  // עיניים
  const ey = oy + 3 * px;
  const eyes = [2, G - 3].map((x) => `<rect x="${n(ox + x * px)}" y="${n(ey)}" width="${px}" height="${px}" fill="${PAPER}"/>`).join("");
  return `<rect width="${W}" height="${H}" fill="${PALETTE[a]}"/><g fill="${PALETTE[b]}">${cells}</g>${eyes}`;
}

/** פסים עבים עם מדבקת כוכב */
function stripes({ W, H, r, c }) {
  const [a, b] = twoColors(r);
  const stripe = H / pick(r, [9, 11, 13]);
  let out = `<rect width="${W}" height="${H}" fill="${PAPER}"/><g fill="${INK}">`;
  for (let y = 0; y < H; y += stripe * 2) out += `<rect y="${n(y)}" width="${W}" height="${n(stripe)}"/>`;
  out += "</g>";
  const cx = W * (0.32 + r() * 0.36);
  const cy = H * (0.4 + r() * 0.2);
  const R1 = Math.min(W, H) * 0.34;
  const R2 = R1 * 0.78;
  const spikes = pick(r, [12, 14, 16]);
  let d = "";
  for (let k = 0; k < spikes * 2; k++) {
    const t = (k / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const R = k % 2 ? R2 : R1;
    d += `${k ? "L" : "M"}${n(cx + R * Math.cos(t))} ${n(cy + R * Math.sin(t))}`;
  }
  const g = esc(letters(c.artist_name)[0] ?? "");
  const tilt = Math.round(r() * 24 - 12);
  return `${out}<g transform="rotate(${tilt} ${n(cx)} ${n(cy)})"><path d="${d}Z" fill="${PALETTE[a]}"/>
<text class="pt" x="${n(cx)}" y="${n(cy + R2 * 0.36)}" font-size="${n(R2 * 1.05)}" text-anchor="middle" fill="${ON[a]}">${g}</text></g>`;
}

/** שחמט שמתרחב, עם עיגול צבע */
function checker({ W, H, r }) {
  const [a] = twoColors(r);
  let out = `<rect width="${W}" height="${H}" fill="${PAPER}"/><g fill="${INK}">`;
  let x = 0;
  let col = 0;
  let w = W * 0.05;
  while (x < W) {
    const rows = 6 + (col % 2);
    const h = H / rows;
    for (let row = 0; row < rows; row++) if ((row + col) % 2 === 0) out += `<rect x="${n(x)}" y="${n(row * h)}" width="${n(w)}" height="${n(h)}"/>`;
    x += w;
    w *= 1.32;
    col++;
  }
  out += "</g>";
  const R = Math.min(W, H) * 0.2;
  return `${out}<circle cx="${n(W * (0.25 + r() * 0.5))}" cy="${n(H * (0.3 + r() * 0.4))}" r="${n(R)}" fill="${PALETTE[a]}"/>`;
}

/** המילה עצמה, ענקית, עם קווי קו-בסיס וגובה-x כמו במסמך גופן */
function bigword({ W, H, r, c }) {
  const [a] = twoColors(r);
  const words = String(c.title).trim().split(/\s+/).slice(0, 3);
  const longest = Math.max(...words.map((w) => [...w].length), 2);
  const size = Math.min((W * 1.6) / longest, (H * 0.78) / words.length);
  const lh = size * 0.92;
  const top = (H - lh * words.length) / 2 + size * 0.78;
  let out = `<rect width="${W}" height="${H}" fill="${PALETTE[a]}"/><g stroke="${ON[a]}" stroke-opacity=".35" stroke-width="1">`;
  words.forEach((_, i) => {
    const base = top + i * lh;
    out += `<line x1="0" x2="${W}" y1="${n(base)}" y2="${n(base)}"/><line x1="0" x2="${W}" y1="${n(base - size * 0.52)}" y2="${n(base - size * 0.52)}"/>`;
  });
  out += "</g>";
  words.forEach((w, i) => {
    out += `<text class="pt" x="${n(W - W * 0.06)}" y="${n(top + i * lh)}" font-size="${n(size)}" text-anchor="start" direction="rtl" fill="${ON[a]}" textLength="${[...w].length > 2 ? n(W * 0.88) : ""}" lengthAdjust="spacingAndGlyphs">${esc(w)}</text>`;
  });
  return out.replace(/ textLength=""/g, "");
}

export const LAYOUTS = { letter, alphabet, sunburst, rainbow, pixels, stripes, checker, bigword };
const ORDER = Object.keys(LAYOUTS);

/** הפוסטר עצמו (בלי עטיפה). size: card 4:3, big 4:5, square */
export function posterSvg(c, { size = "card", layout } = {}) {
  const seed = hash(`${c.artist_name}|${c.title}`);
  const r = rng(seed);
  const name = layout ?? ORDER[seed % ORDER.length];
  const [W, H] = size === "big" ? [400, 500] : size === "square" ? [300, 300] : [400, 300];
  const body = LAYOUTS[name]({ W, H, r, c });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-layout="${name}">${body}</svg>`;
}

/** אווטאר פיקסלים ליוצר: דמות סימטרית 5×5 בצבעי הפלטה, ייחודית לכל משתמש */
export function pixelAvatarSvg(key) {
  const r = rng(hash(`avatar|${key}`));
  const [a, b] = twoColors(r);
  const fg = r() < 0.5 ? PALETTE[b] : ON[a];
  let cells = "";
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (r() < 0.55 || (x === 2 && y > 0 && y < 4)) {
        for (const xx of new Set([x, 4 - x])) cells += `<rect x="${xx * 2 + 1}" y="${y * 2 + 1}" width="2" height="2"/>`;
      }
    }
  }
  return `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><rect width="12" height="12" fill="${PALETTE[a]}"/><g fill="${fg}">${cells}</g></svg>`;
}
