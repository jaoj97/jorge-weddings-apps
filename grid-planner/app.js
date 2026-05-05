/* ============================================================
   Grid Planner · Jorge Weddings
   ============================================================ */

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
// escape HTML para evitar XSS en innerHTML con datos externos
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const STORAGE_KEY = "grid-planner-v1";

// MODO DUAL: localhost usa proxy Python (server.py); producción llama Airtable directo
const IS_LOCAL = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname);
const PAT_KEY = "grid-planner-airtable-pat";
const AIRTABLE_BASE_ID = "appDrl2lAZc8WRXzO";
const AIRTABLE_TABLES = {
  stock:     "tbl2ZrOeAf3FA85HH",
  bodas:     "tbl9kAKJIxhFGRsHJ",
  carousels: "tblaZQEMezwGpbBa1",
  historias: "tblsJRnxye5qBOHA9",
  postear:   "tblIV1ttMwDBukvLL",
};
function getPAT() { return localStorage.getItem(PAT_KEY) || ""; }
function setPAT(v) { localStorage.setItem(PAT_KEY, v); }
function ensurePAT() {
  if (IS_LOCAL) return true;
  if (getPAT()) return true;
  const v = prompt("Pega tu Airtable PAT (Personal Access Token) — se guarda solo en este navegador.\nObtén uno en: https://airtable.com/create/tokens\nAsegúrate que tenga acceso a la base 'Jorge Weddings'.");
  if (v && v.trim()) { setPAT(v.trim()); return true; }
  return false;
}

/* ---------------- STATE ---------------- */
const state = {
  // pool de fotos: id, src, source (manual|airtable), table, recId, rating, boda, capitulo, fechaShoot, slides[], colors[], lum, type
  photos: {},
  // ordenes
  published: [],   // photo ids ya publicados
  planned: [],     // photo ids planeados (futuro)
  gallery: [],     // photo ids en pool externo (no usados)
  gridB: [],       // versión B (split)
  // metadata por slot (caption etc.) keyed por photo id (cuando está en grid)
  meta: {},        // { id: { caption, hashtags, firstComment, location, alt, link, type, scheduled, chapter } }
  // snapshots
  snapshots: [],
  // settings
  cadence: { days: [1,3,5], time: "09:00", start: null },
  hashPool: [],
  filters: { source: "all", search: "", tags: [], ratingOp: ">=", ratingValue: 4 },
  profile: {
    handle: "jorge_ortiz_foto",
    name: "Jorge Ortiz | Wedding photographer Antigua Guatemala",
    pronouns: "he/him",
    category: "Fotógrafo(a)",
    bio: "Capturing love, happiness, spontaneity for those wildly in love 📸",
    link: "jorgeweddings.com",
    followers: "19.6 mil",
    following: "1,288",
    highlights: [
      { label: "BTS", color: "#222" },
      { label: "C+J", color: "#7c2d12" },
      { label: "A+F", color: "#9a3412" },
      { label: "J & J", color: "#65a30d" },
      { label: "L & Z", color: "#a16207" },
    ],
  },
  ui: { theme: "light", view: "profile", overlay: "none", mode: "reorder", zoom: 3, splitView: false,
        colCal: 240, colGal: 360, galZoom: 95, calCollapsed: false, galCollapsed: false,
        tileMode: "square", device: "desktop", phoneZoom: 1 },
  // historia para undo/redo
  history: [],
  histIndex: -1,
  selected: new Set(),
};

/* ---------------- PERSISTENCE ---------------- */
function persistableState() {
  return {
    photos: state.photos,
    published: state.published,
    planned: state.planned,
    gallery: state.gallery,
    gridB: state.gridB,
    meta: state.meta,
    snapshots: state.snapshots,
    cadence: state.cadence,
    hashPool: state.hashPool,
    ui: state.ui,
    filters: state.filters,
    profile: state.profile,
  };
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState())); }
    catch (e) { console.warn("save failed:", e); }
  }, 400);
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    Object.assign(state, d);
    state.history = []; state.histIndex = -1;
    state.selected = new Set();
    return true;
  } catch (e) { console.warn("load failed:", e); return false; }
}

/* ---------------- HISTORY (undo/redo) ---------------- */
function snapshotForUndo() {
  const snap = JSON.stringify({
    photos: state.photos,
    published: state.published, planned: state.planned, gallery: state.gallery, gridB: state.gridB,
    meta: state.meta,
  });
  state.history = state.history.slice(0, state.histIndex + 1);
  state.history.push(snap);
  if (state.history.length > 60) state.history.shift();
  state.histIndex = state.history.length - 1;
}
function undo() {
  if (state.histIndex <= 0) return;
  state.histIndex--;
  applyHist();
}
function redo() {
  if (state.histIndex >= state.history.length - 1) return;
  state.histIndex++;
  applyHist();
}
function applyHist() {
  const d = JSON.parse(state.history[state.histIndex]);
  state.photos = d.photos;
  state.published = d.published; state.planned = d.planned;
  state.gallery = d.gallery; state.gridB = d.gridB;
  state.meta = d.meta;
  renderAll(); save();
}

/* ---------------- TOAST ---------------- */
let toastTimer;
function toast(msg, ms=2200) {
  const el = $("#toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, ms);
}

/* ---------------- IMAGE ANALYSIS (paleta + lum) ---------------- */
async function analyzePhoto(p) {
  if (p.colors && p.lum != null) return;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 32; c.height = 32;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        const buckets = {};
        let lumSum = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          lumSum += 0.299*r + 0.587*g + 0.114*b;
          n++;
          // bucket reducido (4 niveles por canal)
          const key = `${r>>6},${g>>6},${b>>6}`;
          buckets[key] = (buckets[key] || 0) + 1;
        }
        const top = Object.entries(buckets)
          .sort((a,b) => b[1]-a[1])
          .slice(0, 4)
          .map(([k]) => {
            const [r,g,b] = k.split(",").map(v => (parseInt(v) << 6) + 32);
            return [r,g,b];
          });
        p.colors = top;
        p.lum = lumSum / n;
      } catch (e) { p.colors = []; p.lum = 128; }
      resolve();
    };
    img.onerror = () => { p.colors = []; p.lum = 128; resolve(); };
    img.src = p.src;
  });
}
function rgbToHex([r,g,b]) {
  return "#" + [r,g,b].map(v => Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,"0")).join("");
}
function colorDistance(a, b) {
  if (!a || !b) return 999;
  const dr = a[0]-b[0], dg = a[1]-b[1], db = a[2]-b[2];
  return Math.sqrt(dr*dr + dg*dg + db*db);
}
function photosSimilar(p1, p2) {
  if (!p1 || !p2 || !p1.colors || !p2.colors || !p1.colors.length || !p2.colors.length) return false;
  const lumDiff = Math.abs((p1.lum||0) - (p2.lum||0));
  const colDiff = colorDistance(p1.colors[0], p2.colors[0]);
  return lumDiff < 25 && colDiff < 60;
}

