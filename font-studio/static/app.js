"use strict";

const DEFAULTS = {
  family: "Otiyot", height: 540, width: 1.0, contrast: 1.2, roundness: 0.5,
  slant: 0, spacing: 1.0, head: 0.24, ascender: 0.42, descender: 0.45, weight_scale: 1.0,
};

const SHAPE = [
  { key: "height", label: "גובה האותיות", min: 420, max: 680, step: 1, hint: "גבוה = בולט וקריא יותר בגדלים קטנים" },
  { key: "width", label: "רוחב", min: 0.7, max: 1.4, step: 0.01 },
  { key: "contrast", label: "ניגודיות (אופקי מול אנכי)", min: 0.6, max: 2.0, step: 0.01, hint: "מעל 1: הקווים האופקיים עבים יותר, כמו בכתב העברי המסורתי" },
  { key: "roundness", label: "עיגול פינות", min: 0, max: 1, step: 0.01 },
  { key: "slant", label: "נטייה (מעלות)", min: -14, max: 14, step: 0.5 },
];
const DETAIL = [
  { key: "spacing", label: "ריווח בין אותיות", min: 0.3, max: 1.8, step: 0.01 },
  { key: "weight_scale", label: "טווח העובי (דק ↔ עבה)", min: 0.6, max: 1.25, step: 0.01, hint: "מזיז את כל המשקלים יחד" },
  { key: "head", label: "ראש ו׳ / י׳ / נ׳", min: 0.05, max: 0.4, step: 0.01 },
  { key: "ascender", label: "גובה הזנב של ל׳", min: 0.15, max: 0.6, step: 0.01 },
  { key: "descender", label: "עומק ך ן ף ץ ק", min: 0.15, max: 0.6, step: 0.01 },
];

const PRESETS = [
  { name: "גאומטרי", p: { roundness: 0.3, contrast: 1.15, width: 1.0, height: 540 } },
  { name: "רך ועגול", p: { roundness: 1.0, contrast: 1.0, width: 1.06, spacing: 1.06, height: 530 } },
  { name: "צר וגבוה", p: { width: 0.78, height: 620, roundness: 0.25, contrast: 1.3, spacing: 0.9 } },
  { name: "קלאסי", p: { contrast: 1.85, roundness: 0.12, width: 0.95, head: 0.3 } },
  { name: "רחב וידידותי", p: { width: 1.25, height: 500, roundness: 0.7, spacing: 1.15, contrast: 1.05 } },
  { name: "נוטה", p: { slant: 9, roundness: 0.5, width: 0.92 } },
];

const LETTERS = [
  ["א", "אלף"], ["ב", "בית"], ["ג", "גימל"], ["ד", "דלת"], ["ה", "הא"], ["ו", "וו"],
  ["ז", "זין"], ["ח", "חית"], ["ט", "טית"], ["י", "יוד"], ["כ", "כף"], ["ך", "כף סופית"],
  ["ל", "למד"], ["מ", "מם"], ["ם", "מם סופית"], ["נ", "נון"], ["ן", "נון סופית"], ["ס", "סמך"],
  ["ע", "עין"], ["פ", "פא"], ["ף", "פא סופית"], ["צ", "צדי"], ["ץ", "צדי סופית"], ["ק", "קוף"],
  ["ר", "ריש"], ["ש", "שין"], ["ת", "תו"], ["!", ""], ["?", ""], ["״", ""],
];
const WEIGHTS = [[100, "Thin"], [200, "ExtraLight"], [300, "Light"], [400, "Regular"], [500, "Medium"],
  [600, "SemiBold"], [700, "Bold"], [800, "ExtraBold"], [900, "Black"]];

const $ = (s) => document.querySelector(s);
const STORE = "font-studio-params-v1";

let params = load();
let faceCounter = 0;
let currentFace = null;
let pending = null;
let timer = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") return { ...DEFAULTS, ...saved };
  } catch (_) { /* storage unavailable */ }
  return { ...DEFAULTS };
}
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(params)); } catch (_) { /* ignore */ }
}

function fmt(v, step) {
  return step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2);
}

