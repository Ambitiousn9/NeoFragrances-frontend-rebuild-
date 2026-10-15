/* ============================================
   NeoFragrances — admin-offers.js (Milestone 5,
   multi-product offers in Milestone 6 Phase 6)
   Special offers: status tabs (live / scheduled /
   expired / inactive), create + edit in a drawer,
   activate/deactivate, feature, delete. One offer
   covers 1–50 products, each with its own original
   and sale price. Everything the store shows comes
   from these database rows; expired offers stop
   showing automatically.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const TYPES = [["discount", "Discount"], ["flash_sale", "Flash sale"], ["new_arrival", "New arrival"], ["bestseller", "Bestseller"], ["limited", "Limited"]];
  const STATUS = { Active: { key: "live", label: "Live" }, Scheduled: { key: "scheduled", label: "Scheduled" }, Expired: { key: "expired", label: "Expired" }, Disabled: { key: "disabled", label: "Inactive" } };
  const DEFAULTS = { q: "", tab: "all" };
  const MAX_PRODUCTS = 50; // the server's MAX_OFFER_PRODUCTS
  const PICKER_LIMIT = 8;  // matches shown at once in the product search
  const state = NFA.readParams(DEFAULTS);
  let offers = null, products = null, loadError = null;

  const typeLabel = t => (TYPES.find(x => x[0] === t) || [t, NFA.cap(t)])[1];
  const pad = n => String(n).padStart(2, "0");
  const toInput = v => { const d = new Date(v); return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const plural = (n, word) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;
  const productsOf = o => o.products || [];
  // Prices are handled in whole pesewas so 2-decimal maths is exact. Same rule as the
  // server: more than 0, at most 1,000,000, at most 2 decimal places.
  const toCents = s => { const t = String(s).trim(); return /^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(t) ? Math.round(Number(t) * 100) : NaN; };
  const priceOk = c => Number.isInteger(c) && c > 0 && c <= 100000000;
  const fixed2 = v => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? "" : Number(v).toFixed(2));
  const percentOff = (original, sale) => Math.round(((original - sale) / original) * 100);

  function relative(o) {
    const now = Date.now(), start = new Date(o.start_at).getTime(), end = new Date(o.end_at).getTime();
    const span = ms => { const h = Math.round(ms / 36e5); return h < 48 ? `${Math.max(1, h)} hour${h === 1 ? "" : "s"}` : `${Math.round(h / 24)} days`; };
    if (now < start) return `Starts in ${span(start - now)}`;
    if (now < end) return `Ends in ${span(end - now)}`;
    return `Ended ${NFA.date(o.end_at)}`;
  }
  function warnings(o) {
    const ps = productsOf(o), w = [];
    if (!ps.length) return ["This offer has no products, so it won't show in the store."];
    const single = ps.length === 1;
    const names = list => (list.length <= 2 ? list.map(p => p.product_name).join(" and ") : `${list[0].product_name} and ${list.length - 1} others`);
    const isAre = list => (list.length === 1 ? "is" : "are");
    const archived = ps.filter(p => p.product_archived);
    if (archived.length) w.push(single ? "The product is archived, so this offer won't show in the store." : `${names(archived)} ${isAre(archived)} archived and won't show in the store.`);
    const drift = ps.filter(p => !p.product_archived && Number(p.product_price) !== Number(p.original_price));
    if (drift.length) w.push(single ? `The product's current price is ${money(drift[0].product_price)}; the offer's original price is ${money(drift[0].original_price)}.` : `The offer's original price differs from the current store price for ${names(drift)}.`);
    const out = ps.filter(p => !p.product_archived && Number(p.product_stock) === 0);
    if (out.length && o.status === "Active") w.push(single ? "The product is out of stock." : `${names(out)} ${isAre(out)} out of stock.`);
    return w;
  }

  function filtered() {
    const q = NFA.normalize(state.q);
    return offers.filter(o => {
      if (state.tab !== "all" && STATUS[o.status]?.key !== state.tab) return false;
      if (q && !NFA.normalize(`${o.title} ${productsOf(o).map(p => `${p.product_name} ${p.product_brand || ""}`).join(" ")} ${o.badge || ""}`).includes(q)) return false;
      return true;
    });
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const count = key => offers.filter(o => STATUS[o.status]?.key === key).length;
    root.innerHTML = `
      <div class="adm-tabs" role="group" aria-label="Offer status">
        ${[["all", "All", offers.length], ["live", "Live", count("live")], ["scheduled", "Scheduled", count("scheduled")], ["expired", "Expired", count("expired")], ["disabled", "Inactive", count("disabled")]].map(([k, l, n]) => `<button type="button" class="adm-tab" data-tab="${k}" aria-pressed="${state.tab === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("")}
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="f-search" class="sr-only">Search offers</label><input id="f-search" class="adm-input" type="search" placeholder="Offer title, product or badge" value="${esc(state.q)}"></div>
        <div class="adm-toolbar-right"><span class="adm-count" id="f-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards"><caption class="sr-only">Special offers</caption>
          <thead><tr><th>Offer</th><th>Products</th><th class="ta-r">Sale price</th><th>Schedule</th><th>Status</th><th class="ta-r"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="f-body"></tbody>
        </table>
      </div>
      <p class="adm-note" style="margin-top:12px">“Live” = active and inside its start/end window. Inactive offers stay hidden even during their window. Featured live offers are shown first on the store.</p>`;
    renderTable();
  }

  function productCell(o) {
    const ps = productsOf(o);
    if (!ps.length) return `<span class="muted">No products</span>`;
    if (ps.length === 1) {
      const p = ps[0];
      return `<div class="adm-cell-product">${NFA.thumb(p.product_image)}<div><span>${esc(p.product_name)}</span><span class="adm-cell-sub" style="display:block">${esc(p.product_brand || "")}</span></div></div>`;
    }
    return `
      <div class="adm-offer-summary">
        <div class="adm-cell-product">
          <span class="adm-thumb-stack">${ps.slice(0, 3).map(p => NFA.thumb(p.product_image)).join("")}</span>
          <div><span class="adm-offer-count">${plural(ps.length, "product")}</span><span class="adm-cell-sub" style="display:block">${ps.slice(0, 2).map(p => esc(p.product_name)).join(", ")}${ps.length > 2 ? ` +${int(ps.length - 2)} more` : ""}</span></div>
        </div>
        <details class="adm-offer-items">
          <summary>All ${int(ps.length)} prices</summary>
          <ul>${ps.map(p => `<li><span class="adm-offer-item-name">${esc(p.product_name)}${p.product_archived ? ` <span class="adm-tag">Archived</span>` : ""}</span><span class="num nowrap">${money(p.sale_price)} <s>${money(p.original_price)}</s></span></li>`).join("")}</ul>
        </details>
      </div>`;
  }
  function priceCell(o) {
    const ps = productsOf(o);
    if (!ps.length) return `<span class="muted">—</span>`;
    if (ps.length === 1) return `<strong class="num">${money(ps[0].sale_price)}</strong><span class="adm-cell-sub" style="display:block"><s>${money(ps[0].original_price)}</s> · −${int(ps[0].discount_percent)}%</span>`;
    const sales = ps.map(p => p.sale_price), pcts = ps.map(p => p.discount_percent);
    const lo = Math.min(...sales), hi = Math.max(...sales), pLo = Math.min(...pcts), pHi = Math.max(...pcts);
    return `<strong class="num" data-price-range>${lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`}</strong><span class="adm-cell-sub" style="display:block">${pLo === pHi ? `−${int(pLo)}% on each` : `−${int(pLo)}% to −${int(pHi)}%`}</span>`;
  }

  function renderTable() {
    NFA.writeParams(state, DEFAULTS);
    const list = filtered();
    document.getElementById("f-count").textContent = `${int(list.length)} offer${list.length !== 1 ? "s" : ""}`;
    document.getElementById("f-body").innerHTML = list.length ? list.map(o => {
      const st = STATUS[o.status] || { key: "disabled", label: o.status };
      const w = warnings(o);
      return `
      <tr data-offer-id="${o.id}">
        <td class="adm-td-primary">
          <button type="button" class="adm-link adm-cell-title" data-action="edit" data-id="${o.id}" style="color:inherit;text-align:left">${esc(o.title)}</button>
          <span class="adm-cell-sub"><span class="adm-tag">${esc(typeLabel(o.offer_type))}</span>${o.badge ? ` <span class="adm-tag">${esc(o.badge)}</span>` : ""}${o.featured ? ` · <i class="fa-solid fa-star" style="color:var(--nf-gold)" aria-hidden="true"></i> Featured` : ""} · order ${int(o.display_order)}</span>
          ${w.map(t => `<span class="adm-cell-sub" style="display:block;color:var(--nf-wine)"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${esc(t)}</span>`).join("")}
        </td>
        <td data-label="Products">${productCell(o)}</td>
        <td data-label="Sale price" class="ta-r nowrap">${priceCell(o)}</td>
        <td data-label="Schedule" class="nowrap"><span>${esc(NFA.dateTime(o.start_at))}</span><span class="adm-cell-sub" style="display:block">→ ${esc(NFA.dateTime(o.end_at))}</span><span class="adm-cell-sub" style="display:block">${esc(relative(o))}</span></td>
        <td data-label="Status"><span class="adm-badge adm-badge--${st.key}">${esc(st.label)}</span></td>
        <td class="adm-td-actions ta-r"><span class="adm-row-actions">
          <button type="button" class="adm-link" data-action="edit" data-id="${o.id}" aria-label="Edit ${esc(o.title)}">Edit</button>
          <button type="button" class="adm-link" data-action="toggle" data-id="${o.id}" aria-label="${o.active ? "Deactivate" : "Activate"} ${esc(o.title)}">${o.active ? "Deactivate" : "Activate"}</button>
          <button type="button" class="adm-link" data-action="feature" data-id="${o.id}" aria-label="${o.featured ? "Unfeature" : "Feature"} ${esc(o.title)}">${o.featured ? "Unfeature" : "Feature"}</button>
          <button type="button" class="adm-link adm-link--danger" data-action="delete" data-id="${o.id}" aria-label="Delete ${esc(o.title)}">Delete</button>
        </span></td>
      </tr>`;
    }).join("")
      : NFA.tableState(6, offers.length
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No offers here", text: "Try another tab or search." })
        : NFA.stateHTML({ icon: "fa-solid fa-tag", title: "No offers yet", text: "Create an offer to put one or more products on sale for a set period.", action: `<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" data-action="new">Create offer</button>` }));
  }

  /* ---------- drawer form ---------- */
  function formHTML(o) {
    const v = k => esc(o ? (o[k] ?? "") : "");
    const now = new Date(), week = new Date(Date.now() + 7 * 864e5);
    return `
      <form id="offer-form" novalidate>
        <div class="adm-form-grid">
          <div class="adm-field adm-field--wide"><label for="of-title">Offer title *</label><input class="adm-input" id="of-title" name="title" maxlength="150" required value="${v("title")}"><span class="adm-error" data-error-for="title"></span></div>

          <div class="adm-form-section">Products</div>
          <div class="adm-field adm-field--wide adm-op">
            <div class="adm-op-head"><label for="of-product-search" id="of-items-label">Products on this offer *</label><span class="adm-op-count" id="of-items-count"></span></div>
            <div class="adm-op-picker">
              <div class="adm-search adm-op-search"><i class="fa-solid fa-plus" aria-hidden="true"></i><input id="of-product-search" class="adm-input" type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="of-product-results" aria-describedby="of-product-help" placeholder="Add a product — search name, brand or ID"></div>
              <ul id="of-product-results" class="adm-op-results" role="listbox" aria-label="Matching products" hidden></ul>
              <span class="adm-help" id="of-product-help">Each product can be added once, up to ${MAX_PRODUCTS}. Archived products can't be added.</span>
              <span class="adm-help adm-op-note" id="of-product-note" role="status"></span>
            </div>
            <span class="adm-error" data-error-for="items"></span>
            <p class="adm-op-empty" id="of-items-empty"><i class="fa-solid fa-spray-can-sparkles" aria-hidden="true"></i> No products yet. Search above to add the first one.</p>
            <ol class="adm-op-rows" id="of-items" aria-labelledby="of-items-label"></ol>
            <div class="adm-op-bulk" id="of-bulk-group" role="group" aria-labelledby="of-bulk-label">
              <div class="adm-op-bulk-row">
                <label for="of-bulk" id="of-bulk-label">Same discount for every product <span class="muted">(optional)</span></label>
                <div class="adm-op-bulk-controls">
                  <span class="adm-op-pct"><input class="adm-input" id="of-bulk" type="number" min="0.01" max="99.99" step="0.01" inputmode="decimal" placeholder="20" aria-describedby="of-bulk-help"><span aria-hidden="true">% off</span></span>
                  <button type="button" class="adm-btn adm-btn--sm" data-op-bulk>Apply to all</button>
                </div>
              </div>
              <span class="adm-help" id="of-bulk-help">Works out each sale price from that product's own original price, rounded to the nearest pesewa. You can still change any price afterwards.</span>
              <span class="adm-error" id="of-bulk-error"></span>
              <span class="adm-help" id="of-bulk-status" role="status"></span>
            </div>
          </div>

          <div class="adm-form-section">Schedule</div>
          <div class="adm-field"><label for="of-start">Starts *</label><input class="adm-input" id="of-start" name="start_at" type="datetime-local" required value="${o ? toInput(o.start_at) : toInput(now)}"><span class="adm-error" data-error-for="start_at"></span></div>
          <div class="adm-field"><label for="of-end">Ends *</label><input class="adm-input" id="of-end" name="end_at" type="datetime-local" required value="${o ? toInput(o.end_at) : toInput(week)}"><span class="adm-error" data-error-for="end_at"></span></div>
          <div class="adm-field adm-field--wide adm-fieldset" role="group" aria-label="Visibility">
            <label class="adm-check"><input type="checkbox" name="active" ${!o || o.active ? "checked" : ""}> Active — show on the store during its window</label>
            <label class="adm-check"><input type="checkbox" name="featured" ${o && o.featured ? "checked" : ""}> Featured — show first</label>
          </div>
          <div class="adm-form-section">Presentation</div>
          <div class="adm-field"><label for="of-type">Offer type</label><select class="adm-select" id="of-type" name="offer_type">${TYPES.map(([k, l]) => `<option value="${k}"${(o ? o.offer_type : "discount") === k ? " selected" : ""}>${l}</option>`).join("")}</select><span class="adm-error" data-error-for="offer_type"></span></div>
          <div class="adm-field"><label for="of-badge">Badge text <span class="muted">(optional)</span></label><input class="adm-input" id="of-badge" name="badge" maxlength="40" value="${v("badge")}" placeholder="e.g. Weekend deal"><span class="adm-error" data-error-for="badge"></span></div>
          <div class="adm-field"><label for="of-order">Display order</label><input class="adm-input" id="of-order" name="display_order" type="number" min="0" max="9999" step="1" value="${o ? esc(o.display_order) : "0"}"><span class="adm-help">Lower numbers show first.</span><span class="adm-error" data-error-for="display_order"></span></div>
          <div class="adm-field"><label for="of-image">Image path <span class="muted">(optional)</span></label><input class="adm-input" id="of-image" name="image" maxlength="250" value="${v("image")}" placeholder="images/offers/name.jpg"><span class="adm-error" data-error-for="image"></span></div>
          <div class="adm-field adm-field--wide"><label for="of-description">Description <span class="muted">(optional)</span></label><textarea class="adm-textarea" id="of-description" name="description" maxlength="2000">${v("description")}</textarea><span class="adm-error" data-error-for="description"></span></div>
        </div>
        <button type="submit" hidden></button>
      </form>`;
  }

  /* ---------- product rows ---------- */
  let rowSeq = 0;
  const catalogProduct = id => products.find(p => p.id === id) || null;
  // A product already on the offer, described from the offer row when the catalogue doesn't have it.
  const fromOffer = p => ({ id: p.product_id, name: p.product_name, brand: p.product_brand || "", price: p.product_price, stock_qty: p.product_stock, image: p.product_image, deleted_at: p.product_archived ? "archived" : null });
  const rowsOf = form => [...form.querySelectorAll("#of-items > .adm-op-row")];
  const selectedIds = form => rowsOf(form).map(r => Number(r.dataset.pid));
  const priceInput = (row, k) => row.querySelector(`[data-k="${k}"]`);

  function rowHTML(p, original, sale, saved = false) {
    const u = `op${++rowSeq}`;
    return `
      <li class="adm-op-row" data-pid="${p.id}" data-store-price="${esc(fixed2(p.price))}"${saved ? " data-saved" : ""}>
        <div class="adm-op-prod">
          <span class="adm-op-num" aria-hidden="true"></span>
          ${NFA.thumb(p.image)}
          <div class="adm-op-meta">
            <span class="adm-op-name" id="${u}-name" tabindex="-1">${esc(p.name)}</span>
            <span class="adm-cell-sub">${esc(p.brand || "")} · #${p.id} · Store price ${money(p.price)}${p.deleted_at ? "" : ` · ${Number(p.stock_qty) > 0 ? `${int(p.stock_qty)} in stock` : "Out of stock"}`}</span>
            ${p.deleted_at ? `<span class="adm-op-flag"><i class="fa-solid fa-box-archive" aria-hidden="true"></i> Archived — it can stay on this offer but won't show in the store</span>` : ""}
          </div>
          <button type="button" class="adm-btn adm-btn--ghost adm-btn--icon adm-op-remove" data-op-remove aria-label="Remove ${esc(p.name)} from this offer"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
        <div class="adm-op-prices">
          <div class="adm-field"><label for="${u}-o">Original price (GH₵)</label><input class="adm-input" id="${u}-o" data-k="original_price" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" value="${esc(fixed2(original))}" aria-describedby="${u}-name"></div>
          <div class="adm-field"><label for="${u}-s">Sale price (GH₵)</label><input class="adm-input" id="${u}-s" data-k="sale_price" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" value="${esc(fixed2(sale))}" aria-describedby="${u}-name ${u}-off"></div>
          <div class="adm-op-off" id="${u}-off" data-op-off></div>
        </div>
        <span class="adm-error" data-op-error></span>
      </li>`;
  }

  // The live discount read-out beside a row's prices.
  function updateRow(row) {
    const original = toCents(priceInput(row, "original_price").value), sale = toCents(priceInput(row, "sale_price").value);
    const el = row.querySelector("[data-op-off]");
    const drift = priceOk(original) && row.dataset.storePrice && original !== toCents(row.dataset.storePrice) ? `<span class="adm-op-drift">Store price is ${money(row.dataset.storePrice)}</span>` : "";
    el.classList.remove("is-warn");
    if (!priceOk(original) || !priceOk(sale)) { el.innerHTML = drift; return; }
    if (sale > original) { el.classList.add("is-warn"); el.innerHTML = `<span>Sale is higher than the original</span>${drift}`; return; }
    el.innerHTML = `<strong>−${percentOff(original, sale)}%</strong><span>saves ${money((original - sale) / 100)}</span>${drift}`;
  }

  // Row numbers, the counter, the empty state and the 50-product cap.
  function refreshRows(form) {
    const rows = rowsOf(form), n = rows.length, full = n >= MAX_PRODUCTS;
    rows.forEach((r, i) => { r.querySelector(".adm-op-num").textContent = i + 1; });
    form.querySelector("#of-items-count").textContent = `${int(n)} of ${MAX_PRODUCTS}`;
    form.querySelector("#of-items-empty").hidden = n > 0;
    form.querySelector("#of-bulk-group").hidden = n === 0;
    const search = form.querySelector("#of-product-search");
    search.disabled = full;
    search.placeholder = full ? `This offer has the maximum of ${MAX_PRODUCTS} products` : "Add a product — search name, brand or ID";
    if (full) closeResults(form);
  }

  /* ---------- product search (combobox) ---------- */
  function matches(query) {
    const terms = NFA.normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const exactId = /^#?\d+$/.test(query.trim()) ? Number(query.trim().replace("#", "")) : null;
    return products
      .filter(p => !p.deleted_at && terms.every(t => NFA.normalize(`${p.name} ${p.brand} ${p.category || ""} #${p.id}`).includes(t)))
      .sort((a, b) => (b.id === exactId) - (a.id === exactId) || String(a.brand || "").localeCompare(String(b.brand || "")) || String(a.name).localeCompare(String(b.name)));
  }
  function closeResults(form) {
    const list = form.querySelector("#of-product-results"), input = form.querySelector("#of-product-search");
    list.hidden = true; list.innerHTML = "";
    input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
  }
  function renderResults(form) {
    const input = form.querySelector("#of-product-search"), list = form.querySelector("#of-product-results"), note = form.querySelector("#of-product-note");
    const query = input.value.trim();
    if (!query) { closeResults(form); note.textContent = ""; return; }
    const chosen = new Set(selectedIds(form)), all = matches(query), shown = all.slice(0, PICKER_LIMIT);
    list.innerHTML = shown.map(p => {
      const added = chosen.has(p.id);
      return `<li role="option" id="of-opt-${p.id}" class="adm-op-opt" data-pid="${p.id}" aria-selected="false"${added ? ` aria-disabled="true"` : ""}>
        ${NFA.thumb(p.image)}
        <span class="adm-op-opt-text"><span class="adm-op-opt-name">${esc(p.name)}</span><span class="adm-cell-sub">${esc(p.brand)} · #${p.id} · ${money(p.price)} · ${Number(p.stock_qty) > 0 ? `${int(p.stock_qty)} in stock` : "Out of stock"}</span></span>
        <span class="adm-op-opt-state">${added ? "Added" : `<i class="fa-solid fa-plus" aria-hidden="true"></i><span class="sr-only">Add</span>`}</span>
      </li>`;
    }).join("");
    list.hidden = !shown.length;
    input.setAttribute("aria-expanded", String(!!shown.length));
    input.removeAttribute("aria-activedescendant");
    note.textContent = !all.length ? `No products match “${query}”.` : all.length > shown.length ? `Showing ${shown.length} of ${int(all.length)} matches — keep typing to narrow it down.` : `${int(all.length)} match${all.length === 1 ? "" : "es"}.`;
  }
  function moveActive(form, step) {
    const input = form.querySelector("#of-product-search");
    const opts = [...form.querySelectorAll("#of-product-results .adm-op-opt")];
    if (!opts.length) return;
    const current = opts.findIndex(o => o.getAttribute("aria-selected") === "true");
    const next = current < 0 ? (step > 0 ? 0 : opts.length - 1) : (current + step + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === next)));
    input.setAttribute("aria-activedescendant", opts[next].id);
    opts[next].scrollIntoView({ block: "nearest" });
  }

  function addProduct(form, id) {
    const note = form.querySelector("#of-product-note");
    const p = catalogProduct(id);
    if (!p || p.deleted_at) return;
    if (selectedIds(form).includes(id)) { note.textContent = `${p.name} is already in this offer.`; return; }
    if (rowsOf(form).length >= MAX_PRODUCTS) { note.textContent = `An offer can include at most ${MAX_PRODUCTS} products.`; return; }
    form.querySelector("#of-items").insertAdjacentHTML("beforeend", rowHTML(p, p.price, ""));
    const rows = rowsOf(form);
    updateRow(rows[rows.length - 1]);
    form.querySelector('[data-error-for="items"]').textContent = "";
    form.querySelector("#of-product-search").removeAttribute("aria-invalid");
    refreshRows(form);
    if (rows.length < MAX_PRODUCTS) renderResults(form);
    else priceInput(rows[rows.length - 1], "sale_price").focus(); // the search box is now disabled
    note.textContent = `${p.name} added — ${plural(rows.length, "product")} on this offer.`;
    return true;
  }
  function removeRow(form, row) {
    const rows = rowsOf(form), i = rows.indexOf(row);
    const name = row.querySelector(".adm-op-name").textContent, saved = row.hasAttribute("data-saved");
    row.remove();
    refreshRows(form);
    if (form.querySelector("#of-product-search").value.trim()) renderResults(form);
    form.querySelector("#of-product-note").textContent = saved ? `${name} removed — it comes off the offer when you save.` : `${name} removed.`;
    const left = rowsOf(form);
    const next = left[i] || left[i - 1];
    (next ? next.querySelector("[data-op-remove]") : form.querySelector("#of-product-search")).focus();
  }

  // "Same discount for every product": sets each sale price from that row's own original
  // price, in whole pesewas (half rounds up). Rows without a valid original are left alone.
  function applyBulk(form) {
    const input = form.querySelector("#of-bulk"), err = form.querySelector("#of-bulk-error"), status = form.querySelector("#of-bulk-status");
    err.textContent = ""; status.textContent = ""; input.removeAttribute("aria-invalid");
    const raw = input.value.trim(), bp = /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : NaN;
    if (!(bp >= 1 && bp <= 9999)) { input.setAttribute("aria-invalid", "true"); err.textContent = "Enter a percentage from 0.01 to 99.99."; input.focus(); return; }
    let set = 0, skipped = 0;
    rowsOf(form).forEach(row => {
      const original = toCents(priceInput(row, "original_price").value);
      const sale = priceOk(original) ? Math.round((original * (10000 - bp)) / 10000) : 0;
      if (!priceOk(sale)) { skipped++; return; }
      priceInput(row, "sale_price").value = (sale / 100).toFixed(2);
      priceInput(row, "sale_price").removeAttribute("aria-invalid");
      updateRow(row); set++;
    });
    status.textContent = `${raw}% off applied to ${plural(set, "product")}.${skipped ? ` ${plural(skipped, "product")} skipped — enter ${skipped === 1 ? "its" : "their"} original price first.` : ""}`;
    return set;
  }

  /* ---------- errors ---------- */
  function clearErrors(form) {
    NFA.clearFormErrors(form);
    form.querySelectorAll(".adm-op-row.is-invalid").forEach(r => r.classList.remove("is-invalid"));
  }
  // Client and server errors share field names: title, start_at, …, "items", or
  // "items[i].product_id / original_price / sale_price" for the i-th product row as sent.
  function fieldError(form, field, message) {
    const m = /^items\[(\d+)\](?:\.(\w+))?$/.exec(field || "");
    const row = m ? rowsOf(form)[Number(m[1])] : null;
    const status = form.closest(".adm-drawer")?.querySelector(".adm-form-status");
    if (field === "items" || (m && !row)) {
      form.querySelector('[data-error-for="items"]').textContent = message;
      const search = form.querySelector("#of-product-search");
      if (!search.disabled) { search.setAttribute("aria-invalid", "true"); search.focus(); }
      if (status) { status.textContent = message; status.classList.add("is-error"); }
      return;
    }
    if (!m) return NFA.showFormError(form, field, message);
    row.classList.add("is-invalid");
    row.querySelector("[data-op-error]").textContent = message;
    const input = m[2] === "original_price" || m[2] === "sale_price" ? priceInput(row, m[2]) : null;
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); } else row.querySelector(".adm-op-name").focus();
    row.scrollIntoView({ block: "nearest" });
    if (status) { status.textContent = `Product ${Number(m[1]) + 1} (${row.querySelector(".adm-op-name").textContent}): ${message}`; status.classList.add("is-error"); }
  }

  function openForm(o) {
    let dirty = false;
    const drawer = NFA.openDrawer({
      title: o ? "Edit offer" : "Create offer",
      bodyHTML: formHTML(o),
      footHTML: `<span class="adm-form-status" role="status"></span><button type="button" class="adm-btn" data-drawer-cancel>Cancel</button><button type="button" class="adm-btn adm-btn--primary" data-drawer-save>${o ? "Save offer" : "Create offer"}</button>`,
      onClose: async () => !dirty || NFA.confirm({ title: "Discard changes?", text: "Your unsaved changes to this offer will be lost.", okLabel: "Discard", danger: true }),
    });
    drawer.classList.add("adm-drawer--offer");
    const form = drawer.querySelector("#offer-form");
    const search = form.querySelector("#of-product-search"), results = form.querySelector("#of-product-results");
    if (o) {
      form.querySelector("#of-items").innerHTML = productsOf(o).map(p => rowHTML(catalogProduct(p.product_id) || fromOffer(p), p.original_price, p.sale_price, true)).join("");
      rowsOf(form).forEach(updateRow);
    }
    refreshRows(form);

    form.addEventListener("input", e => {
      if (e.target === search) return renderResults(form);
      if (e.target.id === "of-bulk") return;
      dirty = true;
      const row = e.target.closest(".adm-op-row");
      if (row) {
        updateRow(row);
        if (row.classList.contains("is-invalid")) { row.classList.remove("is-invalid"); row.querySelector("[data-op-error]").textContent = ""; row.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid")); }
      }
    });
    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (results.hidden) renderResults(form); moveActive(form, e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") {
        e.preventDefault(); // never submit the offer from the search box
        const active = results.querySelector('[aria-selected="true"]');
        const enabled = [...results.querySelectorAll('.adm-op-opt:not([aria-disabled="true"])')];
        const pick = active || (enabled.length === 1 ? enabled[0] : null);
        if (pick && pick.getAttribute("aria-disabled") !== "true" && addProduct(form, Number(pick.dataset.pid))) dirty = true;
      } else if (e.key === "Escape" && (!results.hidden || search.value)) { e.preventDefault(); e.stopPropagation(); search.value = ""; closeResults(form); form.querySelector("#of-product-note").textContent = ""; }
    });
    search.addEventListener("focus", () => { if (search.value.trim()) renderResults(form); });
    search.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== search) closeResults(form); }, 120));
    results.addEventListener("mousedown", e => e.preventDefault()); // keep focus in the search box
    results.addEventListener("click", e => {
      const opt = e.target.closest(".adm-op-opt");
      if (opt && opt.getAttribute("aria-disabled") !== "true" && addProduct(form, Number(opt.dataset.pid))) { dirty = true; search.focus(); }
    });
    form.addEventListener("click", e => {
      const rm = e.target.closest("[data-op-remove]");
      if (rm) { dirty = true; removeRow(form, rm.closest(".adm-op-row")); return; }
      if (e.target.closest("[data-op-bulk]") && applyBulk(form)) dirty = true;
    });
    form.querySelector("#of-bulk").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (applyBulk(form)) dirty = true; } });
    form.addEventListener("submit", e => { e.preventDefault(); save(form, o, () => { dirty = false; }); });
    drawer.querySelector("[data-drawer-save]").addEventListener("click", () => form.requestSubmit());
    drawer.querySelector("[data-drawer-cancel]").addEventListener("click", () => drawer.querySelector("[data-drawer-close]").click());
  }

  async function save(form, o, markClean) {
    clearErrors(form);
    const body = {
      title: form.elements.title.value.trim(), items: [],
      start_at: form.elements.start_at.value, end_at: form.elements.end_at.value,
      active: form.elements.active.checked, featured: form.elements.featured.checked,
      offer_type: form.elements.offer_type.value, badge: form.elements.badge.value.trim(), display_order: form.elements.display_order.value === "" ? 0 : Number(form.elements.display_order.value),
      image: form.elements.image.value.trim(), description: form.elements.description.value.trim(),
    };
    if (!body.title) return fieldError(form, "title", "Give the offer a title.");
    const rows = rowsOf(form);
    if (!rows.length) return fieldError(form, "items", "Add at least one product to the offer.");
    if (rows.length > MAX_PRODUCTS) return fieldError(form, "items", `An offer can include at most ${MAX_PRODUCTS} products.`);
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const pid = Number(rows[i].dataset.pid);
      if (seen.has(pid)) return fieldError(form, `items[${i}].product_id`, "That product is already in this offer.");
      seen.add(pid);
      const cents = {};
      for (const [k, label] of [["original_price", "original"], ["sale_price", "sale"]]) {
        const input = priceInput(rows[i], k);
        if (input.value.trim() === "" && !input.validity.badInput) return fieldError(form, `items[${i}].${k}`, `Enter the ${label} price.`);
        cents[k] = toCents(input.value);
        if (!priceOk(cents[k])) return fieldError(form, `items[${i}].${k}`, `${label === "sale" ? "Sale" : "Original"} price must be more than 0 with at most 2 decimal places.`);
      }
      if (cents.sale_price > cents.original_price) return fieldError(form, `items[${i}].sale_price`, "Sale price cannot be higher than the original price.");
      body.items.push({ product_id: pid, original_price: cents.original_price / 100, sale_price: cents.sale_price / 100 });
    }
    if (!body.start_at || !body.end_at) return fieldError(form, body.start_at ? "end_at" : "start_at", "Choose start and end dates.");
    if (new Date(body.end_at) <= new Date(body.start_at)) return fieldError(form, "end_at", "End must be after the start.");
    const btn = form.closest(".adm-drawer").querySelector("[data-drawer-save]");
    btn.disabled = true;
    try {
      await NFA.api(o ? `/api/admin/offers/${o.id}` : "/api/admin/offers", { method: o ? "PUT" : "POST", body });
      markClean();
      NFA.closeDrawer();
      NFA.toast(o ? "Offer updated" : "Offer created");
      await load();
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      fieldError(form, e.field, e.message);
    } finally { btn.disabled = false; }
  }

  async function action(kind, o) {
    try {
      if (kind === "toggle") {
        await NFA.api(`/api/admin/offers/${o.id}/toggle`, { method: "PATCH", body: { active: !o.active } });
        NFA.toast(o.active ? "Offer deactivated — hidden from the store" : "Offer activated");
      } else if (kind === "feature") {
        await NFA.api(`/api/admin/offers/${o.id}/featured`, { method: "PATCH", body: { featured: !o.featured } });
        NFA.toast(o.featured ? "Offer unfeatured" : "Offer featured");
      } else if (kind === "delete") {
        const n = productsOf(o).length;
        const ok = await NFA.confirm({ title: `Delete “${o.title}”?`, text: `The offer${n > 1 ? ` and its ${int(n)} product prices are` : " is"} removed permanently and ${n > 1 ? "the sale prices stop" : "its sale price stops"} applying immediately. To pause it instead, deactivate it.`, okLabel: "Delete offer", danger: true });
        if (!ok) return;
        await NFA.api(`/api/admin/offers/${o.id}`, { method: "DELETE" });
        NFA.toast("Offer deleted");
      }
      await load();
    } catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      [offers, products] = await Promise.all([NFA.api("/api/admin/offers"), products ? Promise.resolve(products) : NFA.api("/api/admin/products")]);
      loadError = null;
    } catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  const onSearch = NFA.debounce(renderTable);
  root.addEventListener("input", e => { if (e.target.id === "f-search") { state.q = e.target.value; onSearch(); } });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; render(); root.querySelector(`[data-tab="${state.tab}"]`).focus(); return; }
    const a = e.target.closest("[data-action]");
    if (!a) return;
    if (a.dataset.action === "new") return openForm(null);
    const o = offers.find(x => x.id === Number(a.dataset.id));
    if (!o) return;
    if (a.dataset.action === "edit") openForm(o); else action(a.dataset.action, o);
  });

  NFA.ready.then(async () => {
    const actions = document.getElementById("page-actions");
    actions.innerHTML = `<a class="adm-btn" href="../special-offers.html" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> View on store</a><button type="button" class="adm-btn adm-btn--primary" id="new-offer"><i class="fa-solid fa-plus" aria-hidden="true"></i> Create offer</button>`;
    actions.querySelector("#new-offer").addEventListener("click", () => products && openForm(null));
    await load();
  });
})();