/* ---------------- AIRTABLE ---------------- */
async function airtable(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  let url;
  if (IS_LOCAL) {
    url = `/api/airtable/${path}`;
  } else {
    if (!ensurePAT()) return { error: "PAT no configurado" };
    // path = "<tableKey>" o "<tableKey>/<recId>" o "<tableKey>?<query>"
    const m = path.match(/^([^/?]+)(.*)$/);
    const key = m?.[1]; const rest = m?.[2] || "";
    const tbl = AIRTABLE_TABLES[key];
    if (!tbl) return { error: `tabla desconocida: ${key}` };
    url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tbl}${rest}`;
    opts.headers["Authorization"] = "Bearer " + getPAT();
  }
  const r = await fetch(url, opts);
  return r.json();
}

async function fetchAirtableAll(table, params="") {
  let url = `${table}?pageSize=100${params ? "&" + params : ""}`;
  let all = [];
  while (true) {
    const data = await airtable("GET", url);
    if (!data.records) {
      console.warn(table, data);
      return all;
    }
    all = all.concat(data.records);
    if (!data.offset) break;
    url = `${table}?pageSize=100${params ? "&" + params : ""}&offset=${data.offset}`;
  }
  return all;
}

async function syncAirtable() {
  if (!IS_LOCAL && !ensurePAT()) { toast("Configura tu Airtable PAT primero"); return; }
  const btn = document.getElementById("btnSync");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Sincronizando…";
  toast("Sincronizando con Airtable…", 4000);
  try {
    // Stock photos: traemos TODAS, los tabs filtran client-side (Stock = carousel=✓, Todo = rating)
    const stockFields = "fields[]=Foto&fields[]=Boda&fields[]=Rating LR&fields[]=Fecha del shoot&fields[]=Color&fields[]=Mood&fields[]=Orientación&fields[]=Filename&fields[]=Caption sugerida&fields[]=carousel&fields[]=Aspect ratio";
    const [carousels, stock, historias, postear] = await Promise.all([
      fetchAirtableAll("carousels"),
      fetchAirtableAll("stock", stockFields),
      fetchAirtableAll("historias"),
      fetchAirtableAll("postear"),
    ]);
    btn.textContent = `Procesando ${carousels.length + stock.length + historias.length + postear.length}…`;
    // pre-borrar fotos de las fuentes Airtable que ya no existen en el sync (sincronización fresca)
    const liveIds = new Set([
      ...carousels.map(r => "at_car_" + r.id),
      ...stock.map(r => "at_stk_" + r.id),
      ...historias.map(r => "at_his_" + r.id),
      ...postear.map(r => "at_pos_" + r.id),
    ]);

    let added = 0;
    // CAROUSELS — slide 1 = portada, resto en slides[]
    for (const r of carousels) {
      const fotos = r.fields["Fotos"] || [];
      if (!fotos.length) continue;
      const id = "at_car_" + r.id;
      if (!state.photos[id]) {
        state.photos[id] = {
          id, source: "carousels", table: "carousels", recId: r.id,
          src: proxyUrl(fotos[0].url),
          origUrl: fotos[0].url,
          slidesOrig: fotos.map(f => f.url),
          slides: fotos.map(f => proxyUrl(f.url)),
          capitulo: r.fields["Capítulo"] || "",
          boda: r.fields["Bodas incluidas"] || "",
          fecha: r.fields["Fecha"] || null,
          status: r.fields["Status"] || null,
          etiquetas: r.fields["Etiquetas"] || "",
          rating: 5,
          type: "carousel",
        };
        added++;
      }
    }
    // STOCK — guardo TODAS, los tabs filtran client-side
    for (const r of stock) {
      const fotos = r.fields["Foto"] || [];
      if (!fotos.length) continue;
      const id = "at_stk_" + r.id;
      const photo = {
        id, source: "stock", table: "stock", recId: r.id,
        src: proxyUrl(fotos[0].url),
        origUrl: fotos[0].url,
        rating: r.fields["Rating LR"] || 0,
        capitulo: "", boda: (r.fields["Boda"]||[]).join(","),
        fecha: r.fields["Fecha del shoot"] || null,
        color: r.fields["Color"] || "",
        mood: (r.fields["Mood"]||[]).join(", "),
        orient: r.fields["Orientación"] || "",
        filename: r.fields["Filename"] || "",
        carousel: !!r.fields["carousel"],
        aspectRatio: r.fields["Aspect ratio"] || null,
        type: "photo",
      };
      if (!state.photos[id]) added++;
      // siempre actualizar (refresca rating/carousel checkbox)
      state.photos[id] = { ...(state.photos[id]||{}), ...photo };
    }
    // HISTORIAS
    for (const r of historias) {
      const fotos = r.fields["Fotos"] || [];
      if (!fotos.length) continue;
      const id = "at_his_" + r.id;
      if (!state.photos[id]) {
        state.photos[id] = {
          id, source: "historias", table: "historias", recId: r.id,
          src: proxyUrl(fotos[0].url),
          origUrl: fotos[0].url,
          slidesOrig: fotos.map(f => f.url),
          slides: fotos.map(f => proxyUrl(f.url)),
          capitulo: r.fields["Capítulo"] || "",
          boda: r.fields["Bodas incluidas"] || "",
          fecha: r.fields["Fecha"] || null,
          rating: 4,
          type: "story",
        };
        added++;
      }
    }
    // POSTEAR — éstos van directo a "publicado" si status=published
    for (const r of postear) {
      const att = r.fields["attachement"] || [];
      if (!att.length) continue;
      const id = "at_pos_" + r.id;
      if (!state.photos[id]) {
        state.photos[id] = {
          id, source: "postear", table: "postear", recId: r.id,
          src: proxyUrl(att[0].url),
          origUrl: att[0].url,
          fecha: r.fields["publish date"] || null,
          status: r.fields["status"] || "",
          platform: (r.fields["platform"]||[]).join(", "),
          caption: r.fields["copy post"] || "",
          type: "photo",
        };
        added++;
        // si status=published o publicado → al published; si no, a galería
        const st = (r.fields["status"]||"").toLowerCase();
        if (st.includes("publish") || st.includes("publicado")) {
          state.published.push(id);
        } else {
          state.gallery.push(id);
        }
        continue;
      }
    }

    // PURGAR fotos borradas en Airtable: si una foto era de Airtable y ya no está en liveIds, eliminarla
    let removed = 0;
    for (const id of Object.keys(state.photos)) {
      if (id.startsWith("at_") && !liveIds.has(id)) {
        delete state.photos[id];
        state.gallery   = state.gallery.filter(x => x !== id);
        state.published = state.published.filter(x => x !== id);
        state.planned   = state.planned.filter(x => x !== id);
        state.gridB     = state.gridB.filter(x => x !== id);
        delete state.meta[id];
        removed++;
      }
    }
    // todo lo nuevo de carousels/stock/historias va a la galería externa
    for (const id of Object.keys(state.photos)) {
      if (!isPlaced(id)) {
        if (!state.gallery.includes(id)) state.gallery.push(id);
      }
    }
    if (removed) console.info(`[sync] purgadas ${removed} fotos eliminadas en Airtable`);

    snapshotForUndo();
    renderAll(); save();
    toast(`Sincronizado · ${added} nuevas · carousels: ${carousels.length} · stock: ${stock.length} · historias: ${historias.length} · postear: ${postear.length}`, 5000);
  } catch (e) {
    console.error(e);
    toast("Error sincronizando — revisa la consola del server: " + e.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function proxyUrl(url) {
  // localhost: usar proxy Python (permite leer pixeles en canvas sin CORS)
  // producción: usar URL directa de Airtable CDN. img tag funciona; el análisis
  // de paleta/luminosidad se desactivará graciosamente cuando CORS bloquee.
  return IS_LOCAL ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

function isPlaced(id) {
  return state.published.includes(id) || state.planned.includes(id) || state.gridB.includes(id);
}

/* ---------------- PUSH A AIRTABLE (Postear) ---------------- */
async function pushToAirtable() {
  if (!state.planned.length) { toast("No hay nada en 'planeado'"); return; }
  if (!confirm(`¿Crear ${state.planned.length} registros en tabla "Postear"?`)) return;
  toast("Subiendo a Airtable…", 4000);
  // dates calculadas según cadencia (fallback si no hay m.scheduled)
  const dates = computeDates();
  const items = state.planned.map((id, gridPos) => {
    const p = state.photos[id] || {}; const m = state.meta[id] || {};
    // Para attachment: necesitamos URL pública.
    //   - origUrl = URL real de Airtable CDN (firmada, válida ~24h)
    //   - data: URL de upload manual → Airtable la acepta sólo si es < 5MB y el endpoint la decodea (no siempre)
    //   - proxy /api/proxy-image: localhost, Airtable NO lo puede leer
    const attachments = [];
    if (p.origUrl) attachments.push({ url: p.origUrl, filename: p.filename || "photo.jpg" });
    else if (p.src && p.src.startsWith("data:")) attachments.push({ url: p.src, filename: p.filename || "photo.jpg" });
    // si solo hay proxy URL, no podemos enviarlo (Airtable no llega a localhost)
    const fields = {
      Name: m.chapter || p.capitulo || `Post #${gridPos+1}`,
      "publish date": m.scheduled || (dates[gridPos] ? dates[gridPos].toISOString() : null),
      "copy post": [m.caption||"", m.hashtags||"", m.firstComment ? "\n\n— Primer comentario —\n"+m.firstComment : ""].filter(Boolean).join("\n\n") || (p.caption || ""),
      status: "to post",
      platform: ["instagram"],
      "content destination": "post",
    };
    if (attachments.length) fields.attachement = attachments;
    return { localId: id, fields, hasAttachment: attachments.length > 0 };
  });

  let ok = 0, failed = 0;
  const errors = [];
  const subidos = new Set();   // localIds que sí se subieron
  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i+10);
    try {
      const r = await airtable("POST", "postear", { records: chunk.map(({ fields }) => ({ fields })) });
      if (r.error || !r.records) {
        failed += chunk.length;
        errors.push(r.error?.message || r.error?.type || "respuesta inválida");
      } else {
        ok += r.records.length;
        chunk.forEach(c => subidos.add(c.localId));
      }
    } catch (e) {
      failed += chunk.length;
      errors.push(String(e.message || e));
    }
  }
  // mover los subidos de planned → published para evitar re-push duplicado
  if (subidos.size) {
    snapshotForUndo();
    state.planned = state.planned.filter(id => !subidos.has(id));
    state.published = state.published.concat([...subidos]);
    renderAll(); save();
  }
  const sinFoto = items.filter(it => !it.hasAttachment).length;
  if (errors.length) {
    toast(`Subidos ${ok}/${items.length} · ${failed} fallaron — ${errors[0]}`, 6000);
    console.warn("pushToAirtable errores:", errors);
  } else if (sinFoto) {
    toast(`Subidos ${ok}/${items.length} (${sinFoto} sin foto — re-sincroniza Airtable y vuelve a empujar)`, 6000);
  } else {
    toast(`Subidos ${ok}/${items.length} → movidos a 'publicado'`, 4000);
  }
}

