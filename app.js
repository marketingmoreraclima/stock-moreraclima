const ITEMS = window.ITEMS;
const BY = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const PDF_ORDER = ITEMS.map(i => i.id);
const COUNTERS = ["Alonso", "Tanit"];
const BUYER = "José María";
const EMAIL = "holamoreraclima@gmail.com";
const API = ((window.STOCK_API || "").includes("PEGA_AQUI") ? "" : (window.STOCK_API || "").trim());

const S = {
  view: "conteo", filter: "todos", q: "",
  clave: null,
  order: PDF_ORDER.slice(), orderMeta: null,
  draft: null, draftBy: null,
  conteo: { encargado: null, startedAt: null },
  counts: {}, pending: {},
  hist: [], rec: null,
};

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const norm = s => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = s => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) + " a las " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };
const fileDate = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
function normalizeOrder(o) {
  const seen = new Set(); const out = [];
  (Array.isArray(o) ? o : []).forEach(id => { if (BY[id] && !seen.has(id)) { seen.add(id); out.push(id); } });
  PDF_ORDER.forEach(id => { if (!seen.has(id)) out.push(id); });
  return out;
}
function status(id) {
  const it = BY[id], c = S.counts[id];
  if (c === null || c === undefined || c === "") return { k: "pend", txt: "Sin contar", pedir: 0 };
  if (it.min == null) return { k: "ok", txt: "Sin mínimo", pedir: 0 };
  const p = Math.max(0, it.min - c);
  return p > 0 ? { k: "pedir", txt: "Pedir " + p, pedir: p } : { k: "ok", txt: "OK", pedir: 0 };
}
function setSync(t) { $("#sync").textContent = t; }
const store = {
  get(k) { try { return localStorage.getItem("stockmc_" + k) ?? sessionStorage.getItem("stockmc_" + k); } catch (e) { return null; } },
  set(k, v, keep) { try { (keep ? localStorage : sessionStorage).setItem("stockmc_" + k, v); } catch (e) { } },
  del(k) { try { localStorage.removeItem("stockmc_" + k); sessionStorage.removeItem("stockmc_" + k); } catch (e) { } },
};

/* ---------- servidor (Google Apps Script) ---------- */
async function api(action, payload = {}) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, clave: S.clave, ...payload }),
  });
  if (!r.ok) { const e = new Error("HTTP " + r.status); e.code = "red"; throw e; }
  const j = await r.json();
  if (!j.ok) {
    const e = new Error(j.error || "Error"); e.code = j.code || "error";
    if (j.code === "clave" && action !== "login") logout("La clave ha cambiado. Vuelve a entrar.");
    throw e;
  }
  return j;
}

/* ---------- acceso con clave ---------- */
function showLogin(msg) {
  $("#login").hidden = false; $("#app").hidden = true;
  $("#login-msg").textContent = msg || "";
  setTimeout(() => $("#clave").focus(), 50);
}
function logout(msg) { S.clave = null; store.del("clave"); stopPolling(); showLogin(msg); }
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!API) { $("#login-msg").textContent = "Falta configurar la dirección del servidor en config.js (ver LEEME.md)."; return; }
  const btn = $("#login-btn"); btn.disabled = true; $("#login-msg").textContent = "Comprobando…";
  S.clave = $("#clave").value;
  try {
    await api("login");
    store.set("clave", S.clave, $("#recordar").checked);
    $("#clave").value = ""; enterApp();
  } catch (err) {
    S.clave = null;
    $("#login-msg").textContent = err.code === "clave" ? "Clave incorrecta." : err.code === "bloqueado" ? err.message : "No se pudo conectar con el servidor. Revisa la conexión.";
  } finally { btn.disabled = false; }
});
$("#logout").addEventListener("click", () => logout(""));

