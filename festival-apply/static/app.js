"use strict";

const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async send(url, method, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

const state = { festivals: [], current: null, generated: null };

// ---- Master asset profile fields (mirrors app/models.py:Assets) ----
const ASSET_FIELDS = [
  { key: "act_name", label: "Act / artist name" },
  { key: "contact_name", label: "Primary contact name" },
  { key: "email", label: "Contact email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "based_in", label: "Based in (town/region)" },
  { key: "country", label: "Country" },
  { key: "genre", label: "Genre / style" },
  { key: "members", label: "Number of performers", type: "number" },
  { key: "years_active", label: "Years active" },
  { key: "one_liner", label: "One-line tagline", wide: true },
  { key: "short_bio", label: "Short bio (~60 words)", type: "textarea", wide: true },
  { key: "bio", label: "Full bio (longer — the LLM trims this per festival)", type: "textarea", wide: true },
  { key: "influences", label: "Influences / similar artists", wide: true },
  { key: "press_quotes", label: "Press quotes / reviews", type: "textarea", wide: true },
  { key: "website", label: "Website", type: "url" },
  { key: "facebook", label: "Facebook", type: "url" },
  { key: "instagram", label: "Instagram", type: "url" },
  { key: "youtube", label: "YouTube (live video)", type: "url" },
  { key: "spotify", label: "Spotify", type: "url" },
  { key: "bandcamp", label: "Bandcamp", type: "url" },
  { key: "epk", label: "EPK / press kit link", type: "url" },
  { key: "photo_urls", label: "Photo links (one per line)", type: "textarea", wide: true },
  { key: "availability", label: "Availability notes", type: "textarea", wide: true },
  { key: "fee", label: "Fee expectation" },
];

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => switchTab(t.dataset.tab)));

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "drafts") loadDrafts();
}

// ---------- LLM badge ----------
async function refreshLLM() {
  const badge = document.getElementById("llm-badge");
  try {
    const s = await api.get("/api/llm/status");
    badge.textContent = s.available ? `LLM: ${s.model.split("/").pop()}` : "LLM: fallback";
    badge.title = s.reason || "";
    badge.classList.toggle("on", !!s.available);
    badge.classList.toggle("off", !s.available);
  } catch { badge.textContent = "LLM: ?"; }
}

// ---------- Festivals ----------
async function loadFilters() {
  const f = await api.get("/api/festivals/filters");
  const fill = (id, vals) => {
    const sel = document.getElementById(id);
    vals.forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
  };
  fill("f-region", f.regions); fill("f-country", f.countries);
  fill("f-genre", f.genres); fill("f-status", f.statuses);
}

async function loadFestivals() {
  const p = new URLSearchParams();
  const add = (id, key) => { const v = document.getElementById(id).value; if (v) p.set(key, v); };
  add("f-search", "search"); add("f-region", "region"); add("f-country", "country");
  add("f-genre", "genre"); add("f-status", "status");
  state.festivals = await api.get("/api/festivals?" + p.toString());
  renderFestivals();
}

function renderFestivals() {
  const list = document.getElementById("festival-list");
  document.getElementById("f-count").textContent = `${state.festivals.length} festivals`;
  list.innerHTML = "";
  state.festivals.forEach((f) => {
    const card = document.createElement("div");
    card.className = "card";
    const dates = [f.next_edition, f.application_window].filter(Boolean).join(" · ");
    card.innerHTML = `
      <span class="status ${f.application_status}">${f.application_status}</span>
      <h3>${esc(f.name)}</h3>
      <div class="loc">📍 ${esc(f.location)} — ${esc(f.country)}</div>
      <div class="tags">${(f.genres || []).slice(0, 5).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>
      <div class="meta">🗓 ${esc(f.festival_month || "")}${f.next_edition ? " · " + esc(f.next_edition) : ""}</div>
      ${f.application_window ? `<div class="meta">📝 ${esc(f.application_window)}</div>` : ""}
      ${(f.headliners || []).length ? `<div class="meta">🎵 ${esc((f.headliners || []).join(", "))}</div>` : ""}
      <div class="card-actions">
        <button class="primary" data-id="${f.id}">Build application</button>
        <a class="ghost" href="${esc(f.application_url || f.url)}" target="_blank" rel="noopener">Site ↗</a>
      </div>`;
    card.querySelector("button").addEventListener("click", () => openApplication(f.id));
    list.appendChild(card);
  });
}

["f-search", "f-region", "f-country", "f-genre", "f-status"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener(id === "f-search" ? "input" : "change", debounce(loadFestivals, 250));
});

// ---------- Assets ----------
async function loadAssets() {
  const data = await api.get("/api/assets");
  const form = document.getElementById("assets-form");
  form.innerHTML = "";
  ASSET_FIELDS.forEach((f) => {
    const wrap = document.createElement("div");
    wrap.className = "field" + (f.wide ? " wide" : "");
    let val = data[f.key];
    if (f.key === "photo_urls" && Array.isArray(val)) val = val.join("\n");
    const input = f.type === "textarea"
      ? `<textarea id="a-${f.key}">${esc(val ?? "")}</textarea>`
      : `<input id="a-${f.key}" type="${f.type || "text"}" value="${esc(val ?? "")}" />`;
    wrap.innerHTML = `<label for="a-${f.key}">${f.label}</label>${input}`;
    form.appendChild(wrap);
  });
}