/* ---------------- RENDER ---------------- */
function renderAll() {
  renderProfile();
  renderGallery();
  renderGrid();
  renderCalendar();
  renderBalance();
  applyTheme();
  applyZoom();
}

function renderProfile() {
  const p = state.profile || {};
  const set = (id, v) => { const el = $("#" + id); if (el && el.textContent !== v) el.textContent = v; };
  set("phHandle", p.handle || "");
  set("phFollowers", p.followers || "");
  set("phFollowing", p.following || "");
  set("phLink", p.link || "");
  set("phBio", p.bio || "");
  // foto de perfil
  const picEl = document.querySelector(".ph-pic");
  if (picEl) {
    if (p.pic) {
      picEl.style.backgroundImage = `url('${p.pic}')`;
      picEl.style.backgroundSize = "cover";
      picEl.style.backgroundPosition = "center";
      picEl.textContent = "";
    } else {
      picEl.style.backgroundImage = "";
      picEl.textContent = (p.handle || "JO").slice(0,2).toUpperCase();
    }
    picEl.title = "Click para cambiar foto de perfil";
    picEl.style.cursor = "pointer";
  }
  // name lleva pronouns dentro
  const nameEl = $("#phName");
  if (nameEl) {
    const pron = p.pronouns ? ` <span class="muted">${p.pronouns}</span>` : "";
    nameEl.innerHTML = (p.name || "") + pron;
  }
  // categoría
  const catEl = document.querySelector(".ph-category");
  if (catEl) catEl.textContent = p.category || "";
  // highlights — usamos createElement (no innerHTML con interpolación)
  const hl = $("#phHighlights");
  if (hl) {
    hl.innerHTML = "";
    (p.highlights || []).forEach((h, i) => {
      const wrap = document.createElement("div");
      wrap.className = "ph-hl"; wrap.dataset.idx = String(i);
      const circle = document.createElement("div");
      circle.className = "ph-hl-circle";
      circle.style.backgroundColor = (h.color && /^#[0-9a-f]{3,8}$/i.test(h.color)) ? h.color : "#222";
      if (h.cover && typeof h.cover === "string") {
        // solo permitir data: URLs o paths del proxy local
        if (h.cover.startsWith("data:") || h.cover.startsWith("/api/proxy-image") || h.cover.startsWith("/")) {
          circle.style.backgroundImage = `url('${h.cover.replace(/'/g,"")}')`;
        }
      } else {
        circle.textContent = (h.label || "").slice(0, 3);
      }
      const label = document.createElement("div");
      label.className = "ph-hl-label";
      label.textContent = h.label || "";
      wrap.appendChild(circle); wrap.appendChild(label);
      hl.appendChild(wrap);
    });
    const addWrap = document.createElement("div");
    addWrap.className = "ph-hl"; addWrap.dataset.idx = "add";
    addWrap.innerHTML = `<div class="ph-hl-circle" style="border-style:dashed;font-size:18px;">+</div><div class="ph-hl-label muted">Nueva</div>`;
    hl.appendChild(addWrap);
  }
}

// Listeners de contenteditable: cuando blur, persistir al state.profile
function wireProfileEditable() {
  const map = {
    phHandle:    "handle",
    phName:      "name",
    phBio:       "bio",
    phLink:      "link",
    phFollowers: "followers",
    phFollowing: "following",
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("blur", () => {
      let v = el.textContent.trim();
      if (key === "name") {
        // arrancar pronouns del fin si los puso pegados
        const m = v.match(/(.+?)\s+(he\/him|she\/her|they\/them)$/i);
        if (m) { state.profile.name = m[1]; state.profile.pronouns = m[2]; renderProfile(); save(); return; }
      }
      state.profile[key] = v; save();
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
  });
  // foto de perfil: click → file picker
  document.querySelector(".ph-pic").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { state.profile.pic = reader.result; renderProfile(); save(); };
      reader.readAsDataURL(f);
    };
    inp.click();
  });
  // highlights: click "+" → agregar; click sobre uno → editar label
  $("#phHighlights").addEventListener("click", e => {
    const hl = e.target.closest(".ph-hl");
    if (!hl) return;
    if (hl.dataset.idx === "add") {
      const label = prompt("Nombre del highlight (ej. 'C+J'):");
      if (!label) return;
      state.profile.highlights = state.profile.highlights || [];
      state.profile.highlights.push({ label, color: "#" + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,"0") });
      renderProfile(); save();
    } else {
      const idx = +hl.dataset.idx;
      const h = state.profile.highlights[idx];
      const newLabel = prompt("Editar label (vacío para eliminar):", h.label);
      if (newLabel === null) return;
      if (newLabel === "") state.profile.highlights.splice(idx, 1);
      else h.label = newLabel;
      renderProfile(); save();
    }
  });
}

