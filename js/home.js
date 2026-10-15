/* ============================================
   NeoFragrances — home.js
   Renders the homepage from real data only:
   - PRODUCTS (main.js, GET /api/products)
   - active offers (GET /api/offers/active — the
     server already excludes expired/disabled offers)
   - genuine reviews (GET /api/products/:id/reviews)
   Every data-driven section starts hidden and is
   only revealed when there is real content for it.

   Uses from other scripts: escapeHtml, money,
   productCard, productMedia, SCENT_FAMILIES (main.js);
   offerCardHTML, formatCountdownParts, pad2 (offers.js);
   nfWhatsAppLink (layout.js); nfReveal (motion.js);
   refreshWishlistIcons (wishlist.js).
   ============================================ */

const HOME_PICKS_LIMIT = 8;
// The scent-family section appears only when EVERY family has at least this many active,
// in-stock products with an owner-assigned family (see homeScentFamiliesEligible).
const HOME_SCENT_MIN_IN_STOCK = 5;
const HOME_REVIEW_PRODUCTS = 6;      // how many reviewed products to fetch reviews for
const HOME_REVIEWS_LIMIT = 3;

let homeCountdownTimer = null;
// Re-renders the visible picks tab (set once products are rendered) — used when offer prices arrive.
let homePicksRefresh = null;

function homeShow(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
  return el;
}

function homeRevealIn(el) {
  if (el && typeof nfReveal === "function") nfReveal(el);
}

// In-stock products first, keeping the original order otherwise.
function homeInStockFirst(list) {
  return [...list].sort((a, b) => Number(b.stock) - Number(a.stock));
}

/* ---------- Hero ---------- */
function homeRenderHero() {
  const brands = new Set(PRODUCTS.map(p => p.brand));
  const categories = new Set(PRODUCTS.map(p => p.category));
  document.getElementById("stat-products").textContent = PRODUCTS.length;
  document.getElementById("stat-brands").textContent = brands.size;
  document.getElementById("stat-categories").textContent = categories.size;
  homeShow("hero-stats");

  // Three in-stock products from different houses, bestsellers preferred.
  const pool = homeInStockFirst([
    ...PRODUCTS.filter(p => p.badge === "Bestseller"),
    ...PRODUCTS.filter(p => p.badge !== "Bestseller"),
  ]).filter(p => p.image);
  const picks = [];
  const usedBrands = new Set();
  for (const p of pool) {
    if (usedBrands.has(p.brand)) continue;
    picks.push(p);
    usedBrands.add(p.brand);
    if (picks.length === 3) break;
  }

  const items = document.querySelectorAll("#hero-vitrine .nf-vitrine-item");
  items.forEach((item, i) => {
    const p = picks[i];
    if (!p) { item.remove(); return; }
    item.innerHTML = `
      <a class="nf-vitrine-card" href="product-details.html?id=${encodeURIComponent(p.id)}" tabindex="-1">
        <span class="nf-vitrine-media">${productMedia(p.image, p.name)}</span>
        <span class="nf-vitrine-caption"><span>${escapeHtml(p.brand)}</span>${escapeHtml(p.name)}</span>
      </a>`;
  });
}

/* ---------- Brand strip ----------
   A continuous right-to-left marquee (css/home.css). The houses are rendered twice: the
   second group is a decorative copy, hidden from assistive technology and skipped by Tab,
   so the CSS loop (translateX 0 → -50%) is seamless. Reduced motion hides the copy and
   keeps the original scrollable strip. */
const HOME_MARQUEE_PX_PER_SECOND = 40;

function homeRenderBrands() {
  const counts = {};
  PRODUCTS.forEach(p => { counts[p.brand] = (counts[p.brand] || 0) + 1; });
  const brands = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  if (brands.length === 0) return;

  const links = focusable => brands.map(b =>
    `<a href="products.html?brand=${encodeURIComponent(b)}" class="nf-brand-link"${focusable ? "" : ' tabindex="-1"'}>${escapeHtml(b)}</a>`
  ).join("");
  const track = document.getElementById("brands-track");
  track.innerHTML = `<div class="nf-marquee-track">` +
    `<div class="nf-marquee-group">${links(true)}</div>` +
    `<div class="nf-marquee-group" aria-hidden="true">${links(false)}</div></div>`;
  homeShow("brands");

  // Constant, unhurried speed whatever the number of houses: duration = one group's width / speed.
  // A group narrower than the strip would leave a gap, so repeat its houses (as extra decorative
  // copies) until it is wide enough. Measured again once the web fonts have loaded.
  const groups = track.querySelectorAll(".nf-marquee-group");
  const fit = () => {
    for (let i = 0; i < 6 && groups[0].scrollWidth < track.clientWidth; i++) {
      groups.forEach(g => g.insertAdjacentHTML("beforeend", `<span aria-hidden="true" style="display:contents">${links(false)}</span>`));
    }
    const width = groups[0].getBoundingClientRect().width;
    if (width > 0) track.style.setProperty("--nf-marquee-duration", `${Math.round(width / HOME_MARQUEE_PX_PER_SECOND)}s`);
  };
  fit();
  document.fonts?.ready.then(fit);
}

