/* ============================================
   NeoFragrances — cart-page.js (cart.html)
   Bag → Delivery → Payment on one page.

   Prices: every total shown in the summary comes
   from the server (POST /api/cart/quote). The same
   server calculation is used when the payment is
   started, so what the customer sees is what
   Paystack charges. The browser never sends prices.

   Uses: getCart/updateQty/removeFromCart/
   dropOfferFromLine/addToCart/clearCart (cart.js),
   PRODUCTS, ACTIVE_OFFER_BY_PRODUCT, nfLoadActiveOffers,
   money, productMedia, escapeHtml, productCard (main.js),
   getAuth/isLoggedIn (auth.js).
   ============================================ */

const COUPON_SESSION_KEY = "nf_cart_coupon";

const checkout = {
  quote: null,            // last successful server quote
  quoteError: null,       // { code, error, productId, available, offerId }
  quoteLoading: false,
  quoteSeq: 0,
  coupon: null,           // { id, code } once the server accepted it
  addresses: [],
  addressesLoaded: false,
  selectedAddressId: null,
  addressFormOpen: false,
  paying: false,
  removed: null,          // last removed line, for Undo
};

const $id = id => document.getElementById(id);

/* ---------- line model (display only; totals come from the quote) ---------- */
// One offer covers several products, each with its own price, so an offer row is
// identified by (offer id, product id) — never by the offer id alone.
const offerKey = (offerId, productId) => `${Number(offerId)}:${Number(productId)}`;
function liveOfferRows() {
  const rows = {};
  (typeof ACTIVE_OFFERS !== "undefined" ? ACTIVE_OFFERS : []).forEach(o => { rows[offerKey(o.id, o.product_id)] = o; });
  return rows;
}

// A line added from an offer is priced at its product's lowest live offer: if a cheaper
// offer is live, or the line's own offer has ended while another one is live, the line
// moves onto it. With no live offer left, the line keeps the "offer has ended" prompt
// (shown at the regular price) — the server never charges an ended offer either way.
function applyLowestOffers() {
  const rows = liveOfferRows();
  const cart = getCart();
  let moved = false;
  cart.slice().forEach(item => {
    if (!item.offerId) return;
    const best = ACTIVE_OFFER_BY_PRODUCT[item.id];
    if (!best || Number(best.id) === item.offerId) return;
    const own = rows[offerKey(item.offerId, item.id)];
    if (own && Number(own.sale_price) <= Number(best.sale_price)) return;
    moved = moveLineOffer(cart, item.id, item.offerId, Number(best.id)) || moved;
  });
  if (moved) saveCart(cart);
}

function cartLines() {
  const rows = liveOfferRows();
  return getCart().map(item => {
    const product = PRODUCTS.find(p => p.id === item.id) || null;
    const offer = item.offerId ? rows[offerKey(item.offerId, item.id)] || null : null;
    const offerValid = !!offer;
    const issues = [];
    if (!product) issues.push({ type: "unavailable" });
    else {
      if (item.offerId && !offerValid) issues.push({ type: "offer-ended" });
      if (product.stockQty === 0) issues.push({ type: "sold-out" });
      else if (item.qty > product.stockQty) issues.push({ type: "low-stock", available: product.stockQty });
    }
    const unitPrice = product ? (offerValid ? Number(offer.sale_price) : product.price) : 0;
    return { item, product, offer: offerValid ? offer : null, issues, unitPrice, regularPrice: product ? product.price : 0 };
  });
}

function quoteLineFor(item) {
  return checkout.quote?.lines.find(l => l.productId === item.id && (l.offerId || null) === (item.offerId || null)) || null;
}

/* ---------- rendering: bag ---------- */
function lineIssueHTML(line) {
  const i = line.issues[0];
  if (!i) return "";
  const name = line.product ? escapeHtml(line.product.name) : "This item";
  const map = {
    "unavailable": `This item is no longer available. <button type="button" class="nf-link-btn" data-action="remove">Remove it</button>`,
    "sold-out": `${name} is sold out. <button type="button" class="nf-link-btn" data-action="remove">Remove it</button>`,
    "low-stock": `Only ${escapeHtml(i.available)} left in stock. <button type="button" class="nf-link-btn" data-action="cap" data-qty="${escapeHtml(i.available)}">Update to ${escapeHtml(i.available)}</button>`,
    "offer-ended": `The offer on this item has ended. <button type="button" class="nf-link-btn" data-action="drop-offer">Keep it at ${money(line.regularPrice)}</button>`,
  };
  return `<p class="nf-line-issue" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ${map[i.type]}</p>`;
}