function applyTheme() {
  document.body.dataset.theme = state.ui.theme;
  document.body.dataset.view = state.ui.view;
  document.body.dataset.overlay = state.ui.overlay;
  document.body.dataset.source = state.filters.source;
  document.body.dataset.device = state.ui.device || "desktop";
  $$("#deviceMode button").forEach(b => b.classList.toggle("active", b.dataset.dev === (state.ui.device||"desktop")));
  // sync rating UI buttons
  $$("#ratingOp button").forEach(b => b.classList.toggle("active", b.dataset.op === state.filters.ratingOp));
  $$("#ratingValue button").forEach(b => b.classList.toggle("active", +b.dataset.r === +state.filters.ratingValue));
  document.body.classList.toggle("cal-collapsed", !!state.ui.calCollapsed);
  document.body.classList.toggle("gal-collapsed", !!state.ui.galCollapsed);
  document.documentElement.style.setProperty("--col-cal", (state.ui.colCal||240) + "px");
  document.documentElement.style.setProperty("--col-gal", (state.ui.colGal||360) + "px");
  document.documentElement.style.setProperty("--gal-cell-size", (state.ui.galZoom||95) + "px");
  document.documentElement.style.setProperty("--phone-zoom", state.ui.phoneZoom || 1);
  document.querySelector("#viewToggle").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.ui.view));
  document.querySelector("#overlayToggle").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.ov === state.ui.overlay));
  document.querySelector("#modeToggle").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.mode === state.ui.mode));
  document.querySelector("#sourceFilter").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.src === state.filters.source));
}
function applyZoom() {
  const sizes = { 1: 60, 2: 90, 3: 130, 4: 170, 5: 210, 6: 260 };
  const dev = state.ui.device || "desktop";
  if (dev === "iphone" || dev === "iphone-mini") {
    // ancho útil = device - 24 (padding frame) - 4 (padding screen ~) - 4 (gap 2px*2)
    const w = dev === "iphone-mini" ? 375 : 393;
    const cell = Math.floor((w - 24 - 4) / 3);
    document.documentElement.style.setProperty("--cell-size", cell + "px");
  } else {
    document.documentElement.style.setProperty("--cell-size", (sizes[state.ui.zoom] || 130) + "px");
  }
  $("#zoomSlider").value = state.ui.zoom;
  $("#zoomSlider").disabled = (dev !== "desktop");
  // ya no movemos nodos: phone-frame y phone-screen están siempre en HTML.
  // En desktop CSS los hace `display: contents`; en iPhone se vuelven el marco real.
}

function renderGallery() {
  const el = $("#galleryEl");
  el.innerHTML = "";
  el.dataset.tileMode = state.ui.tileMode || "square";
  // sync segmented control
  $$("#tileMode button").forEach(b => b.classList.toggle("active", b.dataset.tm === (state.ui.tileMode||"square")));
  const ids = state.gallery.filter(id => filterPhoto(state.photos[id]));
  $("#galleryCount").textContent = `${ids.length} fotos`;
  for (const id of ids) {
    el.appendChild(makeTile(id));
  }
  // analiza colores en background
  ids.forEach(id => analyzePhoto(state.photos[id]));
  // dynamic mode usa CSS columns nativo, no necesita JS
}
function filterPhoto(p) {
  if (!p) return false;
  const src = state.filters.source;
  // tabs:
  //   all    → solo Stock photos + filtro de rating (estrellas)
  //   manual → fotos cargadas manualmente
  //   carousels / historias → tablas correspondientes (todas)
  //   stock  → Stock photos con campo "carousel" = ✓
  if (src === "all") {
    if (p.source !== "stock") return false;
    const op = state.filters.ratingOp || ">=";
    const v  = +(state.filters.ratingValue ?? 0);
    const r  = +p.rating || 0;
    if (op === ">=" && !(r >= v)) return false;
    if (op === "="  && !(r === v)) return false;
    if (op === "<=" && !(r <= v)) return false;
  } else if (src === "stock") {
    if (p.source !== "stock") return false;
    if (!p.carousel) return false;
  } else if (src !== p.source) {
    return false;
  }
  if (state.filters.search) {
    const s = state.filters.search.toLowerCase();
    const blob = `${p.boda||""} ${p.capitulo||""} ${p.color||""} ${p.mood||""} ${p.filename||""}`.toLowerCase();
    if (!blob.includes(s)) return false;
  }
  return true;
}

function makeTile(id) {
  const p = state.photos[id];
  const t = document.createElement("div");
  t.className = "tile";
  t.dataset.id = id;
  if (state.selected.has(id)) t.classList.add("selected");
  const stars = p.rating ? "★".repeat(Math.max(0, Math.min(5, p.rating|0))) : "";
  t.innerHTML = `
    <img src="${esc(p.src)}" alt="" loading="lazy">
    ${p.type === "carousel" ? `<div class="badge">▥ ${(p.slides||[]).length|0}</div>` : ""}
    ${p.type === "story" ? `<div class="badge">○ story</div>` : ""}
    ${p.type === "reel" ? `<div class="badge">▶ reel</div>` : ""}
    ${stars ? `<div class="meta">${stars}</div>` : ""}
    <button class="add-btn" title="Agregar al grid planeado">+</button>
  `;
  t.addEventListener("click", e => onTileClick(e, id));
  t.querySelector(".add-btn").addEventListener("click", e => {
    e.stopPropagation();
    snapshotForUndo();
    state.gallery = state.gallery.filter(x => x !== id);
    state.planned.push(id);
    renderAll(); save();
    toast("Agregada al grid");
  });
  attachHoverPreview(t, p);
  return t;
}

function renderGrid() {
  // PUBLISHED — ocultar la sección si está vacía (sino hay un hueco enorme en iPhone view)
  const pubEl = $("#gridPublished");
  pubEl.innerHTML = "";
  state.published.forEach((id, i) => pubEl.appendChild(makeCell(id, i, "published")));
  const sectionEmpty = state.published.length === 0;
  document.querySelectorAll(".grid-section-label, .grid-divider").forEach(el => el.style.display = sectionEmpty ? "none" : "");
  pubEl.style.display = sectionEmpty ? "none" : "";
  // PLANNED — completar con celdas vacías hasta múltiplo de 3
  const planEl = $("#gridPlanned");
  planEl.innerHTML = "";
  state.planned.forEach((id, i) => planEl.appendChild(makeCell(id, i, "planned")));
  const fillTo = Math.max(9, Math.ceil(state.planned.length / 3) * 3 + 3);
  for (let i = state.planned.length; i < fillTo; i++) {
    const empty = document.createElement("div");
    empty.className = "cell empty";
    empty.dataset.empty = "1";
    planEl.appendChild(empty);
  }
  // VERSIÓN B
  if (state.ui.splitView) {
    document.querySelector(".grid-wrap").classList.add("split");
    $("#gridColB").hidden = false;
    const bEl = $("#gridB"); bEl.innerHTML = "";
    state.gridB.forEach((id, i) => bEl.appendChild(makeCell(id, i, "gridB")));
  } else {
    document.querySelector(".grid-wrap").classList.remove("split");
    $("#gridColB").hidden = true;
  }

  $("#phPosts").textContent = state.published.length + state.planned.length;
  detectSimilar();
  // re-bind solo si los contenedores fueron recreados (no en cada render)
  setupSortablesIfNeeded();
}

