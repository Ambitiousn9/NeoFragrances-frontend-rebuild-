/* ============================================
   NeoFragrances — offers.js
   Powers special-offers.html. Everything shown here
   (prices, discounts, countdown, which product is
   featured) comes from GET /api/offers/active —
   nothing is hardcoded. The Admin Portal is the
   source of truth; this file only renders what the
   API returns.

   FIX: the Add to Cart button on each offer card now
   carries data-offer-id, so cart.js's global click
   handler knows which offer this add came from and
   the cart/checkout can price it correctly.
   ============================================ */

let OFFERS = [];
let OFFER_ROWS = []; // every live (offer, product) row, before the one-card-per-product filter
let ACTIVE_OFFER_FILTER = "all";
let COUNTDOWN_INTERVAL = null;

async function loadActiveOffers() {
  try {
    const res = await fetch(`${API_BASE}/api/offers/active`);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    // One card per product: a product in several live offers is shown once, at its
    // lowest offer price (main.js), so this page never advertises a higher one.
    OFFER_ROWS = await res.json();
    OFFERS = nfLowestOfferRows(OFFER_ROWS);
  } catch (err) {
    console.error("Could not load offers:", err);
    OFFER_ROWS = [];
    OFFERS = [];
  }
  renderOffersPage();
}

function offerDiscountBadge(offer) {
  if (offer.offer_type === "flash_sale") return "FLASH SALE";
  if (offer.badge) return offer.badge.toUpperCase();
  return "SALE";
}

/* ---------- "+N more in this offer" (offers page banner + homepage spotlight) ----------
   rows: the live (offer, product) rows from /api/offers/active — the server already
   leaves out archived products and offers that aren't live. Counts the OTHER products
   the same offer covers; a product priced lower by an overlapping offer still counts. */
function offerMoreCount(rows, offer) {
  return new Set(rows.filter(r => r.id === offer.id && r.product_id !== offer.product_id).map(r => r.product_id)).size;
}
function offerProductIds(rows, offer) {
  return [...new Set(rows.filter(r => r.id === offer.id).map(r => Number(r.product_id)))];
}
function offerMoreLinkHTML(offer, more, href, cls) {
  if (!more) return "";
  return `<a class="${cls}" href="${href}" data-offer-more="${escapeHtml(offer.id)}" aria-label="See ${more} more product${more === 1 ? "" : "s"} in ${escapeHtml(offer.title)} on the offers page">+${more} more in this offer <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>`;
}

/* ---------- Countdown: built from the offer's real end_at, recomputed
   every tick from the actual clock — never reset on reload. ---------- */
