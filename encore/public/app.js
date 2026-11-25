// שיפורים קטנים בצד הלקוח. הכל עובד גם בלי JavaScript; זה רק נוח יותר.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ils = (agorot) => "₪" + (agorot / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 });

  function flashButton(b, msg) {
    const t = b.textContent;
    b.textContent = msg;
    setTimeout(() => (b.textContent = t), 1800);
  }

  document.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy], [data-copy-from]");
    if (copy) {
      const text = copy.dataset.copy ?? $("#" + copy.dataset.copyFrom)?.value ?? "";
      try {
        await navigator.clipboard.writeText(text);
        flashButton(copy, copy.dataset.copied || "הועתק");
      } catch {
        prompt("העתיקו:", text);
      }
    }
    const share = e.target.closest(".native-share");
    if (share && navigator.share) {
      try {
        await navigator.share({ title: share.dataset.shareTitle, text: $("#share-text")?.value });
      } catch {}
    }
  });

  // כפתור "שיתוף…" של המכשיר, אם יש
  if (navigator.share) $$(".native-share").forEach((b) => (b.hidden = false));

  // עריכת הודעת השיתוף מעדכנת את כל כפתורי השיתוף
  const ta = $("#share-text");
  if (ta) {
    const url = ta.dataset.shareUrl;
    ta.addEventListener("input", () => {
      const t = encodeURIComponent(ta.value);
      const wa = $('[data-share-target="wa"]');
      if (wa) wa.href = `https://wa.me/?text=${t}`;
      const tg = $('[data-share-target="tg"]');
      if (tg) tg.href = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(ta.value.replace(url, "").trim())}`;
      const sms = $('[data-share-target="sms"]');
      if (sms) sms.href = `sms:?&body=${t}`;
    });
  }

  // חלוקת מחיר הכרטיס בזמן אמת
  const split = $("[data-split]");
  if (split) {
    const price = $("[data-price]");
    const reward = $("[data-reward]");
    const bps = Number(split.dataset.feeBps);
    const hint = $("[data-suggest]");
    const calc = () => {
      const p = Math.round(Number(price.value) * 100) || 0;
      const r = Math.round(Number(reward.value) * 100) || 0;
      const fee = Math.floor((p * bps) / 10000);
      const left = p - r - fee;
      $('[data-s="reward"]', split).textContent = r ? ils(r) : "—";
      $('[data-s="fee"]', split).textContent = p ? ils(fee) : "—";
      $('[data-s="artist"]', split).textContent = p ? ils(left) : "—";
      split.classList.toggle("bad", p > 0 && left < 0);
      if (hint && p) {
        const s = Math.max(5, Math.min(50, Math.round((p * 0.2) / 100 / 5) * 5));
        hint.textContent = `הצעה: ₪${s} לכרטיס (כ-20% מהמחיר) מושך יותר מקדמים.`;
      }
    };
    price.addEventListener("input", calc);
    reward.addEventListener("input", calc);
    calc();
  }

  // אישור לפני פעולות שאי אפשר לבטל, ומניעת שליחה כפולה
  document.addEventListener("submit", (e) => {
    const msg = e.target.dataset.confirm;
    if (msg && !confirm(msg)) return e.preventDefault();
    const busy = e.target.dataset.busy;
    const b = busy && $("button", e.target);
    if (b) {
      b.disabled = true;
      b.textContent = busy;
    }
  });

  // אמצעי תשלום: ביט או בנק
  $$('input[name="method"]').forEach((r) =>
    r.addEventListener("change", () => {
      $$("[data-method]", r.form).forEach((el) => (el.hidden = el.dataset.method !== r.value));
    })
  );
})();

// מחיר שירות: כמה נשאר ליוצר אחרי העמלה
(() => {
  const input = document.querySelector("[data-service-price]");
  const out = document.querySelector("[data-service-net]");
  if (!input || !out) return;
  const bps = Number(input.dataset.feeBps);
  const calc = () => {
    const p = Math.round(Number(input.value) * 100) || 0;
    if (!p) return;
    const net = p - Math.floor((p * bps) / 10000);
    out.textContent = `תקבלו ₪${(net / 100).toLocaleString("he-IL")} על כל עבודה שהושלמה (אחרי ${bps / 100}% עמלה).`;
  };
  input.addEventListener("input", calc);
  calc();
})();

// העלאת תמונה: תצוגה מקדימה מיידית של הקובץ שנבחר
document.addEventListener("change", (e) => {
  const input = e.target.closest("input[type=file][data-preview]");
  if (!input || !input.files?.[0]) return;
  const box = input.closest(".upload-box");
  const preview = box.querySelector(".upload-preview");
  preview.innerHTML = "";
  const f = input.files[0];
  const isVideo = f.type.startsWith("video/");
  const el = document.createElement(isVideo ? "video" : "img");
  if (isVideo) { el.muted = true; el.playsInline = true; el.preload = "metadata"; } else el.alt = "";
  el.src = URL.createObjectURL(f);
  preview.append(el);
  const label = box.querySelector("[data-label-change]");
  if (label) label.textContent = label.dataset.labelChange;
  if (isVideo && f.size > 80 * 1024 * 1024) alert("הסרטון גדול מ-80MB. אפשר לקצר אותו או לייצא באיכות נמוכה יותר.");
  else if (!isVideo && f.size > 8 * 1024 * 1024) alert("התמונה גדולה מ-8MB. נסו תמונה קטנה יותר.");
});

// לפני העלאה: מקטינים תמונה גדולה ל-1600px ושומרים כ-JPEG.
// העלאה מהירה יותר מהטלפון, תצוגה מקדימה בוואטסאפ (שדורש תמונה קטנה), ומחיקת מטא-דאטה כמו מיקום GPS.
document.addEventListener("change", async (e) => {
  const input = e.target.closest("input[type=file][data-preview]");
  const file = input?.files?.[0];
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap || !window.DataTransfer) return;
  try {
    const bmp = await createImageBitmap(file);
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
    input.files = dt.files;
  } catch {
    // אם הדפדפן לא מצליח, מעלים את המקור והשרת יבדוק את הגודל
  }
});

// מסלול הקופונים: מעתיקים את הקוד ואז ממשיכים לקופה של האמן
document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-copy-then-go]");
  if (!a) return;
  e.preventDefault();
  try { await navigator.clipboard.writeText(a.dataset.copyThenGo); } catch {}
  window.location.href = a.href;
});

// פתיחת הופעה: מראים רק את השדות של אופן המכירה שנבחר
(() => {
  const box = document.querySelector("[data-ticketing]");
  if (!box) return;
  const sync = () => {
    const v = box.querySelector("input:checked")?.value;
    document.querySelectorAll(".ticketing-opt").forEach((el) => {
      const on = el.dataset.when === v;
      el.hidden = !on;
      // רק שדה החובה של כל אפשרות (כמות כרטיסים / לינק). המחיר המוקדם תמיד רשות.
      el.querySelectorAll("input[data-req]").forEach((i) => (i.required = on));
    });
  };
  box.addEventListener("change", sync);
  sync();
})();

// קופה: הסכום מתעדכן לפי מספר הכרטיסים
(() => {
  const sel = document.querySelector("[data-qty]");
  const out = document.querySelector("[data-total]");
  if (!sel || !out) return;
  const unit = Number(sel.dataset.unit);
  sel.addEventListener("change", () => {
    out.textContent = "₪" + ((unit * Number(sel.value)) / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 });
  });
})();

// כניסה: סריקת QR במצלמה (בדפדפנים שתומכים), אחרת הקלדה או סורק חיצוני
(() => {
  const form = document.querySelector("[data-door-form]");
  if (!form) return;
  const input = form.querySelector("[data-door-code]");
  const btn = form.querySelector("[data-scan]");
  const box = document.querySelector("[data-scanner]");
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return;
  btn.hidden = false;
  const start = async () => {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = box.querySelector("video");
      video.srcObject = stream;
      box.hidden = false;
      btn.hidden = true;
      await video.play();
      const tick = async () => {
        const [code] = await detector.detect(video).catch(() => []);
        if (code?.rawValue) {
          stream.getTracks().forEach((t) => t.stop());
          try { sessionStorage.setItem("door-camera", "1"); } catch {}
          input.value = code.rawValue;
          form.submit();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch {
      box.hidden = true;
      btn.hidden = false;
    }
  };
  btn.addEventListener("click", start);
  // אחרי סריקה, המצלמה נפתחת שוב אוטומטית לכרטיס הבא
  let again = false;
  try { again = sessionStorage.getItem("door-camera") === "1"; } catch {}
  if (again) setTimeout(start, 900);
})();

// ערכת שיתוף: עיצובים מוכנים שנבנים בדפדפן מהתמונה של ההופעה והקוד של הג׳וקר
(() => {
  const cv = document.querySelector("[data-story]");
  if (!cv) return;
  const d = cv.dataset;
  const g = cv.getContext("2d");
  const PAD = 80;
  const INK = "#151515", PAPER = "#EDECE4", ACID = "#DFFF45", RED = "#FF493D";
  const load = (src, cors) =>
    new Promise((ok) => {
      if (!src) return ok(null);
      const im = new Image();
      if (cors) im.crossOrigin = "anonymous";
      im.onload = () => ok(im);
      im.onerror = () => ok(null);
      im.src = src;
    });
  const wrap = (text, maxW, maxLines) => {
    const lines = [];
    let cur = "";
    for (const w of text.split(/\s+/)) {
      const t = cur ? cur + " " + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += "…"; }
    return lines;
  };
  const rtl = (font, color, align = "right") => { g.direction = "rtl"; g.textAlign = align; g.textBaseline = "alphabetic"; g.font = font; g.fillStyle = color; };
  const photoBox = (photo, x, y, w, h) => {
    if (!photo) { g.fillStyle = "#2a2a2a"; g.fillRect(x, y, w, h); return; }
    const s = Math.max(w / photo.width, h / photo.height);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(photo, x + (w - photo.width * s) / 2, y + (h - photo.height * s) / 2, photo.width * s, photo.height * s);
    g.restore();
    try {
      const px = g.getImageData(x, y, w, h), a = px.data;
      for (let i = 0; i < a.length; i += 4) {
        const v = Math.min(255, (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2] - 128) * 1.08 + 128);
        a[i] = a[i + 1] = a[i + 2] = v;
      }
      g.putImageData(px, x, y);
    } catch {}
  };
  const stampAt = (cx, cy, r) => {
    g.fillStyle = ACID; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr";
    g.font = `700 ${Math.round(r * 0.53)}px 'Space Grotesk', sans-serif`;
    g.fillText("Be Jo.", cx, cy + 4);
  };
  const wordmark = (xRight, y, color, size = 44) => {
    g.direction = "ltr"; g.textAlign = "right"; g.textBaseline = "alphabetic";
    g.font = `700 ${size}px 'Space Grotesk', sans-serif`; g.fillStyle = color;
    g.fillText("JoCares", xRight - size / 2, y);
    g.fillStyle = RED; g.beginPath(); g.arc(xRight - size / 7, y - size / 5, size / 5, 0, Math.PI * 2); g.fill();
  };
  const qrBlock = (qr, x, y, q, urlColor, size = 32) => {
    if (qr) { g.fillStyle = "#fff"; g.fillRect(x, y, q, q); g.drawImage(qr, x, y, q, q); }
    g.direction = "ltr"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = `500 ${size}px 'IBM Plex Mono', monospace`; g.fillStyle = urlColor;
    g.fillText(d.url, x, y + q + size * 1.6);
  };
  const priceChip = (y, bg = ACID, fg = INK) => {
    if (!d.price) return y;
    rtl("700 46px Heebo, sans-serif", fg);
    const W = cv.width, tw = g.measureText(d.price).width;
    y += 92;
    g.fillStyle = bg; g.fillRect(W - PAD - tw - 28, y - 52, tw + 56, 72);
    g.fillStyle = fg; g.fillText(d.price, W - PAD, y);
    return y;
  };

  const VARIANTS = {
    // תמונה למעלה, פרטים למטה
    photo: { w: 1080, h: 1920, draw(photo, qr) {
      const W = 1080, H = 1920, PH = 960;
      g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
      photoBox(photo, 0, 0, W, PH);
      stampAt(W - 190, 190, 120);
      let y = PH + 100;
      rtl("500 44px Assistant, Heebo, sans-serif", INK); g.fillText(d.artist, W - PAD, y);
      g.font = "800 104px Heebo, sans-serif";
      for (const line of wrap(d.title, W - PAD * 2, 2)) { y += 118; g.fillText(line, W - PAD, y); }
      g.font = "500 46px Assistant, Heebo, sans-serif";
      y += 84; g.fillText(d.when, W - PAD, y);
      y += 60; g.fillText(d.where, W - PAD, y);
      priceChip(y);
      qrBlock(qr, PAD, 1580, 220, INK);
      rtl("700 52px Heebo, sans-serif", INK); g.fillText("כרטיסים בלינק", W - PAD, 1640);
      wordmark(W - PAD, 1800, INK);
    } },
    // בלי תמונה: כותרת ענקית על דיו
    type: { w: 1080, h: 1920, draw(_photo, qr) {
      const W = 1080, H = 1920;
      g.fillStyle = INK; g.fillRect(0, 0, W, H);
      stampAt(W - 200, 220, 130);
      let y = 520;
      rtl("500 50px Assistant, Heebo, sans-serif", PAPER); g.fillText(d.artist, W - PAD, y);
      g.font = "800 150px Heebo, sans-serif"; g.fillStyle = ACID;
      for (const line of wrap(d.title, W - PAD * 2, 4)) { y += 165; g.fillText(line, W - PAD, y); }
      rtl("500 52px Assistant, Heebo, sans-serif", PAPER);
      y += 110; g.fillText(d.when, W - PAD, y);
      y += 66; g.fillText(d.where, W - PAD, y);
      priceChip(y, ACID, INK);
      qrBlock(qr, PAD, 1560, 240, PAPER);
      rtl("700 56px Heebo, sans-serif", PAPER); g.fillText("בואו איתי", W - PAD, 1640);
      wordmark(W - PAD, 1800, PAPER);
    } },
    // פוסט מרובע לפיד
    square: { w: 1080, h: 1080, draw(photo, qr) {
      const W = 1080, H = 1080, half = 540;
      g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
      photoBox(photo, 0, 0, half, H);
      stampAt(half - 120, 130, 90);
      const X = W - 60, maxW = half - 100;
      let y = 140;
      rtl("500 32px Assistant, Heebo, sans-serif", INK); g.fillText(d.artist, X, y);
      g.font = "800 72px Heebo, sans-serif";
      for (const line of wrap(d.title, maxW, 3)) { y += 84; g.fillText(line, X, y); }
      g.font = "500 34px Assistant, Heebo, sans-serif";
      y += 66; g.fillText(d.when, X, y);
      y += 46; g.fillText(d.where, X, y);
      if (d.price) { g.font = "700 34px Heebo, sans-serif"; y += 60; const tw = g.measureText(d.price).width; g.fillStyle = ACID; g.fillRect(X - tw - 20, y - 38, tw + 40, 54); g.fillStyle = INK; g.fillText(d.price, X, y); }
      qrBlock(qr, half + 60, 720, 170, INK, 22);
      wordmark(X, 1020, INK, 38);
    } },
  };

  let assets = null;
  const render = async (name) => {
    try { await Promise.all(["800 120px Heebo", "500 40px Assistant", "700 60px 'Space Grotesk'", "500 32px 'IBM Plex Mono'"].map((f) => document.fonts.load(f))); } catch {}
    assets ??= await Promise.all([load(d.img, !d.img.startsWith("/")), load(d.qr, false)]);
    const v = VARIANTS[name] ?? VARIANTS.photo;
    cv.width = v.w; cv.height = v.h;
    v.draw(...assets);
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.querySelector("[data-story-download]");
      if (a) { a.href = URL.createObjectURL(blob); a.download = `jocares-${name}.png`; }
      const file = new File([blob], `jocares-${name}.png`, { type: "image/png" });
      const btn = document.querySelector("[data-story-share]");
      if (btn && navigator.canShare?.({ files: [file] })) {
        btn.hidden = false;
        btn.onclick = () => navigator.share({ files: [file] }).catch(() => {});
      }
    }, "image/png");
  };
  document.querySelectorAll('input[name="story-variant"]').forEach((r) => r.addEventListener("change", () => render(r.value)));
  render("photo");
})();

// פתיחת הופעה: שם המקום או ההפקה רק כשמי שמוכר הוא לא האמן
(() => {
  const box = document.querySelector("[data-organizer]");
  if (!box) return;
  const sync = () => {
    const v = box.querySelector("input:checked")?.value || "artist";
    document.querySelectorAll(".organizer-opt").forEach((el) => {
      const on = el.dataset.orgWhen.split(" ").includes(v);
      el.hidden = !on;
      el.querySelectorAll("[data-req-org]").forEach((i) => (i.required = on));
    });
  };
  box.addEventListener("change", sync);
  sync();
})();

// כרטיסים שמיים: שדה שם לכל כרטיס לפי הכמות שנבחרה
(() => {
  const sel = document.querySelector("[data-qty]");
  const box = document.querySelector("[data-holders]");
  if (!sel || !box) return;
  const sync = () => {
    const n = Number(sel.value);
    box.querySelectorAll("[data-holder]").forEach((el) => {
      const i = Number(el.dataset.holder);
      el.hidden = i > n;
      const input = el.querySelector("input");
      input.required = i > 1 && i <= n;
      if (i > n) input.value = "";
    });
  };
  sel.addEventListener("change", sync);
  sync();
})();