function makeCell(id, idx, list) {
  const p = state.photos[id]; if (!p) return document.createTextNode("");
  const m = state.meta[id] || {};
  const c = document.createElement("div");
  c.className = "cell"; c.dataset.id = id; c.dataset.list = list;
  if (state.selected.has(id)) c.classList.add("selected");
  const palette = (p.colors||[]).slice(0,4).map(rgb => `<div style="flex:1;background:${rgbToHex(rgb)}"></div>`).join("");
  const lumColor = p.lum != null ? `rgb(${255-Math.min(255,p.lum)},${255-Math.min(255,p.lum)},${255-Math.min(255,p.lum)})` : "transparent";
  c.style.setProperty("--lum-color", lumColor);
  const typeIcon = { photo: "▢", carousel: "▥", reel: "▶", story: "○" }[m.type || p.type || "photo"];
  c.innerHTML = `
    <img src="${esc(p.src)}" alt="" loading="lazy">
    <div class="palette-strip">${palette}</div>
    <div class="similar-warn">≈ similar</div>
    <button class="x-btn" data-act="remove">×</button>
    <div class="type-icon">${esc(typeIcon)}</div>
    <div class="pos">${idx+1}</div>
  `;
  c.addEventListener("click", e => onCellClick(e, id, list));
  c.querySelector(".x-btn").addEventListener("click", e => {
    e.stopPropagation();
    snapshotForUndo();
    removeFromGrid(id);
    renderAll(); save();
  });
  attachHoverPreview(c, p);
  return c;
}

function detectSimilar() {
  // pares vecinos en planned: si dos fotos consecutivas (en filas o columnas inmediatas) son muy similares
  const ids = [...state.published, null, ...state.planned];
  const cols = 3;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]; if (!id) continue;
    const p = state.photos[id]; if (!p) continue;
    const neighbors = [ids[i-1], ids[i+1], ids[i-cols], ids[i+cols]].filter(Boolean);
    let sim = false;
    for (const nid of neighbors) {
      if (photosSimilar(p, state.photos[nid])) { sim = true; break; }
    }
    const cell = document.querySelector(`.cell[data-id="${id}"]`);
    if (cell) cell.classList.toggle("warn-similar", sim);
  }
}

function attachHoverPreview(el, p) {
  if (!p.slides || p.slides.length < 2) return;
  el.addEventListener("mouseenter", e => {
    const hp = $("#hoverPreview");
    hp.innerHTML = "";
    p.slides.slice(0, 8).forEach(s => {
      const im = document.createElement("img");
      im.src = s;
      hp.appendChild(im);
    });
    hp.hidden = false;
    moveHoverPreview(e);
  });
  el.addEventListener("mousemove", moveHoverPreview);
  el.addEventListener("mouseleave", () => { $("#hoverPreview").hidden = true; });
}
function moveHoverPreview(e) {
  const hp = $("#hoverPreview");
  const x = Math.min(e.clientX + 14, window.innerWidth - 450);
  const y = Math.min(e.clientY + 14, window.innerHeight - 290);
  hp.style.left = Math.max(8, x) + "px";
  hp.style.top  = Math.max(8, y) + "px";
}

function renderBalance() {
  const all = [...state.published, ...state.planned];
  const counts = { photo: 0, carousel: 0, reel: 0, story: 0 };
  all.forEach(id => {
    const p = state.photos[id]; if (!p) return;
    const t = (state.meta[id]||{}).type || p.type || "photo";
    counts[t] = (counts[t]||0) + 1;
  });
  const total = Math.max(1, all.length);
  const bar = $("#balanceBar");
  bar.innerHTML = `
    <span class="b-photo" style="width:${counts.photo/total*100}%" title="Fotos: ${counts.photo}"></span>
    <span class="b-carousel" style="width:${counts.carousel/total*100}%" title="Carruseles: ${counts.carousel}"></span>
    <span class="b-reel" style="width:${counts.reel/total*100}%" title="Reels: ${counts.reel}"></span>
    <span class="b-story" style="width:${counts.story/total*100}%" title="Stories: ${counts.story}"></span>
  `;
}

/* ---------------- CALENDAR ---------------- */
function renderCalendar() {
  const list = $("#calList");
  list.innerHTML = "";
  const dates = computeDates();
  // ordenar por fecha ASC (próximo a publicar arriba), pero mostrar la posición real del grid
  const items = state.planned.map((id, gridPos) => ({ id, gridPos, date: dates[gridPos] }));
  items.sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
  items.forEach(({ id, gridPos, date: d }) => {
    const p = state.photos[id]; if (!p) return;
    const dStr = d ? d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }) : "—";
    const tStr = d ? d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
    const item = document.createElement("div");
    item.className = "cal-item";
    const thumb = document.createElement("div");
    thumb.className = "cal-thumb";
    thumb.style.backgroundImage = `url('${esc(p.src)}')`;
    const meta = document.createElement("div");
    meta.className = "cal-meta";
    const chapter = (state.meta[id]||{}).chapter || p.capitulo || "—";
    meta.innerHTML = `<b>${esc(dStr)}</b><span>${esc(tStr)} · pos #${gridPos+1} · ${esc(chapter)}</span>`;
    item.appendChild(thumb); item.appendChild(meta);
    list.appendChild(item);
  });
}
function computeDates() {
  // En Instagram el grid muestra el post MÁS RECIENTE arriba a la izquierda.
  // Por eso asignamos la fecha más temprana al ÚLTIMO planeado y la más tardía al primero:
  //   planned[0]      → último en publicarse (top del grid)
  //   planned[N-1]    → primero en publicarse (bottom del grid)
  const N = state.planned.length;
  const out = new Array(N);
  const days = state.cadence.days;
  const [hh, mm] = (state.cadence.time||"09:00").split(":").map(Number);
  const start = state.cadence.start ? new Date(state.cadence.start) : new Date();
  start.setHours(hh, mm, 0, 0);
  let d = new Date(start);
  // recorremos de atrás hacia adelante: el último elemento del array recibe la primera fecha
  for (let i = N - 1; i >= 0; i--) {
    while (!days.includes(d.getDay())) {
      d.setDate(d.getDate() + 1);
      d.setHours(hh, mm, 0, 0);
    }
    const meta = state.meta[state.planned[i]] || {};
    if (meta.scheduled) {
      out[i] = new Date(meta.scheduled);
    } else {
      out[i] = new Date(d);
    }
    d.setDate(d.getDate() + 1);
    d.setHours(hh, mm, 0, 0);
  }
  return out;
}

/* ---------------- DRAG / SORT ---------------- */
let sortableInstances = [];
let sortablesBoundFor = "";   // firma de la última config (mode|splitView)
function setupSortablesIfNeeded() {
  const sig = `${state.ui.mode}|${state.ui.splitView ? 1 : 0}`;
  // si los nodos siguen vivos y la config no cambió, no rebindear
  const galEl = $("#galleryEl"), pubEl = $("#gridPublished"), planEl = $("#gridPlanned");
  const allBound = sortableInstances.length && sortableInstances.every(s => s.el && s.el.isConnected);
  if (allBound && sig === sortablesBoundFor) return;
  setupSortables();
  sortablesBoundFor = sig;
}
function setupSortables() {
  sortableInstances.forEach(s => { try { s.destroy(); } catch {} });
  sortableInstances = [];
  const groupOpts = { name: "photos", pull: true, put: true };
  const swap = state.ui.mode === "swap";
  const opts = () => ({
    group: groupOpts,
    animation: 150,
    swap,
    onStart: (evt) => evt.item.classList.add("dragging"),
    onEnd: (evt) => {
      evt.item.classList.remove("dragging");
      $("#hoverPreview").hidden = true;
    },
    onAdd: () => commitSort(),
    onUpdate: () => commitSort(),
    onRemove: () => commitSort(),
  });
  if ($("#galleryEl"))     sortableInstances.push(Sortable.create($("#galleryEl"), {
    group: groupOpts, animation: 150,
    onAdd: () => commitSort(), onUpdate: () => commitSort(), onRemove: () => commitSort(),
  }));
  if ($("#gridPublished")) sortableInstances.push(Sortable.create($("#gridPublished"), opts()));
  if ($("#gridPlanned"))   sortableInstances.push(Sortable.create($("#gridPlanned"), opts()));
  if (state.ui.splitView && $("#gridB")) sortableInstances.push(Sortable.create($("#gridB"), opts()));
}
function commitSort() {
  snapshotForUndo();
  // [data-id] funciona sea .tile o .cell (SortableJS mueve el nodo entre contenedores
  // sin cambiarle la clase). Las celdas vacías no tienen data-id, así que se filtran solas.
  state.published = $$("#gridPublished [data-id]").map(c => c.dataset.id);
  state.planned   = $$("#gridPlanned   [data-id]").map(c => c.dataset.id);
  state.gallery   = $$("#galleryEl     [data-id]").map(c => c.dataset.id);
  if (state.ui.splitView) state.gridB = $$("#gridB [data-id]").map(c => c.dataset.id);
  // dedup: una id solo en un contenedor
  const placed = new Set([...state.published, ...state.planned, ...state.gridB]);
  state.gallery = state.gallery.filter(id => !placed.has(id));
  setTimeout(() => { renderAll(); save(); }, 0);
}
function removeFromGrid(id) {
  state.published = state.published.filter(x => x !== id);
  state.planned = state.planned.filter(x => x !== id);
  state.gridB = state.gridB.filter(x => x !== id);
  if (!state.gallery.includes(id)) state.gallery.push(id);
}