function formatCountdownParts(endAt) {
  const diff = new Date(endAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { days, hours, minutes, seconds };
}

function pad2(n) { return String(n).padStart(2, "0"); }

function startCountdowns() {
  if (COUNTDOWN_INTERVAL) clearInterval(COUNTDOWN_INTERVAL);
  COUNTDOWN_INTERVAL = setInterval(() => {
    document.querySelectorAll("[data-countdown-end]").forEach(el => {
      const parts = formatCountdownParts(el.dataset.countdownEnd);
      if (!parts) {
        // Offer expired while the customer was on the page — reload
        // from the API rather than just hiding the timer, since the
        // whole offer needs to disappear from the grid too.
        clearInterval(COUNTDOWN_INTERVAL);
        loadActiveOffers();
        return;
      }
      const d = el.querySelector(".cd-days"), h = el.querySelector(".cd-hours"),
            m = el.querySelector(".cd-minutes"), s = el.querySelector(".cd-seconds");
      if (d) d.textContent = pad2(parts.days);
      if (h) h.textContent = pad2(parts.hours);
      if (m) m.textContent = pad2(parts.minutes);
      if (s) s.textContent = pad2(parts.seconds);
    });
  }, 1000);
}

function countdownHTML(endAt) {
  return `
    <div class="offer-countdown" data-countdown-end="${escapeHtml(endAt)}" aria-label="Offer ends soon">
      <div class="cd-unit"><span class="cd-days">00</span><small>Days</small></div>
      <div class="cd-unit"><span class="cd-hours">00</span><small>Hours</small></div>
      <div class="cd-unit"><span class="cd-minutes">00</span><small>Minutes</small></div>
      <div class="cd-unit"><span class="cd-seconds">00</span><small>Seconds</small></div>
    </div>`;
}

/* ---------- Featured flash sale banner ---------- */
function renderFeaturedOffer() {
  const wrap = document.getElementById("featured-offer-wrap");
  if (!wrap) return;
  const featured = OFFERS.find(o => o.featured) || OFFERS[0];

  if (!featured) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = `
    <div class="featured-offer-banner">
      <div class="featured-offer-media">${productMedia(cleanText(featured.image) || featured.product_image, featured.product_name)}</div>
      <div class="featured-offer-info">
        <span class="featured-offer-eyebrow"><i class="fa-solid fa-bolt"></i> ${escapeHtml(offerDiscountBadge(featured))}</span>
        <h2>${escapeHtml(featured.title)}</h2>
        ${featured.description ? `<p class="featured-offer-desc">${escapeHtml(featured.description)}</p>` : ""}
        <div class="featured-offer-product">${escapeHtml(featured.brand)} — ${escapeHtml(featured.product_name)}</div>
        ${offerMoreLinkHTML(featured, offerMoreCount(OFFER_ROWS, featured), "#offers-grid", "featured-offer-more")}
        <div class="featured-offer-prices">
          <span class="offer-price-original">${money(featured.original_price)}</span>
          <span class="offer-price-sale">${money(featured.sale_price)}</span>
          <span class="offer-save-badge">SAVE ${escapeHtml(featured.discount_percent)}%</span>
        </div>
        <div class="offer-ends-label"><i class="fa-regular fa-clock"></i> Offer ends in</div>
        ${countdownHTML(featured.end_at)}
        <a href="product-details.html?id=${encodeURIComponent(featured.product_id)}" class="btn btn-primary featured-offer-cta">Shop Now</a>
      </div>
    </div>`;
}

/* ---------- Offer product card (mirrors productCard() from main.js,
   with sale pricing added) ---------- */
function offerCardHTML(offer) {
  const stock = offer.stock_qty > 0;
  return `
  <div class="product-card offer-card" data-id="${escapeHtml(offer.product_id)}" data-offer-type="${escapeHtml(offer.offer_type)}">
    <div class="product-media">
      <span class="product-badge">${escapeHtml(offerDiscountBadge(offer))}</span>
      <button class="wishlist-btn" data-id="${escapeHtml(offer.product_id)}" onclick="toggleWishlist(${Number(offer.product_id)}, this)" title="Save to wishlist" aria-label="Save to wishlist"><i class="fa-regular fa-heart"></i></button>
      ${productMedia(offer.product_image, offer.product_name)}
    </div>
    <div class="product-info">
      <span class="product-brand">${escapeHtml(offer.brand)}</span>
      <h3 class="product-name">${escapeHtml(offer.product_name)}</h3>
      <span class="product-cat">${escapeHtml(capitalize(offer.category))}</span>
      <div class="offer-price-row">
        <span class="offer-price-original">${money(offer.original_price)}</span>
        <span class="offer-price-sale">${money(offer.sale_price)}</span>
        <span class="offer-save-badge">SAVE ${escapeHtml(offer.discount_percent)}%</span>
      </div>
      <div class="product-price-row">
        <span class="${stock ? 'stock-yes' : 'stock-no'}">${stock ? 'In stock' : 'Out of stock'}</span>
      </div>
    </div>
    <div class="product-actions">
      <button class="btn btn-primary add-to-cart" data-id="${escapeHtml(offer.product_id)}" data-offer-id="${escapeHtml(offer.id)}" ${stock ? "" : "disabled"} aria-label="Add ${escapeHtml(offer.product_name)} to cart"><i class="fa-solid fa-bag-shopping"></i>&nbsp; Add to Cart</button>
      <a href="product-details.html?id=${encodeURIComponent(offer.product_id)}" class="view-details-link">View details <i class="fa-solid fa-chevron-right"></i></a>
    </div>
  </div>`;
}

function renderOfferChips() {
  const wrap = document.getElementById("offer-chips");
  if (!wrap) return;
  const types = ["all", ...new Set(OFFERS.map(o => o.offer_type))];
  const labels = { all: "All Offers", discount: "Percentage Discounts", flash_sale: "Flash Sales", new_arrival: "New Arrivals", bestseller: "Bestsellers", limited: "Limited Offers" };
  wrap.innerHTML = types.map(t =>
    `<button type="button" class="chip${t === ACTIVE_OFFER_FILTER ? " active" : ""}" data-filter="${escapeHtml(t)}">${escapeHtml(labels[t] || capitalize(t))}</button>`
  ).join("");
  wrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      ACTIVE_OFFER_FILTER = chip.dataset.filter;
      renderOffersPage();
    });
  });
}