/* ---------- Scent families ----------
   Eligibility, from the live catalogue (GET /api/products, i.e. active products only):
   every one of the four families needs at least HOME_SCENT_MIN_IN_STOCK products whose
   scent_family is that family (only the owner sets it, in the admin) AND stock_qty > 0.
   Unclassified products never count. If the product request failed, this is never called
   (see the productsReady handler) and the section stays hidden. */
function homeScentFamiliesEligible(products) {
  if (typeof SCENT_FAMILIES === "undefined" || SCENT_FAMILIES.length !== 4 || !Array.isArray(products)) return false;
  return SCENT_FAMILIES.every(f =>
    products.filter(p => p.scentFamily === f.key && Number(p.stockQty) > 0).length >= HOME_SCENT_MIN_IN_STOCK);
}

function homeRenderScentFamilies() {
  if (!homeScentFamiliesEligible(PRODUCTS)) return; // stays hidden: never a partial grid

  const grid = document.getElementById("scent-grid");
  grid.innerHTML = SCENT_FAMILIES.map((f, i) => `
      <a href="products.html?scent=${encodeURIComponent(f.key)}" class="nf-scent-card" data-scent-card="${escapeHtml(f.key)}" data-reveal data-reveal-delay="${Math.min(i, 3)}">
        <img src="${escapeHtml(f.image)}" alt="" width="${f.width}" height="${f.height}" loading="lazy" decoding="async" style="object-position:${escapeHtml(f.focus)}">
        <div class="nf-scent-body">
          <h3>${escapeHtml(f.label)}</h3>
          <p>${escapeHtml(f.notes)}</p>
        </div>
      </a>`).join("");
  homeShow("scent-families");
  homeRevealIn(grid);
}

/* ---------- Bestsellers / New arrivals tabs ---------- */
function homePickLists() {
  const bestsellers = homeInStockFirst(PRODUCTS.filter(p => p.badge === "Bestseller"));
  const newArrivals = homeInStockFirst(
    PRODUCTS.filter(p => p.badge === "New")
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  );
  const lists = [];
  if (bestsellers.length) lists.push({ key: "bestsellers", label: "Bestsellers", items: bestsellers });
  if (newArrivals.length) lists.push({ key: "new", label: "New Arrivals", items: newArrivals });
  // Fallback when no badges are set: the most recently listed products.
  if (lists.length === 0 && PRODUCTS.length) {
    lists.push({ key: "latest", label: "Latest", items: homeInStockFirst([...PRODUCTS].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))) });
  }
  return lists;
}

function homeRenderPicks() {
  const lists = homePickLists();
  const grid = document.getElementById("picks-grid");
  const tabs = document.getElementById("picks-tabs");

  const show = (key) => {
    const list = lists.find(l => l.key === key) || lists[0];
    tabs.querySelectorAll("[role=tab]").forEach(t => {
      const selected = t.dataset.key === list.key;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
    });
    grid.setAttribute("aria-labelledby", `picks-tab-${list.key}`);
    grid.classList.remove("is-swapping");
    void grid.offsetWidth; // restart the fade-in
    grid.classList.add("is-swapping");
    grid.innerHTML = list.items.slice(0, HOME_PICKS_LIMIT).map(productCard).join("");
    if (typeof refreshWishlistIcons === "function") refreshWishlistIcons();
  };

  if (lists.length > 1) {
    tabs.innerHTML = lists.map(l =>
      `<button type="button" role="tab" id="picks-tab-${l.key}" data-key="${l.key}" aria-controls="picks-grid">${escapeHtml(l.label)}</button>`
    ).join("");
    tabs.hidden = false;
    tabs.addEventListener("click", (e) => {
      const tab = e.target.closest("[role=tab]");
      if (tab) show(tab.dataset.key);
    });
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const all = [...tabs.querySelectorAll("[role=tab]")];
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      const next = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      next.focus();
      show(next.dataset.key);
    });
  } else if (lists.length === 1) {
    document.getElementById("picks-title").textContent = lists[0].label;
  }
  if (lists.length) {
    show(lists[0].key);
    homePicksRefresh = () => show(tabs.querySelector("[aria-selected=true]")?.dataset.key || lists[0].key);
  }
}

