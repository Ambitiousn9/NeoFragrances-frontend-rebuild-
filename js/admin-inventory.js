/* ============================================
   NeoFragrances — admin-inventory.js
   Stock levels for active products. Changes are
   sent as adjustments (new − shown value) so a sale
   made while this page is open isn't overwritten;
   the server refuses anything that would go below 0.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, int } = NFA;
  const DEFAULTS = { q: "", stock: "all", category: "all", sort: "stock_qty", dir: "asc", page: 1 };
  const PAGE_SIZE = 30;
  const state = NFA.readParams(DEFAULTS);
  let products = null, loadError = null;
  const getters = { name: p => p.name.toLowerCase(), stock_qty: p => Number(p.stock_qty), units_sold: p => Number(p.units_sold), category: p => p.category };

  const active = () => products.filter(p => !p.deleted_at);
  function filtered() {
    const q = NFA.normalize(state.q);
    return active().filter(p => {
      if (state.stock !== "all" && NFA.stockState(p).key !== state.stock) return false;
      if (state.category !== "all" && p.category !== state.category) return false;
      if (q && !NFA.normalize(`${p.name} ${p.brand} ${p.id}`).includes(q)) return false;
      return true;
    });
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const list = active();
    const c = { in: 0, low: 0, out: 0 };
    list.forEach(p => { c[NFA.stockState(p).key]++; });
    const units = list.reduce((s, p) => s + Number(p.stock_qty), 0);
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Units in stock</span><span class="adm-kpi-value">${int(units)}</span><span class="adm-kpi-meta">Across ${int(list.length)} active products</span></div>
        <a class="adm-kpi" href="?stock=in"><span class="adm-kpi-label">In stock</span><span class="adm-kpi-value">${int(c.in)}</span><span class="adm-kpi-meta">More than ${NFA.LOW_STOCK} units</span></a>
        <a class="adm-kpi${c.low ? " adm-kpi--alert" : ""}" href="?stock=low"><span class="adm-kpi-label">Low stock</span><span class="adm-kpi-value">${int(c.low)}</span><span class="adm-kpi-meta">1–${NFA.LOW_STOCK} units</span></a>
        <a class="adm-kpi${c.out ? " adm-kpi--alert" : ""}" href="?stock=out"><span class="adm-kpi-label">Out of stock</span><span class="adm-kpi-value">${int(c.out)}</span><span class="adm-kpi-meta">Hidden from purchase</span></a>
      </div>
      <div class="adm-tabs" role="group" aria-label="Stock level">
        ${[["all", "All", list.length], ["low", "Low", c.low], ["out", "Out", c.out], ["in", "In stock", c.in]].map(([k, l, n]) => `<button type="button" class="adm-tab" data-stock="${k}" aria-pressed="${state.stock === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("")}
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="i-search" class="sr-only">Search inventory</label><input id="i-search" class="adm-input" type="search" placeholder="Search name, brand or ID" value="${esc(state.q)}"></div>
        <label class="sr-only" for="i-category">Category</label>
        <select id="i-category" class="adm-select"><option value="all">All categories</option>${["men", "women", "unisex"].map(x => `<option value="${x}"${state.category === x ? " selected" : ""}>${NFA.cap(x)}</option>`).join("")}</select>
        <div class="adm-toolbar-right"><span class="adm-count" id="i-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards"><caption class="sr-only">Inventory</caption><thead id="i-head"></thead><tbody id="i-body"></tbody></table>
        <div id="i-pager"></div>
      </div>
      <p class="adm-note" style="margin-top:12px">Archived products aren't listed here — restore them from Products first.</p>`;
    renderTable();
  }

  function rowHTML(p) {
    return `
      <tr data-row="${p.id}">
        <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(p.image)}<div><span class="adm-cell-title">${esc(p.name)}</span><span class="adm-cell-sub">${esc(p.brand)} · ${esc(NFA.cap(p.category))}</span></div></div></td>
        <td data-label="Status">${NFA.stockBadge(p)}</td>
        <td data-label="Sold" class="ta-r num">${int(p.units_sold)}</td>
        <td data-label="Stock" class="ta-r">
          <span class="adm-stepper">
            <button type="button" data-step="-1" aria-label="Decrease stock of ${esc(p.name)}"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
            <input type="number" min="0" max="100000" step="1" inputmode="numeric" value="${esc(p.stock_qty)}" data-stock-input="${p.id}" aria-label="Stock for ${esc(p.name)}">
            <button type="button" data-step="1" aria-label="Increase stock of ${esc(p.name)}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
          </span>
        </td>
        <td class="adm-td-actions ta-r"><span class="adm-row-actions">
          <button type="button" class="adm-btn adm-btn--sm adm-btn--primary" data-save="${p.id}" hidden>Save</button>
          <button type="button" class="adm-link" data-reset="${p.id}" hidden>Undo</button>
        </span></td>
      </tr>`;
  }

  function renderTable() {
    const list = NFA.sortBy(filtered(), state.sort, state.dir, getters);
    const pg = NFA.paginate(list, state.page, PAGE_SIZE);
    state.page = pg.page;
    NFA.writeParams(state, DEFAULTS);
    document.getElementById("i-head").innerHTML = `<tr>${NFA.sortHeader("Product", "name", state)}<th>Status</th>${NFA.sortHeader("Sold", "units_sold", state, "ta-r")}${NFA.sortHeader("Stock", "stock_qty", state, "ta-r")}<th class="ta-r"><span class="sr-only">Actions</span></th></tr>`;
    document.getElementById("i-count").textContent = `${int(list.length)} product${list.length !== 1 ? "s" : ""}`;
    document.getElementById("i-body").innerHTML = pg.rows.length ? pg.rows.map(rowHTML).join("")
      : NFA.tableState(5, NFA.stateHTML({ icon: "fa-solid fa-boxes-stacked", title: "No products here", text: state.stock === "low" ? `No active product has 1–${NFA.LOW_STOCK} units.` : "Try a different search or filter." }));
    document.getElementById("i-pager").innerHTML = NFA.pagerHTML({ total: list.length, page: pg.page, pageSize: PAGE_SIZE, noun: "products" });
  }

  function markChanged(id) {
    const p = products.find(x => x.id === id);
    const input = root.querySelector(`[data-stock-input="${id}"]`);
    const changed = input.value !== String(p.stock_qty);
    root.querySelector(`[data-save="${id}"]`).hidden = !changed;
    root.querySelector(`[data-reset="${id}"]`).hidden = !changed;
  }

  async function saveStock(id) {
    const p = products.find(x => x.id === id);
    const input = root.querySelector(`[data-stock-input="${id}"]`);
    const raw = input.value.trim();
    if (!/^\d+$/.test(raw) || Number(raw) > 100000) { NFA.toast("Stock must be a whole number from 0 to 100,000.", "error"); input.focus(); return; }
    const delta = Number(raw) - Number(p.stock_qty);
    if (!delta) return markChanged(id);
    const btn = root.querySelector(`[data-save="${id}"]`); btn.disabled = true;
    try {
      const res = await NFA.api(`/api/admin/products/${id}/stock`, { method: "PATCH", body: { adjust: delta } });
      p.stock_qty = res.stock_qty;
      NFA.toast(`${p.name}: stock ${delta > 0 ? "+" : ""}${delta} → ${res.stock_qty}`);
      const row = root.querySelector(`[data-row="${id}"]`);
      row.outerHTML = rowHTML(p);
      root.querySelector(`[data-stock-input="${id}"]`)?.focus();
      NFA.loadCounts(true);
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      NFA.toast(e.message, "error");
      if (e.code === "NEGATIVE_STOCK") load(); // stock changed elsewhere — refresh the real value
    } finally { if (document.contains(btn)) btn.disabled = false; }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { products = await NFA.api("/api/admin/products"); loadError = null; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  const onSearch = NFA.debounce(() => { state.page = 1; renderTable(); });
  root.addEventListener("input", e => {
    if (e.target.id === "i-search") { state.q = e.target.value; onSearch(); }
    if (e.target.dataset.stockInput) markChanged(Number(e.target.dataset.stockInput));
  });
  root.addEventListener("change", e => { if (e.target.id === "i-category") { state.category = e.target.value; state.page = 1; renderTable(); } });
  root.addEventListener("keydown", e => {
    if (e.target.dataset.stockInput && e.key === "Enter") { e.preventDefault(); saveStock(Number(e.target.dataset.stockInput)); }
  });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-stock]");
    if (tab) { state.stock = tab.dataset.stock; state.page = 1; render(); root.querySelector(`[data-stock="${state.stock}"]`).focus(); return; }
    const kpi = e.target.closest("a.adm-kpi");
    if (kpi) { e.preventDefault(); state.stock = new URL(kpi.href).searchParams.get("stock"); state.page = 1; render(); return; }
    const sort = e.target.closest("[data-sort]");
    if (sort) { NFA.nextSort(state, sort.dataset.sort); renderTable(); root.querySelector(`[data-sort="${sort.dataset.sort}"]`).focus(); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); renderTable(); return; }
    const step = e.target.closest("[data-step]");
    if (step) {
      const input = step.parentElement.querySelector("input");
      input.value = String(Math.max(0, Math.min(100000, (parseInt(input.value, 10) || 0) + Number(step.dataset.step))));
      markChanged(Number(input.dataset.stockInput));
      return;
    }
    const save = e.target.closest("[data-save]");
    if (save) return saveStock(Number(save.dataset.save));
    const reset = e.target.closest("[data-reset]");
    if (reset) { const id = Number(reset.dataset.reset); root.querySelector(`[data-stock-input="${id}"]`).value = String(products.find(x => x.id === id).stock_qty); markChanged(id); }
  });

  NFA.ready.then(load);
})();
