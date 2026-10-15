/* ============================================
   NeoFragrances — admin-products.js
   Catalog management: search / filter / sort /
   paginate (state kept in the URL), create + edit
   in a drawer, archive (soft delete) and restore.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const DEFAULTS = { q: "", status: "active", category: "all", brand: "all", stock: "all", sort: "name", dir: "asc", page: 1 };
  const PAGE_SIZE = 25;
  const CATEGORIES = ["men", "women", "unisex"];
  const state = NFA.readParams(DEFAULTS);
  let products = null, loadError = null;

  const getters = {
    name: p => p.name.toLowerCase(), brand: p => p.brand.toLowerCase(), price: p => Number(p.price),
    stock_qty: p => Number(p.stock_qty), units_sold: p => Number(p.units_sold), updated_at: p => new Date(p.updated_at).getTime() || 0,
  };

  function filtered() {
    const q = NFA.normalize(state.q);
    return products.filter(p => {
      if (state.status === "active" && p.deleted_at) return false;
      if (state.status === "archived" && !p.deleted_at) return false;
      if (state.category !== "all" && p.category !== state.category) return false;
      if (state.brand !== "all" && p.brand !== state.brand) return false;
      if (state.stock !== "all" && NFA.stockState({ ...p, deleted_at: null }).key !== state.stock) return false;
      if (q && !NFA.normalize(`${p.name} ${p.brand} ${p.id}`).includes(q)) return false;
      return true;
    });
  }

  function renderToolbar() {
    const brands = [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b));
    const counts = { active: products.filter(p => !p.deleted_at).length, archived: products.filter(p => p.deleted_at).length };
    return `
      <div class="adm-tabs" role="group" aria-label="Product status">
        ${[["active", "Active", counts.active], ["archived", "Archived", counts.archived], ["all", "All", products.length]].map(([k, l, n]) => `<button type="button" class="adm-tab" data-status="${k}" aria-pressed="${state.status === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("")}
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="p-search" class="sr-only">Search products</label><input id="p-search" class="adm-input" type="search" placeholder="Search name, brand or ID" value="${esc(state.q)}"></div>
        <label class="sr-only" for="p-category">Category</label>
        <select id="p-category" class="adm-select" data-filter="category"><option value="all">All categories</option>${CATEGORIES.map(c => `<option value="${c}"${state.category === c ? " selected" : ""}>${NFA.cap(c)}</option>`).join("")}</select>
        <label class="sr-only" for="p-brand">Brand</label>
        <select id="p-brand" class="adm-select" data-filter="brand"><option value="all">All brands</option>${brands.map(b => `<option value="${esc(b)}"${state.brand === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>
        <label class="sr-only" for="p-stock">Stock</label>
        <select id="p-stock" class="adm-select" data-filter="stock">${[["all", "Any stock"], ["in", "In stock"], ["low", "Low stock"], ["out", "Out of stock"]].map(([v, l]) => `<option value="${v}"${state.stock === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <div class="adm-toolbar-right"><span class="adm-count" id="p-count" role="status"></span><button type="button" class="adm-btn adm-btn--sm" data-action="export"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Export CSV</button></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards">
          <caption class="sr-only">Products</caption>
          <thead id="p-head"></thead>
          <tbody id="p-body"></tbody>
        </table>
        <div id="p-pager"></div>
      </div>`;
  }

  function renderTable() {
    const list = NFA.sortBy(filtered(), state.sort, state.dir, getters);
    const pg = NFA.paginate(list, state.page, PAGE_SIZE);
    state.page = pg.page;
    NFA.writeParams(state, DEFAULTS);
    document.getElementById("p-head").innerHTML = `<tr>${NFA.sortHeader("Product", "name", state)}${NFA.sortHeader("Price", "price", state, "ta-r")}${NFA.sortHeader("Stock", "stock_qty", state)}${NFA.sortHeader("Sold", "units_sold", state, "ta-r")}${NFA.sortHeader("Updated", "updated_at", state)}<th class="ta-r"><span class="sr-only">Actions</span></th></tr>`;
    document.getElementById("p-count").textContent = `${int(list.length)} product${list.length !== 1 ? "s" : ""}`;
    document.getElementById("p-body").innerHTML = pg.rows.length ? pg.rows.map(p => `
      <tr${p.deleted_at ? ' class="adm-row--muted"' : ""}>
        <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(p.image)}<div><button type="button" class="adm-link adm-cell-title" data-action="edit" data-id="${p.id}" style="color:inherit;text-align:left">${esc(p.name)}</button><span class="adm-cell-sub">${esc(p.brand)} · ${esc(NFA.cap(p.category))} · #${esc(p.id)}${p.badge ? ` · <span class="adm-tag">${esc(p.badge)}</span>` : ""}</span></div></div></td>
        <td data-label="Price" class="ta-r num">${money(p.price)}</td>
        <td data-label="Stock"><span class="num">${int(p.stock_qty)}</span> ${NFA.stockBadge(p)}</td>
        <td data-label="Sold" class="ta-r num">${int(p.units_sold)}</td>
        <td data-label="Updated" class="nowrap">${esc(NFA.date(p.updated_at))}</td>
        <td class="adm-td-actions ta-r"><span class="adm-row-actions">
          <button type="button" class="adm-link" data-action="edit" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">Edit</button>
          ${p.deleted_at
            ? `<button type="button" class="adm-link" data-action="restore" data-id="${p.id}" aria-label="Restore ${esc(p.name)}">Restore</button>`
            : `<button type="button" class="adm-link adm-link--danger" data-action="archive" data-id="${p.id}" aria-label="Archive ${esc(p.name)}">Archive</button>`}
        </span></td>
      </tr>`).join("") : NFA.tableState(6, NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No products match", text: "Try a different search or clear the filters.", action: `<button type="button" class="adm-btn adm-btn--sm" data-action="clear">Clear filters</button>` }));
    document.getElementById("p-pager").innerHTML = NFA.pagerHTML({ total: list.length, page: pg.page, pageSize: PAGE_SIZE, noun: "products" });
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    root.innerHTML = renderToolbar();
    renderTable();
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { products = await NFA.api("/api/admin/products"); loadError = null; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  /* ---------- drawer form ---------- */
  function formHTML(p) {
    const v = k => esc(p ? (p[k] ?? "") : "");
    const brands = [...new Set(products.map(x => x.brand))].sort();
    return `
      <form id="product-form" novalidate data-id="${p ? p.id : ""}">
        <div class="adm-form-grid">
          <div class="adm-field adm-field--wide"><label for="pf-name">Name *</label><input class="adm-input" id="pf-name" name="name" maxlength="150" required value="${v("name")}"><span class="adm-error" data-error-for="name"></span></div>
          <div class="adm-field"><label for="pf-brand">Brand *</label><input class="adm-input" id="pf-brand" name="brand" maxlength="100" required list="pf-brands" value="${v("brand")}"><datalist id="pf-brands">${brands.map(b => `<option value="${esc(b)}">`).join("")}</datalist><span class="adm-error" data-error-for="brand"></span></div>
          <div class="adm-field"><label for="pf-category">Category *</label><select class="adm-select" id="pf-category" name="category" required><option value="">Choose…</option>${CATEGORIES.map(c => `<option value="${c}"${p && p.category === c ? " selected" : ""}>${NFA.cap(c)}</option>`).join("")}</select><span class="adm-error" data-error-for="category"></span></div>
          <div class="adm-field"><label for="pf-price">Price (GH₵) *</label><input class="adm-input" id="pf-price" name="price" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${v("price")}"><span class="adm-error" data-error-for="price"></span></div>
          <div class="adm-field"><label for="pf-stock">${p ? "Stock" : "Opening stock"}</label><input class="adm-input" id="pf-stock" name="stock_qty" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${p ? esc(p.stock_qty) : "0"}" data-original="${p ? esc(p.stock_qty) : ""}"><span class="adm-help">${p ? "Only saved if you change it. Use Inventory for quick adjustments." : "Whole number, 0 or more."}</span><span class="adm-error" data-error-for="stock_qty"></span></div>
          <div class="adm-field"><label for="pf-badge">Badge <span class="muted">(optional)</span></label><input class="adm-input" id="pf-badge" name="badge" maxlength="20" list="pf-badges" value="${v("badge")}"><datalist id="pf-badges"><option value="New"><option value="Bestseller"></datalist><span class="adm-error" data-error-for="badge"></span></div>
          <div class="adm-field adm-field--wide"><label for="pf-image">Image path</label><input class="adm-input" id="pf-image" name="image" maxlength="250" placeholder="images/perfumes/name.jpg" value="${v("image")}" aria-describedby="pf-image-help"><span class="adm-help" id="pf-image-help">A file in the site's images/ folder. Image upload is planned for Milestone 6.</span><div class="adm-img-preview" id="pf-preview"></div><span class="adm-error" data-error-for="image"></span></div>
          <div class="adm-form-section">Description &amp; notes</div>
          <div class="adm-field adm-field--wide"><label for="pf-description">Description</label><textarea class="adm-textarea" id="pf-description" name="description" maxlength="5000">${v("description")}</textarea><span class="adm-error" data-error-for="description"></span></div>
          <div class="adm-field adm-field--wide"><label for="pf-top">Top notes</label><input class="adm-input" id="pf-top" name="top_notes" maxlength="255" value="${v("top_notes")}"><span class="adm-error" data-error-for="top_notes"></span></div>
          <div class="adm-field adm-field--wide"><label for="pf-middle">Heart (middle) notes</label><input class="adm-input" id="pf-middle" name="middle_notes" maxlength="255" value="${v("middle_notes")}"><span class="adm-error" data-error-for="middle_notes"></span></div>
          <div class="adm-field adm-field--wide"><label for="pf-base">Base notes</label><input class="adm-input" id="pf-base" name="base_notes" maxlength="255" value="${v("base_notes")}"><span class="adm-error" data-error-for="base_notes"></span></div>
        </div>
        <button type="submit" hidden></button>
      </form>`;
  }

  function updatePreview(form) {
    const path = form.elements.image.value.trim();
    const el = document.getElementById("pf-preview");
    if (!path) { el.innerHTML = ""; return; }
    el.innerHTML = /^images\//.test(path) && !path.includes("..") ? `${NFA.thumb(path, "adm-thumb--lg")}<span>Preview — a bottle icon means the file wasn't found.</span>` : `<span class="adm-error">Path must start with images/</span>`;
  }

  function openForm(p) {
    let dirty = false;
    const drawer = NFA.openDrawer({
      title: p ? "Edit product" : "Add product",
      bodyHTML: formHTML(p),
      footHTML: `<span class="adm-form-status" role="status"></span><button type="button" class="adm-btn" data-drawer-cancel>Cancel</button><button type="button" class="adm-btn adm-btn--primary" data-drawer-save>${p ? "Save changes" : "Create product"}</button>`,
      onClose: async () => !dirty || NFA.confirm({ title: "Discard changes?", text: "Your unsaved changes to this product will be lost.", okLabel: "Discard", danger: true }),
    });
    const form = drawer.querySelector("#product-form");
    updatePreview(form);
    form.addEventListener("input", e => { dirty = true; if (e.target.name === "image") updatePreview(form); });
    form.addEventListener("submit", e => { e.preventDefault(); save(form, p, () => { dirty = false; }); });
    drawer.querySelector("[data-drawer-save]").addEventListener("click", () => form.requestSubmit());
    drawer.querySelector("[data-drawer-cancel]").addEventListener("click", () => drawer.querySelector("[data-drawer-close]").click());
  }

  async function save(form, p, markClean) {
    NFA.clearFormErrors(form);
    const val = n => form.elements[n].value.trim();
    const body = { name: val("name"), brand: val("brand"), category: val("category"), price: val("price") === "" ? "" : Number(val("price")), badge: val("badge"), image: val("image"), description: val("description"), top_notes: val("top_notes"), middle_notes: val("middle_notes"), base_notes: val("base_notes") };
    const stock = val("stock_qty");
    if (!p || stock !== form.elements.stock_qty.dataset.original) {
      if (!/^\d+$/.test(stock)) return NFA.showFormError(form, "stock_qty", "Stock must be a whole number, 0 or more.");
      body.stock_qty = Number(stock);
    }
    // Quick client checks (the server validates everything again).
    if (!body.name) return NFA.showFormError(form, "name", "Name is required.");
    if (!body.brand) return NFA.showFormError(form, "brand", "Brand is required.");
    if (!body.category) return NFA.showFormError(form, "category", "Choose a category.");
    if (!(body.price > 0)) return NFA.showFormError(form, "price", "Price must be more than 0.");
    const btn = form.closest(".adm-drawer").querySelector("[data-drawer-save]");
    btn.disabled = true;
    try {
      await NFA.api(p ? `/api/admin/products/${p.id}` : "/api/admin/products", { method: p ? "PUT" : "POST", body });
      markClean();
      NFA.closeDrawer();
      NFA.toast(p ? "Product updated" : "Product created");
      await load();
      NFA.loadCounts(true);
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      NFA.showFormError(form, e.field, e.message);
    } finally { btn.disabled = false; }
  }

  async function archive(p) {
    const ok = await NFA.confirm({ title: `Archive “${p.name}”?`, text: "It disappears from the store and can't be put on offer, but stays in order history. You can restore it at any time.", okLabel: "Archive product", danger: true });
    if (!ok) return;
    try { await NFA.api(`/api/admin/products/${p.id}`, { method: "DELETE" }); NFA.toast("Product archived"); await load(); NFA.loadCounts(true); }
    catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
  }
  async function restore(p) {
    try { await NFA.api(`/api/admin/products/${p.id}/restore`, { method: "PATCH" }); NFA.toast("Product restored — it's visible in the store again"); await load(); NFA.loadCounts(true); }
    catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
  }

  function exportCSV() {
    const list = NFA.sortBy(filtered(), state.sort, state.dir, getters);
    NFA.downloadCSV(`neofragrances-products-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["ID", "Name", "Brand", "Category", "Price (GHS)", "Stock", "Status", "Units sold", "Badge", "Image"],
      ...list.map(p => [p.id, p.name, p.brand, p.category, Number(p.price).toFixed(2), p.stock_qty, NFA.stockState(p).label, p.units_sold, p.badge || "", p.image || ""]),
    ]);
  }

  /* ---------- events ---------- */
  const onSearch = NFA.debounce(() => { state.page = 1; renderTable(); });
  root.addEventListener("input", e => { if (e.target.id === "p-search") { state.q = e.target.value; onSearch(); } });
  root.addEventListener("change", e => { const f = e.target.dataset.filter; if (f) { state[f] = e.target.value; state.page = 1; renderTable(); } });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-status]");
    if (tab) { state.status = tab.dataset.status; state.page = 1; render(); document.querySelector(`[data-status="${state.status}"]`).focus(); return; }
    const sort = e.target.closest("[data-sort]");
    if (sort) { NFA.nextSort(state, sort.dataset.sort); renderTable(); document.querySelector(`[data-sort="${sort.dataset.sort}"]`).focus(); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); renderTable(); document.getElementById("p-count").focus?.(); root.scrollIntoView({ block: "start" }); return; }
    const a = e.target.closest("[data-action]");
    if (!a) return;
    const p = a.dataset.id ? products.find(x => x.id === Number(a.dataset.id)) : null;
    if (a.dataset.action === "edit" && p) openForm(p);
    if (a.dataset.action === "archive" && p) archive(p);
    if (a.dataset.action === "restore" && p) restore(p);
    if (a.dataset.action === "export") exportCSV();
    if (a.dataset.action === "clear") { Object.assign(state, DEFAULTS); render(); }
  });

  NFA.ready.then(async () => {
    const actions = document.getElementById("page-actions");
    actions.innerHTML = `<button type="button" class="adm-btn adm-btn--primary" id="add-product"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add product</button>`;
    actions.querySelector("#add-product").addEventListener("click", () => products && openForm(null));
    const params = new URLSearchParams(window.location.search); // read before the URL is rewritten
    await load();
    if (products && params.get("new") === "1") openForm(null);
    const editId = Number(params.get("edit"));
    if (products && editId) { const p = products.find(x => x.id === editId); if (p) openForm(p); }
  });
})();