/* ---------- Collections (category cards) ---------- */
function homeRenderCollections() {
  document.querySelectorAll(".nf-collection-card").forEach(card => {
    const items = PRODUCTS.filter(p => p.category === card.dataset.category);
    const countEl = card.querySelector(".nf-collection-count");
    if (items.length === 0) { card.remove(); return; }
    countEl.textContent = `${items.length} fragrance${items.length !== 1 ? "s" : ""}`;
    const thumbs = homeInStockFirst([
      ...items.filter(p => p.badge === "Bestseller"),
      ...items.filter(p => p.badge !== "Bestseller"),
    ]).filter(p => p.image).slice(0, 3);
    card.querySelector(".nf-collection-media").innerHTML =
      thumbs.map(p => `<span>${productMedia(p.image, "")}</span>`).join("");
  });
}

/* ---------- Offers ---------- */
function homeOfferEndsLabel(offer) {
  const end = new Date(offer.end_at);
  return `Ends ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function homeCountdownMarkup(endAt) {
  return `
    <div class="nf-countdown" data-home-countdown="${escapeHtml(endAt)}" role="timer" aria-label="Time remaining">
      <div><span data-unit="days">00</span><small>Days</small></div>
      <div><span data-unit="hours">00</span><small>Hrs</small></div>
      <div><span data-unit="minutes">00</span><small>Min</small></div>
      <div><span data-unit="seconds">00</span><small>Sec</small></div>
    </div>`;
}

function homeTickCountdowns() {
  let expired = false;
  document.querySelectorAll("[data-home-countdown]").forEach(el => {
    const parts = formatCountdownParts(el.dataset.homeCountdown);
    if (!parts) { expired = true; return; }
    ["days", "hours", "minutes", "seconds"].forEach(unit => {
      const span = el.querySelector(`[data-unit="${unit}"]`);
      const value = pad2(parts[unit]);
      if (span && span.textContent !== value) span.textContent = value;
    });
  });
  // An offer ended while the page was open: reload offers so it disappears.
  if (expired) { clearInterval(homeCountdownTimer); homeLoadOffers({ refresh: true }); }
}

// rows: every live (offer, product) row, for the "+N more in this offer" link (offers.js).
function homeRenderSpotlight(offer, rows = []) {
  const isFlash = offer.offer_type === "flash_sale";
  const image = cleanText(offer.image) || offer.product_image;
  const inStock = offer.stock_qty > 0;
  return `
    <article class="nf-spotlight" data-reveal>
      <a class="nf-spotlight-media" href="product-details.html?id=${encodeURIComponent(offer.product_id)}" aria-label="${escapeHtml(offer.product_name)}">
        ${productMedia(image, offer.product_name)}
        <span class="nf-spotlight-save">Save ${escapeHtml(offer.discount_percent)}%</span>
      </a>
      <div class="nf-spotlight-body">
        <span class="nf-eyebrow">${escapeHtml(isFlash ? "Flash Sale" : (offer.badge || "Special Offer"))}</span>
        <h3>${escapeHtml(offer.title)}</h3>
        ${offer.description ? `<p class="nf-spotlight-desc">${escapeHtml(offer.description)}</p>` : ""}
        <p class="nf-spotlight-product"><span>${escapeHtml(offer.brand)}</span> ${escapeHtml(offer.product_name)}</p>
        ${offerMoreLinkHTML(offer, offerMoreCount(rows, offer), "special-offers.html#offers-grid", "nf-spotlight-more")}
        <div class="nf-spotlight-price">
          <span class="nf-price-sale">${money(offer.sale_price)}</span>
          <span class="nf-price-original">${money(offer.original_price)}</span>
        </div>
        ${isFlash ? homeCountdownMarkup(offer.end_at) : `<p class="nf-spotlight-ends"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(homeOfferEndsLabel(offer))}</p>`}
        <div class="nf-spotlight-actions">
          <button class="btn btn-primary add-to-cart" data-id="${escapeHtml(offer.product_id)}" data-offer-id="${escapeHtml(offer.id)}" ${inStock ? "" : "disabled"}>
            <i class="fa-solid fa-bag-shopping" aria-hidden="true"></i> ${inStock ? "Add to cart" : "Out of stock"}
          </button>
          <a href="product-details.html?id=${encodeURIComponent(offer.product_id)}" class="nf-text-link">View product <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </div>
    </article>`;
}

async function homeLoadOffers({ refresh = false } = {}) {
  const section = document.getElementById("offers");
  // Shared, cached loader (main.js) — also gives product cards their sale prices.
  // On refresh (an offer just expired) the cache is dropped to fetch fresh data.
  if (refresh) nfActiveOffersPromise = null;
  // One row per product, at its lowest live offer price (main.js).
  const rows = await nfLoadActiveOffers();
  const offers = nfLowestOfferRows(rows);
  if (homePicksRefresh) homePicksRefresh();

  if (offers.length === 0) {
    section.hidden = true;
    return;
  }

  const spotlight = offers.find(o => o.offer_type === "flash_sale") || offers[0];
  const rest = offers.filter(o => o !== spotlight).slice(0, 4);
  const hasFlash = offers.some(o => o.offer_type === "flash_sale");

  document.getElementById("offers-eyebrow").textContent = hasFlash ? "Flash Sale" : "Special Offers";
  document.getElementById("offer-spotlight").innerHTML = homeRenderSpotlight(spotlight, rows);
  const grid = document.getElementById("offer-grid");
  grid.innerHTML = rest.map(offerCardHTML).join("");
  grid.hidden = rest.length === 0;

  section.hidden = false;
  homeRevealIn(section);
  if (typeof refreshWishlistIcons === "function") refreshWishlistIcons();

  if (document.querySelector("[data-home-countdown]")) {
    clearInterval(homeCountdownTimer);
    homeTickCountdowns();
    homeCountdownTimer = setInterval(homeTickCountdowns, 1000);
  }
}

/* ---------- Genuine reviews ---------- */
function homeReviewerName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Customer";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : parts[0];
}

async function homeLoadReviews() {
  const reviewed = PRODUCTS.filter(p => p.reviewCount > 0)
    .sort((a, b) => b.reviewCount - a.reviewCount)
    .slice(0, HOME_REVIEW_PRODUCTS);
  if (reviewed.length === 0) return;

  const results = await Promise.all(reviewed.map(async p => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(p.id)}/reviews`);
      const rows = res.ok ? await res.json() : [];
      return rows.map(r => ({ ...r, product: p }));
    } catch (err) {
      return [];
    }
  }));

  const reviews = results.flat()
    .filter(r => r.comment && String(r.comment).trim() && Number(r.rating) >= 4)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, HOME_REVIEWS_LIMIT);
  if (reviews.length === 0) return; // no genuine reviews → section stays hidden

  const grid = document.getElementById("review-grid");
  grid.innerHTML = reviews.map((r, i) => `
    <figure class="nf-review-card" data-reveal data-reveal-delay="${i}">
      <div class="nf-review-stars" aria-label="${escapeHtml(r.rating)} out of 5 stars">
        ${[1, 2, 3, 4, 5].map(n => `<i class="fa-solid fa-star${n <= Number(r.rating) ? "" : " is-empty"}" aria-hidden="true"></i>`).join("")}
      </div>
      <blockquote>${escapeHtml(r.comment)}</blockquote>
      <figcaption>
        <strong>${escapeHtml(homeReviewerName(r.full_name))}</strong>
        ${r.is_verified_purchase ? `<span class="nf-review-verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified purchase</span>` : ""}
        <a href="product-details.html?id=${encodeURIComponent(r.product.id)}">${escapeHtml(r.product.name)}</a>
      </figcaption>
    </figure>`).join("");
  homeShow("reviews");
  homeRevealIn(grid);
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const wa = document.getElementById("story-wa");
  if (wa && typeof nfWhatsAppLink === "function") {
    wa.href = nfWhatsAppLink("Hello NeoFragrances, could you recommend a fragrance for me?");
  }
  document.getElementById("picks-grid").innerHTML = skeletonGrid(4);
  homeLoadOffers();
});

document.addEventListener("productsReady", (e) => {
  if (!e.detail.success) {
    document.getElementById("picks-grid").innerHTML =
      `<p class="nf-state nf-state--error">We're having trouble loading the collection right now. Please refresh in a moment.</p>`;
    document.getElementById("hero-vitrine")?.remove();
    document.getElementById("collections")?.setAttribute("hidden", "");
    return;
  }
  homeRenderHero();
  homeRenderBrands();
  homeRenderScentFamilies();
  homeRenderPicks();
  homeRenderCollections();
  homeLoadReviews();
});