/* ---------------- CLICKS ---------------- */
function onTileClick(e, id) {
  if (e.shiftKey) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderGallery();
    return;
  }
  // doble click → meter al final del grid planned
  if (e.detail === 2) {
    snapshotForUndo();
    state.gallery = state.gallery.filter(x => x !== id);
    state.planned.push(id);
    renderAll(); save();
  }
}
function onCellClick(e, id, list) {
  if (e.target.dataset.act === "remove") return;
  if (e.shiftKey) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderGrid(); return;
  }
  openInspector(id);
}

/* ---------------- INSPECTOR ---------------- */
let inspectorId = null;
function openInspector(id) {
  inspectorId = id;
  const p = state.photos[id]; if (!p) return;
  const m = state.meta[id] || {};
  const ins = $("#inspector");
  ins.hidden = false;
  $("#insPreview").style.backgroundImage = `url('${p.src}')`;
  $("#insType").querySelectorAll("button").forEach(b => b.classList.toggle("active", (m.type||p.type||"photo") === b.dataset.t));
  $("#insDate").value = m.scheduled || "";
  $("#insChapter").value = m.chapter || p.capitulo || "";
  $("#insCaption").value = m.caption || p.caption || "";
  $("#insHashtags").value = m.hashtags || "";
  $("#insFirstComment").value = m.firstComment || "";
  $("#insLocation").value = m.location || "";
  $("#insAlt").value = m.alt || "";
  $("#insLink").value = m.link || "";
  updateCharCount();
}
function saveInspector() {
  if (!inspectorId) return;
  snapshotForUndo();    // ← guardamos el estado ANTES de mutar
  const t = $("#insType .active")?.dataset.t || "photo";
  state.meta[inspectorId] = {
    type: t,
    scheduled: $("#insDate").value || null,
    chapter: $("#insChapter").value,
    caption: $("#insCaption").value,
    hashtags: $("#insHashtags").value,
    firstComment: $("#insFirstComment").value,
    location: $("#insLocation").value,
    alt: $("#insAlt").value,
    link: $("#insLink").value,
  };
  renderAll(); save();
  toast("Guardado");
}
function updateCharCount() {
  const cap = $("#insCaption").value.length;
  const hsh = $("#insHashtags").value.length;
  const total = cap + hsh + 2;
  const el = $("#capCount");
  el.textContent = `${total}/2200`;
  el.classList.toggle("over", total > 2200);
}

/* ---------------- HASHTAG POOL ---------------- */
function defaultHashPool() {
  return $("#hashPoolDefaults").innerHTML.trim().split(/[;\n]/).map(s => s.trim()).filter(Boolean);
}
function renderHashPool() {
  const pool = state.hashPool.length ? state.hashPool : defaultHashPool();
  const el = $("#hashPool");
  el.innerHTML = "";
  pool.forEach(h => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.h = h;
    chip.textContent = "#" + h;
    el.appendChild(chip);
  });
  el.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      const ta = $("#insHashtags");
      const tag = "#" + ch.dataset.h;
      if (ta.value.includes(tag)) return;
      ta.value = (ta.value ? ta.value + " " : "") + tag;
      updateCharCount();
    });
  });
}

/* ---------------- UPLOAD ---------------- */
function handleUpload(files) {
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const id = "m_" + uid();
      state.photos[id] = {
        id, source: "manual", src: reader.result, type: "photo",
        filename: f.name, rating: 0,
      };
      state.gallery.unshift(id);
      added++;
      renderAll(); save();
    };
    reader.readAsDataURL(f);
  }
  if (added) toast(`+${added} fotos cargadas`);
}

/* ---------------- PRESETS / PATTERNS ---------------- */
function applyPreset(p) {
  snapshotForUndo();
  const ids = [...state.planned];
  switch (p) {
    case "reverse": state.planned = ids.reverse(); break;
    case "byrating": state.planned = ids.sort((a,b) => (state.photos[b]?.rating||0) - (state.photos[a]?.rating||0)); break;
    case "bydate": state.planned = ids.sort((a,b) => new Date(state.photos[a]?.fecha||0) - new Date(state.photos[b]?.fecha||0)); break;
    case "chess": {
      // alterna fotos claras y oscuras
      const sorted = ids.slice().sort((a,b) => (state.photos[a]?.lum||128) - (state.photos[b]?.lum||128));
      const dark = sorted.slice(0, Math.ceil(sorted.length/2));
      const light = sorted.slice(Math.ceil(sorted.length/2));
      const out = [];
      for (let i = 0; i < ids.length; i++) {
        out.push(((i%2===0) ? dark : light).pop() || ((i%2===0) ? light : dark).pop());
      }
      state.planned = out.filter(Boolean);
      break;
    }
    case "rows": {
      // agrupar de 3 en 3 con paletas similares por fila
      const sorted = ids.slice().sort((a,b) => {
        const ca = state.photos[a]?.colors?.[0]; const cb = state.photos[b]?.colors?.[0];
        return colorDistance(ca, [128,128,128]) - colorDistance(cb, [128,128,128]);
      });
      state.planned = sorted; break;
    }
    case "diag": {
      // ordena por luminosidad diagonal: i + j*0.5
      state.planned = ids.slice().sort((a,b) => (state.photos[a]?.lum||128) - (state.photos[b]?.lum||128));
      break;
    }
    case "puzzle": {
      // agrupa por boda en bloques de 9
      const byBoda = {};
      ids.forEach(id => {
        const b = state.photos[id]?.boda || "_";
        (byBoda[b] = byBoda[b] || []).push(id);
      });
      state.planned = Object.values(byBoda).flat();
      break;
    }
    case "balance": {
      // intercala carrusel/foto/reel para variedad
      const byType = { carousel: [], photo: [], reel: [], story: [] };
      ids.forEach(id => {
        const t = (state.meta[id]||{}).type || state.photos[id]?.type || "photo";
        (byType[t] = byType[t] || []).push(id);
      });
      const out = [];
      while (Object.values(byType).some(v => v.length)) {
        for (const k of ["photo","carousel","reel","story"]) {
          if (byType[k].length) out.push(byType[k].shift());
        }
      }
      state.planned = out; break;
    }
  }
  renderAll(); save();
  toast("Patrón aplicado");
}

