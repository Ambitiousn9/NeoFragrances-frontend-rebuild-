/* ============================================
   NeoFragrances — main.js (Phase 4 + clickable cards)
   Products now load from the real database via
   the Express API, instead of being hardcoded.

   IMPORTANT: PRODUCTS starts EMPTY and fills in
   after the fetch below finishes. Any script that
   needs PRODUCTS must wait for the "productsReady"
   event instead of assuming it's ready immediately.

   NEW: the entire .product-card is clickable and
   opens product-details.html for that product,
   while .wishlist-btn, .add-to-cart, and
   .view-details-link keep working independently
   (handled via one delegated listener below —
   applies automatically to every page that uses
   productCard(), since it's the single shared
   template for all of them).
   ============================================ */

// Local development (localhost / 127.0.0.1) talks to the local Express
// server; every other host (e.g. the live Netlify site) uses Render.
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];
const API_BASE = LOCAL_HOSTNAMES.includes(window.location.hostname)
  ? "http://localhost:5000"
  : "https://neofragrances-server.onrender.com";

// Escapes a value for safe interpolation into HTML text or a quoted
// attribute. Use on every API/user-derived value placed into innerHTML.
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Returns a safe same-origin path for a ?redirect= value, or the fallback.
// Blocks open redirects (other sites, //host, javascript: URLs).
function safeRedirectTarget(target, fallback = "index.html") {
  if (!target) return fallback;
  try {
    const url = new URL(target, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    if (url.origin !== window.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch (err) {
    return fallback;
  }
}

// The four primary scent families (products.scent_family, migration 008). Only the
// owner assigns a family, in the admin portal; NULL means unassigned. These four keys
// are the only valid ?scent= values. `notes` is the homepage card line (describing the
// family in general, never a specific product); `image` is the homepage card photo.
// NOTE: the card photos are local placeholders — their commercial-use rights are
// unconfirmed and Woody.jpeg must be replaced or approved before launch.
const SCENT_FAMILIES = [
  { key: "floral", label: "Floral", notes: "Rose · Jasmine · Peony", image: "images/scent%20family/Floral.jpeg", width: 1280, height: 872, focus: "62% 50%" },
  { key: "amber", label: "Amber", notes: "Oud · Amber · Musk", image: "images/scent%20family/Amber.jpeg", width: 1000, height: 1000, focus: "50% 45%" },
  { key: "fresh", label: "Fresh", notes: "Citrus · Aqua · Green", image: "images/scent%20family/fresh.jpeg", width: 960, height: 1280, focus: "60% 42%" },
  { key: "woody", label: "Woody", notes: "Sandalwood · Cedar", image: "images/scent%20family/Woody.jpeg", width: 495, height: 619, focus: "50% 40%" },
];

let PRODUCTS = [];
let loadFailed = false;

// "Only N left" is shown at or below this real stock quantity.
const LOW_STOCK_THRESHOLD = 10;

// Treats empty values — and the literal text "NULL" left behind by a faulty
// CSV/SQL import — as missing, so it never renders as visible text.
function cleanText(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s.toUpperCase() === "NULL" ? "" : s;
}

async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/api/products`);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const data = await res.json();

    // Convert the database's column names/shapes into the same shape
    // the rest of the site's code already expects.
    PRODUCTS = data.map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      scentFamily: p.scent_family || null,
      price: Number(p.price),
      stock: p.stock_qty > 0,
      stockQty: p.stock_qty,
      badge: cleanText(p.badge),
      image: p.image,
      avgRating: Number(p.avg_rating) || 0,
      reviewCount: p.review_count || 0,
      description: cleanText(p.description),
      createdAt: p.created_at || null,
      notes: { top: p.top_notes, middle: p.middle_notes, base: p.base_notes },
    }));
    loadFailed = false;
  } catch (err) {
    console.error("Could not load products from the API:", err);
    PRODUCTS = [];
    loadFailed = true;
  }
  // Let every other script know the data has arrived (or failed).
  // success: there are products to show · error: the request failed ·
  // empty: the request worked but the catalog has no products.
  document.dispatchEvent(new CustomEvent("productsReady", {
    detail: { success: PRODUCTS.length > 0, error: loadFailed, empty: !loadFailed && PRODUCTS.length === 0 },
  }));
}

/* ---------- Active offers (shared, fetched at most once per page) ----------
   Pages that show sale pricing on product cards call nfLoadActiveOffers().
   The server only returns offers that are active right now, so expired or
   disabled offers never appear. The admin portal is the source of truth. */
let ACTIVE_OFFERS = [];
let ACTIVE_OFFER_BY_PRODUCT = {};
let nfActiveOffersPromise = null;

function nfLoadActiveOffers() {
  if (!nfActiveOffersPromise) {
    nfActiveOffersPromise = fetch(`${API_BASE}/api/offers/active`)
      .then(res => (res.ok ? res.json() : []))
      .catch(err => { console.error("Could not load offers:", err); return []; })
      .then(list => {
        const now = Date.now();
        ACTIVE_OFFERS = (Array.isArray(list) ? list : []).filter(o => new Date(o.end_at).getTime() > now);
        ACTIVE_OFFER_BY_PRODUCT = {};
        nfLowestOfferRows(ACTIVE_OFFERS).forEach(o => { ACTIVE_OFFER_BY_PRODUCT[o.product_id] = o; });
        return ACTIVE_OFFERS;
      });
  }
  return nfActiveOffersPromise;
}

// /api/offers/active returns one row per (offer, product). A product can be in several
// live offers; the lowest sale price applies (first row wins a tie). This keeps, in the
// API's order, only the row that actually prices each product — so no card, spotlight
// or cart line ever offers a product at a higher offer price than it really costs.
function nfLowestOfferRows(rows) {
  const best = {};
  rows.forEach(o => {
    const current = best[o.product_id];
    if (!current || Number(o.sale_price) < Number(current.sale_price)) best[o.product_id] = o;
  });
  return rows.filter(o => best[o.product_id] === o);
}

// Price a customer currently sees: the active offer's sale price, else the regular price.
function nfEffectivePrice(p) {
  const offer = ACTIVE_OFFER_BY_PRODUCT[p.id];
  return offer ? Number(offer.sale_price) : p.price;
}

/* Reusable bottle silhouette placeholder — shown if a photo file is missing */
function bottleSVG(fill = "#2B1B2E") {
  return `<svg viewBox="0 0 60 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="24" y="4" width="12" height="10" rx="2" fill="${fill}" opacity="0.7"/>
    <rect x="21" y="14" width="18" height="8" rx="2" fill="${fill}" opacity="0.5"/>
    <path d="M14 26 h32 a4 4 0 0 1 4 4 v58 a6 6 0 0 1 -6 6 H16 a6 6 0 0 1 -6 -6 V30 a4 4 0 0 1 4 -4 Z" fill="${fill}"/>
    <rect x="18" y="46" width="24" height="22" rx="1" fill="#FAF6F0" opacity="0.9"/>
  </svg>`;
}

function productMedia(imagePath, alt) {
  return `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="handleImageError(this)">`;
}

function handleImageError(img) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = bottleSVG();
  img.replaceWith(wrapper.firstElementChild);
}

function money(amount) {
  return `GH₵${Number(amount).toFixed(2)}`;
}

// Shared product card (homepage, products page, wishlist, related products).
// Sale pricing appears only when a real active offer exists for the product
// (ACTIVE_OFFER_BY_PRODUCT, filled by nfLoadActiveOffers()).
function productCard(p) {
  const offer = ACTIVE_OFFER_BY_PRODUCT[p.id];
  const lowStock = p.stock && p.stockQty <= LOW_STOCK_THRESHOLD;
  const categoryLabel = p.category === "men" || p.category === "women" ? `For ${p.category}` : capitalize(p.category);

  const priceBlock = offer
    ? `<span class="product-price product-price--sale">${money(offer.sale_price)}</span>
       <span class="product-price-original"><span class="sr-only">Regular price </span>${money(offer.original_price)}</span>`
    : `<span class="product-price">${money(p.price)}</span>`;

  const stockLabel = !p.stock
    ? `<span class="stock-no">Out of stock</span>`
    : lowStock
      ? `<span class="stock-low">Only ${escapeHtml(p.stockQty)} left</span>`
      : `<span class="stock-yes">In stock</span>`;

  return `
  <div class="product-card${p.stock ? "" : " is-soldout"}" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name.toLowerCase())}" data-brand="${escapeHtml(p.brand)}" data-cat="${escapeHtml(p.category)}" data-price="${escapeHtml(p.price)}" tabindex="0" role="link" aria-label="View details for ${escapeHtml(p.name)}">
    <div class="product-media">
      <div class="product-badges">
        ${offer ? `<span class="product-badge badge-sale">−${escapeHtml(offer.discount_percent)}%</span>` : ""}
        ${p.badge ? `<span class="product-badge${p.badge === 'New' ? ' badge-new' : ''}">${escapeHtml(p.badge)}</span>` : ""}
      </div>
      <button class="wishlist-btn" data-id="${escapeHtml(p.id)}" onclick="toggleWishlist(${Number(p.id)}, this)" title="Save to wishlist" aria-label="Save ${escapeHtml(p.name)} to wishlist"><i class="fa-regular fa-heart"></i></button>
      ${productMedia(p.image, p.name)}
      ${p.stock ? "" : `<span class="product-soldout-tag">Sold out</span>`}
    </div>
    <div class="product-info">
      <span class="product-brand">${escapeHtml(p.brand)}</span>
      <h3 class="product-name">${escapeHtml(p.name)}</h3>
      <span class="product-cat">${escapeHtml(categoryLabel)}</span>
      <div class="product-price-row">
        <div class="product-prices">${priceBlock}</div>
        ${stockLabel}
      </div>
    </div>
    <div class="product-actions">
      <button class="btn btn-primary add-to-cart" data-id="${escapeHtml(p.id)}"${offer ? ` data-offer-id="${escapeHtml(offer.id)}"` : ""} ${p.stock ? "" : "disabled"}><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>&nbsp; ${p.stock ? "Add to Cart" : "Sold Out"}</button>
      <a href="product-details.html?id=${encodeURIComponent(p.id)}" class="view-details-link">View details <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>
    </div>
  </div>`;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function skeletonGrid(count = 8) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-img skeleton-shimmer"></div>
        <div class="skeleton-line skeleton-shimmer w-60"></div>
        <div class="skeleton-line skeleton-shimmer w-80"></div>
        <div class="skeleton-line skeleton-shimmer w-40"></div>
      </div>`;
  }
  return html;
}