/* ---------- render: conteo ---------- */
function renderWho() {
  $("#who").innerHTML = COUNTERS.map(n => `<button class="chip" data-who="${n}" aria-pressed="${S.conteo.encargado === n}">${n}</button>`).join("");
  $("#started").textContent = S.conteo.startedAt ? "Empezado el " + fmtDate(S.conteo.startedAt) : "";
}
function cardHTML(id) {
  const it = BY[id], st = status(id), c = S.counts[id];
  return `<article class="card st-${st.k}" data-id="${id}">
    <div class="thumb"><img src="${it.img}" alt="" loading="lazy"></div>
    <div class="info">
      <div class="mat">${esc(it.material)}</div>
      <div class="meta"><span>${esc(it.proveedor)}</span>${it.codigo ? `<span class="code">${esc(it.codigo)}</span>` : `<span class="small">sin código</span>`}</div>
      ${it.nota ? `<div class="nota">${esc(it.nota)}</div>` : ""}
    </div>
    <div class="counter">
      <div class="minbox">Mín. <b>${it.min ?? "—"}</b></div>
      <div class="stepper">
        <button data-act="dec" aria-label="Restar uno">−</button>
        <input type="number" inputmode="numeric" min="0" step="1" id="c-${id}" aria-label="Stock contado de ${esc(it.material)}" value="${c ?? ""}" placeholder="–">
        <button data-act="inc" aria-label="Sumar uno">+</button>
      </div>
      ${it.min != null ? `<button class="enough" data-act="enough">✓ Hay de sobra</button>` : ""}
      <span class="pill">${st.txt}</span>
    </div>
  </article>`;
}
function visibleIds() {
  const q = norm(S.q).trim();
  return S.order.filter(id => {
    const it = BY[id];
    if (q && !norm(`${it.material} ${it.codigo} ${it.proveedor} ${it.nota}`).includes(q)) return false;
    const st = status(id).k;
    if (S.filter === "pendientes" && st !== "pend") return false;
    if (S.filter === "pedir" && st !== "pedir") return false;
    return true;
  });
}
function renderCards() {
  const ids = visibleIds();
  $("#cards").innerHTML = ids.length ? ids.map(cardHTML).join("") :
    `<div class="empty">${S.q ? "Ningún material coincide con «" + esc(S.q) + "»." : S.filter === "pedir" ? "De momento no hay nada por debajo del mínimo." : "Todo contado."}</div>`;
  renderProgress();
}
function updateCard(id) {
  const el = document.querySelector(`.card[data-id="${id}"]`); if (!el) return;
  const st = status(id);
  el.className = "card st-" + st.k;
  el.querySelector(".pill").textContent = st.txt;
  const inp = el.querySelector("input");
  if (document.activeElement !== inp) inp.value = S.counts[id] ?? "";
}
function renderProgress() {
  const total = ITEMS.length;
  const done = ITEMS.filter(i => status(i.id).k !== "pend").length;
  const ped = ITEMS.filter(i => status(i.id).k === "pedir").length;
  $("#pnums").innerHTML = `<b>${done}</b>/${total} contados · <span class="red"><b>${ped}</b> a pedir</span>`;
  $("#pfill").style.width = (100 * done / total) + "%";
}