/* ---------------- EXPORTS ---------------- */
async function exportPNG() {
  const target = $("#gridColMain");
  const canvas = await html2canvas(target, { backgroundColor: getComputedStyle(document.body).getPropertyValue("--panel"), scale: 2, useCORS: true });
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `grid-${new Date().toISOString().slice(0,10)}.png`;
  a.click();
}
function exportCSV() {
  const dates = computeDates();
  const rows = [["#","fecha","tipo","capitulo","caption","hashtags","first_comment","location","alt","link","source","rec_id"]];
  state.planned.forEach((id, i) => {
    const p = state.photos[id]; const m = state.meta[id]||{};
    rows.push([
      i+1,
      dates[i] ? dates[i].toISOString() : "",
      m.type || p.type || "",
      m.chapter || p.capitulo || "",
      (m.caption||"").replace(/"/g,'""'),
      (m.hashtags||"").replace(/"/g,'""'),
      (m.firstComment||"").replace(/"/g,'""'),
      m.location || "",
      m.alt || "",
      m.link || "",
      p.source || "",
      p.recId || "",
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `plan-${new Date().toISOString().slice(0,10)}.csv`; a.click();
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(persistableState(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `grid-planner-${new Date().toISOString().slice(0,10)}.json`; a.click();
}
async function exportHTML() {
  // HTML autocontenido con solo el grid
  const photos = [...state.published, ...state.planned].map(id => state.photos[id]?.src).filter(Boolean);
  const html = `<!doctype html><meta charset=utf-8>
<title>Grid · Jorge Weddings</title>
<style>body{margin:0;background:#fff;font-family:sans-serif}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;max-width:600px;margin:20px auto}
.c{aspect-ratio:1/1;background:#eee;background-size:cover;background-position:center}</style>
<div class=g>${photos.map(s => `<div class=c style="background-image:url('${s}')"></div>`).join("")}</div>`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `grid-share-${new Date().toISOString().slice(0,10)}.html`; a.click();
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      Object.assign(state, d);
      state.history = []; state.histIndex = -1;
      renderAll(); save();
      toast("Importado");
    } catch (e) { toast("JSON inválido"); }
  };
  reader.readAsText(file);
}

/* ---------------- SNAPSHOTS ---------------- */
function openSnapModal() {
  $("#snapModal").hidden = false;
  renderSnapList();
}
function renderSnapList() {
  const list = $("#snapList");
  list.innerHTML = state.snapshots.length ? "" : `<p style="color:var(--text-2);font-size:12px;padding:12px 0;">Sin snapshots aún. Guarda una versión arriba.</p>`;
  state.snapshots.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "snap-row";
    row.innerHTML = `
      <div><b>${s.name}</b><span>${new Date(s.ts).toLocaleString("es-MX")} · ${s.published.length}+${s.planned.length}</span></div>
      <div class="row">
        <button class="btn xs" data-act="load">Cargar</button>
        <button class="btn xs" data-act="b">→ Versión B</button>
        <button class="btn xs ghost" data-act="del">×</button>
      </div>
    `;
    row.querySelector('[data-act="load"]').onclick = () => {
      snapshotForUndo();
      state.published = [...s.published]; state.planned = [...s.planned];
      state.meta = { ...s.meta };
      renderAll(); save(); toast(`Cargado ${s.name}`);
    };
    row.querySelector('[data-act="b"]').onclick = () => {
      state.gridB = [...s.published, ...s.planned];
      state.ui.splitView = true;
      renderAll(); save();
      $("#snapModal").hidden = true;
    };
    row.querySelector('[data-act="del"]').onclick = () => {
      state.snapshots.splice(i,1); save(); renderSnapList();
    };
    list.appendChild(row);
  });
}
function saveSnapshot() {
  const name = $("#snapName").value.trim() || `Snapshot ${state.snapshots.length+1}`;
  state.snapshots.unshift({
    name, ts: Date.now(),
    published: [...state.published], planned: [...state.planned],
    meta: JSON.parse(JSON.stringify(state.meta)),
  });
  $("#snapName").value = "";
  save(); renderSnapList(); toast("Snapshot guardado");
}

/* ---------------- EVENTS WIRING ---------------- */
function wire() {
  // VIEW TOGGLE
  $("#viewToggle").addEventListener("click", e => {
    if (e.target.dataset.view) { state.ui.view = e.target.dataset.view; applyTheme(); save(); }
  });
  $("#btnTheme").addEventListener("click", () => {
    state.ui.theme = state.ui.theme === "light" ? "dark" : "light"; applyTheme(); save();
  });
  $("#btnUndo").addEventListener("click", undo);
  $("#btnRedo").addEventListener("click", redo);
  $("#btnSync").addEventListener("click", syncAirtable);
  // shift+click en Sync → reset PAT (solo en producción)
  $("#btnSync").addEventListener("contextmenu", e => {
    if (IS_LOCAL) return;
    e.preventDefault();
    if (confirm("¿Cambiar Airtable PAT?")) {
      localStorage.removeItem(PAT_KEY);
      ensurePAT();
    }
  });

  // EXPORT MENU
  $("#btnExport").addEventListener("click", e => {
    const m = $("#exportMenu");
    const r = e.target.getBoundingClientRect();
    m.style.right = (window.innerWidth - r.right) + "px";
    m.style.top = (r.bottom + 6) + "px";
    m.hidden = !m.hidden;
    e.stopPropagation();
  });
  $("#exportMenu").addEventListener("click", e => {
    const act = e.target.dataset.act;
    if (!act) return;
    $("#exportMenu").hidden = true;
    if (act === "png") exportPNG();
    else if (act === "csv") exportCSV();
    else if (act === "json") exportJSON();
    else if (act === "html") exportHTML();
    else if (act === "airtable") pushToAirtable();
    else if (act === "print") window.print();
    else if (act === "import") $("#importInput").click();
  });
  $("#importInput").addEventListener("change", e => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
  });

  // PRESETS
  $("#btnPreset").addEventListener("click", e => {
    const m = $("#presetMenu");
    const r = e.target.getBoundingClientRect();
    m.style.left = r.left + "px"; m.style.top = (r.bottom + 6) + "px";
    m.hidden = !m.hidden; e.stopPropagation();
  });
  $("#presetMenu").addEventListener("click", e => {
    if (!e.target.dataset.p) return;
    $("#presetMenu").hidden = true;
    applyPreset(e.target.dataset.p);
  });

  // SNAPSHOTS
  $("#btnSnap").addEventListener("click", openSnapModal);
  $("#snapClose").addEventListener("click", () => $("#snapModal").hidden = true);
  $("#snapSave").addEventListener("click", saveSnapshot);

  // SPLIT VIEW
  $("#btnSplit").addEventListener("click", () => {
    state.ui.splitView = !state.ui.splitView;
    if (state.ui.splitView && !state.gridB.length) {
      state.gridB = [...state.published, ...state.planned];
    }
    renderAll(); save();
  });

  // OVERLAY / MODE
  $("#overlayToggle").addEventListener("click", e => {
    if (e.target.dataset.ov) { state.ui.overlay = e.target.dataset.ov; applyTheme(); save(); }
  });
  $("#modeToggle").addEventListener("click", e => {
    if (e.target.dataset.mode) { state.ui.mode = e.target.dataset.mode; applyTheme(); setupSortables(); save(); }
  });

  // ZOOM
  $("#zoomSlider").addEventListener("input", e => { state.ui.zoom = +e.target.value; applyZoom(); save(); });
  // DEVICE MODE (desktop / iPhone / iPhone mini)
  $("#deviceMode").addEventListener("click", e => {
    if (!e.target.dataset.dev) return;
    state.ui.device = e.target.dataset.dev;
    applyTheme(); applyZoom(); save();
  });
  // PHONE ZOOM (escala todo el iPhone proporcionalmente)
  $("#phoneZoom").addEventListener("input", e => {
    state.ui.phoneZoom = +e.target.value;
    applyTheme(); save();
  });

  // FILTERS
  $("#sourceFilter").addEventListener("click", e => {
    if (e.target.dataset.src) { state.filters.source = e.target.dataset.src; applyTheme(); renderGallery(); save(); }
  });
  $("#searchBox").addEventListener("input", e => {
    state.filters.search = e.target.value; renderGallery();
  });
  // RATING FILTER (solo aplica al tab Stock ★)
  $("#ratingOp").addEventListener("click", e => {
    if (e.target.dataset.op) { state.filters.ratingOp = e.target.dataset.op; applyTheme(); renderGallery(); save(); }
  });
  $("#ratingValue").addEventListener("click", e => {
    if (e.target.dataset.r != null) { state.filters.ratingValue = +e.target.dataset.r; applyTheme(); renderGallery(); save(); }
  });

  // UPLOAD
  $("#btnUpload").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", e => handleUpload(e.target.files));
  $("#galleryEl").addEventListener("dragover", e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); });
  $("#galleryEl").addEventListener("dragleave", e => e.currentTarget.classList.remove("drag-over"));
  $("#galleryEl").addEventListener("drop", e => {
    e.preventDefault(); e.currentTarget.classList.remove("drag-over");
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  });
  $("#btnShuffleGallery").addEventListener("click", () => {
    state.gallery.sort(() => Math.random() - 0.5);
    renderGallery(); save();
  });

  // INSPECTOR
  $("#inspectorClose").addEventListener("click", () => { $("#inspector").hidden = true; inspectorId = null; });
  $("#insSave").addEventListener("click", saveInspector);
  $("#insRemove").addEventListener("click", () => {
    if (!inspectorId) return;
    snapshotForUndo();
    removeFromGrid(inspectorId);
    $("#inspector").hidden = true; inspectorId = null;
    renderAll(); save();
  });
  $("#insType").addEventListener("click", e => {
    if (!e.target.dataset.t) return;
    $("#insType").querySelectorAll("button").forEach(b => b.classList.toggle("active", b===e.target));
  });
  $("#insCaption").addEventListener("input", updateCharCount);
  $("#insHashtags").addEventListener("input", updateCharCount);

  // CALENDAR toggle (botón en topbar)
  $("#btnCalToggle").addEventListener("click", () => {
    state.ui.calCollapsed = !state.ui.calCollapsed;
    applyTheme(); save();
  });
  $("#btnCalCollapse").addEventListener("click", () => {
    state.ui.calCollapsed = true; applyTheme(); save();
  });
  // GALLERY ZOOM
  $("#galZoom").addEventListener("input", e => {
    state.ui.galZoom = +e.target.value; applyTheme(); save();
  });
  // TILE MODE (cuadrado / vertical 4:5 / fit / dinámico)
  $("#tileMode").addEventListener("click", e => {
    if (!e.target.dataset.tm) return;
    state.ui.tileMode = e.target.dataset.tm;
    renderGallery(); save();
  });
  // RESIZERS
  setupResizer("#resizer1", "colCal", "calCollapsed", 160, 800);
  setupResizer("#resizer2", "colGal", "galCollapsed", 220, 1400);

  $("#btnCadence").addEventListener("click", () => {
    const p = $("#cadencePop"); p.hidden = !p.hidden;
    if (!p.hidden) renderCadence();
  });
  $("#cadApply").addEventListener("click", () => {
    state.cadence.days = $$("#cadencePop .days button.active").map(b => +b.dataset.d);
    state.cadence.time = $("#cadTime").value;
    state.cadence.start = $("#cadStart").value;
    $("#cadencePop").hidden = true;
    renderCalendar(); save(); toast("Cadencia aplicada");
  });

  // SHORTCUTS
  document.addEventListener("keydown", e => {
    if (e.target.matches("input,textarea")) return;
    if ((e.metaKey||e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.metaKey||e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.key === "Escape") {
      $("#inspector").hidden = true; $("#exportMenu").hidden = true; $("#presetMenu").hidden = true;
      $("#snapModal").hidden = true; document.body.classList.remove("fullscreen");
      state.selected.clear(); renderAll();
    }
    else if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
      document.body.classList.toggle("fullscreen");
    }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selected.size) {
        snapshotForUndo();
        [...state.selected].forEach(removeFromGrid);
        state.selected.clear();
        renderAll(); save();
      }
    }
  });

  // CLOSE DROPDOWNS ON OUTSIDE CLICK
  document.addEventListener("click", e => {
    if (!e.target.closest("#exportMenu") && !e.target.closest("#btnExport")) $("#exportMenu").hidden = true;
    if (!e.target.closest("#presetMenu") && !e.target.closest("#btnPreset")) $("#presetMenu").hidden = true;
  });
}

