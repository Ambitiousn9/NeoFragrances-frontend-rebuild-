/* ============================================
   NeoFragrances — search.js
   Products page (products.html) controller:
   search, filters, sorting and browser-side
   pagination. All state lives in the URL, so
   filtered pages can be refreshed, shared and
   navigated with Back/Forward.

   Results come from NFCatalog.query() (catalog.js).
   Only the current page of cards is rendered.
   ============================================ */

let SHOP_STATE = null;
let shopBrandFilterText = "";
let shopBrandsExpanded = false;
let shopDrawerReturnFocus = null;

const SHOP_BRANDS_COLLAPSED = 8;
const SHOP_REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const shop = {
  get grid() { return document.getElementById("product-grid"); },
  get filtersBody() { return document.getElementById("filters-body"); },
  get count() { return document.getElementById("results-count"); },
  get chips() { return document.getElementById("active-filters"); },
  get pagination() { return document.getElementById("pagination"); },
  get search() { return document.getElementById("search-input"); },
  get sort() { return document.getElementById("sort-select"); },
  get drawer() { return document.getElementById("nf-filters"); },
  get overlay() { return document.getElementById("filters-overlay"); },
  get toggle() { return document.getElementById("filter-toggle"); },
};

// Header search suggestions on this page update results in place (see search-suggest.js).
window.nfProductsPageHandlers = {
  onQuery: q => { setShopState({ q, page: 1 }); syncControls(); closeHeaderSearch(); scrollToResults(); },
  onBrand: b => { setShopState({ brands: [b], q: "", page: 1 }); syncControls(); closeHeaderSearch(); scrollToResults(); },
  onCategory: c => { setShopState({ category: c, page: 1 }); syncControls(); closeHeaderSearch(); scrollToResults(); },
};

function closeHeaderSearch() {
  const panel = document.getElementById("nf-search-panel");
  if (panel && !panel.hidden) document.querySelector(".nf-search-toggle")?.click();
}