/* ---------- guardado de conteos ---------- */
let flushTimer = null, flushing = false;
function setCount(id, v) {
  if (v !== null) { v = Math.max(0, Math.floor(Number(v))); if (!isFinite(v)) v = null; }
  S.counts[id] = v; S.pending[id] = v;
  updateCard(id); renderProgress();
  clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700);
}
async function flush() {
  if (flushing) { flushTimer = setTimeout(flush, 500); return; }
  const batch = { ...S.pending }; if (!Object.keys(batch).length) return;
  flushing = true; setSync("Guardando…");
  try {
    const r = await api("setCounts", { changes: batch, encargado: S.conteo.encargado });
    for (const [id, v] of Object.entries(batch)) if (S.pending[id] === v) delete S.pending[id];
    S.conteo.startedAt = r.conteo.startedAt; renderWho();
    setSync("Guardado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    if (e.code !== "clave") { setSync("Sin conexión: se reintentará"); flushTimer = setTimeout(flush, 5000); }
  } finally { flushing = false; }
}
async function setEncargado(n) {
  S.conteo.encargado = n; renderWho();
  try { const r = await api("setEncargado", { encargado: n }); S.conteo.startedAt = r.conteo.startedAt; renderWho(); setSync("Guardado"); }
  catch (e) { setSync("No se pudo guardar el encargado"); }
}

/* ---------- sincronización con el servidor ---------- */
let pollTimer = null;
function applyEstado(j) {
  if (j.orden && j.orden.order) { S.order = normalizeOrder(j.orden.order); S.orderMeta = j.orden; }
  else { S.order = PDF_ORDER.slice(); S.orderMeta = null; }
  const c = j.conteo || {};
  S.counts = { ...(c.counts || {}), ...S.pending };
  S.conteo = { encargado: c.encargado || null, startedAt: c.startedAt || null };
  renderWho(); renderOrderMeta();
  if (S.view === "conteo") {
    const f = document.activeElement;
    if (f && f.closest && f.closest(".card")) { ITEMS.forEach(i => updateCard(i.id)); renderProgress(); } else renderCards();
  }
  if (S.view === "config" && !isDirty()) { S.draft = null; renderOrder(); }
}
async function refresh() {
  try { applyEstado(await api("estado")); setSync("Al día " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })); }
  catch (e) { if (e.code !== "clave") setSync("Sin conexión con el servidor"); }
}
function startPolling() { stopPolling(); pollTimer = setInterval(() => { if (!document.hidden && !flushing && !Object.keys(S.pending).length && S.view !== "revision") refresh(); }, 20000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.clave) refresh(); });

/* ---------- eventos conteo ---------- */
$("#who").addEventListener("click", e => { const b = e.target.closest("[data-who]"); if (b) setEncargado(b.dataset.who); });
$("#q").addEventListener("input", e => { S.q = e.target.value; renderCards(); });
$("#filter").addEventListener("click", e => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  S.filter = b.dataset.f;
  [...$("#filter").children].forEach(x => x.setAttribute("aria-pressed", x === b));
  renderCards();
});
$("#cards").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.closest(".card").dataset.id, c = S.counts[id];
  if (b.dataset.act === "inc") setCount(id, (c ?? 0) + 1);
  if (b.dataset.act === "dec") setCount(id, Math.max(0, (c ?? 0) - 1));
  if (b.dataset.act === "enough") setCount(id, BY[id].min);
});
$("#cards").addEventListener("input", e => {
  if (!e.target.matches("input")) return;
  const id = e.target.closest(".card").dataset.id;
  setCount(id, e.target.value === "" ? null : e.target.value);
});
$("#cards").addEventListener("focusin", e => { if (e.target.matches("input")) e.target.select(); });