function lineHTML(line) {
  const { item, product, offer } = line;
  const q = quoteLineFor(item);
  const unit = q ? q.unitPrice : line.unitPrice;
  const total = q ? q.lineTotal : unit * item.qty;
  const max = product ? Math.min(product.stockQty || 0, CART_MAX_QTY_PER_LINE) : 0;
  const name = product ? product.name : "Unavailable item";
  const href = product ? `product-details.html?id=${encodeURIComponent(product.id)}` : "#";
  return `
    <article class="nf-line${line.issues.length ? " has-issue" : ""}" role="listitem" data-id="${escapeHtml(item.id)}" data-offer-id="${escapeHtml(item.offerId || "")}">
      <a class="nf-line-media" href="${href}" tabindex="-1" aria-hidden="true">${product ? productMedia(product.image, "") : bottleSVG()}</a>
      <div class="nf-line-info">
        ${product ? `<span class="nf-line-brand">${escapeHtml(product.brand)}</span>` : ""}
        <h3 class="nf-line-name">${product ? `<a href="${href}">${escapeHtml(name)}</a>` : escapeHtml(name)}</h3>
        <div class="nf-line-price">
          ${offer ? `<span class="nf-line-sale">${money(unit)}</span><s class="nf-line-was"><span class="sr-only">Regular price </span>${money(line.regularPrice)}</s><span class="nf-line-tag">Offer</span>` : `<span>${money(unit)}</span>`}
        </div>
        ${lineIssueHTML(line)}
      </div>
      <div class="nf-line-qty">
        <div class="nf-stepper" role="group" aria-label="Quantity for ${escapeHtml(name)}">
          <button type="button" data-action="dec" aria-label="Decrease quantity" ${item.qty <= 1 || !product ? "disabled" : ""}><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
          <output aria-live="polite" aria-label="Quantity">${escapeHtml(item.qty)}</output>
          <button type="button" data-action="inc" aria-label="Increase quantity" ${!product || item.qty >= max ? "disabled" : ""}><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
        </div>
        ${product && item.qty >= max && max > 0 ? `<span class="nf-line-max">Max available</span>` : ""}
      </div>
      <div class="nf-line-total">
        <span class="sr-only">Line total </span>${money(total)}
        <button type="button" class="nf-line-remove" data-action="remove" aria-label="Remove ${escapeHtml(name)} from bag"><i class="fa-regular fa-trash-can" aria-hidden="true"></i><span>Remove</span></button>
      </div>
    </article>`;
}

function renderBag() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.item.qty, 0);
  const empty = lines.length === 0;

  $id("checkout-layout").hidden = empty;
  $id("bag-empty").hidden = !empty;
  $id("paybar").hidden = empty;
  $id("bag-count").textContent = empty ? "" : `(${count} item${count !== 1 ? "s" : ""})`;
  document.title = empty ? "Your Bag — NeoFragrances" : `Your Bag (${count}) — NeoFragrances`;

  if (empty) { renderEmptySuggestions(); return lines; }

  let html = lines.map(lineHTML).join("");
  if (checkout.removed) {
    html += `<div class="nf-line-undo" role="status">“${escapeHtml(checkout.removed.name)}” removed. <button type="button" class="nf-link-btn" data-action="undo">Undo</button></div>`;
  }
  $id("cart-list").innerHTML = html;
  return lines;
}

function renderEmptySuggestions() {
  const picks = PRODUCTS.filter(p => p.stock && p.badge === "Bestseller").slice(0, 4);
  $id("bag-suggest").hidden = picks.length === 0;
  $id("bag-suggest-grid").innerHTML = picks.map(productCard).join("");
  if (typeof refreshWishlistIcons === "function") refreshWishlistIcons();
}

