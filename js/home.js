/* ============================================
   NeoFragrances — home.js
   Renders the homepage from real data only:
   - PRODUCTS (main.js, GET /api/products)
   - active offers (GET /api/offers/active — the
     server already excludes expired/disabled offers)
   - genuine reviews (GET /api/reviews/highlights)
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
// Reviews (R11, owner decisions D15): 0 eligible → hidden, 1–2 → static, 3+ → moving strip.
const HOME_REVIEWS_MARQUEE_MIN = 3;
const HOME_REVIEWS_PX_PER_SECOND = 30;

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

/* ---------- Genuine reviews (R11) ----------
   GET /api/reviews/highlights returns only genuine, visible reviews of active products that
   have text, any star rating, with a short reviewer name built on the server. Nothing here
   creates, edits or filters reviews by rating. Owner decisions (D15):
     0 reviews  → the section stays hidden;
     1–2        → a static grid;
     3 or more  → a continuous right-to-left strip (~30 px/s) that pauses on hover, on keyboard
                  focus and with the visible Pause/Play button. The strip holds the reviews
                  twice: the second group is a decorative copy (aria-hidden, links tabindex=-1),
                  so translateX(-50%) lands exactly on its start and the loop never jumps.
                  Visitors who prefer reduced motion get one static, swipeable row instead. */
function homeReviewsMode(count) {
  if (!count) return "hidden";
  return count >= HOME_REVIEWS_MARQUEE_MIN ? "marquee" : "static";
}

function homeReviewCardHTML(r, { decorative = false, revealDelay = null } = {}) {
  const rating = Math.max(0, Math.min(5, Number(r.rating) || 0));
  const product = r.product && r.product.id ? r.product : null;
  return `
    <figure class="nf-review-card"${revealDelay === null ? "" : ` data-reveal data-reveal-delay="${revealDelay}"`}${decorative ? "" : ' role="listitem"'}>
      <div class="nf-review-stars" role="img" aria-label="${rating} out of 5 stars">
        ${[1, 2, 3, 4, 5].map(n => `<i class="fa-solid fa-star${n <= rating ? "" : " is-empty"}" aria-hidden="true"></i>`).join("")}
      </div>
      <blockquote>${escapeHtml(r.comment)}</blockquote>
      <figcaption>
        <strong>${escapeHtml(r.reviewer || "Customer")}</strong>
        ${r.verified ? `<span class="nf-review-verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified purchase</span>` : ""}
        ${product ? `<a href="product-details.html?id=${encodeURIComponent(product.id)}"${decorative ? ' tabindex="-1"' : ""}>${escapeHtml(product.name)}</a>` : ""}
      </figcaption>
    </figure>`;
}

async function homeFetchReviewHighlights() {
  try {
    const res = await fetch(`${API_BASE}/api/reviews/highlights`);
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data && data.reviews) ? data.reviews : [];
    // Defensive: the server already sends only reviews with text.
    return list.filter(r => r && typeof r.comment === "string" && r.comment.trim());
  } catch (err) {
    return [];
  }
}

function homeRenderStaticReviews(reviews) {
  const grid = document.getElementById("review-grid");
  grid.setAttribute("role", "list");
  grid.innerHTML = reviews.map((r, i) => homeReviewCardHTML(r, { revealDelay: i })).join("");
  homeShow("reviews");
  homeRevealIn(grid);
}

function homeRenderReviewMarquee(reviews) {
  const marquee = document.getElementById("reviews-marquee");
  const toggle = document.getElementById("reviews-toggle");
  const cards = decorative => reviews.map(r => homeReviewCardHTML(r, { decorative })).join("");
  marquee.innerHTML =
    `<div class="nf-reviews-track">` +
    `<div class="nf-reviews-group" role="list" aria-label="Customer reviews">${cards(false)}</div>` +
    `<div class="nf-reviews-group" aria-hidden="true">${cards(true)}</div></div>`;
  document.getElementById("review-grid").remove();
  marquee.hidden = false;
  toggle.hidden = false;
  homeShow("reviews");

  // Constant speed whatever the number of reviews: duration = one group's width / speed. A group
  // narrower than the strip would leave a gap, so repeat its reviews (as extra decorative copies,
  // in both groups so they stay identical) until it is wide enough. Measured again once the web
  // fonts have loaded and when the window size changes.
  const groups = marquee.querySelectorAll(".nf-reviews-group");
  const fit = () => {
    for (let i = 0; i < 8 && groups[0].scrollWidth < marquee.clientWidth; i++) {
      groups.forEach(g => g.insertAdjacentHTML("beforeend", `<div class="nf-reviews-extra" aria-hidden="true">${cards(true)}</div>`));
    }
    const width = groups[0].getBoundingClientRect().width;
    if (width > 0) marquee.style.setProperty("--nf-reviews-duration", `${Math.round(width / HOME_REVIEWS_PX_PER_SECOND)}s`);
  };
  fit();
  document.fonts?.ready.then(fit);
  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 200); });

  // Visible Pause/Play control (hover and keyboard focus also pause, in css/home.css).
  const label = toggle.querySelector("span"), icon = toggle.querySelector("i");
  const setPaused = paused => {
    marquee.classList.toggle("is-paused", paused);
    label.textContent = paused ? "Play" : "Pause";
    icon.className = paused ? "fa-solid fa-play" : "fa-solid fa-pause";
    toggle.setAttribute("aria-label", paused ? "Play scrolling reviews" : "Pause scrolling reviews");
  };
  setPaused(false);
  toggle.addEventListener("click", () => setPaused(!marquee.classList.contains("is-paused")));
}

async function homeLoadReviews() {
  const reviews = await homeFetchReviewHighlights();
  const mode = homeReviewsMode(reviews.length);
  if (mode === "hidden") return; // no genuine reviews with text → the section stays hidden
  if (mode === "static") homeRenderStaticReviews(reviews);
  else homeRenderReviewMarquee(reviews);
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const wa = document.getElementById("story-wa");
  if (wa && typeof nfWhatsAppLink === "function") {
    wa.href = nfWhatsAppLink("Hello NeoFragrances, could you recommend a fragrance for me?");
  }
  document.getElementById("picks-grid").innerHTML = skeletonGrid(4);
  homeLoadOffers();
  homeLoadReviews(); // independent of the catalogue (GET /api/reviews/highlights)
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
});