/* ---------- revisión, Excel y correo ---------- */
function buildLines() {
  const lines = S.order.map(id => {
    const it = BY[id], st = status(id), c = S.counts[id];
    return { id, proveedor: it.proveedor, codigo: it.codigo, material: it.material, min: it.min, stock: c ?? null, pedir: st.pedir, nota: it.nota, estado: st.k };
  });
  return { pedir: lines.filter(l => l.estado === "pedir"), sinContar: lines.filter(l => l.estado === "pend"), todas: lines };
}
function groupByProv(lines) { const g = {}; lines.forEach(l => (g[l.proveedor] = g[l.proveedor] || []).push(l)); return g; }
function makeWorkbook(rec) {
  const wb = XLSX.utils.book_new();
  const head = [["Pedido de material · MoreraClima"], [`Conteo: ${fmtDate(rec.fecha)} · Encargado de stock: ${rec.encargado}`], [`Para: ${BUYER} (compras)`], []];
  const cols = ["Proveedor", "Código", "Material", "Mínimo", "Stock contado", "A pedir", "Nota", "Pedido ✓", "Recibido ✓"];
  const toRow = l => [l.proveedor, l.codigo || "", l.material, l.min ?? "", l.stock ?? "", l.pedir, l.nota || "", "", ""];
  const widths = [{ wch: 18 }, { wch: 14 }, { wch: 58 }, { wch: 8 }, { wch: 13 }, { wch: 9 }, { wch: 42 }, { wch: 10 }, { wch: 11 }];
  const sorted = rec.pedir.slice().sort((a, b) => a.proveedor.localeCompare(b.proveedor));
  const ws = XLSX.utils.aoa_to_sheet([...head, cols, ...sorted.map(toRow), [], ["", "", "Total líneas", "", "", sorted.length]]);
  ws["!cols"] = widths; XLSX.utils.book_append_sheet(wb, ws, "Pedido");
  const g = groupByProv(rec.pedir);
  Object.keys(g).sort().forEach(p => {
    const s = XLSX.utils.aoa_to_sheet([[`Pedido ${p}`], [`Conteo: ${fmtDate(rec.fecha)} · ${rec.encargado}`], [], cols, ...g[p].map(toRow)]);
    s["!cols"] = widths; XLSX.utils.book_append_sheet(wb, s, p.replace(/[\\/?*\[\]:]/g, "").slice(0, 31));
  });
  if (rec.sinContar.length) {
    const s = XLSX.utils.aoa_to_sheet([["Materiales que no se contaron en este conteo"], [], cols.slice(0, 7), ...rec.sinContar.map(l => toRow(l).slice(0, 7))]);
    s["!cols"] = widths; XLSX.utils.book_append_sheet(wb, s, "Sin contar");
  }
  const s = XLSX.utils.aoa_to_sheet([["Conteo completo"], [], cols.slice(0, 7), ...rec.todas.map(l => toRow(l).slice(0, 7))]);
  s["!cols"] = widths; XLSX.utils.book_append_sheet(wb, s, "Conteo completo");
  return wb;
}
function currentRecord() {
  const { pedir, sinContar, todas } = buildLines();
  return { encargado: S.conteo.encargado, fecha: new Date().toISOString(), startedAt: S.conteo.startedAt, pedir, sinContar, todas };
}
const fname = rec => `pedido_stock_${fileDate(rec.fecha)}_${(rec.encargado || "sin-nombre").toLowerCase()}.xlsx`;
function downloadRec(rec, msgEl) {
  try { XLSX.writeFile(makeWorkbook(rec), fname(rec)); msgEl.textContent = "Excel descargado."; }
  catch (e) { msgEl.innerHTML = `<span class="nota">No se pudo generar el Excel.</span>`; }
}
function renderRevision() {
  const rec = currentRecord(); S.rec = rec;
  const g = groupByProv(rec.pedir);
  let h = "";
  if (!rec.encargado) h += `<div class="notice warn">Elige quién hace el conteo (${COUNTERS.join(" o ")}) antes de enviarlo.</div>`;
  if (rec.sinContar.length) h += `<div class="notice warn"><b>${rec.sinContar.length} materiales sin contar.</b> No entran en el pedido; salen en una pestaña aparte del Excel. <button class="btn link" id="see-pend">Ver cuáles</button></div>`;
  if (!rec.pedir.length) h += `<div class="notice good">No hay nada por debajo del mínimo. Puedes enviar igualmente el conteo para que quede registrado.</div>`;
  Object.keys(g).sort().forEach(p => {
    h += `<h3 class="prov-h">${esc(p)} <span class="small muted">· ${g[p].length} líneas</span></h3>
    <div class="tbl-wrap"><table><thead><tr><th>Material</th><th>Código</th><th>Mín.</th><th>Hay</th><th>Pedir</th></tr></thead><tbody>
    ${g[p].map(l => `<tr><td>${esc(l.material)}${l.nota ? `<div class="nota">${esc(l.nota)}</div>` : ""}</td><td><span class="code">${esc(l.codigo || "—")}</span></td><td class="n">${l.min}</td><td class="n">${l.stock}</td><td class="n big">${l.pedir}</td></tr>`).join("")}
    </tbody></table></div>`;
  });
  h += `<div class="panel stack">
    <div><span class="lbl">Enviar a ${BUYER}</span><div class="email">${EMAIL}</div>
    <div class="small muted">El correo sale desde la cuenta de Gmail de la empresa, con el Excel adjunto.</div></div>
    <div class="row">
      <button class="btn primary" id="send" ${rec.encargado ? "" : "disabled"}>Enviar Excel por correo</button>
      <button class="btn" id="download">Descargar Excel</button>
    </div>
    <div id="send-msg" class="small"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn link" id="close-nosend">Cerrar conteo sin enviar correo</button></div>
  </div>`;
  $("#rev-body").innerHTML = h;
}
function emailHTML(rec) {
  const g = groupByProv(rec.pedir);
  let t = `<p>Hola ${BUYER},</p><p>${esc(rec.encargado)} ha terminado el conteo de stock (${fmtDate(rec.fecha)}). Hay <b>${rec.pedir.length}</b> materiales por debajo del mínimo. Va el Excel adjunto con una pestaña por proveedor.</p>`;
  Object.keys(g).sort().forEach(p => {
    t += `<h3 style="margin:16px 0 6px">${esc(p)}</h3><table cellpadding="6" style="border-collapse:collapse;font-size:14px"><tr style="background:#eef1f3"><th align="left">Código</th><th align="left">Material</th><th align="right">Pedir</th></tr>` +
      g[p].map(l => `<tr style="border-top:1px solid #ddd"><td>${esc(l.codigo || "—")}</td><td>${esc(l.material)}${l.nota ? `<br><small style="color:#c8321f">${esc(l.nota)}</small>` : ""}</td><td align="right"><b>${l.pedir}</b></td></tr>`).join("") + `</table>`;
  });
  if (rec.sinContar.length) t += `<p style="color:#c8321f">Aviso: ${rec.sinContar.length} materiales no se contaron (pestaña «Sin contar»).</p>`;
  return t;
}
function emailText(rec) {
  return `Hola ${BUYER},\n\n${rec.encargado} ha terminado el conteo de stock (${fmtDate(rec.fecha)}).\nMateriales a pedir: ${rec.pedir.length}.\n\n` +
    rec.pedir.map(l => `${l.proveedor} · ${l.codigo || "sin código"} · ${l.material} · pedir ${l.pedir}`).join("\n") +
    (rec.sinContar.length ? `\n\nAviso: ${rec.sinContar.length} materiales sin contar.` : "") + "\n\nExcel adjunto.";
}
async function finalizar(enviar) {
  const rec = S.rec, msg = $("#send-msg");
  document.querySelectorAll("#rev-body button").forEach(b => b.disabled = true);
  msg.textContent = enviar ? "Enviando…" : "Cerrando el conteo…";
  stopPolling(); clearTimeout(flushTimer);
  try {
    if (Object.keys(S.pending).length) await flush();
    await api("finalizar", {
      rec, enviar,
      xlsx: enviar ? XLSX.write(makeWorkbook(rec), { type: "base64", bookType: "xlsx" }) : null,
      filename: fname(rec),
      subject: `Pedido de material · conteo ${new Date(rec.fecha).toLocaleDateString("es-ES")} (${rec.encargado})`,
      html: enviar ? emailHTML(rec) : "", text: enviar ? emailText(rec) : "",
    });
    msg.innerHTML = enviar ? `<span style="color:var(--ok);font-weight:600">Correo enviado a ${EMAIL}.</span>` : "Conteo cerrado.";
    S.counts = {}; S.pending = {}; S.conteo = { encargado: null, startedAt: null };
    startPolling();
    setTimeout(() => go("historial"), 1200);
  } catch (e) {
    document.querySelectorAll("#rev-body button").forEach(b => b.disabled = false);
    startPolling();
    msg.innerHTML = `<span class="nota">${e.code === "red" || e.message === "Failed to fetch"
      ? "Se perdió la conexión. Puede que el correo haya salido: revisa la bandeja de " + EMAIL + " antes de volver a intentarlo."
      : "No se pudo completar: " + esc(e.message)}</span>`;
  }
}
$("#finish").addEventListener("click", () => { renderRevision(); go("revision"); });
$("#back").addEventListener("click", () => go("conteo"));
$("#rev-body").addEventListener("click", e => {
  if (e.target.id === "send") finalizar(true);
  if (e.target.id === "download") downloadRec(S.rec, $("#send-msg"));
  if (e.target.id === "see-pend") { S.filter = "pendientes"; [...$("#filter").children].forEach(x => x.setAttribute("aria-pressed", x.dataset.f === "pendientes")); go("conteo"); }
  if (e.target.id === "close-nosend") {
    const b = e.target;
    if (b.dataset.confirm) finalizar(false);
    else { b.dataset.confirm = "1"; b.textContent = "¿Seguro? Se cierra el conteo sin enviar nada. Pulsa otra vez para confirmar"; }
  }
});