function buildControls(container, defs) {
  for (const d of defs) {
    const wrap = document.createElement("div");
    wrap.className = "ctl";
    const id = `p-${d.key}`;
    wrap.innerHTML = `<label for="${id}">${d.label} <output id="${id}-out"></output></label>
      <input id="${id}" type="range" min="${d.min}" max="${d.max}" step="${d.step}">
      ${d.hint ? `<small>${d.hint}</small>` : ""}`;
    container.appendChild(wrap);
    const input = wrap.querySelector("input");
    input.addEventListener("input", () => {
      params[d.key] = Number(input.value);
      wrap.querySelector("output").textContent = fmt(input.value, d.step);
      scheduleBuild();
    });
  }
}

function syncControls() {
  for (const d of [...SHAPE, ...DETAIL]) {
    const input = $(`#p-${d.key}`);
    input.value = params[d.key];
    $(`#p-${d.key}-out`).textContent = fmt(params[d.key], d.step);
  }
  $("#family").value = params.family;
}

function setStatus(text, err = false) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("err", err);
}

function scheduleBuild() {
  persist();
  clearTimeout(timer);
  timer = setTimeout(rebuild, 160);
}

async function rebuild() {
  if (pending) pending.abort();
  const ctrl = new AbortController();
  pending = ctrl;
  setStatus("בונה את הפונט…");
  const t0 = performance.now();
  try {
    const res = await fetch("/api/font", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const buf = await res.arrayBuffer();
    const name = `StudioFont${++faceCounter}`;
    const face = new FontFace(name, buf, { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
    document.documentElement.style.setProperty("--studio", `"${name}", system-ui, sans-serif`);
    if (currentFace) document.fonts.delete(currentFace);
    currentFace = face;
    setStatus(`מוכן · ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    if (e.name !== "AbortError") setStatus(`שגיאה: ${e.message}`, true);
  } finally {
    if (pending === ctrl) pending = null;
  }
}

function buildPresets() {
  const box = $("#presets");
  for (const pr of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pr.name;
    b.addEventListener("click", () => {
      params = { ...DEFAULTS, family: params.family, ...pr.p };
      syncControls();
      scheduleBuild();
    });
    box.appendChild(b);
  }
}

function buildAlphabet() {
  const box = $("#alphabet");
  for (const [ch, name] of LETTERS) {
    const c = document.createElement("div");
    c.className = "cell";
    c.innerHTML = `<div class="g"></div><div class="n"></div>`;
    c.querySelector(".g").textContent = ch;
    c.querySelector(".n").textContent = name;
    box.appendChild(c);
  }
}

function buildWaterfall() {
  const box = $("#waterfall");
  for (const [w, n] of WEIGHTS) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="lbl">${w} · ${n}</span><span class="smp" style="font-weight:${w}">שלום, אני הפונט החדש שלך</span>`;
    box.appendChild(row);
  }
}

function tabs() {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tabs [data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
      document.querySelectorAll(".tab").forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
      document.body.classList.toggle("editing", b.dataset.tab === "edit");
    });
  });
}

function reference() {
  const img = $("#ref-img");
  const text = $("#ref-text");
  const stage = $("#ref-stage");
  $("#ref-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    img.src = URL.createObjectURL(f);
    img.hidden = false;
    $("#ref-empty").hidden = true;
  });
  const apply = () => {
    img.style.opacity = $("#ref-opacity").value;
    text.style.fontSize = `${$("#ref-size").value}px`;
    text.style.transform = `translate(${$("#ref-x").value}px, ${$("#ref-y").value}px)`;
    stage.className = `ref-stage ${$("#ref-mode").value}`;
  };
  ["ref-opacity", "ref-size", "ref-x", "ref-y", "ref-mode"].forEach((id) => $(`#${id}`).addEventListener("input", apply));
  apply();
}