/* ---------- rendering: delivery ---------- */
function addressCardHTML(a) {
  const checked = a.id === checkout.selectedAddressId;
  return `
    <label class="nf-address${checked ? " is-selected" : ""}">
      <input type="radio" name="delivery-address" value="${escapeHtml(a.id)}" ${checked ? "checked" : ""}>
      <span class="nf-address-body">
        <span class="nf-address-label">${escapeHtml(a.label || "Address")}${a.is_default ? ` <span class="nf-address-default">Default</span>` : ""}</span>
        <strong>${escapeHtml(a.full_name)}</strong>
        <span>${escapeHtml(a.address_line1)}${a.address_line2 ? `, ${escapeHtml(a.address_line2)}` : ""}</span>
        <span>${escapeHtml(a.city)}${a.region ? `, ${escapeHtml(a.region)}` : ""}, ${escapeHtml(a.country)}</span>
        ${a.phone ? `<span class="nf-address-phone"><i class="fa-solid fa-phone" aria-hidden="true"></i> ${escapeHtml(a.phone)}</span>` : ""}
      </span>
    </label>`;
}

function addressFormHTML() {
  const first = checkout.addresses.length === 0;
  return `
    <form class="nf-address-form" id="address-form" novalidate>
      <h3>${first ? "Where should we deliver?" : "New address"}</h3>
      <div class="nf-form-grid">
        <div class="nf-field"><label for="addr-name">Full name <span aria-hidden="true">*</span></label><input id="addr-name" autocomplete="name" required maxlength="150"></div>
        <div class="nf-field"><label for="addr-phone">Phone</label><input id="addr-phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20"></div>
        <div class="nf-field nf-field--wide"><label for="addr-line1">Address <span aria-hidden="true">*</span></label><input id="addr-line1" autocomplete="address-line1" required maxlength="255" placeholder="House number, street, area"></div>
        <div class="nf-field nf-field--wide"><label for="addr-line2">Landmark / apartment <span class="nf-optional">(optional)</span></label><input id="addr-line2" autocomplete="address-line2" maxlength="255"></div>
        <div class="nf-field"><label for="addr-city">City / town <span aria-hidden="true">*</span></label><input id="addr-city" autocomplete="address-level2" required maxlength="100"></div>
        <div class="nf-field"><label for="addr-region">Region</label><input id="addr-region" autocomplete="address-level1" maxlength="100"></div>
        <div class="nf-field"><label for="addr-country">Country <span aria-hidden="true">*</span></label><input id="addr-country" autocomplete="country-name" required maxlength="100" value="Ghana"></div>
        <div class="nf-field"><label for="addr-label">Save as</label><input id="addr-label" maxlength="30" placeholder="Home, Work…"></div>
      </div>
      <p class="nf-form-error" id="addr-error" role="alert" hidden></p>
      <div class="nf-form-actions">
        <button type="submit" class="btn btn-primary btn-sm" id="save-address-btn">Save address</button>
        ${first ? "" : `<button type="button" class="btn btn-outline btn-sm" data-action="cancel-address">Cancel</button>`}
      </div>
    </form>`;
}

function renderDelivery() {
  const body = $id("delivery-body");
  if (typeof isLoggedIn !== "function" || !isLoggedIn()) {
    body.innerHTML = `
      <div class="nf-signin-prompt">
        <p>Sign in to choose a delivery address and pay. Your bag will be waiting.</p>
        <div class="nf-signin-actions">
          <a class="btn btn-primary btn-sm" href="login.html?redirect=cart.html">Log in</a>
          <a class="btn btn-outline btn-sm" href="register.html">Create an account</a>
        </div>
      </div>`;
    return;
  }
  if (!checkout.addressesLoaded) {
    body.innerHTML = `<div class="nf-address nf-address--skeleton" aria-hidden="true"><span class="skeleton-shimmer"></span></div><p class="sr-only">Loading your addresses…</p>`;
    return;
  }
  const list = checkout.addresses.length
    ? `<div class="nf-address-list" role="radiogroup" aria-label="Saved addresses">${checkout.addresses.map(addressCardHTML).join("")}</div>`
    : "";
  const showForm = checkout.addressFormOpen || checkout.addresses.length === 0;
  body.innerHTML = list +
    (showForm ? addressFormHTML() : `<button type="button" class="nf-add-address" data-action="add-address"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add a new address</button>`);
}

