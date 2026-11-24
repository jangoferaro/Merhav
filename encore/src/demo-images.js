// תמונות הדגמה ל-seed ולמדריך הסגנון. במערכת האמיתית אמנים ויוצרים מעלים תמונות משלהם;
// כאן מייצרים קבצי PNG אמיתיים (בלי תלויות) כדי שלדמו יהיו תמונות בלי להוריד מהרשת.
import zlib from "node:zlib";

const PAL = [[255, 77, 0], [255, 179, 209], [0, 122, 55], [110, 76, 255], [0, 52, 209], [255, 196, 0], [17, 17, 17], [245, 240, 232]];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** סגנונות: blur (כתמי צבע רכים), rings, rays, stripes, pixels */
export function demoImage(seed, style, w = 960, h = 720) {
  const r = rng(seed);
  const px = Buffer.alloc(w * h * 3);
  const pick = () => PAL[Math.floor(r() * 6)];
  const set = (i, c) => { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  const cols = [pick(), pick(), pick(), pick()];
  if (style === "blur") {
    const blobs = Array.from({ length: 5 }, () => ({ x: r() * w, y: r() * h, s: (0.25 + r() * 0.35) * w, c: pick() }));
    const base = PAL[7];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let R = base[0] * 0.3, G = base[1] * 0.3, B = base[2] * 0.3, W = 0.3;
      for (const b of blobs) {
        const d = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.s * b.s);
        const k = Math.exp(-d * 2.2);
        R += b.c[0] * k; G += b.c[1] * k; B += b.c[2] * k; W += k;
      }
      const n = (r() - 0.5) * 14; // גרעין
      set((y * w + x) * 3, [R / W + n, G / W + n, B / W + n].map((v) => Math.max(0, Math.min(255, v))));
    }
  } else if (style === "rings") {
    const cx = w * (0.2 + r() * 0.6), cy = h * (0.6 + r() * 0.5), band = w * (0.04 + r() * 0.03);
    const start = Math.floor(r() * 6);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = Math.floor(Math.hypot(x - cx, y - cy) / band);
      set((y * w + x) * 3, k < 2 ? PAL[6] : PAL[(start + k) % 6]);
    }
  } else if (style === "rays") {
    const cx = w / 2, cy = h * (0.4 + r() * 0.3), n = 12 + Math.floor(r() * 10), rad = h * 0.2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = (Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI);
      set((y * w + x) * 3, d < rad ? cols[2] : Math.floor(a * n * 2) % 2 ? cols[0] : PAL[7]);
    }
  } else if (style === "stripes") {
    const s = h / (8 + Math.floor(r() * 8)), tilt = (r() - 0.5) * 0.8;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      set((y * w + x) * 3, Math.floor((y + x * tilt) / s) % 2 ? PAL[6] : cols[1]);
    }
  } else {
    const cell = Math.floor(w / (12 + Math.floor(r() * 8)));
    const grid = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      if (!grid.has(key)) grid.set(key, r() < 0.55 ? cols[0] : r() < 0.5 ? cols[1] : PAL[6]);
      set((y * w + x) * 3, grid.get(key));
    }
  }
  return encodePng(w, h, px);
}

export const DEMO_STYLES = ["blur", "rings", "rays", "stripes", "pixels"];