async function exportZip() {
  const btn = $("#export");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "מכין קבצים…";
  try {
    const res = await fetch("/api/export", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="([^"]+)"/);
    download(blob, m ? m[1] : "font.zip");
  } catch (e) {
    setStatus(`ההורדה נכשלה: ${e.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const VARIATIONS = [
  { name: "קרוב למקור", hint: "בסיס המדידה", f: (b) => ({}) },
  { name: "רך יותר", hint: "פינות עגולות", f: (b) => ({ roundness: Math.min(1, b.roundness + 0.35), contrast: (b.contrast + 1) / 2 }) },
  { name: "חד יותר", hint: "פינות ישרות", f: (b) => ({ roundness: Math.max(0, b.roundness - 0.35), contrast: b.contrast * 1.12 }) },
  { name: "עברית קלאסית", hint: "אופקיים עבים", f: (b) => ({ contrast: Math.max(1.55, b.contrast * 1.3), roundness: b.roundness * 0.6 }) },
  { name: "רחב ופתוח", hint: "נוח לקריאה", f: (b) => ({ width: b.width + 0.15, spacing: b.spacing + 0.15, height: b.height - 25 }) },
  { name: "צר ודחוס", hint: "לכותרות", f: (b) => ({ width: b.width - 0.13, height: b.height + 40, spacing: b.spacing - 0.08 }) },
];
let inspireBase = null;
let inspireFace = null;

function clampParams(p) {
  const all = [...SHAPE, ...DETAIL];
  for (const d of all) p[d.key] = Math.min(d.max, Math.max(d.min, Number(p[d.key])));
  return p;
}

function setMode(mode) {
  document.querySelectorAll(".seg [data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  ["image", "link", "file"].forEach((m) => { $(`#mode-${m}`).hidden = m !== mode; });
}

async function postAnalyze(url, body, headers) {
  const res = await fetch(url, { method: "POST", headers, body });
  let data;
  try { data = await res.json(); } catch (_) { throw new Error(res.statusText); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadInspirationFont(src) {
  try {
    const face = new FontFace("InspirationFont", src);
    await face.load();
    if (inspireFace) document.fonts.delete(inspireFace);
    document.fonts.add(face);
    inspireFace = face;
    return true;
  } catch (_) { return false; } // e.g. the site does not allow it; comparison falls back
}

let lastImage = null;

function inspiration() {
  document.querySelectorAll(".seg [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  // --- font file
  $("#insp-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await run(async () => {
      const buf = await f.arrayBuffer();
      const data = await postAnalyze("/api/analyze", buf, { "Content-Type": "application/octet-stream" });
      await loadInspirationFont(buf);
      showResult(data, { label: f.name });
    });
  });

  // --- image
  const analyzeImage = async () => {
    if (!lastImage) return;
    await run(async () => {
      const text = $("#insp-text").value;
      const data = await postAnalyze(`/api/analyze-image?text=${encodeURIComponent(text)}`, lastImage.buf,
        { "Content-Type": "application/octet-stream" });
      showResult(data, { label: lastImage.name, imageUrl: lastImage.url, text });
    });
  };
  $("#insp-image").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (lastImage) URL.revokeObjectURL(lastImage.url);
    lastImage = { buf: await f.arrayBuffer(), url: URL.createObjectURL(f), name: f.name };
    $("#insp-reimage").hidden = false;
    analyzeImage();
  });
  $("#insp-reimage").addEventListener("click", analyzeImage);

  // --- link
  const analyzeLink = async () => {
    const url = $("#insp-url").value.trim();
    if (!url) return;
    await run(async () => {
      const text = $("#insp-text").value;
      const data = await postAnalyze("/api/analyze-url", JSON.stringify({ url, text }), { "Content-Type": "application/json" });
      if (data.source.kind === "image") {
        showResult(data, { label: url, imageUrl: data.source.url, text });
      } else {
        const ok = data.source.url ? await loadInspirationFont(`url(${JSON.stringify(data.source.url)})`) : false;
        showResult(data, { label: url, fontShown: ok });
      }
    });
  };
  $("#insp-go").addEventListener("click", analyzeLink);
  $("#insp-url").addEventListener("keydown", (e) => { if (e.key === "Enter") analyzeLink(); });
}

async function run(fn) {
  setStatus("מנתח את ההשראה…");
  try {
    await fn();
  } catch (err) {
    setStatus(`הניתוח נכשל: ${err.message}`, true);
  }
}