/* ---------- state ---------- */
function setShopState(patch, { push = false } = {}) {
  if (!SHOP_STATE) return;
  SHOP_STATE = { ...SHOP_STATE, ...patch };
  const url = `${window.location.pathname}${NFCatalog.serializeState(SHOP_STATE)}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  renderShop();
}

function scrollToResults() {
  const target = document.getElementById("shop-main");
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - 90;
  if (window.scrollY > top) window.scrollTo({ top, behavior: SHOP_REDUCED_MOTION ? "auto" : "smooth" });
}

function syncControls() {
  if (shop.search && shop.search.value !== SHOP_STATE.q) shop.search.value = SHOP_STATE.q;
  document.getElementById("search-clear").hidden = !shop.search.value;
  if (shop.sort) shop.sort.value = SHOP_STATE.sort;
}

// Collection pills: the pill for the current category reads as the current page.
function syncCollectionPills(category) {
  document.querySelectorAll("#collection-pills a[data-category]").forEach(a => {
    if (a.dataset.category === (category || "")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

/* ---------- headings ---------- */
function shopHeading(state) {
  const catLabel = NFCatalog.categoryLabel(state.category);
  let title = "All Fragrances";
  if (state.category === "men" || state.category === "women") title = `Fragrances for ${catLabel}`;
  else if (state.category) title = `${catLabel} Fragrances`;
  if (state.brands.length === 1 && !state.category) title = state.brands[0];
  // Scent family: "Floral Family"; an unknown value gets a fixed title (the raw value is never shown).
  const family = state.scent ? SCENT_FAMILIES.find(f => f.key === state.scent) : null;
  if (family) title = `${family.label} Family`;
  if (state.scentInvalid) title = "Scent family not found";
  if (state.q) title = "Search results";
  return { title, crumb: state.q ? `Search: “${state.q}”` : title };
}

function renderHeading(result) {
  const { title, crumb } = shopHeading(SHOP_STATE);
  document.getElementById("shop-title").textContent = title;
  document.getElementById("breadcrumb-current").textContent = crumb;
  const brands = new Set(PRODUCTS.map(p => p.brand)).size;
  document.getElementById("shop-intro").textContent = SHOP_STATE.q
    ? `Results for “${SHOP_STATE.q}” across ${PRODUCTS.length} fragrances.`
    : `${PRODUCTS.length} fragrances from ${brands} houses — designer icons and Arabian perfumery.`;
  document.title = `${title} — NeoFragrances`;

  shop.count.textContent = result.total
    ? `Showing ${result.start}–${result.end} of ${result.total} fragrance${result.total !== 1 ? "s" : ""}`
    : "No fragrances found";
}

/* ---------- filters panel ---------- */
function filterOption({ type, name, value, label, count, checked, filterId }) {
  const disabled = !checked && count === 0;
  return `
    <label class="nf-filter-option${disabled ? " is-disabled" : ""}">
      <input type="${type}" name="${name}" value="${escapeHtml(value)}" data-filter-id="${escapeHtml(filterId)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="nf-filter-label">${escapeHtml(label)}</span>
      <span class="nf-filter-count-pill">${count}</span>
    </label>`;
}

function renderFilters(result) {
  const body = shop.filtersBody;
  const focusedId = document.activeElement?.dataset?.filterId;
  const brandInputFocused = document.activeElement?.id === "brand-filter-search";
  const f = result.facets;

  const categories = [...new Set(PRODUCTS.map(p => p.category))].sort();
  const brandCounts = {};
  PRODUCTS.forEach(p => { brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1; });
  const allBrands = Object.keys(brandCounts).sort((a, b) => a.localeCompare(b));
  const needle = NFCatalog.normalize(shopBrandFilterText);
  let brands = allBrands.filter(b => !needle || NFCatalog.normalize(b).includes(needle));
  // Selected brands always stay visible; collapse the rest to a short list.
  const collapsed = !shopBrandsExpanded && !needle && brands.length > SHOP_BRANDS_COLLAPSED;
  if (collapsed) {
    const ranked = [...brands].sort((a, b) => brandCounts[b] - brandCounts[a]);
    const keep = new Set([...SHOP_STATE.brands, ...ranked.slice(0, SHOP_BRANDS_COLLAPSED)]);
    brands = brands.filter(b => keep.has(b));
  }

  // The family facet appears once any product is classified, or whenever a family is in the URL.
  const scentAvailable = typeof SCENT_FAMILIES !== "undefined" && (NFCatalog.hasScentData(PRODUCTS) || !!SHOP_STATE.scent || SHOP_STATE.scentInvalid);
  const visibleBands = NFCatalog.PRICE_BANDS.filter(b => PRODUCTS.some(p => {
    const v = typeof nfEffectivePrice === "function" ? nfEffectivePrice(p) : p.price;
    return v >= b.min && v < b.max;
  }));

  body.innerHTML = `
    <fieldset class="nf-filter-group">
      <legend>Collection</legend>
      ${filterOption({ type: "radio", name: "category", value: "", label: "All", count: Object.values(f.categories).reduce((a, b) => a + b, 0), checked: !SHOP_STATE.category, filterId: "cat-all" })}
      ${categories.map(c => filterOption({ type: "radio", name: "category", value: c, label: NFCatalog.categoryLabel(c), count: f.categories[c] || 0, checked: SHOP_STATE.category === c, filterId: `cat-${c}` })).join("")}
    </fieldset>

    <fieldset class="nf-filter-group">
      <legend>Availability</legend>
      ${filterOption({ type: "checkbox", name: "stock", value: "in", label: "In stock only", count: f.inStock, checked: SHOP_STATE.inStock, filterId: "stock-in" })}
    </fieldset>

    <fieldset class="nf-filter-group">
      <legend>Price</legend>
      ${filterOption({ type: "radio", name: "price", value: "", label: "Any price", count: Object.values(f.price).reduce((a, b) => a + b, 0), checked: !SHOP_STATE.price, filterId: "price-any" })}
      ${visibleBands.map(b => filterOption({ type: "radio", name: "price", value: b.key, label: b.label, count: f.price[b.key] || 0, checked: SHOP_STATE.price === b.key, filterId: `price-${b.key}` })).join("")}
    </fieldset>

    ${scentAvailable ? `
    <fieldset class="nf-filter-group">
      <legend>Scent family</legend>
      ${filterOption({ type: "radio", name: "scent", value: "", label: "All families", count: result.total, checked: !SHOP_STATE.scent && !SHOP_STATE.scentInvalid, filterId: "scent-all" })}
      ${SCENT_FAMILIES.filter(s => f.scent[s.key] || SHOP_STATE.scent === s.key).map(s => filterOption({ type: "radio", name: "scent", value: s.key, label: s.label, count: f.scent[s.key] || 0, checked: SHOP_STATE.scent === s.key, filterId: `scent-${s.key}` })).join("")}
    </fieldset>` : ""}

    <fieldset class="nf-filter-group">
      <legend>House</legend>
      ${allBrands.length > SHOP_BRANDS_COLLAPSED ? `
      <div class="nf-filter-search">
        <label for="brand-filter-search" class="sr-only">Find a house</label>
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" id="brand-filter-search" placeholder="Find a house" value="${escapeHtml(shopBrandFilterText)}" autocomplete="off">
      </div>` : ""}
      <div class="nf-filter-list">
        ${brands.length ? brands.map(b => filterOption({ type: "checkbox", name: "brand", value: b, label: b, count: f.brands[b] || 0, checked: SHOP_STATE.brands.includes(b), filterId: `brand-${b}` })).join("") : `<p class="nf-filter-none">No houses match “${escapeHtml(shopBrandFilterText)}”.</p>`}
      </div>
      ${!needle && allBrands.length > SHOP_BRANDS_COLLAPSED ? `<button type="button" class="nf-filter-more" id="brands-more" aria-expanded="${shopBrandsExpanded}">${shopBrandsExpanded ? "Show fewer houses" : `Show all ${allBrands.length} houses`}</button>` : ""}
    </fieldset>`;

  // Restore keyboard focus after re-rendering.
  if (brandInputFocused) {
    const input = document.getElementById("brand-filter-search");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  } else if (focusedId) {
    [...body.querySelectorAll("[data-filter-id]")].find(el => el.dataset.filterId === focusedId)?.focus();
  }

  const activeCount = NFCatalog.activeFilterCount(SHOP_STATE) - (SHOP_STATE.q ? 1 : 0);
  const badge = document.getElementById("filter-count");
  badge.textContent = activeCount;
  badge.hidden = activeCount === 0;
  document.getElementById("filters-apply").textContent = result.total ? `Show ${result.total} result${result.total !== 1 ? "s" : ""}` : "No results";
}

/* ---------- active-filter chips ---------- */
function renderChips() {
  const chips = [];
  const chip = (label, patch) => chips.push(
    `<button type="button" class="nf-chip" data-patch='${escapeHtml(JSON.stringify(patch))}'>${escapeHtml(label)}<i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="sr-only"> — remove filter</span></button>`);
  if (SHOP_STATE.q) chip(`“${SHOP_STATE.q}”`, { q: "" });
  if (SHOP_STATE.category) chip(NFCatalog.categoryLabel(SHOP_STATE.category), { category: "" });
  SHOP_STATE.brands.forEach(b => chip(b, { brands: SHOP_STATE.brands.filter(x => x !== b) }));
  if (SHOP_STATE.price) chip(NFCatalog.PRICE_BANDS.find(b => b.key === SHOP_STATE.price)?.label || "", { price: "" });
  if (SHOP_STATE.inStock) chip("In stock", { inStock: false });
  if (SHOP_STATE.scent) chip(SCENT_FAMILIES.find(s => s.key === SHOP_STATE.scent)?.label || SHOP_STATE.scent, { scent: "" });
  if (SHOP_STATE.scentInvalid) chip("Unknown scent family", { scent: "", scentInvalid: false, scentRaw: "" });
  if (chips.length > 1) chips.push(`<button type="button" class="nf-chip-clear" data-clear-all>Clear all</button>`);
  shop.chips.innerHTML = chips.join("");
}

/* ---------- grid + states ---------- */
function renderGrid(result) {
  const grid = shop.grid;
  // Scent family states: an unknown family, or a real family with no classified products yet.
  // Both are explicit messages — neither may ever fall back to listing the whole catalogue.
  if (result.total === 0 && !SHOP_STATE.q && (SHOP_STATE.scentInvalid || (SHOP_STATE.scent && !PRODUCTS.some(p => p.scentFamily === SHOP_STATE.scent)))) {
    const family = SCENT_FAMILIES.find(f => f.key === SHOP_STATE.scent);
    grid.innerHTML = `
      <div class="nf-empty" data-scent-state="${family ? "empty" : "invalid"}">
        <i class="fa-regular fa-compass" aria-hidden="true"></i>
        <h2>${family ? `No fragrances in the ${escapeHtml(family.label)} family yet` : "We couldn't find that scent family"}</h2>
        <p>${family ? "We're still adding fragrances to this family. Explore the full collection in the meantime." : "Choose one of our scent families, or browse the full collection."}</p>
        <div class="nf-empty-actions">
          ${family ? "" : SCENT_FAMILIES.map(f => `<a class="btn btn-outline btn-sm" href="products.html?scent=${encodeURIComponent(f.key)}">${escapeHtml(f.label)}</a>`).join("")}
          <a class="btn btn-primary btn-sm" href="products.html">Browse all fragrances</a>
        </div>
      </div>`;
    return;
  }
  if (result.total === 0) {
    const hasFilters = NFCatalog.activeFilterCount(SHOP_STATE) > (SHOP_STATE.q ? 1 : 0);
    const suggestion = SHOP_STATE.q ? NFCatalog.suggest(PRODUCTS, SHOP_STATE.q).didYouMean : null;
    grid.innerHTML = `
      <div class="nf-empty">
        <i class="fa-regular fa-compass" aria-hidden="true"></i>
        <h2>${SHOP_STATE.q ? `No results for “${escapeHtml(SHOP_STATE.q)}”` : "No fragrances match these filters"}</h2>
        <p>${SHOP_STATE.q ? "Check the spelling, try a house name, or search for something broader." : "Try removing a filter or choosing a different price range."}</p>
        <div class="nf-empty-actions">
          ${suggestion ? `<button type="button" class="btn btn-primary btn-sm" data-search="${escapeHtml(suggestion)}">Search for “${escapeHtml(suggestion)}”</button>` : ""}
          ${hasFilters && SHOP_STATE.q ? `<button type="button" class="btn btn-outline btn-sm" data-keep-query>Keep search, remove filters</button>` : ""}
          <button type="button" class="btn btn-outline btn-sm" data-clear-all>Clear everything</button>
        </div>
      </div>`;
    return;
  }
  grid.innerHTML = result.items.map(productCard).join("");
  if (!SHOP_REDUCED_MOTION) {
    grid.classList.remove("is-entering");
    void grid.offsetWidth; // restart the entrance animation
    grid.classList.add("is-entering");
  }
  if (typeof refreshWishlistIcons === "function") refreshWishlistIcons();
}

/* ---------- pagination ---------- */
function pageList(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach(p => pages.add(p));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach(p => pages.add(p));
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

function renderPagination(result) {
  const nav = shop.pagination;
  if (result.pageCount <= 1) { nav.hidden = true; nav.innerHTML = ""; return; }
  nav.hidden = false;
  const { page, pageCount } = result;
  nav.innerHTML = `
    <button type="button" class="nf-page-step" data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Previous page">
      <i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Previous</span>
    </button>
    <ol class="nf-page-list">
      ${pageList(page, pageCount).map(p => p === "…"
        ? `<li class="nf-page-gap" aria-hidden="true">…</li>`
        : `<li><button type="button" class="nf-page-num" data-page="${p}" ${p === page ? 'aria-current="page"' : ""} aria-label="Page ${p}${p === page ? ", current page" : ""}">${p}</button></li>`).join("")}
    </ol>
    <span class="nf-page-status">Page ${page} of ${pageCount}</span>
    <button type="button" class="nf-page-step" data-page="${page + 1}" ${page === pageCount ? "disabled" : ""} aria-label="Next page">
      <span>Next</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
    </button>`;
}

/* ---------- main render ---------- */
function renderShop() {
  if (!SHOP_STATE) return;
  const result = NFCatalog.query(PRODUCTS, SHOP_STATE);
  if (result.page !== SHOP_STATE.page) {
    // Requested page no longer exists (e.g. filters narrowed results): show the last real page.
    SHOP_STATE.page = result.page;
    history.replaceState(null, "", `${window.location.pathname}${NFCatalog.serializeState(SHOP_STATE)}`);
  }
  renderHeading(result);
  syncCollectionPills(SHOP_STATE.category);
  renderFilters(result);
  renderChips();
  renderGrid(result);
  renderPagination(result);
}

function renderShopError() {
  shop.count.textContent = "We couldn't load the collection";
  shop.grid.innerHTML = `
    <div class="nf-empty nf-empty--error" role="alert">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      <h2>We couldn't load the collection</h2>
      <p>This is usually temporary. Please check your connection and try again.</p>
      <div class="nf-empty-actions"><button type="button" class="btn btn-primary btn-sm" data-retry>Try again</button></div>
    </div>`;
  shop.filtersBody.innerHTML = `<p class="nf-filter-none">Filters will appear once the collection loads.</p>`;
  shop.pagination.hidden = true;
  shop.chips.innerHTML = "";
}

function renderShopEmptyCatalog() {
  shop.count.textContent = "No fragrances listed yet";
  shop.grid.innerHTML = `
    <div class="nf-empty">
      <i class="fa-regular fa-gem" aria-hidden="true"></i>
      <h2>The collection is being prepared</h2>
      <p>No fragrances are listed right now. Please check back soon, or contact us if you're looking for something specific.</p>
      <div class="nf-empty-actions"><a href="contact.html" class="btn btn-primary btn-sm">Contact us</a></div>
    </div>`;
  shop.filtersBody.innerHTML = "";
  shop.pagination.hidden = true;
}

/* ---------- mobile filter drawer ---------- */
function isDrawerMode() { return window.matchMedia("(max-width: 960px)").matches; }

function openFilterDrawer() {
  shopDrawerReturnFocus = document.activeElement;
  shop.drawer.classList.add("is-open");
  shop.drawer.setAttribute("role", "dialog");
  shop.drawer.setAttribute("aria-modal", "true");
  shop.overlay.hidden = false;
  requestAnimationFrame(() => shop.overlay.classList.add("is-open"));
  shop.toggle.setAttribute("aria-expanded", "true");
  document.body.classList.add("nf-scroll-lock");
  shop.drawer.focus();
}

function closeFilterDrawer() {
  if (!shop.drawer.classList.contains("is-open")) return;
  shop.drawer.classList.remove("is-open");
  shop.drawer.removeAttribute("role");
  shop.drawer.removeAttribute("aria-modal");
  shop.overlay.classList.remove("is-open");
  shop.toggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("nf-scroll-lock");
  setTimeout(() => { shop.overlay.hidden = true; }, 300);
  // Return focus to whatever opened the drawer, falling back to the Filter button.
  const back = shopDrawerReturnFocus && shopDrawerReturnFocus !== document.body && document.contains(shopDrawerReturnFocus) ? shopDrawerReturnFocus : shop.toggle;
  back.focus();
}

function trapDrawerFocus(e) {
  if (e.key !== "Tab" || !shop.drawer.classList.contains("is-open")) return;
  const focusables = [...shop.drawer.querySelectorAll("button, input:not([disabled]), select, a[href]")].filter(el => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === shop.drawer)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- events (bound once) ---------- */
function bindShopEvents() {
  shop.sort.innerHTML = NFCatalog.SORTS.map(s => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join("");

  let searchTimer = null;
  shop.search.addEventListener("input", () => {
    document.getElementById("search-clear").hidden = !shop.search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setShopState({ q: shop.search.value.trim(), page: 1 }), 250);
  });
  document.getElementById("search-clear").addEventListener("click", () => {
    shop.search.value = "";
    setShopState({ q: "", page: 1 });
    syncControls();
    shop.search.focus();
  });
  if (typeof nfAttachSearchSuggest === "function") {
    nfAttachSearchSuggest(shop.search, {
      onQuery: q => { clearTimeout(searchTimer); shop.search.value = q; setShopState({ q, page: 1 }); syncControls(); },
      onBrand: b => { clearTimeout(searchTimer); shop.search.value = ""; setShopState({ brands: [b], q: "", page: 1 }); syncControls(); },
      onCategory: c => { clearTimeout(searchTimer); shop.search.value = ""; setShopState({ category: c, q: "", page: 1 }); syncControls(); },
    });
  }

  shop.sort.addEventListener("change", () => setShopState({ sort: shop.sort.value, page: 1 }));

  shop.filtersBody.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "category") setShopState({ category: t.value, page: 1 });
    else if (t.name === "price") setShopState({ price: t.value, page: 1 });
    else if (t.name === "stock") setShopState({ inStock: t.checked, page: 1 });
    else if (t.name === "scent") setShopState({ scent: t.value, scentInvalid: false, scentRaw: "", page: 1 });
    else if (t.name === "brand") {
      const brands = t.checked ? [...SHOP_STATE.brands, t.value] : SHOP_STATE.brands.filter(b => b !== t.value);
      setShopState({ brands, page: 1 });
    }
  });
  shop.filtersBody.addEventListener("input", (e) => {
    if (e.target.id !== "brand-filter-search") return;
    shopBrandFilterText = e.target.value;
    renderFilters(NFCatalog.query(PRODUCTS, SHOP_STATE));
  });
  shop.filtersBody.addEventListener("click", (e) => {
    if (e.target.closest("#brands-more")) { shopBrandsExpanded = !shopBrandsExpanded; renderFilters(NFCatalog.query(PRODUCTS, SHOP_STATE)); document.getElementById("brands-more")?.focus(); }
  });

  // Collection pills apply the category in place, the same way the Category filter does.
  // Modified clicks (new tab/window) and Special Offers (no data-category) follow the link.
  document.getElementById("collection-pills")?.addEventListener("click", (e) => {
    const pill = e.target.closest("a[data-category]");
    if (!pill || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setShopState({ category: pill.dataset.category, page: 1 });
    syncControls();
  });

  const clearAll = () => { shopBrandFilterText = ""; setShopState({ ...NFCatalog.DEFAULT_STATE, brands: [], sort: SHOP_STATE.sort }); syncControls(); };
  document.getElementById("filters-clear").addEventListener("click", clearAll);
  document.getElementById("filters-apply").addEventListener("click", () => { closeFilterDrawer(); scrollToResults(); });

  shop.chips.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-all]")) { clearAll(); return; }
    const chip = e.target.closest(".nf-chip");
    if (!chip) return;
    setShopState({ ...JSON.parse(chip.dataset.patch), page: 1 });
    syncControls();
    (shop.chips.querySelector(".nf-chip, .nf-chip-clear") || shop.search).focus();
  });

  shop.grid.addEventListener("click", (e) => {
    if (e.target.closest("[data-retry]")) { shop.grid.innerHTML = skeletonGrid(NFCatalog.PAGE_SIZE); shop.count.textContent = "Loading the collection…"; loadProducts(); return; }
    if (e.target.closest("[data-clear-all]")) { clearAll(); return; }
    if (e.target.closest("[data-keep-query]")) { setShopState({ ...NFCatalog.DEFAULT_STATE, brands: [], q: SHOP_STATE.q, sort: SHOP_STATE.sort }); return; }
    const s = e.target.closest("[data-search]");
    if (s) { shop.search.value = s.dataset.search; setShopState({ q: s.dataset.search, page: 1 }); syncControls(); }
  });

  shop.pagination.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    setShopState({ page: Number(btn.dataset.page) }, { push: true });
    scrollToResults();
    // Move focus to the results heading so keyboard/screen-reader users land on the new page.
    shop.count.setAttribute("tabindex", "-1");
    shop.count.focus({ preventScroll: true });
  });

  shop.toggle.addEventListener("click", openFilterDrawer);
  document.getElementById("filters-close").addEventListener("click", closeFilterDrawer);
  shop.overlay.addEventListener("click", closeFilterDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && shop.drawer.classList.contains("is-open")) closeFilterDrawer();
    trapDrawerFocus(e);
  });
  window.matchMedia("(max-width: 960px)").addEventListener("change", (mq) => { if (!mq.matches) closeFilterDrawer(); });

  window.addEventListener("popstate", () => {
    SHOP_STATE = NFCatalog.parseState(window.location.search, PRODUCTS);
    syncControls();
    renderShop();
  });
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("product-grid")) return; // not on products.html
  shop.grid.innerHTML = skeletonGrid(NFCatalog.PAGE_SIZE);
  // Pre-fill the search box from the URL so it doesn't flash empty while loading.
  const q = new URLSearchParams(window.location.search).get("q");
  if (q) shop.search.value = q;
  // Mark the pill from the URL straight away; renderShop() keeps it in step afterwards.
  syncCollectionPills(new URLSearchParams(window.location.search).get("category") || "");
  nfLoadActiveOffers(); // in parallel with the product request
});

document.addEventListener("productsReady", (e) => {
  if (!document.getElementById("product-grid")) return;
  if (e.detail.error) { renderShopError(); return; }
  if (e.detail.empty) { renderShopEmptyCatalog(); return; }

  const firstLoad = SHOP_STATE === null;
  SHOP_STATE = NFCatalog.parseState(window.location.search, PRODUCTS);
  // Normalise the URL (drops unknown/invalid parameters).
  history.replaceState(null, "", `${window.location.pathname}${NFCatalog.serializeState(SHOP_STATE)}`);
  if (firstLoad) bindShopEvents();
  syncControls();
  renderShop();

  // When offer prices arrive, re-render so sale prices, price bands and price sorting use them.
  nfLoadActiveOffers().then(offers => { if (offers.length) renderShop(); });
});
