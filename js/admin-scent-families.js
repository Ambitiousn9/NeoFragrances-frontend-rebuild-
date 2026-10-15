/* ============================================
   NeoFragrances — admin-scent-families.js
   Owner-managed scent families (Stage B). One primary
   family per active product: floral, amber, fresh or
   woody; NULL = unassigned. Families are only ever set
   here by the owner — nothing is inferred from a name.

   Data: GET /api/admin/products (already returns
   scent_family). Writes: the Stage A endpoints —
     PATCH /api/admin/products/:id/scent-family
     PATCH /api/admin/products/scent-family (bulk,
       1–100 products, all-or-nothing on the server).
   A bulk change is ONE request; it is never simulated
   with individual updates.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const live = document.getElementById("sf-live");
  const { esc, int } = NFA;
  const FAMILIES = [
    { key: "floral", label: "Floral", hint: "Rose · Jasmine · Peony" },
    { key: "amber", label: "Amber", hint: "Oud · Amber · Musk" },
    { key: "fresh", label: "Fresh", hint: "Citrus · Aqua · Green" },
    { key: "woody", label: "Woody", hint: "Sandalwood · Cedar" },
  ];
  const LABEL = Object.fromEntries(FAMILIES.map(f => [f.key, f.label]));
  const BULK_MAX = 100; // matches MAX_SCENT_FAMILY_BATCH on the server
  const PAGE_SIZE = 30;
  const DEFAULTS = { q: "", family: "all", stock: "all", sort: "name", dir: "asc", page: 1 };
  const FAMILY_FILTERS = ["all", ...FAMILIES.map(f => f.key), "unassigned"];
  const STOCK_FILTERS = [["all", "Any stock"], ["available", "Available (1+ units)"], ["low", `Low stock (1–${NFA.LOW_STOCK})`], ["out", "Out of stock"]];
  const state = NFA.readParams(DEFAULTS);
  if (!FAMILY_FILTERS.includes(state.family)) state.family = "all";
  if (!STOCK_FILTERS.some(([k]) => k === state.stock)) state.stock = "all";
  const getters = { name: p => p.name.toLowerCase(), stock_qty: p => Number(p.stock_qty) };

  let products = null, loadError = null;
  const selected = new Set();   // product ids chosen for a bulk change (kept across pages and filters)
  const busy = new Set();       // product ids with a single update in flight
  const rowErrors = new Map();  // product id -> last save error, shown in the row until the next change
  let bulkBusy = false;
  let bulkChoice = "";      // the family chosen in the bulk bar, kept across re-renders

  const familyOf = p => (p.scent_family && LABEL[p.scent_family] ? p.scent_family : null);
  const active = () => products.filter(p => !p.deleted_at);
  const byId = id => products.find(p => p.id === id);
  const announce = text => { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 30); };
  const plural = (n, one, many = one + "s") => `${int(n)} ${n === 1 ? one : many}`;

  function stockMatch(p) {
    const q = Number(p.stock_qty);
    if (state.stock === "available") return q > 0;
    if (state.stock === "low") return q > 0 && q <= NFA.LOW_STOCK;
    if (state.stock === "out") return q <= 0;
    return true;
  }
  function filtered() {
    const q = NFA.normalize(state.q);
    return active().filter(p => {
      const fam = familyOf(p);
      if (state.family === "unassigned" ? fam !== null : state.family !== "all" && fam !== state.family) return false;
      if (!stockMatch(p)) return false;
      if (q && !NFA.normalize(`${p.name} ${p.brand} ${p.id}`).includes(q)) return false;
      return true;
    });
  }

  function familyBadge(key) {
    return key
      ? `<span class="adm-badge adm-badge--sf-${key}">${esc(LABEL[key])}</span>`
      : `<span class="adm-badge adm-badge--sf-none">Unassigned</span>`;
  }

  /* ---------- page ---------- */
  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    root.innerHTML = `
      <div class="adm-kpis adm-sf-kpis" id="sf-kpis" role="group" aria-label="Scent family totals"></div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="sf-search" class="sr-only">Search products</label><input id="sf-search" class="adm-input" type="search" placeholder="Search name, brand or ID" value="${esc(state.q)}"></div>
        <label class="sr-only" for="sf-family">Scent family</label>
        <select id="sf-family" class="adm-select">${[["all", "All families"], ...FAMILIES.map(f => [f.key, f.label]), ["unassigned", "Unassigned only"]].map(([k, l]) => `<option value="${k}"${state.family === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <label class="sr-only" for="sf-stock">Stock availability</label>
        <select id="sf-stock" class="adm-select">${STOCK_FILTERS.map(([k, l]) => `<option value="${k}"${state.stock === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="adm-toolbar-right"><span class="adm-count" id="sf-count" role="status" tabindex="-1"></span></div>
      </div>
      <div class="adm-sf-bulk" id="sf-bulk" hidden></div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards adm-sf-table"><caption class="sr-only">Products and their scent families</caption><thead id="sf-head"></thead><tbody id="sf-body"></tbody></table>
        <div id="sf-pager"></div>
      </div>
      <p class="adm-note" style="margin-top:12px">Archived products aren't listed — restore them from Products first. Changing a family never touches price, stock or any other product detail.</p>`;
    renderKpis();
    renderTable();
  }

  function renderKpis() {
    const list = active();
    const tile = (key, label, items) => {
      const inStock = items.filter(p => Number(p.stock_qty) > 0).length;
      return `<button type="button" class="adm-kpi adm-sf-kpi adm-sf-kpi--${key}" data-family-tile="${key}" aria-pressed="${state.family === key}">
        <span class="adm-kpi-label">${esc(label)}</span>
        <span class="adm-kpi-value" data-count="${key}">${int(items.length)}</span>
        <span class="adm-kpi-meta">${int(inStock)} in stock</span>
      </button>`;
    };
    document.getElementById("sf-kpis").innerHTML =
      FAMILIES.map(f => tile(f.key, f.label, list.filter(p => familyOf(p) === f.key))).join("") +
      tile("unassigned", "Unassigned", list.filter(p => familyOf(p) === null));
  }

  function controlHTML(p) {
    const fam = familyOf(p);
    const isBusy = busy.has(p.id);
    return `
      <span class="adm-sf-assign">
        <label class="sr-only" for="sf-set-${p.id}">Scent family for ${esc(p.name)}</label>
        <select class="adm-select adm-select--sm" id="sf-set-${p.id}" data-set="${p.id}"${isBusy || bulkBusy ? " disabled" : ""}>
          <option value=""${fam === null ? " selected" : ""}>Unassigned</option>
          ${FAMILIES.map(f => `<option value="${f.key}"${fam === f.key ? " selected" : ""}>${esc(f.label)}</option>`).join("")}
        </select>
        <button type="button" class="adm-btn adm-btn--sm adm-btn--primary" data-save="${p.id}"${isBusy ? "" : " hidden"}${isBusy ? " disabled" : ""}>${isBusy ? "Saving…" : "Save"}</button>
        <button type="button" class="adm-link" data-undo="${p.id}" hidden>Undo</button>
      </span>`;
  }

  function rowHTML(p) {
    const fam = familyOf(p);
    const err = rowErrors.get(p.id);
    const checked = selected.has(p.id);
    const capped = !checked && selected.size >= BULK_MAX;
    return `
      <tr data-row="${p.id}"${busy.has(p.id) ? ' aria-busy="true"' : ""}>
        <td data-label="Select" class="adm-sf-td-check">
          <input type="checkbox" class="adm-sf-check" data-select="${p.id}" aria-label="Select ${esc(p.name)} for a bulk change"${checked ? " checked" : ""}${capped || bulkBusy ? " disabled" : ""}${capped ? ` title="Limit reached: ${BULK_MAX} products per bulk change"` : ""}>
        </td>
        <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(p.image)}<div><span class="adm-cell-title">${esc(p.name)}</span><span class="adm-cell-sub">${esc(p.brand)} · <span class="num">#${esc(p.id)}</span></span></div></div></td>
        <td data-label="Stock"><span class="adm-sf-stock">${NFA.stockBadge(p)}<span class="num">${int(p.stock_qty)} units</span></span></td>
        <td data-label="Family" data-family-cell="${p.id}">${familyBadge(fam)}</td>
        <td data-label="Change" class="adm-sf-td-control">${controlHTML(p)}${err ? `<span class="adm-sf-row-error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Not saved — ${esc(err)}</span>` : ""}</td>
      </tr>`;
  }

  function renderTable() {
    const list = NFA.sortBy(filtered(), state.sort, state.dir, getters);
    const pg = NFA.paginate(list, state.page, PAGE_SIZE);
    state.page = pg.page;
    NFA.writeParams(state, DEFAULTS);
    const pageIds = pg.rows.map(p => p.id);
    const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    document.getElementById("sf-head").innerHTML = `<tr>
      <th class="adm-sf-td-check"><input type="checkbox" class="adm-sf-check" id="sf-check-page" aria-label="Select all ${pageIds.length} products on this page"${allOnPage ? " checked" : ""}${!pageIds.length || bulkBusy ? " disabled" : ""}></th>
      ${NFA.sortHeader("Product", "name", state)}${NFA.sortHeader("Stock", "stock_qty", state)}<th>Family</th><th>Change family</th></tr>`;
    document.getElementById("sf-count").textContent = plural(list.length, "product");
    document.getElementById("sf-body").innerHTML = pg.rows.length ? pg.rows.map(rowHTML).join("")
      : NFA.tableState(5, NFA.stateHTML({ icon: "fa-solid fa-spray-can-sparkles", title: "No products here", text: state.family === "unassigned" && !state.q && state.stock === "all" ? "Every active product has a scent family." : "Try a different search or filter." }));
    document.getElementById("sf-pager").innerHTML = NFA.pagerHTML({ total: list.length, page: pg.page, pageSize: PAGE_SIZE, noun: "products" });
    renderBulk();
  }

  function renderBulk() {
    const bar = document.getElementById("sf-bulk");
    if (!bar) return;
    if (!selected.size) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    const atCap = selected.size >= BULK_MAX;
    const prev = bulkChoice;
    bar.innerHTML = `
      <div class="adm-sf-bulk-info">
        <strong id="sf-selected-count">${plural(selected.size, "product")} selected</strong>
        <span class="adm-note">${atCap ? `Limit reached — up to ${BULK_MAX} products per bulk change.` : `Up to ${BULK_MAX} per bulk change.`}</span>
      </div>
      <div class="adm-sf-bulk-controls">
        <label for="sf-bulk-family">Change selected to</label>
        <select id="sf-bulk-family" class="adm-select adm-select--sm"${bulkBusy ? " disabled" : ""}>
          <option value="">Choose a family…</option>
          ${FAMILIES.map(f => `<option value="${f.key}"${prev === f.key ? " selected" : ""}>${esc(f.label)}</option>`).join("")}
          <option value="unassigned"${prev === "unassigned" ? " selected" : ""}>Unassigned (remove family)</option>
        </select>
        <button type="button" class="adm-btn adm-btn--sm adm-btn--primary" id="sf-bulk-apply"${bulkBusy ? " disabled" : ""}>${bulkBusy ? "Saving…" : "Apply"}</button>
        <button type="button" class="adm-btn adm-btn--sm adm-btn--ghost" id="sf-bulk-clear"${bulkBusy ? " disabled" : ""}>Clear selection</button>
      </div>`;
  }

  // Keeps the current page, the tiles and the bulk bar in step without rebuilding the toolbar.
  function refresh() { renderKpis(); renderTable(); }

  /* ---------- single product ---------- */
  function markChanged(id) {
    const p = byId(id);
    const sel = root.querySelector(`[data-set="${id}"]`);
    if (!p || !sel) return;
    const changed = sel.value !== (familyOf(p) || "");
    root.querySelector(`[data-save="${id}"]`).hidden = !changed;
    root.querySelector(`[data-undo="${id}"]`).hidden = !changed;
  }

  async function saveOne(id) {
    if (busy.has(id) || bulkBusy) return;           // no duplicate submissions
    const p = byId(id);
    const sel = root.querySelector(`[data-set="${id}"]`);
    if (!p || !sel) return;
    const value = sel.value === "" ? null : sel.value;
    if (value === familyOf(p)) return markChanged(id);
    busy.add(id); rowErrors.delete(id);
    const row = root.querySelector(`[data-row="${id}"]`);
    if (row) row.outerHTML = rowHTML(p);
    const newSel = root.querySelector(`[data-set="${id}"]`); if (newSel) newSel.value = value || "";
    announce(`Saving ${p.name}…`);
    try {
      const res = await NFA.api(`/api/admin/products/${id}/scent-family`, { method: "PATCH", body: { scent_family: value } });
      p.scent_family = res.scent_family;
      busy.delete(id);
      const msg = res.scent_family ? `${p.name}: ${LABEL[res.scent_family]}` : `${p.name}: returned to Unassigned`;
      NFA.toast(msg); announce(`Saved. ${msg}.`);
      refresh();
      const again = root.querySelector(`[data-set="${id}"]`);
      (again || document.getElementById("sf-count"))?.focus();
    } catch (e) {
      busy.delete(id);
      if (NFA.isSessionError(e)) return;              // NFA already sent the admin to the login page
      rowErrors.set(id, e.message);
      NFA.toast(e.message, "error"); announce(`Not saved. ${e.message}`);
      if (e.code === "PRODUCT_ARCHIVED" || e.status === 404) { await load(); return; } // changed elsewhere — show the truth
      refresh();
      root.querySelector(`[data-set="${id}"]`)?.focus();
    }
  }

  /* ---------- bulk ---------- */
  function toggleSelect(id, on) {
    if (on) {
      if (selected.size >= BULK_MAX) { announce(`Limit reached: ${BULK_MAX} products per bulk change.`); return false; }
      selected.add(id);
    } else selected.delete(id);
    return true;
  }

  async function applyBulk() {
    if (bulkBusy || !selected.size) return;
    const choice = document.getElementById("sf-bulk-family").value;
    if (!choice) { NFA.toast("Choose the family to apply first.", "error"); document.getElementById("sf-bulk-family").focus(); return; }
    const ids = [...selected];
    if (ids.length > BULK_MAX) { NFA.toast(`Select ${BULK_MAX} products or fewer.`, "error"); return; }
    const target = choice === "unassigned" ? null : choice;
    const items = ids.map(byId).filter(Boolean);
    const already = items.filter(p => familyOf(p) === target).length;
    const moving = items.filter(p => familyOf(p) !== null && familyOf(p) !== target).length;
    const dest = target ? LABEL[target] : "Unassigned";
    const details = [
      moving ? `${plural(moving, "product")} currently in another family will change.` : "",
      already ? `${int(already)} ${already === 1 ? "is" : "are"} already ${dest}.` : "",
      "All or nothing: if any product can't be updated, none of them are changed.",
    ].filter(Boolean).join(" ");
    const ok = await NFA.confirm({
      title: target ? `Assign ${plural(ids.length, "product")} to ${dest}?` : `Return ${plural(ids.length, "product")} to Unassigned?`,
      text: details,
      okLabel: target ? `Assign to ${dest}` : "Remove family",
    });
    if (!ok) return;
    bulkBusy = true; renderTable();
    announce(`Saving ${plural(ids.length, "product")}…`);
    try {
      const res = await NFA.api("/api/admin/products/scent-family", { method: "PATCH", body: { product_ids: ids, scent_family: target } });
      (res.product_ids || ids).forEach(id => { const p = byId(id); if (p) { p.scent_family = res.scent_family; rowErrors.delete(id); } });
      selected.clear();
      bulkBusy = false;
      bulkChoice = "";
      const msg = target ? `${plural(res.updated, "product")} assigned to ${dest}` : `${plural(res.updated, "product")} returned to Unassigned`;
      NFA.toast(msg); announce(`Saved. ${msg}.`);
      refresh();
      document.getElementById("sf-count")?.focus();
    } catch (e) {
      bulkBusy = false;
      if (NFA.isSessionError(e)) return;
      if (e.code === "INELIGIBLE_PRODUCTS") {
        // The server changed nothing. Reload the real catalogue; load() drops archived or deleted
        // products from the selection, so the owner can review the rest and apply again.
        const before = new Set(selected);
        await load();
        const removed = [...before].filter(id => !selected.has(id));
        const msg = `Nothing was changed. ${removed.length ? `${plural(removed.length, "selected product")} ${removed.length === 1 ? "is" : "are"} archived or no longer exist${removed.length === 1 ? "s" : ""} (#${removed.join(", #")}) and ${removed.length === 1 ? "was" : "were"} removed from your selection.` : "Some selected products couldn't be updated."} Review the selection and apply again.`;
        NFA.toast(msg, "error"); announce(msg);
        return;
      }
      const msg = /nothing was changed/i.test(e.message) ? e.message : `Nothing was changed. ${e.message}`;
      NFA.toast(msg, "error"); announce(msg);
      renderTable();
    }
  }

  /* ---------- data ---------- */
  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      products = await NFA.api("/api/admin/products"); loadError = null;
      const known = new Set(products.filter(p => !p.deleted_at).map(p => p.id));
      [...selected].forEach(id => { if (!known.has(id)) selected.delete(id); });
    } catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  /* ---------- events ---------- */
  const onSearch = NFA.debounce(() => { state.page = 1; renderTable(); });
  root.addEventListener("input", e => {
    if (e.target.id === "sf-search") { state.q = e.target.value; onSearch(); }
  });
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sf-family") { state.family = t.value; state.page = 1; refresh(); return; }
    if (t.id === "sf-stock") { state.stock = t.value; state.page = 1; renderTable(); return; }
    if (t.id === "sf-bulk-family") { bulkChoice = t.value; return; }
    if (t.dataset.set) { rowErrors.delete(Number(t.dataset.set)); markChanged(Number(t.dataset.set)); return; }
    if (t.dataset.select) {
      const id = Number(t.dataset.select);
      if (!toggleSelect(id, t.checked)) t.checked = false;
      renderTable();
      root.querySelector(`[data-select="${id}"]`)?.focus();
      return;
    }
    if (t.id === "sf-check-page") {
      const pageIds = [...root.querySelectorAll("#sf-body [data-select]")].map(x => Number(x.dataset.select));
      if (t.checked) {
        let skipped = 0;
        pageIds.forEach(id => { if (!selected.has(id) && !toggleSelect(id, true)) skipped++; });
        if (skipped) { NFA.toast(`Limit reached: ${BULK_MAX} products per bulk change. ${plural(skipped, "product")} on this page weren't selected.`, "error"); }
      } else pageIds.forEach(id => selected.delete(id));
      renderTable();
      document.getElementById("sf-check-page")?.focus();
    }
  });
  root.addEventListener("keydown", e => {
    if (e.target.dataset.set && e.key === "Enter") { e.preventDefault(); saveOne(Number(e.target.dataset.set)); }
  });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tile = e.target.closest("[data-family-tile]");
    if (tile) { const k = tile.dataset.familyTile; state.family = state.family === k ? "all" : k; state.page = 1; render(); root.querySelector(`[data-family-tile="${k}"]`)?.focus(); return; }
    const sort = e.target.closest("[data-sort]");
    if (sort) { NFA.nextSort(state, sort.dataset.sort); renderTable(); root.querySelector(`[data-sort="${sort.dataset.sort}"]`)?.focus(); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); renderTable(); return; }
    const save = e.target.closest("[data-save]");
    if (save) return saveOne(Number(save.dataset.save));
    const undo = e.target.closest("[data-undo]");
    if (undo) { const id = Number(undo.dataset.undo); const p = byId(id); root.querySelector(`[data-set="${id}"]`).value = familyOf(p) || ""; markChanged(id); root.querySelector(`[data-set="${id}"]`).focus(); return; }
    if (e.target.closest("#sf-bulk-apply")) return applyBulk();
    if (e.target.closest("#sf-bulk-clear")) { selected.clear(); bulkChoice = ""; renderTable(); announce("Selection cleared."); document.getElementById("sf-search")?.focus(); }
  });

  NFA.ready.then(load);
})();