/* ---------- rendering: summary ---------- */
function blockingReason(lines) {
  if (lines.some(l => l.issues.length)) return { text: "Resolve the highlighted items in your bag to continue.", target: "bag-panel" };
  if (checkout.quoteError) return { text: checkout.quoteError.error, target: "bag-panel" };
  if (!checkout.quote) return { text: checkout.quoteLoading ? "Calculating your total…" : "We couldn't calculate your total yet.", target: null };
  if (typeof isLoggedIn !== "function" || !isLoggedIn()) return { text: "Log in to choose a delivery address and pay.", target: "delivery-panel", login: true };
  if (!checkout.selectedAddressId) return { text: "Add or choose a delivery address to continue.", target: "delivery-panel" };
  return null;
}

function renderSummary(lines) {
  const q = checkout.quote;
  const set = (id, text) => { $id(id).textContent = text; };
  if (q) {
    set("summary-subtotal", money(q.subtotal));
    set("summary-shipping", q.shipping ? money(q.shipping) : "Free");
    set("summary-total", money(q.total));
    const offerSavings = q.lines.reduce((s, l) => s + Math.max(0, l.regularUnitPrice - l.unitPrice) * l.qty, 0);
    $id("summary-offer-row").hidden = offerSavings <= 0;
    set("summary-offer-savings", `−${money(offerSavings)}`);
    $id("summary-discount-row").hidden = !(q.discount > 0);
    set("summary-discount", `−${money(q.discount)}`);
    set("summary-discount-label", q.coupon ? `Promo (${q.coupon.code})` : "Promo code");
    const saving = offerSavings + q.discount;
    set("summary-note", saving > 0 ? `You're saving ${money(saving)} on this order.` : "");
    set("paybar-total", money(q.total));
  } else {
    ["summary-subtotal", "summary-shipping", "summary-total", "paybar-total"].forEach(id => set(id, checkout.quoteLoading ? "…" : "—"));
    $id("summary-offer-row").hidden = true;
    $id("summary-discount-row").hidden = true;
    set("summary-note", "");
  }
  $id("totals").classList.toggle("is-loading", checkout.quoteLoading);

  // Coupon chip
  const applied = $id("promo-applied");
  applied.hidden = !checkout.coupon;
  applied.innerHTML = checkout.coupon
    ? `<span><i class="fa-solid fa-tag" aria-hidden="true"></i> <strong>${escapeHtml(checkout.coupon.code)}</strong> applied</span><button type="button" class="nf-link-btn" id="remove-coupon-btn">Remove</button>`
    : "";
  $id("promo").hidden = !!checkout.coupon;

  // Pay buttons
  const reason = blockingReason(lines);
  const ready = !reason && !checkout.paying;
  const label = checkout.paying ? "Starting payment…" : q && !reason ? `Pay ${money(q.total)}` : reason?.login ? "Log in to pay" : "Pay securely";
  [$id("checkout-btn"), $id("sticky-checkout-btn")].forEach(b => {
    b.disabled = !ready && !reason?.login;
    b.setAttribute("aria-disabled", String(!ready && !reason?.login));
  });
  $id("checkout-btn-label").textContent = label;
  $id("paybar-label").textContent = checkout.paying ? "Starting…" : q && !reason ? `Pay ${money(q.total)}` : reason?.login ? "Log in to pay" : "Pay";
  $id("pay-hint").textContent = reason ? reason.text : "You'll confirm the payment on Paystack.";
  $id("pay-hint").classList.toggle("is-warning", !!reason && !checkout.quoteLoading);

  renderSteps(lines, reason);
}

