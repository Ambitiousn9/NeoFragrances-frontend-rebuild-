/* ============================================
   NeoFragrances — search-suggest.js
   Accessible search suggestions (ARIA combobox +
   listbox) built from the real catalog in PRODUCTS.
   Used by the header search on every page and by the
   products-page search box.

   nfAttachSearchSuggest(input, {
     onQuery(q), onBrand(name), onCategory(key), onProduct(p)
   })
   Each handler is optional; the defaults navigate to
   products.html / product-details.html.

   Depends on: NFCatalog (catalog.js), PRODUCTS, money,
   productMedia, escapeHtml, nfEffectivePrice (main.js).
   ============================================ */

const NF_RECENT_SEARCHES_KEY = "nf_recent_searches";
const NF_RECENT_SEARCHES_MAX = 5;

function nfGetRecentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(NF_RECENT_SEARCHES_KEY) || "[]");
    return Array.isArray(list) ? list.filter(s => typeof s === "string").slice(0, NF_RECENT_SEARCHES_MAX) : [];
  } catch (err) { return []; }
}

function nfRememberSearch(q) {
  const term = String(q || "").trim();
  if (!term) return;
  try {
    const list = nfGetRecentSearches().filter(s => s.toLowerCase() !== term.toLowerCase());
    list.unshift(term);
    localStorage.setItem(NF_RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, NF_RECENT_SEARCHES_MAX)));
  } catch (err) { /* storage unavailable — recent searches are a convenience only */ }
}

function nfClearRecentSearches() {
  try { localStorage.removeItem(NF_RECENT_SEARCHES_KEY); } catch (err) { /* ignore */ }
}

let nfSuggestCounter = 0;