function setupResizer(sel, stateKey, collapseKey, min, max) {
  const el = $(sel); if (!el) return;
  let startX = 0, startVal = 0, rafId = 0, pendingV = 0, pendingCollapsed = false;
  const cssVar = stateKey === "colCal" ? "--col-cal" : "--col-gal";
  function flush() {
    rafId = 0;
    state.ui[stateKey] = pendingV;
    state.ui[collapseKey] = pendingCollapsed;
    document.documentElement.style.setProperty(cssVar, pendingV + "px");
    document.body.classList.toggle(stateKey === "colCal" ? "cal-collapsed" : "gal-collapsed", pendingCollapsed);
  }
  function onMove(e) {
    const dx = e.clientX - startX;
    let v = startVal + dx;
    if (v < min/2) { pendingCollapsed = true; v = 0; }
    else { pendingCollapsed = false; v = Math.max(min, Math.min(max, v)); }
    pendingV = v;
    if (!rafId) rafId = requestAnimationFrame(flush);
  }
  function onUp() {
    el.classList.remove("dragging");
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (rafId) { cancelAnimationFrame(rafId); flush(); }
    applyTheme(); save();
  }
  el.addEventListener("mousedown", e => {
    startX = e.clientX; startVal = state.ui[stateKey] || 240;
    pendingV = startVal; pendingCollapsed = !!state.ui[collapseKey];
    el.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
  el.addEventListener("dblclick", () => {
    state.ui[collapseKey] = !state.ui[collapseKey];
    if (!state.ui[collapseKey] && (state.ui[stateKey]||0) < min) state.ui[stateKey] = stateKey === "colCal" ? 240 : 360;
    applyTheme(); save();
  });
}

function renderCadence() {
  $$("#cadencePop .days button").forEach(b => b.classList.toggle("active", state.cadence.days.includes(+b.dataset.d)));
  $$("#cadencePop .days button").forEach(b => b.onclick = () => b.classList.toggle("active"));
  $("#cadTime").value = state.cadence.time;
  $("#cadStart").value = state.cadence.start || new Date().toISOString().slice(0,10);
}

/* ---------------- BOOT ---------------- */
function boot() {
  load();
  if (!state.ui.colCal) state.ui.colCal = 240;
  if (!state.ui.colGal) state.ui.colGal = 360;
  if (!state.ui.galZoom) state.ui.galZoom = 95;
  if (!state.hashPool.length) state.hashPool = defaultHashPool();
  // si no hay nada, mostrar fotos demo cargadas en el pool
  wire();
  renderAll();
  wireProfileEditable();
  renderHashPool();
  // sincronizar sliders con state
  document.getElementById("galZoom").value = state.ui.galZoom;
  document.getElementById("phoneZoom").value = state.ui.phoneZoom || 1;
  snapshotForUndo();
  // detectar fotos sin colors y analizarlas
  Object.values(state.photos).forEach(p => analyzePhoto(p).then(() => {
    // re-render para mostrar paletas/lum una vez listo (throttle)
    debounceRender();
  }));
}
let renderDebounce;
function debounceRender() {
  clearTimeout(renderDebounce);
  renderDebounce = setTimeout(() => { renderGrid(); renderGallery(); }, 300);
}

document.addEventListener("DOMContentLoaded", boot);
