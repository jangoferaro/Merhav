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
  const img = document.createElement("img");
  img.alt = "";
  img.src = URL.createObjectURL(input.files[0]);
  preview.append(img);
  const label = box.querySelector("[data-label-change]");
  if (label) label.textContent = label.dataset.labelChange;
  if (input.files[0].size > 8 * 1024 * 1024) alert("התמונה גדולה מ-8MB. נסו תמונה קטנה יותר.");
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
      el.querySelectorAll("input").forEach((i) => (i.required = on));
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
