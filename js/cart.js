/* ============================================
   NeoFragrances — cart.js (shared, every page)
   Cart storage in localStorage, the header cart
   count, and the global "Add to Cart" handler.

   Cart lines: { id: productId, qty, offerId|null }.
   A line added from an offer keeps its offerId so the
   server can apply that offer's price — the server
   (POST /api/cart/quote, /api/payments/initialize)
   is the only source of prices and totals.

   The cart/checkout page itself is js/cart-page.js.
   ============================================ */

const CART_KEY = "neofragrances_cart";
const CART_MAX_QTY_PER_LINE = 50; // mirrors the server's per-line limit

function getCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY));
    if (!Array.isArray(cart)) return [];
    // Drop anything malformed (e.g. edited storage) rather than sending it to checkout.
    return cart.filter(i => i && Number.isInteger(i.id) && Number.isInteger(i.qty) && i.qty > 0)
      .map(i => ({ id: i.id, qty: Math.min(i.qty, CART_MAX_QTY_PER_LINE), offerId: Number.isInteger(i.offerId) ? i.offerId : null }));
  } catch (e) {
    return [];
  }
}

// Returns true only when the cart is really stored: written, then read back unchanged.
// (Private modes, full storage or blocked site data make the write throw or not stick.)
function saveCart(cart) {
  const json = JSON.stringify(cart);
  let saved = false;
  try {
    localStorage.setItem(CART_KEY, json);
    saved = localStorage.getItem(CART_KEY) === json;
  } catch (e) { /* storage unavailable */ }
  updateCartCount();
  if (saved) document.dispatchEvent(new CustomEvent("cartChanged"));
  return saved;
}

const CART_SAVE_ERROR = "We couldn't add this to your bag — your browser isn't allowing this site to save data. Please check your privacy settings and try again.";

function clearCart() {
  try { localStorage.removeItem(CART_KEY); } catch (e) { /* ignore */ }
  updateCartCount();
  document.dispatchEvent(new CustomEvent("cartChanged"));
}

function sameLine(item, productId, offerId) {
  return item.id === productId && (item.offerId || null) === (offerId || null);
}

function addToCart(productId, qty = 1, offerId = null) {
  const cart = getCart();
  const existing = cart.find(item => sameLine(item, productId, offerId));
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, CART_MAX_QTY_PER_LINE);
  } else {
    cart.push({ id: productId, qty: Math.min(qty, CART_MAX_QTY_PER_LINE), offerId: offerId || null });
  }
  return saveCart(cart);
}

function removeFromCart(productId, offerId = null) {
  return saveCart(getCart().filter(item => !sameLine(item, productId, offerId)));
}

// The "✓ Added" confirmation on an add-to-cart button, used only after addToCart() returned
// true. The width is held while the label is swapped so nothing around the button shifts.
function showAddedState(btn, restoreHTML) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = restoreHTML || btn.innerHTML;
  if (!btn.classList.contains("is-added")) btn.style.minWidth = `${btn.getBoundingClientRect().width}px`;
  btn.innerHTML = `<i class="fa-solid fa-check nf-added-check" aria-hidden="true"></i>&nbsp; Added`;
  btn.classList.add("is-added");
  clearTimeout(btn._addedTimer);
  btn._addedTimer = setTimeout(() => {
    btn.innerHTML = btn.dataset.label;
    btn.classList.remove("is-added");
    btn.style.minWidth = "";
  }, 1600);
}

function updateQty(productId, qty, offerId = null) {
  const cart = getCart();
  const item = cart.find(i => sameLine(i, productId, offerId));
  if (item) {
    item.qty = Math.max(1, Math.min(Math.floor(qty), CART_MAX_QTY_PER_LINE));
    saveCart(cart);
  }
}

// Moves a line in `cart` onto another offer (toOfferId null = the regular price),
// merging with a line already on it. Changes the array only; returns true if it moved.
function moveLineOffer(cart, productId, offerId, toOfferId) {
  const line = cart.find(i => sameLine(i, productId, offerId));
  if (!line) return false;
  const target = cart.find(i => sameLine(i, productId, toOfferId));
  if (target) {
    target.qty = Math.min(target.qty + line.qty, CART_MAX_QTY_PER_LINE);
    cart.splice(cart.indexOf(line), 1);
  } else {
    line.offerId = toOfferId || null;
  }
  return true;
}

// Moves a line off an offer that has ended, merging with an existing regular line.
function dropOfferFromLine(productId, offerId) {
  const cart = getCart();
  if (moveLineOffer(cart, productId, offerId, null)) saveCart(cart);
}

function cartItemCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function updateCartCount() {
  const badges = document.querySelectorAll(".cart-count");
  if (!badges.length) return;
  const total = cartItemCount();
  badges.forEach(badge => {
    badge.textContent = total;
    badge.style.display = total > 0 ? "flex" : "none";
  });
  document.querySelectorAll(".nf-cart-link").forEach(link => {
    link.setAttribute("aria-label", total ? `Cart, ${total} item${total !== 1 ? "s" : ""}` : "Cart, empty");
  });
}

// Show the real count on every page load (the header renders with 0).
document.addEventListener("DOMContentLoaded", updateCartCount);
// Keep tabs in sync when the cart changes in another tab.
window.addEventListener("storage", (e) => { if (e.key === CART_KEY) updateCartCount(); });

// Global "Add to Cart" for every product card / offer card / spotlight.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".add-to-cart");
  if (!btn || btn.disabled) return;
  const productId = Number(btn.dataset.id);
  if (!Number.isInteger(productId)) return;
  const offerId = btn.dataset.offerId ? Number(btn.dataset.offerId) : null;
  // Confirm only what really happened: no "Added" unless the cart was saved.
  if (!addToCart(productId, 1, offerId)) {
    if (typeof showToast === "function") showToast(CART_SAVE_ERROR, "error");
    return;
  }
  showAddedState(btn);
  if (typeof showToast === "function") showToast("Added to cart");
});