/* ---------- Whole-card navigation to product details ----------
   Single delegated listener, so this works for every product card
   on every page (products.html, homepage, wishlist.html, related-
   products grids), no matter which script rendered it, and works
   for cards added dynamically after this script runs. */
function navigateToProductFromCard(card) {
  const id = card.dataset.id;
  if (!id) return;
  window.location.href = `product-details.html?id=${id}`;
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;

  // Let these keep handling themselves — do not navigate for them.
  if (e.target.closest(".wishlist-btn")) return;
  if (e.target.closest(".add-to-cart")) return;
  if (e.target.closest(".view-details-link")) return; // its own href already goes to the right place

  navigateToProductFromCard(card);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".product-card");
  if (!card) return;
  // Only trigger card-level navigation when the card itself has focus —
  // if a button/link inside it has focus, let that element's own
  // Enter/Space behavior run instead (native button/link activation).
  if (e.target !== card) return;
  e.preventDefault();
  navigateToProductFromCard(card);
});

/* ---------- Maintenance mode (Milestone 6 Phase 2) ----------
   UX only. The server is the authority: while maintenance is on, every blocked
   /api/* route already returns 503 with code MAINTENANCE_MODE, and nothing here
   can bypass that. This exists so a customer sees a calm page instead of a
   broken one — it is NOT a security control.

   Two exemptions, both deliberate:

   1. Admin pages. All 12 of them load this file, and admin-core.js awaits
      /api/me during boot. Redirecting here would lock the administrator out of
      the very portal that turns maintenance off.

   2. payment-callback.html. A customer returning from Paystack has already been
      charged. Trapping them here would stop js/payment-result.js from calling
      /api/payments/verify/:reference, so they would never see their order
      confirmation or its reference. The order itself would still be created —
      the webhook bypasses maintenance and settlePayment() is idempotent — but
      the customer would be left with no receipt on screen. Both that route and
      the webhook are on the server's bypass list for the same reason.

   maintenance.html loads no storefront JavaScript at all, so it cannot loop. */
