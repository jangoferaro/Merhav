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
        flashButton(copy, copy.dataset.copied || "הועתק ✓");
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