function showResult(data, opts) {
  inspireBase = { ...DEFAULTS, family: params.family, ...params, ...data.params };
  renderSummary(data, opts.label);
  const isImage = data.source.kind === "image";
  $("#cmp-image").hidden = !isImage;
  $("#cmp-mine-from-image").hidden = !isImage;
  document.querySelectorAll(".src-row").forEach((r) => { r.hidden = isImage || opts.fontShown === false; });
  document.querySelectorAll(".mine-row").forEach((r) => { r.hidden = isImage; });
  if (isImage) {
    $("#cmp-img").src = opts.imageUrl;
    $("#cmp-image-text").textContent = opts.text || "אבגדהוזחטיכלמנסעפצקרשת";
    const boxes = $("#cmp-boxes");
    boxes.innerHTML = "";
    for (const b of data.boxes || []) {
      const d = document.createElement("div");
      d.className = `box${b.label ? "" : " unmatched"}`;
      Object.assign(d.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
      if (b.label) { const sp = document.createElement("span"); sp.textContent = b.label; d.appendChild(sp); }
      boxes.appendChild(d);
    }
  }
  renderVariations();
  applyVariation(0);
  $("#insp-result").hidden = false;
}

function renderSummary(data, fileName) {
  const m = data.measured;
  const box = $("#insp-summary");
  box.innerHTML = "";
  const title = document.createElement("div");
  title.textContent = data.source.kind === "image"
    ? `נותחה תמונה: ${fileName} · ${data.found_letters} אותיות זוהו${data.matched ? " והותאמו לטקסט" : ""}`
    : `נותח: ${data.source.family || fileName} · משקל ${data.source.weight}${data.source.variable ? " · פונט משתנה" : ""}`;
  box.appendChild(title);
  const dl = document.createElement("dl");
  const items = [
    ["גובה אותיות", m.letter_height], ["עובי קו אנכי", m.stem], ["עובי קו אופקי", m.bar],
    ["רדיוס פינה", m.corner_radius], ["נטייה", `${m.slant_degrees}°`],
  ];
  if (data.source.kind === "image") items.shift(); // height in a picture has no absolute scale
  for (const [k, v] of items) {
    if (v === null || v === undefined || v === "null°") continue;
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    const wrap = document.createElement("div"); wrap.append(dt, dd); dl.appendChild(wrap);
  }
  box.appendChild(dl);
  if (data.note) {
    const n = document.createElement("div");
    n.className = "note";
    n.textContent = data.note;
    box.appendChild(n);
  }
  if (data.source.kind !== "image" && data.missing_letters.length) {
    const w = document.createElement("div");
    w.className = "hint";
    w.textContent = "חלק מהאותיות חסרות בפונט המקורי, אז חלק מהמדידות הן הערכה.";
    box.appendChild(w);
  }
}

function renderVariations() {
  const box = $("#insp-variations");
  box.innerHTML = "";
  VARIATIONS.forEach((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span></span><small></small>`;
    b.querySelector("span").textContent = v.name;
    b.querySelector("small").textContent = v.hint;
    b.addEventListener("click", () => applyVariation(i));
    box.appendChild(b);
  });
}

function applyVariation(i) {
  if (!inspireBase) return;
  params = clampParams({ ...inspireBase, ...VARIATIONS[i].f(inspireBase), family: params.family });
  document.querySelectorAll("#insp-variations button").forEach((b, j) => b.setAttribute("aria-pressed", i === j));
  syncControls();
  scheduleBuild();
}

// ---------------------------------------------------------------------------
// Editing an existing font
// ---------------------------------------------------------------------------

const EDIT_DEFAULTS = {
  base_wght: 0, weight: 0, contrast: 0, width: 1, height: 1, keep_strokes: true,
  slant: 0, tracking: 0, corners: 0, outline: 0, line_height: 1,
};
const EDIT_CONTROLS = [
  { key: "weight", label: "עובי", min: -60, max: 140, step: 1, hint: "מעבה או מדקק את כל הקווים" },
  { key: "contrast", label: "ניגודיות", min: -80, max: 80, step: 1, hint: "ימינה: קווים אופקיים עבים יותר · שמאלה: אנכיים" },
  { key: "width", label: "רוחב", min: 0.6, max: 1.6, step: 0.01 },
  { key: "height", label: "גובה", min: 0.75, max: 1.3, step: 0.01 },
  { key: "keep_strokes", label: "לשמור על עובי הקווים בשינוי רוחב/גובה", type: "check" },
  { key: "slant", label: "נטייה (מעלות)", min: -15, max: 15, step: 0.5 },
  { key: "tracking", label: "ריווח בין אותיות", min: -80, max: 250, step: 1 },
  { key: "corners", label: "עיגול פינות", min: 0, max: 120, step: 1, hint: "בפינות ישרות בלבד" },
  { key: "outline", label: "אפקט קו מתאר (0 = כבוי)", min: 0, max: 60, step: 1 },
  { key: "line_height", label: "רווח בין שורות", min: 1, max: 2, step: 0.01 },
];
const edit = { token: null, buf: null, url: null, summary: null, params: { ...EDIT_DEFAULTS }, faceNew: null, faceOrig: null, timer: null, ctrl: null };

function editControls() {
  const box = $("#edit-controls");
  box.innerHTML = "";
  const axes = (edit.summary.axes || []).find((a) => a.tag === "wght");
  const defs = [...EDIT_CONTROLS];
  if (axes) defs.unshift({ key: "base_wght", label: "משקל בסיס (פונט משתנה)", min: axes.min, max: axes.max, step: 1 });
  for (const d of defs) {
    const wrap = document.createElement("div");
    if (d.type === "check") {
      wrap.className = "check";
      wrap.innerHTML = `<input type="checkbox" id="e-${d.key}"><label for="e-${d.key}"></label>`;
      wrap.querySelector("label").textContent = d.label;
      const cb = wrap.querySelector("input");
      cb.checked = !!edit.params[d.key];
      cb.addEventListener("change", () => { edit.params[d.key] = cb.checked; scheduleEdit(); });
    } else {
      wrap.className = "ctl";
      wrap.innerHTML = `<label for="e-${d.key}"><span></span> <output></output></label>
        <input id="e-${d.key}" type="range" min="${d.min}" max="${d.max}" step="${d.step}">${d.hint ? "<small></small>" : ""}`;
      wrap.querySelector("label span").textContent = d.label;
      if (d.hint) wrap.querySelector("small").textContent = d.hint;
      const input = wrap.querySelector("input");
      if (d.key === "base_wght" && !edit.params.base_wght) edit.params.base_wght = axes.default;
      input.value = edit.params[d.key];
      const out = wrap.querySelector("output");
      out.textContent = fmt(input.value, d.step);
      input.addEventListener("input", () => {
        edit.params[d.key] = Number(input.value);
        out.textContent = fmt(input.value, d.step);
        scheduleEdit();
      });
    }
    box.appendChild(wrap);
  }
  const reset = document.createElement("button");
  reset.className = "ghost";
  reset.textContent = "איפוס השינויים";
  reset.addEventListener("click", () => { edit.params = { ...EDIT_DEFAULTS }; editControls(); scheduleEdit(); });
  box.appendChild(reset);
}

function renderEditInfo() {
  const s = edit.summary;
  const box = $("#edit-info");
  box.innerHTML = "";
  const title = document.createElement("div");
  const feats = [s.hebrew && "עברית", s.niqqud && "ניקוד", s.latin && "לטינית"].filter(Boolean).join(" · ");
  title.textContent = `${s.family} ${s.style || ""} · ${s.glyphs} תווים · ${feats}${s.axes.length ? " · פונט משתנה" : ""}`;
  box.appendChild(title);
  const lic = document.createElement("div");
  lic.style.marginTop = "8px";
  const badge = document.createElement("span");
  const L = s.license;
  badge.className = `badge ${L.free ? "ok" : "warn"}`;
  badge.textContent = L.free ? `רישיון חופשי: ${L.kind}` : "לא נמצא רישיון חופשי";
  const txt = document.createElement("span");
  txt.className = "hint";
  txt.style.marginInlineStart = "8px";
  txt.textContent = L.free
    ? "מותר לשנות ולהשתמש, גם מסחרית. הפונט החדש יישאר תחת אותו רישיון, וחייב לקבל שם חדש."
      + (L.reserved_names.length ? ` שמות שמורים שאסור להשתמש בהם: ${L.reserved_names.join(", ")}.` : "")
    : "ייתכן שזה פונט בתשלום שאסור לשנות. אפשר לנסות ולראות תצוגה, אבל לפני ההורדה צריך לאשר שיש לכם זכות לשנות אותו.";
  lic.append(badge, txt);
  box.appendChild(lic);
  if (!s.hebrew) {
    const w = document.createElement("div"); w.className = "note"; w.textContent = "בפונט הזה אין אותיות עבריות.";
    box.appendChild(w);
  }
  $("#edit-confirm-wrap").hidden = L.free;
}

async function editLoaded(data, buf, url) {
  Object.assign(edit, { token: data.token, summary: data.summary, buf, url, params: { ...EDIT_DEFAULTS } });
  renderEditInfo();
  editControls();
  $("#edit-main").hidden = false;
  await Promise.all([loadEditFace("orig", EDIT_DEFAULTS), loadEditFace("new", edit.params)]);
}

async function editFetch(path, payload, asJson = false) {
  let res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (res.status === 410) { // server forgot the font: upload it again
    await reuploadEdit();
    payload.token = edit.token;
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (_) { /* binary */ }
    throw new Error(msg);
  }
  return asJson ? res.json() : res;
}

async function reuploadEdit() {
  let data;
  if (edit.buf) data = await postAnalyze("/api/edit/upload", edit.buf, { "Content-Type": "application/octet-stream" });
  else data = await postAnalyze("/api/edit/upload-url", JSON.stringify({ url: edit.url }), { "Content-Type": "application/json" });
  edit.token = data.token;
}

async function loadEditFace(which, p) {
  const res = await editFetch("/api/edit/preview", { token: edit.token, params: p });
  const buf = await res.arrayBuffer();
  const fam = which === "orig" ? "EditOriginal" : "EditNew";
  const face = new FontFace(fam, buf);
  await face.load();
  const key = which === "orig" ? "faceOrig" : "faceNew";
  if (edit[key]) document.fonts.delete(edit[key]);
  document.fonts.add(face);
  edit[key] = face;
}

function scheduleEdit() {
  clearTimeout(edit.timer);
  edit.timer = setTimeout(async () => {
    setStatus("מעדכן…");
    const t0 = performance.now();
    try {
      await loadEditFace("new", edit.params);
      setStatus(`מוכן · ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { setStatus(`שגיאה: ${e.message}`, true); }
  }, 140);
}

function editing() {
  $("#edit-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await run(async () => {
      const buf = await f.arrayBuffer();
      const data = await postAnalyze("/api/edit/upload", buf, { "Content-Type": "application/octet-stream" });
      await editLoaded(data, buf, null);
      setStatus("מוכן");
    });
  });
  const fromUrl = async () => {
    const url = $("#edit-url").value.trim();
    if (!url) return;
    await run(async () => {
      setStatus("מוריד את הפונט…");
      const data = await postAnalyze("/api/edit/upload-url", JSON.stringify({ url }), { "Content-Type": "application/json" });
      await editLoaded(data, null, url);
      setStatus("מוכן");
    });
  };
  $("#edit-url-go").addEventListener("click", fromUrl);
  $("#edit-url").addEventListener("keydown", (e) => { if (e.key === "Enter") fromUrl(); });
  $("#edit-export").addEventListener("click", async () => {
    const btn = $("#edit-export");
    btn.disabled = true;
    try {
      const res = await editFetch("/api/edit/export", {
        token: edit.token, confirm_rights: $("#edit-confirm").checked,
        params: { ...edit.params, family: $("#edit-family").value },
      });
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      download(await res.blob(), m ? m[1] : "font.zip");
      setStatus("הפונט הורד");
    } catch (e) {
      setStatus(`ההורדה נכשלה: ${e.message}`, true);
    } finally { btn.disabled = false; }
  });
}

function init() {
  inspiration();
  editing();
  buildControls($("#controls-shape"), SHAPE);
  buildControls($("#controls-detail"), DETAIL);
  buildPresets();
  buildAlphabet();
  buildWaterfall();
  tabs();
  reference();
  syncControls();

  const wght = $("#wght");
  wght.addEventListener("input", () => {
    document.documentElement.style.setProperty("--wght", wght.value);
    $("#wght-out").textContent = wght.value;
  });
  $("#family").addEventListener("input", (e) => { params.family = e.target.value; persist(); });
  $("#family").addEventListener("change", scheduleBuild);
  $("#export").addEventListener("click", exportZip);
  $("#reset").addEventListener("click", () => { params = { ...DEFAULTS }; syncControls(); scheduleBuild(); });
  $("#save-json").addEventListener("click", () => {
    download(new Blob([JSON.stringify(params, null, 2)], { type: "application/json" }), `${params.family || "font"}-params.json`);
  });
  $("#load-json").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      params = { ...DEFAULTS, ...JSON.parse(await f.text()) };
      syncControls();
      scheduleBuild();
    } catch (_) {
      setStatus("הקובץ לא נקרא — צריך קובץ params.json מהסטודיו", true);
    }
  });
  rebuild();
}

init();