document.getElementById("save-assets").addEventListener("click", async () => {
  const payload = {};
  ASSET_FIELDS.forEach((f) => {
    let v = document.getElementById(`a-${f.key}`).value;
    if (f.key === "photo_urls") v = v.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (f.type === "number") v = v === "" ? null : Number(v);
    payload[f.key] = v;
  });
  const status = document.getElementById("assets-status");
  try { await api.send("/api/assets", "PUT", payload); status.textContent = "✓ Saved"; }
  catch (e) { status.textContent = "Error: " + e.message; }
  setTimeout(() => (status.textContent = ""), 2500);
});

// ---------- Application modal ----------
const modal = document.getElementById("modal");
document.getElementById("modal-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

async function openApplication(id) {
  const f = await api.get(`/api/festivals/${id}`);
  state.current = f; state.generated = null;
  document.getElementById("modal-header").innerHTML = `
    <h2>${esc(f.name)}</h2>
    <div class="muted">📍 ${esc(f.location)} · 🗓 ${esc(f.next_edition || f.festival_month || "")}</div>
    <div class="muted">📝 ${esc(f.application_window || "")}</div>
    ${f.form_platform ? `<div class="muted">Form: ${esc(f.form_platform)}</div>` : ""}`;
  document.getElementById("open-form").href = f.application_url || f.url;
  document.getElementById("generated-fields").innerHTML =
    `<p class="muted">Click “Generate application” to map your saved assets onto this festival's ${f.form_fields.length} form fields.</p>`;
  document.getElementById("generate-status").textContent = "";
  modal.classList.remove("hidden");
}

document.getElementById("generate-btn").addEventListener("click", async () => {
  const status = document.getElementById("generate-status");
  const useLlm = document.getElementById("use-llm").checked;
  status.textContent = useLlm ? "Generating (LLM may take a moment)…" : "Generating…";
  try {
    const res = await api.send(`/api/festivals/${state.current.id}/generate`, "POST", { use_llm: useLlm });
    state.generated = res;
    renderGenerated(res);
    status.textContent = `✓ ${res.fields.length} fields · ${res.llm.available && useLlm ? "LLM used" : "deterministic fallback"}`;
  } catch (e) { status.textContent = "Error: " + e.message; }
});

function renderGenerated(res) {
  const c = document.getElementById("generated-fields");
  c.innerHTML = "";
  res.fields.forEach((f) => {
    const div = document.createElement("div");
    div.className = "gfield";
    const big = f.type === "textarea" || (f.value && f.value.length > 60);
    const control = big
      ? `<textarea data-key="${f.key}">${esc(f.value)}</textarea>`
      : `<input data-key="${f.key}" type="text" value="${esc(f.value)}" />`;
    const badges = [
      f.required ? '<span class="req">*required</span>' : "",
      f.llm_used ? '<span class="badge llm">LLM</span>' : "",
      f.needs_review ? '<span class="badge review">needs input</span>' : "",
      f.max_words ? `<span class="wordcount" data-max="${f.max_words}"></span>` : "",
    ].filter(Boolean).join(" ");
    div.innerHTML = `
      <div class="gfield-head"><strong>${esc(f.label)}</strong><span>${badges}</span></div>
      ${control}
      ${f.note ? `<div class="note">${esc(f.note)}${f.source_field ? " · from <code>" + esc(f.source_field) + "</code>" : ""}</div>` : ""}`;
    c.appendChild(div);
    const ctrl = div.querySelector("[data-key]");
    const wc = div.querySelector(".wordcount");
    if (wc) { const upd = () => { const n = ctrl.value.trim().split(/\s+/).filter(Boolean).length; const max = +wc.dataset.max; wc.textContent = `${n}/${max} words`; wc.classList.toggle("over", n > max); }; ctrl.addEventListener("input", upd); upd(); }
  });
}

function collectValues() {
  const out = {};
  document.querySelectorAll("#generated-fields [data-key]").forEach((el) => (out[el.dataset.key] = el.value));
  return out;
}

document.getElementById("copy-all").addEventListener("click", () => {
  if (!state.generated) return;
  const vals = collectValues();
  const text = state.generated.fields
    .map((f) => `${f.label}:\n${vals[f.key] || ""}`).join("\n\n");
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById("generate-status").textContent = "✓ Copied all fields to clipboard";
  });
});

document.getElementById("save-draft").addEventListener("click", async () => {
  if (!state.current) return;
  const status = document.getElementById("generate-status");
  try {
    await api.send("/api/applications", "POST", { festival_id: state.current.id, values: collectValues() });
    status.textContent = "✓ Draft saved";
  } catch (e) { status.textContent = "Error: " + e.message; }
});

// ---------- Drafts ----------
async function loadDrafts() {
  const list = document.getElementById("drafts-list");
  const drafts = await api.get("/api/applications");
  list.innerHTML = drafts.length ? "" : '<p class="muted">No saved drafts yet.</p>';
  drafts.forEach((d) => {
    const card = document.createElement("div");
    card.className = "card";
    const filled = Object.values(d.values).filter((v) => v && String(v).trim()).length;
    card.innerHTML = `
      <h3>${esc(d.festival_name || "Festival #" + d.festival_id)}</h3>
      <div class="meta">Status: ${esc(d.status)} · ${filled} fields filled</div>
      <div class="meta">Updated ${esc((d.updated_at || "").slice(0, 16).replace("T", " "))}</div>
      <div class="card-actions"><button class="primary" data-id="${d.festival_id}">Reopen festival</button></div>`;
    card.querySelector("button").addEventListener("click", () => { switchTab("festivals"); openApplication(d.festival_id); });
    list.appendChild(card);
  });
}

// ---------- helpers ----------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- init ----------
(async function init() {
  await Promise.all([refreshLLM(), loadFilters(), loadFestivals(), loadAssets()]);
})();