const NF_MAINTENANCE_PAGE = "maintenance.html";
const NF_MAINTENANCE_EXEMPT_PAGES = ["payment-callback.html", NF_MAINTENANCE_PAGE];

function nfMaintenanceExempt() {
  if (document.body.classList.contains("nf-admin")) return true;
  const page = window.location.pathname.split("/").pop() || "index.html";
  return NF_MAINTENANCE_EXEMPT_PAGES.includes(page);
}

async function nfCheckMaintenance() {
  if (nfMaintenanceExempt()) return false;
  try {
    const res = await fetch(`${API_BASE}/api/system/status`, { cache: "no-store" });
    if (!res.ok) return false;              // unreadable probe: assume the site is up
    const data = await res.json();
    if (!data || data.maintenance !== true) return false;
    window.location.replace(NF_MAINTENANCE_PAGE);
    return true;
  } catch (err) {
    // Offline or unreachable API is NOT maintenance. Fail open, exactly as the
    // server does, so a flaky connection never fakes an outage.
    return false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Admin pages load their own data (/api/admin/...) and opt out with <body data-catalog="off">.
  if (document.body.dataset.catalog === "off") return;
  // Fire the probe alongside the catalog load rather than awaiting it first, so
  // a normal page is never slowed down by it.
  nfCheckMaintenance();
  loadProducts();
});