function nfAttachSearchSuggest(input, handlers = {}) {
  if (!input || input.dataset.suggestAttached) return;
  input.dataset.suggestAttached = "1";

  const go = {
    query: handlers.onQuery || (q => { window.location.href = `products.html?q=${encodeURIComponent(q)}`; }),
    brand: handlers.onBrand || (b => { window.location.href = `products.html?brand=${encodeURIComponent(b)}`; }),
    category: handlers.onCategory || (c => { window.location.href = `products.html?category=${encodeURIComponent(c)}`; }),
    product: handlers.onProduct || (p => { window.location.href = `product-details.html?id=${encodeURIComponent(p.id)}`; }),
  };

  const id = `nf-suggest-${++nfSuggestCounter}`;
  const host = input.parentElement;
  host.classList.add("nf-suggest-host");
  const panel = document.createElement("div");
  panel.className = "nf-suggest";
  panel.hidden = true;
  panel.innerHTML = `<ul class="nf-suggest-list" role="listbox" id="${id}" aria-label="Search suggestions"></ul>`;
  host.appendChild(panel);
  const list = panel.firstElementChild;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);
  input.setAttribute("autocomplete", "off");

  let options = [];   // [{ el, action }]
  let active = -1;
  let renderTimer = null;

  function open() { panel.hidden = false; input.setAttribute("aria-expanded", "true"); }
  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function setActive(index) {
    options.forEach((o, i) => o.el.classList.toggle("is-active", i === index));
    active = index;
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", options[index].el.id);
      options[index].el.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function option(html, action, extraClass = "") {
    const oid = `${id}-opt-${options.length}`;
    return { html: `<li role="option" id="${oid}" class="nf-suggest-option ${extraClass}" data-index="${options.length}">${html}</li>`, action, oid };
  }

  function render() {
    const q = input.value.trim();
    const parts = [];
    options = [];
    const push = (html, action, cls) => { const o = option(html, action, cls); options.push({ action, id: o.oid }); parts.push(o.html); };
    const heading = text => parts.push(`<li role="presentation" class="nf-suggest-heading">${escapeHtml(text)}</li>`);

    if (!q) {
      const recent = nfGetRecentSearches();
      if (!recent.length) { close(); return; }
      heading("Recent searches");
      recent.forEach(term => push(`<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><span>${escapeHtml(term)}</span>`, () => submit(term)));
      parts.push(`<li role="presentation" class="nf-suggest-footer"><button type="button" class="nf-suggest-clear">Clear recent searches</button></li>`);
    } else if (!Array.isArray(PRODUCTS) || PRODUCTS.length === 0) {
      push(`<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Search for “${escapeHtml(q)}”</span>`, () => submit(q), "nf-suggest-query");
    } else {
      const s = NFCatalog.suggest(PRODUCTS, q);
      push(`<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Search for “${escapeHtml(q)}”</span>`, () => submit(q), "nf-suggest-query");
      if (s.didYouMean) {
        push(`<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>Did you mean <strong>${escapeHtml(s.didYouMean)}</strong>?</span>`, () => submit(s.didYouMean));
      }
      if (s.brands.length) {
        heading("Houses");
        s.brands.forEach(b => push(`<span class="nf-suggest-label">${escapeHtml(b.name)}</span><span class="nf-suggest-meta">${b.count}</span>`, () => go.brand(b.name)));
      }
      if (s.categories.length) {
        heading("Collections");
        s.categories.forEach(c => push(`<span class="nf-suggest-label">${escapeHtml(c.label)}</span><span class="nf-suggest-meta">${c.count}</span>`, () => go.category(c.key)));
      }
      if (s.products.length) {
        heading("Fragrances");
        s.products.forEach(p => push(`
          <span class="nf-suggest-thumb">${productMedia(p.image, "")}</span>
          <span class="nf-suggest-product"><span class="nf-suggest-brand">${escapeHtml(p.brand)}</span><span class="nf-suggest-label">${escapeHtml(p.name)}</span></span>
          <span class="nf-suggest-meta">${money(typeof nfEffectivePrice === "function" ? nfEffectivePrice(p) : p.price)}</span>`, () => go.product(p)));
      }
      if (!s.brands.length && !s.products.length && !s.categories.length && !s.didYouMean) {
        parts.push(`<li role="presentation" class="nf-suggest-empty">No matching fragrances or houses yet. Press Enter to search anyway.</li>`);
      }
    }

    list.innerHTML = parts.join("");
    options = options.map(o => ({ el: document.getElementById(o.id), action: o.action }));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    open();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 90);
  }

  function submit(q) {
    const term = String(q || "").trim();
    if (!term) return;
    nfRememberSearch(term);
    close();
    go.query(term);
  }

  input.addEventListener("input", scheduleRender);
  input.addEventListener("focus", () => { if (!input.value.trim() || panel.hidden) render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (panel.hidden) render();
      if (options.length) setActive((active + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length) setActive(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && options[active]) options[active].action();
      else submit(input.value);
    } else if (e.key === "Escape" && !panel.hidden) {
      e.stopPropagation();
      close();
    }
  });

  // Keep focus in the input while clicking an option.
  panel.addEventListener("mousedown", (e) => e.preventDefault());
  panel.addEventListener("click", (e) => {
    if (e.target.closest(".nf-suggest-clear")) { nfClearRecentSearches(); close(); input.focus(); return; }
    const li = e.target.closest(".nf-suggest-option");
    if (!li) return;
    const o = options[Number(li.dataset.index)];
    if (o) o.action();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));

  // If the catalog finishes loading while the panel is open, refresh it.
  document.addEventListener("productsReady", () => { if (!panel.hidden) render(); });

  return { close, submit, refresh: render };
}

// Header search (rendered by layout.js) on every page.
document.addEventListener("DOMContentLoaded", () => {
  const headerInput = document.getElementById("nf-search-input");
  if (!headerInput) return;
  // On the products page the controller in search.js attaches its own in-place handlers.
  if (document.getElementById("product-grid") && typeof window.nfProductsPageHandlers === "object") {
    nfAttachSearchSuggest(headerInput, window.nfProductsPageHandlers);
  } else {
    nfAttachSearchSuggest(headerInput);
  }
});
