// אפליקציית הכניסה בדפדפן: סריקה רציפה (jsQR, עובד גם באייפון), צליל ורטט, ועבודה בלי קליטה.
// בלי קליטה: בודקים מול רשימת הכרטיסים שנטענה מראש (רק גיבובי קודים), ושומרים את הכניסות בתור עד שהקליטה חוזרת.
(() => {
  const root = document.querySelector("[data-door]");
  if (!root) return;
  const api = root.dataset.api;
  const csrf = root.dataset.csrf;
  const key = `door:${root.dataset.campaign}`;
  const $ = (s) => root.querySelector(s);
  const device = (() => {
    try {
      let d = localStorage.getItem("door-device");
      if (!d) localStorage.setItem("door-device", (d = Math.random().toString(36).slice(2, 10)));
      return d;
    } catch { return "unknown"; }
  })();
  const store = {
    get(k, f) { try { return JSON.parse(localStorage.getItem(`${key}:${k}`)) ?? f; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(`${key}:${k}`, JSON.stringify(v)); } catch {} },
  };

  let tickets = new Map(store.get("manifest", []).map((t) => [t.h, t]));
  let queue = store.get("queue", []);
  let online = navigator.onLine;
  let lastAdmitted = null;
  let busy = false;
  let lastCode = "";
  let lastCodeAt = 0;

  // ---------- משוב: צליל, רטט, צבע ----------
  let audio;
  const beep = (ok) => {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = ok ? 880 : 220; o.type = ok ? "sine" : "square";
      g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.35));
    } catch {}
    try { navigator.vibrate?.(ok ? 60 : [120, 60, 120]); } catch {}
  };
  const TITLES = {
    ok: "כניסה", used: "כבר נכנס/ה", refunded: "כרטיס שהוחזר", unknown: "קוד לא מוכר", wrong_show: "כרטיס להופעה אחרת",
    undone: "הכניסה בוטלה", queued: "כניסה (בלי קליטה)",
  };
  function show(result, ticket, detail = "") {
    const el = $("[data-result]");
    el.className = `da-result ${["ok", "queued", "undone"].includes(result) ? "good" : "bad"}`;
    $("[data-r-title]").textContent = TITLES[result] || result;
    $("[data-r-name]").textContent = ticket ? `${ticket.name}${ticket.q ? ` · כרטיס ${ticket.q}` : ""}` : "";
    $("[data-r-detail]").textContent =
      detail || (ticket?.named && result === "ok" ? "כרטיס שמי: בדקו תעודה מזהה עם השם הזה" : result === "used" && ticket?.used_at ? `נכנס/ה ב-${new Date(ticket.used_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : "");
    $("[data-undo]").hidden = !(result === "ok" && ticket?.id && online);
    lastAdmitted = result === "ok" ? ticket : null;
    beep(["ok", "queued", "undone"].includes(result));
  }

  // ---------- רשת ----------
  async function post(path, body) {
    const res = await fetch(`${api}/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-door-csrf": csrf }, body: JSON.stringify({ ...body, device }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.result) throw Object.assign(new Error(data.error || "שגיאה"), { status: res.status });
    return data;
  }
  function setStats(s) {
    if (!s) return;
    $("[data-inside]").textContent = s.inside;
    $("[data-total]").textContent = s.total;
    if (s.last15 !== undefined) $("[data-last15]").textContent = s.last15;
  }
  async function loadManifest() {
    try {
      const res = await fetch(`${api}/manifest`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const m = await res.json();
      tickets = new Map(m.tickets.map((t) => [t.h, t]));
      store.set("manifest", m.tickets);
      setStats(m.stats);
      $("[data-synced]").textContent = `הרשימה עודכנה ${new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {}
  }
  function setOnline(v) {
    online = v;
    $("[data-net]").hidden = v;
    $("[data-pending]").textContent = queue.length;
  }
  async function flush() {
    if (!queue.length || !navigator.onLine) return;
    try {
      const r = await post("sync", { items: queue });
      const conflicts = r.results.filter((x) => x.result === "conflict").length;
      queue = [];
      store.set("queue", queue);
      setOnline(true);
      setStats(r.stats);
      if (conflicts) show("used", null, `${conflicts} כרטיסים שנסרקו בלי קליטה כבר נכנסו מדלת אחרת`);
      loadManifest();
    } catch {}
  }

  // ---------- בדיקה בלי קליטה ----------
  async function hash(code) {
    const n = code.toUpperCase().replace(/^JOT-/, "").replace(/[^A-Z0-9]/g, "").slice(0, 20);
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(n));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }
  async function admitOffline(code) {
    const t = tickets.get(await hash(code));
    if (!t) return show("unknown", null, "בלי קליטה: הכרטיס לא ברשימה שנטענה");
    if (t.s === "refunded") return show("refunded", { name: t.n, q: t.q });
    if (t.s === "used") return show("used", { name: t.n, q: t.q });
    t.s = "used";
    store.set("manifest", [...tickets.values()]);
    queue.push({ id: t.id, at: new Date().toISOString() });
    store.set("queue", queue);
    setOnline(false);
    $("[data-inside]").textContent = Number($("[data-inside]").textContent) + 1;
    show("queued", { name: t.n, q: t.q, named: t.named }, t.named ? "כרטיס שמי: בדקו תעודה מזהה עם השם הזה" : "");
  }

  async function check(code) {
    if (busy || !code) return;
    busy = true;
    try {
      if (!navigator.onLine) return await admitOffline(code);
      const r = await post("check", { code });
      setOnline(true);
      setStats(r.stats);
      show(r.result, r.ticket);
    } catch (e) {
      if (e.status) show("unknown", null, e.message);
      else await admitOffline(code);
    } finally {
      busy = false;
    }
  }

  // ---------- מצלמה ----------
  const video = $("video");
  const canvas = $("canvas");
  const g = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
      await video.play();
      $("[data-start]").hidden = true;
      try { localStorage.setItem("door-camera", "1"); } catch {}
      requestAnimationFrame(tick);
    } catch {
      $("[data-start]").hidden = false;
      $("[data-start]").textContent = "אין גישה למצלמה. אפשר להקליד קוד למטה";
    }
  }
  function tick() {
    if (!stream) return;
    if (video.readyState >= 2 && window.jsQR && !busy) {
      const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
      canvas.width = w; canvas.height = h;
      g.drawImage(video, 0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      const qr = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      const now = Date.now();
      // אותו קוד לא נסרק שוב תוך 3 שניות (המצלמה רואה אותו כמה פעמים בשנייה)
      if (qr?.data && !(qr.data === lastCode && now - lastCodeAt < 3000)) {
        lastCode = qr.data; lastCodeAt = now;
        check(qr.data);
      }
    }
    requestAnimationFrame(tick);
  }
  $("[data-start]").addEventListener("click", startCamera);
  try { if (localStorage.getItem("door-camera") === "1") startCamera(); } catch {}

  // ---------- הקלדה, חיפוש, ביטול ----------
  $("[data-manual]").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("[data-code]");
    check(input.value.trim());
    input.value = "";
  });
  $("[data-undo]").addEventListener("click", async () => {
    if (!lastAdmitted?.id) return;
    try {
      const r = await post("undo", { id: lastAdmitted.id });
      setStats(r.stats);
      show("undone", r.ticket);
    } catch (e) { show("unknown", null, e.message); }
  });
  let qTimer;
  $("[data-q]").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    const q = e.target.value.trim();
    qTimer = setTimeout(async () => {
      const list = $("[data-results]");
      list.replaceChildren();
      if (q.length < 2) return;
      let rows = [];
      if (navigator.onLine) {
        try { rows = await (await fetch(`${api}/search?q=${encodeURIComponent(q)}`)).json(); } catch {}
      } else {
        rows = [...tickets.values()].filter((t) => t.n.includes(q)).slice(0, 12).map((t) => ({ id: t.id, name: t.n, q: t.q, status: t.s }));
      }
      for (const t of rows) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.disabled = t.status === "used";
        b.textContent = `${t.name}${t.buyer && t.buyer !== t.name ? ` (הזמנה של ${t.buyer})` : ""} · ${t.q}${t.status === "used" ? " · כבר נכנס/ה" : ""}`;
        b.addEventListener("click", async () => {
          if (!navigator.onLine) {
            const m = [...tickets.values()].find((x) => x.id === t.id);
            if (m && m.s === "valid") {
              m.s = "used"; queue.push({ id: t.id, at: new Date().toISOString() }); store.set("queue", queue); store.set("manifest", [...tickets.values()]);
              setOnline(false); show("queued", { name: m.n, q: m.q, named: m.named });
            }
            return;
          }
          const r = await post("checkid", { id: t.id });
          setStats(r.stats);
          show(r.result, r.ticket);
          b.disabled = true;
        });
        li.append(b);
        list.append(li);
      }
    }, 250);
  });

  // ---------- סנכרון ----------
  window.addEventListener("online", () => { setOnline(true); flush(); });
  window.addEventListener("offline", () => setOnline(false));
  setOnline(navigator.onLine);
  loadManifest().then(flush);
  setInterval(() => { if (navigator.onLine) { flush(); loadManifest(); } }, 30_000);
})();