function renderSteps(lines, reason) {
  const bagOk = lines.length && !lines.some(l => l.issues.length) && !checkout.quoteError;
  const deliveryOk = bagOk && isLoggedIn() && !!checkout.selectedAddressId;
  const current = !bagOk ? "bag" : !deliveryOk ? "delivery" : "payment";
  document.querySelectorAll("#steps-bar li").forEach(li => {
    const step = li.dataset.step;
    const done = (step === "bag" && bagOk) || (step === "delivery" && deliveryOk);
    li.classList.toggle("is-done", done && step !== current);
    li.classList.toggle("is-current", step === current);
    if (step === current) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
}

function showAlert(message) {
  const el = $id("summary-alert");
  el.hidden = !message;
  el.textContent = message || "";
}

function renderAll() {
  const lines = renderBag();
  if (!lines.length) return;
  renderDelivery();
  renderSummary(lines);
}

/* ---------- server quote ---------- */
let quoteTimer = null;
function scheduleQuote(delay = 200) {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(requestQuote, delay);
}

async function requestQuote({ couponCode = null } = {}) {
  const lines = cartLines();
  if (!lines.length) { checkout.quote = null; checkout.quoteError = null; renderAll(); return null; }
  // Don't ask the server to price lines we already know it will reject.
  if (lines.some(l => l.issues.length)) { checkout.quote = null; checkout.quoteError = null; checkout.quoteLoading = false; renderAll(); return null; }

  const seq = ++checkout.quoteSeq;
  checkout.quoteLoading = true;
  renderSummary(lines);
  try {
    const res = await fetch(`${API_BASE}/api/cart/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map(l => ({ productId: l.item.id, qty: l.item.qty, offerId: l.item.offerId || null })),
        ...(couponCode ? { couponCode } : checkout.coupon ? { couponId: checkout.coupon.id } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (seq !== checkout.quoteSeq) return null; // a newer request superseded this one
    checkout.quoteLoading = false;
    if (!res.ok) {
      // A coupon that is no longer valid is dropped; other problems block checkout.
      if (/^COUPON_/.test(data.code || "")) {
        if (!couponCode) { setCoupon(null); setTimeout(() => scheduleQuote(0), 0); }
        checkout.quoteError = null;
        renderAll();
        return { couponError: data.error || "That promo code can't be used." };
      }
      checkout.quote = null;
      checkout.quoteError = { code: data.code || "QUOTE_FAILED", error: data.error || "We couldn't calculate your total.", productId: data.productId };
      if (["OFFER_UNAVAILABLE", "INSUFFICIENT_STOCK", "PRODUCT_UNAVAILABLE"].includes(data.code)) {
        // Product/offer state changed on the server: refresh our data so the bag shows the fix.
        await refreshCatalogState();
      }
      renderAll();
      return null;
    }
    checkout.quote = data;
    checkout.quoteError = null;
    if (couponCode && data.coupon) setCoupon(data.coupon);
    renderAll();
    return data;
  } catch (err) {
    if (seq !== checkout.quoteSeq) return null;
    checkout.quoteLoading = false;
    checkout.quote = null;
    checkout.quoteError = { code: "NETWORK", error: "We couldn't reach the server to calculate your total. Check your connection and try again." };
    renderAll();
    return null;
  }
}

async function refreshCatalogState() {
  nfActiveOffersPromise = null;      // force a fresh offers fetch
  await nfLoadActiveOffers();
  applyLowestOffers();
}

/* ---------- coupon ---------- */
function setCoupon(coupon) {
  checkout.coupon = coupon;
  try {
    if (coupon) sessionStorage.setItem(COUPON_SESSION_KEY, JSON.stringify(coupon));
    else sessionStorage.removeItem(COUPON_SESSION_KEY);
  } catch (e) { /* ignore */ }
}

async function applyCoupon() {
  const input = $id("coupon-input");
  const msg = $id("coupon-msg");
  const code = input.value.trim();
  if (!code) { msg.textContent = "Enter a promo code."; msg.className = "nf-promo-msg is-error"; input.focus(); return; }
  const btn = $id("apply-coupon-btn");
  btn.disabled = true;
  btn.textContent = "Applying…";
  msg.textContent = "";
  const result = await requestQuote({ couponCode: code });
  btn.disabled = false;
  btn.textContent = "Apply";
  if (result && result.couponError) {
    msg.textContent = result.couponError;
    msg.className = "nf-promo-msg is-error";
  } else if (checkout.coupon) {
    input.value = "";
    msg.textContent = "";
    if (typeof showToast === "function") showToast(`Promo code ${checkout.coupon.code} applied`);
  } else if (checkout.quoteError) {
    msg.textContent = "Fix the items in your bag first, then apply your code.";
    msg.className = "nf-promo-msg is-error";
  }
}

/* ---------- addresses ---------- */
async function loadAddresses() {
  if (!isLoggedIn()) return;
  try {
    const res = await fetch(`${API_BASE}/api/addresses`, { headers: { Authorization: `Bearer ${getAuth().token}` } });
    if (res.status === 401) { handleExpiredSession(); return; }
    checkout.addresses = res.ok ? await res.json() : [];
  } catch (err) {
    checkout.addresses = [];
  }
  checkout.addressesLoaded = true;
  if (!checkout.addresses.some(a => a.id === checkout.selectedAddressId)) {
    const preferred = checkout.addresses.find(a => a.is_default) || checkout.addresses[0];
    checkout.selectedAddressId = preferred ? preferred.id : null;
  }
  renderAll();
}

async function saveAddress(e) {
  e.preventDefault();
  const v = id => $id(id).value.trim();
  const payload = {
    label: v("addr-label") || "Home",
    fullName: v("addr-name"),
    phone: v("addr-phone"),
    addressLine1: v("addr-line1"),
    addressLine2: v("addr-line2"),
    city: v("addr-city"),
    region: v("addr-region"),
    country: v("addr-country"),
    isDefault: checkout.addresses.length === 0,
  };
  const err = $id("addr-error");
  const missing = [["addr-name", payload.fullName], ["addr-line1", payload.addressLine1], ["addr-city", payload.city], ["addr-country", payload.country]].filter(([, val]) => !val);
  document.querySelectorAll("#address-form [aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  if (missing.length) {
    missing.forEach(([id]) => $id(id).setAttribute("aria-invalid", "true"));
    err.hidden = false;
    err.textContent = "Please fill in the required fields.";
    $id(missing[0][0]).focus();
    return;
  }
  const btn = $id("save-address-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetch(`${API_BASE}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuth().token}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { handleExpiredSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save the address.");
    checkout.selectedAddressId = data.id;
    checkout.addressFormOpen = false;
    await loadAddresses();
    if (typeof showToast === "function") showToast("Address saved");
  } catch (error) {
    err.hidden = false;
    err.textContent = error.message;
    btn.disabled = false;
    btn.textContent = "Save address";
  }
}

function handleExpiredSession() {
  if (typeof clearAuth === "function") clearAuth();
  showAlert("Your session has expired. Please log in again — your bag is saved.");
  checkout.addresses = [];
  checkout.addressesLoaded = false;
  checkout.selectedAddressId = null;
  renderAll();
}

/* ---------- payment ---------- */
async function startPayment() {
  const lines = cartLines();
  const reason = blockingReason(lines);
  if (reason?.login) { window.location.href = "login.html?redirect=cart.html"; return; }
  if (reason || checkout.paying) {
    if (reason?.target) document.getElementById(reason.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  checkout.paying = true;
  showAlert("");
  renderSummary(lines);
  try {
    const res = await fetch(`${API_BASE}/api/payments/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuth().token}` },
      body: JSON.stringify({
        items: lines.map(l => ({ productId: l.item.id, qty: l.item.qty, offerId: l.item.offerId || null })),
        addressId: checkout.selectedAddressId,
        couponId: checkout.coupon ? checkout.coupon.id : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { checkout.paying = false; handleExpiredSession(); return; }
    if (!res.ok) {
      checkout.paying = false;
      showAlert(data.error || "We couldn't start the payment. Please try again.");
      if (/^COUPON_/.test(data.code || "")) setCoupon(null);
      if (data.code === "INVALID_ADDRESS") await loadAddresses();
      if (["OFFER_UNAVAILABLE", "INSUFFICIENT_STOCK", "PRODUCT_UNAVAILABLE"].includes(data.code)) await refreshCatalogState();
      await requestQuote();
      return;
    }
    // The server re-priced the order; show the amount it will charge.
    if (data.quote) { checkout.quote = data.quote; renderSummary(lines); }
    $id("redirect-text").textContent = data.quote
      ? `You'll pay ${money(data.quote.total)} on Paystack's secure page.`
      : "You'll complete your payment on Paystack's secure page.";
    $id("redirect-overlay").hidden = false;
    $id("redirect-overlay").querySelector(".nf-redirect-card").focus?.();
    window.location.assign(data.authorizationUrl);
  } catch (err) {
    checkout.paying = false;
    showAlert("We couldn't reach the server. Check your connection and try again.");
    renderSummary(lines);
  }
}

/* ---------- events ---------- */
function bindCheckoutEvents() {
  $id("cart-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "undo" && checkout.removed) {
      const r = checkout.removed;
      checkout.removed = null;
      // Not saved: keep the undo available so the shopper can try again.
      if (!addToCart(r.id, r.qty, r.offerId)) {
        checkout.removed = r;
        if (typeof showToast === "function") showToast(CART_SAVE_ERROR, "error");
      }
      return;
    }
    const row = btn.closest(".nf-line");
    if (!row) return;
    const id = Number(row.dataset.id);
    const offerId = row.dataset.offerId ? Number(row.dataset.offerId) : null;
    const item = getCart().find(i => i.id === id && (i.offerId || null) === offerId);
    if (!item) return;
    const action = btn.dataset.action;
    if (action === "inc") updateQty(id, item.qty + 1, offerId);
    else if (action === "dec") updateQty(id, item.qty - 1, offerId);
    else if (action === "cap") updateQty(id, Number(btn.dataset.qty), offerId);
    else if (action === "drop-offer") dropOfferFromLine(id, offerId);
    else if (action === "remove") {
      const product = PRODUCTS.find(p => p.id === id);
      checkout.removed = { id, qty: item.qty, offerId, name: product ? product.name : "Item" };
      removeFromCart(id, offerId);
      setTimeout(() => $id("bag-title")?.focus?.(), 0);
    }
    // Keep keyboard focus on the same control after the line re-renders.
    if (action === "inc" || action === "dec") {
      requestAnimationFrame(() => {
        const sel = `.nf-line[data-id="${id}"][data-offer-id="${offerId || ""}"] [data-action="${action}"]`;
        const again = document.querySelector(sel);
        (again && !again.disabled ? again : document.querySelector(`.nf-line[data-id="${id}"] output`))?.focus?.();
      });
    }
  });
  $id("bag-title").setAttribute("tabindex", "-1");

  // Any cart change (here, another tab or Undo) → re-render + re-price.
  document.addEventListener("cartChanged", () => { renderAll(); scheduleQuote(); });
  window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { renderAll(); scheduleQuote(); } });

  $id("delivery-body").addEventListener("change", (e) => {
    if (e.target.name !== "delivery-address") return;
    checkout.selectedAddressId = Number(e.target.value);
    renderAll();
  });
  $id("delivery-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "add-address") { checkout.addressFormOpen = true; renderDelivery(); $id("addr-name")?.focus(); }
    if (btn.dataset.action === "cancel-address") { checkout.addressFormOpen = false; renderDelivery(); $id("delivery-body").querySelector("[data-action=add-address]")?.focus(); }
  });
  $id("delivery-body").addEventListener("submit", (e) => { if (e.target.id === "address-form") saveAddress(e); });

  $id("apply-coupon-btn").addEventListener("click", applyCoupon);
  $id("coupon-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } });
  $id("order-summary").addEventListener("click", (e) => {
    if (e.target.id === "remove-coupon-btn") { setCoupon(null); $id("coupon-msg").textContent = ""; requestQuote(); }
  });

  $id("checkout-btn").addEventListener("click", startPayment);
  $id("sticky-checkout-btn").addEventListener("click", startPayment);

  // Returning via the browser's Back button from Paystack restores a usable page.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) { checkout.paying = false; $id("redirect-overlay").hidden = true; renderAll(); scheduleQuote(0); }
  });
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  if (!$id("cart-list")) return;
  try { const saved = JSON.parse(sessionStorage.getItem(COUPON_SESSION_KEY)); if (saved && Number.isInteger(saved.id)) checkout.coupon = saved; } catch (e) { /* ignore */ }
  bindCheckoutEvents();
  nfLoadActiveOffers();
  if (isLoggedIn()) loadAddresses();
});

document.addEventListener("productsReady", async (e) => {
  if (!$id("cart-list")) return;
  if (e.detail.error) {
    $id("cart-list").innerHTML = `<div class="nf-empty nf-empty--error" role="alert"><h2>We couldn't load your bag</h2><p>Please check your connection and try again.</p><div class="nf-empty-actions"><button type="button" class="btn btn-primary btn-sm" onclick="loadProducts()">Try again</button></div></div>`;
    return;
  }
  await nfLoadActiveOffers();
  applyLowestOffers();
  renderAll();
  requestQuote();
});
