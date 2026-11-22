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
  { key: "spacing", label: "ריווח בין אותיות", min: 0.5, max: 1.8, step: 0.01 },
  { key: "weight_scale", label: "טווח העובי (דק ↔ עבה)", min: 0.6, max: 1.25, step: 0.01, hint: "מזיז את כל המשקלים יחד" },
  { key: "head", label: "ראש ו׳ / י׳ / נ׳", min: 0.12, max: 0.4, step: 0.01 },
  { key: "ascender", label: "גובה הזנב של ל׳", min: 0.25, max: 0.6, step: 0.01 },
  { key: "descender", label: "עומק ך ן ף ץ ק", min: 0.25, max: 0.6, step: 0.01 },
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

function init() {
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