/* ---------- configuración: orden ---------- */
function renderOrderMeta() {
  const m = S.orderMeta;
  $("#order-meta").innerHTML = m && m.savedBy ? `Orden guardado por <b>${esc(m.savedBy)}</b> el ${fmtDate(m.savedAt)}.` : "Se usa el orden original del PDF (todavía nadie ha guardado otro).";
}
function draft() { if (!S.draft) S.draft = S.order.slice(); return S.draft; }
function isDirty() { return S.draft && S.draft.join() !== S.order.join(); }
function renderOrder() {
  const list = S.draft || S.order, q = norm($("#oq").value).trim();
  $("#olist").innerHTML = list.map((id, i) => {
    const it = BY[id];
    const hit = q && norm(`${it.material} ${it.codigo} ${it.proveedor}`).includes(q);
    return `<li class="orow${hit ? " hit" : ""}" data-id="${id}">
      <button class="handle" aria-label="Arrastrar para mover"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg></button>
      <input class="pos" type="number" inputmode="numeric" id="pos-${id}" value="${i + 1}" min="1" max="${list.length}" aria-label="Posición">
      <div class="othumb"><img src="${it.img}" alt="" loading="lazy"></div>
      <div class="oname">${esc(it.material)}<small>${esc(it.proveedor)}${it.codigo ? " · " + esc(it.codigo) : ""}</small></div>
      <div class="arrows"><button data-mv="-1" aria-label="Subir">▲</button><button data-mv="1" aria-label="Bajar">▼</button></div>
    </li>`;
  }).join("");
  renderSaveBar();
}
function renderSaveBar() {
  $("#bar-config").hidden = !(S.view === "config" && isDirty());
  $("#who-save").innerHTML = COUNTERS.map(n => `<button class="chip" data-who="${n}" aria-pressed="${S.draftBy === n}">${n}</button>`).join("");
  $("#save-order").disabled = !S.draftBy;
}
function moveTo(id, idx) {
  const d = draft(); const from = d.indexOf(id); idx = Math.max(0, Math.min(d.length - 1, idx));
  if (from !== idx) { d.splice(from, 1); d.splice(idx, 0, id); }
  renderOrder();
  const el = document.querySelector(`.orow[data-id="${id}"]`); el && el.scrollIntoView({ block: "nearest" });
}
$("#olist").addEventListener("click", e => {
  const b = e.target.closest("[data-mv]"); if (!b) return;
  const id = b.closest(".orow").dataset.id; const d = draft();
  moveTo(id, d.indexOf(id) + Number(b.dataset.mv));
  document.querySelector(`.orow[data-id="${id}"] [data-mv="${b.dataset.mv}"]`)?.focus({ preventScroll: true });
});
$("#olist").addEventListener("change", e => {
  if (!e.target.matches(".pos")) return;
  const id = e.target.closest(".orow").dataset.id; const n = parseInt(e.target.value, 10);
  if (isFinite(n)) moveTo(id, n - 1); else renderOrder();
});
$("#oq").addEventListener("input", () => { renderOrder(); document.querySelector(".orow.hit")?.scrollIntoView({ block: "center" }); });
$("#reset-order").addEventListener("click", () => { S.draft = PDF_ORDER.slice(); renderOrder(); });
$("#discard").addEventListener("click", () => { S.draft = null; S.draftBy = null; renderOrder(); });
$("#who-save").addEventListener("click", e => { const b = e.target.closest("[data-who]"); if (b) { S.draftBy = b.dataset.who; renderSaveBar(); } });
$("#save-order").addEventListener("click", async () => {
  if (!S.draftBy || !S.draft) return;
  $("#save-msg").textContent = "Guardando…"; $("#save-order").disabled = true;
  try {
    const r = await api("saveOrder", { order: S.draft, savedBy: S.draftBy });
    S.order = normalizeOrder(r.orden.order); S.orderMeta = r.orden; S.draft = null; S.draftBy = null;
    $("#save-msg").textContent = "";
    renderOrderMeta(); renderOrder(); renderCards();
  } catch (e) { $("#save-msg").textContent = "No se pudo guardar: " + e.message; $("#save-order").disabled = false; }
});