function renderOfferGrid() {
  const grid = document.getElementById("offers-grid");
  const emptyState = document.getElementById("offers-empty-state");
  if (!grid) return;

  const list = ACTIVE_OFFER_FILTER === "all" ? OFFERS : OFFERS.filter(o => o.offer_type === ACTIVE_OFFER_FILTER);

  if (list.length === 0) {
    grid.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";
  grid.innerHTML = list.map(offerCardHTML).join("");
  if (typeof refreshWishlistIcons === "function") refreshWishlistIcons();
}

function renderOffersPage() {
  const noOffersBanner = document.getElementById("no-offers-banner");
  if (OFFERS.length === 0) {
    if (noOffersBanner) noOffersBanner.style.display = "block";
    document.getElementById("featured-offer-wrap")?.replaceChildren();
    document.getElementById("offer-chips")?.replaceChildren();
    document.getElementById("offers-grid")?.replaceChildren();
    return;
  }
  if (noOffersBanner) noOffersBanner.style.display = "none";

  renderFeaturedOffer();
  renderOfferChips();
  renderOfferGrid();
  startCountdowns();
}

// Banner "+N more in this offer": show every product (clear a type filter that would hide
// some), scroll to the grid and briefly mark that offer's products.
function showOfferProducts(offerId) {
  const offer = OFFER_ROWS.find(o => String(o.id) === String(offerId));
  const grid = document.getElementById("offers-grid");
  if (!offer || !grid) return;
  if (ACTIVE_OFFER_FILTER !== "all") { ACTIVE_OFFER_FILTER = "all"; renderOfferChips(); renderOfferGrid(); }
  grid.querySelectorAll(".offer-card--in-offer").forEach(c => c.classList.remove("offer-card--in-offer"));
  offerProductIds(OFFER_ROWS, offer).forEach(id => grid.querySelector(`.offer-card[data-id="${id}"]`)?.classList.add("offer-card--in-offer"));
  const first = grid.querySelector(".offer-card--in-offer") || grid;
  first.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  clearTimeout(showOfferProducts.timer);
  showOfferProducts.timer = setTimeout(() => grid.querySelectorAll(".offer-card--in-offer").forEach(c => c.classList.remove("offer-card--in-offer")), 4000);
}

document.addEventListener("click", e => {
  const more = e.target.closest(".featured-offer-more[data-offer-more]");
  if (!more || !document.getElementById("offers-grid")) return;
  e.preventDefault();
  showOfferProducts(more.dataset.offerMore);
});

document.addEventListener("productsReady", (e) => {
  if (!document.getElementById("offers-grid")) return; // not on this page
  loadActiveOffers();
});