/* arrastrar con puntero (ratón y táctil) */
let drag = null;
$("#olist").addEventListener("pointerdown", e => {
  const h = e.target.closest(".handle"); if (!h) return;
  e.preventDefault();
  const row = h.closest(".orow"); draft();
  drag = { row, pid: e.pointerId };
  h.setPointerCapture(e.pointerId); row.classList.add("dragging");
});
$("#olist").addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.pid) return;
  for (const r of $("#olist").children) {
    if (r === drag.row) continue;
    const b = r.getBoundingClientRect();
    if (e.clientY > b.top && e.clientY < b.bottom) {
      const ref = e.clientY > b.top + b.height / 2 ? r.nextSibling : r;
      if (ref !== drag.row) $("#olist").insertBefore(drag.row, ref);
      break;
    }
  }
  if (e.clientY < 70) scrollBy(0, -12); else if (e.clientY > innerHeight - 190) scrollBy(0, 12);
});
function endDrag() {
  if (!drag) return;
  drag.row.classList.remove("dragging");
  S.draft = [...$("#olist").children].map(r => r.dataset.id);
  drag = null; renderOrder();
}
$("#olist").addEventListener("pointerup", endDrag);
$("#olist").addEventListener("pointercancel", endDrag);

/* ---------- historial ---------- */
async function loadHist() {
  $("#hist").innerHTML = `<div class="panel empty">Cargando…</div>`;
  try { S.hist = (await api("historial")).hist || []; } catch (e) { $("#hist").innerHTML = `<div class="panel empty">No se pudo cargar el historial.</div>`; return; }
  if (!S.hist.length) { $("#hist").innerHTML = `<div class="panel empty">Aquí aparecerán los conteos terminados, con quién los hizo, la fecha y el Excel que se envió.</div>`; return; }
  $("#hist").innerHTML = S.hist.map((h, i) => `<div class="panel row" style="justify-content:space-between">
    <div><b>${fmtDate(h.fecha)}</b> · ${esc(h.encargado || "—")}<div class="small muted">${(h.pedir || []).length} materiales a pedir${(h.sinContar || []).length ? ` · ${h.sinContar.length} sin contar` : ""} · ${h.enviado ? "enviado a " + esc(h.enviadoA) : "cerrado sin enviar"}</div><div class="small" id="hmsg-${i}"></div></div>
    <button class="btn" data-h="${i}">Descargar Excel</button></div>`).join("");
}
$("#hist").addEventListener("click", e => { const b = e.target.closest("[data-h]"); if (b) downloadRec(S.hist[b.dataset.h], $("#hmsg-" + b.dataset.h)); });

/* ---------- navegación ---------- */
function go(v) {
  S.view = v;
  ["conteo", "revision", "config", "historial"].forEach(x => $("#v-" + x).hidden = x !== v);
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.view === v || (v === "revision" && t.dataset.view === "conteo")));
  $("#bar-conteo").hidden = v !== "conteo";
  if (v === "config") renderOrder(); else $("#bar-config").hidden = true;
  if (v === "historial") loadHist();
  if (v === "conteo") renderCards();
  scrollTo(0, 0);
}
document.querySelector(".tabs").addEventListener("click", e => { const t = e.target.closest(".tab"); if (t) go(t.dataset.view); });

/* ---------- arranque ---------- */
function enterApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  renderWho(); renderOrderMeta(); go("conteo");
  setSync("Conectando…"); refresh(); startPolling();
}
(async () => {
  if (!API) { showLogin("Falta configurar la dirección del servidor en config.js (ver LEEME.md)."); return; }
  const saved = store.get("clave");
  if (!saved) { showLogin(""); return; }
  S.clave = saved; enterApp();
})();
