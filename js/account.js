/* ============================================
   NeoFragrances — account.js (my-account.html)
   Overview · Profile · Orders · Addresses ·
   Wishlist · Security. Every value shown comes
   from the API for the logged-in customer
   (GET /api/me, /api/my-orders, /api/addresses,
   /api/wishlist). Sections are #hash routes.

   Uses: nfAuthFetch, updateSavedUser, logoutUser,
   isLoggedIn, nfLoginRedirectUrl (auth.js);
   orders-common.js helpers; addToCart (cart.js);
   WISHLIST_IDS (wishlist.js); main.js helpers.
   ============================================ */

const ACCOUNT_SECTIONS = ["overview", "profile", "orders", "addresses", "wishlist", "security"];
const acct = {
  me: null,
  orders: null, addresses: null, wishlist: null,   // null = not loaded yet
  errors: {},
  ordersFilter: "all", ordersQuery: "",
  editingAddressId: null, addressFormOpen: false,
  profileEditing: false,
};
const $a = id => document.getElementById(id);

/* ---------- confirmation dialog (focus-trapped) ---------- */
function confirmDialog({ title, text, okLabel = "Confirm" }) {
  return new Promise(resolve => {
    const backdrop = $a("confirm-dialog");
    const ok = $a("confirm-ok"), cancel = $a("confirm-cancel");
    const returnTo = document.activeElement;
    $a("confirm-title").textContent = title;
    $a("confirm-text").textContent = text;
    ok.textContent = okLabel;
    backdrop.hidden = false;
    cancel.focus();
    const close = result => {
      backdrop.hidden = true;
      document.removeEventListener("keydown", onKey);
      ok.onclick = cancel.onclick = backdrop.onclick = null;
      returnTo?.focus?.();
      resolve(result);
    };
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      if (e.key === "Tab") { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
    };
    document.addEventListener("keydown", onKey);
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    backdrop.onclick = e => { if (e.target === backdrop) close(false); };
  });
}

/* ---------- small helpers ---------- */
function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || "there"; }
function loadingBlock(rows = 3) { return `<div class="nf-acc-skeleton" aria-hidden="true">${"<span class=\"skeleton-shimmer\"></span>".repeat(rows)}</div><p class="sr-only" role="status">Loading…</p>`; }
function errorBlock(message, retry) {
  return `<div class="nf-acc-state nf-acc-state--error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(message)}</p>${retry ? `<button type="button" class="btn btn-outline btn-sm" data-retry="${retry}">Try again</button>` : ""}</div>`;
}
function emptyBlock({ icon, title, text, action }) {
  return `<div class="nf-acc-state"><i class="${icon}" aria-hidden="true"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action || ""}</div>`;
}
function fieldError(form, field, message) {
  form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  const status = form.querySelector(".nf-form-status");
  if (status) { status.textContent = message || ""; status.className = `nf-form-status${message ? " is-error" : ""}`; }
  if (field) { const el = form.querySelector(`[name="${field}"]`); if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } }
}
function formOk(form, message) {
  const status = form.querySelector(".nf-form-status");
  if (status) { status.textContent = message; status.className = "nf-form-status is-ok"; }
}
async function readJson(res) { try { return await res.json(); } catch (e) { return {}; } }

/* ---------- data loaders ---------- */
async function loadMe() {
  const res = await nfAuthFetch("/api/me");
  if (!res.ok) throw new Error("Could not load your profile.");
  acct.me = await res.json();
  updateSavedUser({ full_name: acct.me.full_name, email: acct.me.email });
}
async function loadOrders() {
  try {
    const res = await nfAuthFetch("/api/my-orders");
    if (!res.ok) throw new Error();
    acct.orders = await res.json(); acct.errors.orders = null;
  } catch (e) { if (e.message !== "Session expired") acct.errors.orders = "We couldn't load your orders."; }
}
async function loadAddresses() {
  try {
    const res = await nfAuthFetch("/api/addresses");
    if (!res.ok) throw new Error();
    acct.addresses = await res.json(); acct.errors.addresses = null;
  } catch (e) { if (e.message !== "Session expired") acct.errors.addresses = "We couldn't load your addresses."; }
}
async function loadWishlistItems() {
  try {
    const res = await nfAuthFetch("/api/wishlist");
    if (!res.ok) throw new Error();
    acct.wishlist = await res.json(); acct.errors.wishlist = null;
    if (typeof WISHLIST_IDS !== "undefined") WISHLIST_IDS = new Set(acct.wishlist.map(p => p.id));
  } catch (e) { if (e.message !== "Session expired") acct.errors.wishlist = "We couldn't load your wishlist."; }
}

/* ---------- Overview ---------- */
function renderOverview() {
  const body = $a("overview-body");
  if (!acct.me) { body.innerHTML = loadingBlock(); return; }
  const me = acct.me;
  const count = (list, err) => err ? "—" : list === null ? "…" : String(list.length);
  const recent = (acct.orders || []).slice(0, 3);
  body.innerHTML = `
    <div class="nf-overview-id">
      <div>
        <p class="nf-overview-name">${escapeHtml(me.full_name)}</p>
        <p class="nf-overview-email">${escapeHtml(me.email)} ${me.email_verified ? `<span class="nf-verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified</span>` : `<span class="nf-unverified">Not verified</span>`}</p>
      </div>
      ${me.member_since ? `<p class="nf-overview-since">Member since ${escapeHtml(new Date(me.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}</p>` : ""}
    </div>
    <div class="nf-overview-tiles">
      <a class="nf-tile" href="#orders"><span class="nf-tile-num">${count(acct.orders, acct.errors.orders)}</span><span class="nf-tile-label">Orders</span></a>
      <a class="nf-tile" href="#addresses"><span class="nf-tile-num">${count(acct.addresses, acct.errors.addresses)}</span><span class="nf-tile-label">Saved addresses</span></a>
      <a class="nf-tile" href="#wishlist"><span class="nf-tile-num">${count(acct.wishlist, acct.errors.wishlist)}</span><span class="nf-tile-label">Wishlist</span></a>
    </div>
    <div class="nf-acc-block">
      <div class="nf-acc-block-head"><h3>Recent orders</h3>${recent.length ? `<a href="#orders" class="nf-text-link">All orders <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>` : ""}</div>
      ${acct.errors.orders ? errorBlock(acct.errors.orders, "orders") : acct.orders === null ? loadingBlock(2) : recent.length ? `<ul class="nf-order-list">${recent.map(orderRowHTML).join("")}</ul>` : emptyBlock({ icon: "fa-solid fa-receipt", title: "No orders yet", text: "When you place an order, it will appear here with its status.", action: `<a href="products.html" class="btn btn-primary btn-sm">Start shopping</a>` })}
    </div>`;
}

/* ---------- Profile ---------- */
function renderProfile() {
  const body = $a("profile-body");
  if (!acct.me) { body.innerHTML = loadingBlock(); return; }
  const me = acct.me;
  if (!acct.profileEditing) {
    body.innerHTML = `
      <dl class="nf-detail-list">
        <div><dt>Full name</dt><dd>${escapeHtml(me.full_name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(me.email)} ${me.email_verified ? `<span class="nf-verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified</span>` : ""}</dd></div>
        <div><dt>Phone</dt><dd>${me.phone ? escapeHtml(me.phone) : `<span class="nf-muted">Not added</span>`}</dd></div>
        ${me.member_since ? `<div><dt>Member since</dt><dd>${escapeHtml(formatOrderDate(me.member_since))}</dd></div>` : ""}
      </dl>
      <div class="nf-acc-actions"><button type="button" class="btn btn-outline btn-sm" data-action="edit-profile">Edit profile</button></div>
      <p class="nf-acc-note">Need to change your email address? <a href="contact.html">Contact us</a> and we'll help.</p>`;
    return;
  }
  body.innerHTML = `
    <form class="nf-acc-form" id="profile-form" novalidate>
      <div class="nf-form-grid">
        <div class="nf-field nf-field--wide"><label for="pf-name">Full name</label><input id="pf-name" name="fullName" autocomplete="name" maxlength="150" required value="${escapeHtml(me.full_name)}"></div>
        <div class="nf-field"><label for="pf-phone">Phone <span class="nf-optional">(optional)</span></label><input id="pf-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${escapeHtml(me.phone || "")}"></div>
        <div class="nf-field"><label for="pf-email">Email</label><input id="pf-email" type="email" value="${escapeHtml(me.email)}" readonly aria-describedby="pf-email-note"><span class="nf-field-note" id="pf-email-note">Email changes aren't available here yet.</span></div>
      </div>
      <p class="nf-form-status" role="status"></p>
      <div class="nf-acc-actions">
        <button type="submit" class="btn btn-primary btn-sm">Save changes</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="cancel-profile">Cancel</button>
      </div>
    </form>`;
  $a("pf-name").focus();
}

async function saveProfile(form) {
  const btn = form.querySelector("[type=submit]");
  const fullName = form.fullName.value.trim(), phone = form.phone.value.trim();
  if (fullName.length < 2) return fieldError(form, "fullName", "Please enter your full name.");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const res = await nfAuthFetch("/api/me", { method: "PATCH", body: JSON.stringify({ fullName, phone }) });
    const data = await readJson(res);
    if (!res.ok) { fieldError(form, data.field, data.error || "Could not save your profile."); return; }
    acct.me = data;
    updateSavedUser({ full_name: data.full_name });
    acct.profileEditing = false;
    renderProfile(); renderGreeting();
    if (typeof showToast === "function") showToast("Profile updated");
    document.querySelector("#profile-body [data-action=edit-profile]")?.focus();
  } catch (e) {
    if (e.message !== "Session expired") fieldError(form, null, "We couldn't reach the server. Please try again.");
  } finally { btn.disabled = false; btn.textContent = "Save changes"; }
}

/* ---------- Orders ---------- */
function orderRowHTML(o) {
  const items = o.items || [];
  const thumbs = items.slice(0, 3).map(i => `<span class="nf-order-thumb">${productMedia(i.image, "")}</span>`).join("");
  const more = items.length > 3 ? `<span class="nf-order-thumb nf-order-more">+${items.length - 3}</span>` : "";
  const count = orderItemsCount(o);
  return `
    <li class="nf-order-row">
      <a class="nf-order-link" href="order.html?id=${encodeURIComponent(o.id)}" aria-label="Order ${escapeHtml(o.id)}, ${escapeHtml(orderStatusMeta(o.status).label)}, ${escapeHtml(money(o.total))}">
        <span class="nf-order-thumbs" aria-hidden="true">${thumbs}${more}</span>
        <span class="nf-order-main">
          <span class="nf-order-no">Order #${escapeHtml(o.id)}</span>
          <span class="nf-order-meta">${escapeHtml(formatOrderDate(o.created_at))} · ${count} item${count !== 1 ? "s" : ""}</span>
        </span>
        <span class="nf-order-side">${orderStatusBadge(o.status)}<span class="nf-order-total">${money(o.total)}</span></span>
        <i class="fa-solid fa-chevron-right nf-order-chev" aria-hidden="true"></i>
      </a>
    </li>`;
}

function renderOrders() {
  const body = $a("orders-body");
  if (acct.errors.orders) { body.innerHTML = errorBlock(acct.errors.orders, "orders"); return; }
  if (acct.orders === null) { body.innerHTML = loadingBlock(); return; }
  if (!acct.orders.length) {
    body.innerHTML = emptyBlock({ icon: "fa-solid fa-receipt", title: "No orders yet", text: "Orders you place will appear here so you can follow and reorder them.", action: `<a href="products.html" class="btn btn-primary btn-sm">Explore fragrances</a>` });
    return;
  }
  const statuses = [...new Set(acct.orders.map(o => String(o.status || "").toLowerCase()))];
  const q = NFCatalog.normalize(acct.ordersQuery);
  const list = acct.orders.filter(o => {
    if (acct.ordersFilter !== "all" && String(o.status).toLowerCase() !== acct.ordersFilter) return false;
    if (!q) return true;
    return String(o.id).includes(q.replace(/^#/, "")) || (o.items || []).some(i => NFCatalog.normalize(`${i.name} ${i.brand || ""}`).includes(q));
  });
  const focusedSearch = document.activeElement?.id === "orders-search";
  body.innerHTML = `
    <div class="nf-orders-tools">
      <div class="nf-acc-search">
        <label for="orders-search" class="sr-only">Search orders by number or product</label>
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" id="orders-search" placeholder="Search by order number or product" value="${escapeHtml(acct.ordersQuery)}">
      </div>
      ${statuses.length > 1 ? `<div class="nf-chip-row" role="group" aria-label="Filter by status">
        ${["all", ...statuses].map(s => `<button type="button" class="nf-chip-filter" data-status="${escapeHtml(s)}" aria-pressed="${acct.ordersFilter === s}">${escapeHtml(s === "all" ? "All" : orderStatusMeta(s).label)}</button>`).join("")}
      </div>` : ""}
    </div>
    <p class="sr-only" role="status">${list.length} order${list.length !== 1 ? "s" : ""} shown</p>
    ${list.length ? `<ul class="nf-order-list">${list.map(orderRowHTML).join("")}</ul>` : emptyBlock({ icon: "fa-solid fa-magnifying-glass", title: "No matching orders", text: "Try a different order number, product or status.", action: `<button type="button" class="btn btn-outline btn-sm" data-action="clear-order-filters">Clear filters</button>` })}`;
  if (focusedSearch) { const s = $a("orders-search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

/* ---------- Addresses ---------- */
function addressFormHTML(a) {
  const v = k => escapeHtml(a ? (a[k] || "") : "");
  return `
    <form class="nf-acc-form" id="address-form" data-id="${a ? escapeHtml(a.id) : ""}" novalidate>
      <h3>${a ? "Edit address" : "Add a new address"}</h3>
      <div class="nf-form-grid">
        <div class="nf-field"><label for="ad-name">Full name *</label><input id="ad-name" name="fullName" autocomplete="name" maxlength="150" required value="${v("full_name")}"></div>
        <div class="nf-field"><label for="ad-phone">Phone</label><input id="ad-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${v("phone")}"></div>
        <div class="nf-field nf-field--wide"><label for="ad-line1">Address *</label><input id="ad-line1" name="addressLine1" autocomplete="address-line1" maxlength="255" required value="${v("address_line1")}" placeholder="House number, street, area"></div>
        <div class="nf-field nf-field--wide"><label for="ad-line2">Landmark / apartment <span class="nf-optional">(optional)</span></label><input id="ad-line2" name="addressLine2" autocomplete="address-line2" maxlength="255" value="${v("address_line2")}"></div>
        <div class="nf-field"><label for="ad-city">City / town *</label><input id="ad-city" name="city" autocomplete="address-level2" maxlength="100" required value="${v("city")}"></div>
        <div class="nf-field"><label for="ad-region">Region</label><input id="ad-region" name="region" autocomplete="address-level1" maxlength="100" value="${v("region")}"></div>
        <div class="nf-field"><label for="ad-country">Country *</label><input id="ad-country" name="country" autocomplete="country-name" maxlength="100" required value="${a ? v("country") : "Ghana"}"></div>
        <div class="nf-field"><label for="ad-label">Save as</label><input id="ad-label" name="label" maxlength="30" placeholder="Home, Work…" value="${v("label")}"></div>
      </div>
      <label class="nf-check"><input type="checkbox" name="isDefault" ${a ? (a.is_default ? "checked" : "") : (acct.addresses && acct.addresses.length ? "" : "checked")}> Use as my default address</label>
      <p class="nf-form-status" role="status"></p>
      <div class="nf-acc-actions">
        <button type="submit" class="btn btn-primary btn-sm">${a ? "Save address" : "Add address"}</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="cancel-address">Cancel</button>
      </div>
    </form>`;
}

function addressCardHTML(a) {
  return `
    <li class="nf-addr-card${a.is_default ? " is-default" : ""}">
      <div class="nf-addr-top">
        <span class="nf-addr-label">${escapeHtml(a.label || "Address")}</span>
        ${a.is_default ? `<span class="nf-addr-default">Default</span>` : ""}
      </div>
      <address>
        <strong>${escapeHtml(a.full_name)}</strong><br>
        ${escapeHtml(a.address_line1)}${a.address_line2 ? `<br>${escapeHtml(a.address_line2)}` : ""}<br>
        ${escapeHtml(a.city)}${a.region ? `, ${escapeHtml(a.region)}` : ""}<br>${escapeHtml(a.country)}
        ${a.phone ? `<br><span class="nf-muted">${escapeHtml(a.phone)}</span>` : ""}
      </address>
      ${a.locked ? `<p class="nf-addr-locked"><i class="fa-solid fa-lock" aria-hidden="true"></i> Used for an order — kept as it is for your records.</p>` : ""}
      <div class="nf-addr-actions">
        ${a.is_default ? "" : `<button type="button" class="nf-link-btn" data-action="default-address" data-id="${escapeHtml(a.id)}">Set as default</button>`}
        ${a.locked ? "" : `<button type="button" class="nf-link-btn" data-action="edit-address" data-id="${escapeHtml(a.id)}">Edit</button>
        <button type="button" class="nf-link-btn nf-link-danger" data-action="delete-address" data-id="${escapeHtml(a.id)}">Delete</button>`}
      </div>
    </li>`;
}

function renderAddresses() {
  const body = $a("addresses-body");
  if (acct.errors.addresses) { body.innerHTML = errorBlock(acct.errors.addresses, "addresses"); return; }
  if (acct.addresses === null) { body.innerHTML = loadingBlock(); return; }
  const editing = acct.editingAddressId ? acct.addresses.find(a => a.id === acct.editingAddressId) : null;
  if (editing || acct.addressFormOpen) { body.innerHTML = addressFormHTML(editing); $a("ad-name").focus(); return; }
  body.innerHTML = acct.addresses.length
    ? `<ul class="nf-addr-grid">${acct.addresses.map(addressCardHTML).join("")}</ul>
       <button type="button" class="nf-add-tile" data-action="add-address"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add a new address</button>`
    : emptyBlock({ icon: "fa-solid fa-location-dot", title: "No saved addresses", text: "Save a delivery address to check out faster.", action: `<button type="button" class="btn btn-primary btn-sm" data-action="add-address">Add an address</button>` });
}

async function saveAddress(form) {
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  const val = n => form[n].value.trim();
  const payload = { fullName: val("fullName"), phone: val("phone"), addressLine1: val("addressLine1"), addressLine2: val("addressLine2"), city: val("city"), region: val("region"), country: val("country"), label: val("label"), isDefault: form.isDefault.checked };
  const missing = ["fullName", "addressLine1", "city", "country"].find(k => !payload[k]);
  if (missing) return fieldError(form, missing, "Please fill in the required fields (*).");
  const btn = form.querySelector("[type=submit]"); btn.disabled = true;
  try {
    const res = await nfAuthFetch(id ? `/api/addresses/${id}` : "/api/addresses", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    const data = await readJson(res);
    if (!res.ok) { fieldError(form, null, data.error || "Could not save the address."); return; }
    acct.editingAddressId = null; acct.addressFormOpen = false;
    await loadAddresses(); renderAddresses(); renderOverview();
    if (typeof showToast === "function") showToast(id ? "Address updated" : "Address added");
  } catch (e) {
    if (e.message !== "Session expired") fieldError(form, null, "We couldn't reach the server. Please try again.");
  } finally { btn.disabled = false; }
}

async function addressAction(action, id) {
  const a = acct.addresses.find(x => x.id === id);
  if (!a) return;
  try {
    if (action === "delete-address") {
      const ok = await confirmDialog({ title: "Delete this address?", text: `${a.label || "This address"} — ${a.address_line1}, ${a.city} will be removed from your account.`, okLabel: "Delete address" });
      if (!ok) return;
      const res = await nfAuthFetch(`/api/addresses/${id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) { if (typeof showToast === "function") showToast(data.error || "Could not delete the address.", "error"); }
      else if (typeof showToast === "function") showToast("Address deleted");
    } else if (action === "default-address") {
      const res = await nfAuthFetch(`/api/addresses/${id}/default`, { method: "PATCH" });
      if (res.ok && typeof showToast === "function") showToast("Default address updated");
    }
    await loadAddresses(); renderAddresses(); renderOverview();
    $a("h-addresses").focus();
  } catch (e) { /* expired session is redirected by nfAuthFetch */ }
}

/* ---------- Wishlist ---------- */
function wishlistItemHTML(p) {
  const offer = typeof ACTIVE_OFFER_BY_PRODUCT !== "undefined" ? ACTIVE_OFFER_BY_PRODUCT[p.id] : null;
  const inStock = Number(p.stock_qty) > 0;
  return `
    <li class="nf-wish-item">
      <a class="nf-wish-media" href="product-details.html?id=${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true">${productMedia(p.image, "")}</a>
      <div class="nf-wish-info">
        <span class="nf-wish-brand">${escapeHtml(p.brand)}</span>
        <a class="nf-wish-name" href="product-details.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>
        <span class="nf-wish-price">${offer ? `<span class="nf-sale">${money(offer.sale_price)}</span> <s class="nf-muted"><span class="sr-only">Regular price </span>${money(p.price)}</s>` : money(p.price)}</span>
        <span class="${inStock ? "stock-yes" : "stock-no"}">${inStock ? "In stock" : "Out of stock"}</span>
      </div>
      <div class="nf-wish-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="move-to-bag" data-id="${escapeHtml(p.id)}" ${inStock ? "" : "disabled"}>${inStock ? "Move to bag" : "Out of stock"}</button>
        <button type="button" class="nf-link-btn" data-action="remove-wish" data-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.name)} from wishlist">Remove</button>
      </div>
    </li>`;
}

function renderWishlist() {
  const body = $a("wishlist-body");
  if (acct.errors.wishlist) { body.innerHTML = errorBlock(acct.errors.wishlist, "wishlist"); return; }
  if (acct.wishlist === null) { body.innerHTML = loadingBlock(); return; }
  body.innerHTML = acct.wishlist.length
    ? `<ul class="nf-wish-list">${acct.wishlist.map(wishlistItemHTML).join("")}</ul>`
    : emptyBlock({ icon: "fa-regular fa-heart", title: "Your wishlist is empty", text: "Tap the heart on any fragrance to save it here for later.", action: `<a href="products.html" class="btn btn-primary btn-sm">Browse fragrances</a>` });
}

async function wishlistAction(action, productId) {
  const p = acct.wishlist.find(x => x.id === productId);
  if (!p) return;
  try {
    if (action === "move-to-bag") {
      const offer = typeof ACTIVE_OFFER_BY_PRODUCT !== "undefined" ? ACTIVE_OFFER_BY_PRODUCT[p.id] : null;
      // Not saved to the bag: keep it in the wishlist (no DELETE) and say so.
      if (!addToCart(p.id, 1, offer ? offer.id : null)) {
        if (typeof showToast === "function") showToast(CART_SAVE_ERROR, "error");
        return;
      }
    }
    const res = await nfAuthFetch(`/api/wishlist/${productId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not update your wishlist.");
    acct.wishlist = acct.wishlist.filter(x => x.id !== productId);
    if (typeof WISHLIST_IDS !== "undefined") WISHLIST_IDS.delete(productId);
    renderWishlist(); renderOverview();
    if (typeof showToast === "function") showToast(action === "move-to-bag" ? "Moved to your bag" : "Removed from wishlist");
    $a("h-wishlist").focus();
  } catch (e) {
    if (e.message !== "Session expired" && typeof showToast === "function") showToast(e.message, "error");
  }
}

/* ---------- Security ---------- */
function renderSecurity() {
  const body = $a("security-body");
  if (!acct.me) { body.innerHTML = loadingBlock(); return; }
  if (!acct.me.password_login) {
    body.innerHTML = `
      <div class="nf-acc-block">
        <h3>Sign-in method</h3>
        <p>You sign in with Google. To also sign in with your email and a password, set a password using a secure link sent to <strong>${escapeHtml(acct.me.email)}</strong>.</p>
        <p class="nf-form-status" id="setpw-status" role="status"></p>
        <div class="nf-acc-actions"><button type="button" class="btn btn-primary btn-sm" data-action="send-set-password">Email me a link to set a password</button></div>
      </div>
      ${sessionNoteHTML()}`;
    return;
  }
  body.innerHTML = `
    <form class="nf-acc-form" id="password-form" novalidate>
      <h3>Change password</h3>
      <div class="nf-form-grid nf-form-grid--narrow">
        ${["current", "new", "confirm"].map(k => `
        <div class="nf-field nf-field--wide">
          <label for="pw-${k}">${k === "current" ? "Current password" : k === "new" ? "New password" : "Confirm new password"}</label>
          <div class="nf-pw-wrap">
            <input id="pw-${k}" name="${k}Password" type="password" autocomplete="${k === "current" ? "current-password" : "new-password"}" required ${k !== "current" ? 'minlength="6"' : ""} ${k === "new" ? 'aria-describedby="pw-hint"' : ""}>
            <button type="button" class="nf-pw-toggle" data-action="toggle-pw" aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          ${k === "new" ? `<span class="nf-field-note" id="pw-hint">At least 6 characters.</span>` : ""}
        </div>`).join("")}
      </div>
      <p class="nf-form-status" role="status"></p>
      <div class="nf-acc-actions">
        <button type="submit" class="btn btn-primary btn-sm">Update password</button>
        <a href="forgot-password.html" class="nf-text-link">Forgot your current password?</a>
      </div>
    </form>
    ${sessionNoteHTML()}`;
}

function sessionNoteHTML() {
  return `<div class="nf-acc-block"><h3>Signing out</h3><p>For your security, log out when you use a shared or public device.</p><div class="nf-acc-actions"><button type="button" class="btn btn-outline btn-sm" data-action="logout">Log out</button></div></div>`;
}

async function changePassword(form) {
  const current = form.currentPassword.value, next = form.newPassword.value, confirm = form.confirmPassword.value;
  if (!current) return fieldError(form, "currentPassword", "Please enter your current password.");
  if (next.length < 6) return fieldError(form, "newPassword", "Your new password must be at least 6 characters.");
  if (next !== confirm) return fieldError(form, "confirmPassword", "The new passwords don't match.");
  const btn = form.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Updating…";
  try {
    const res = await nfAuthFetch("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    const data = await readJson(res);
    if (!res.ok) { fieldError(form, data.field, data.error || "Could not change your password."); return; }
    form.reset();
    fieldError(form, null, "");
    formOk(form, "Your password has been updated.");
    if (typeof showToast === "function") showToast("Password updated");
  } catch (e) {
    if (e.message !== "Session expired") fieldError(form, null, "We couldn't reach the server. Please try again.");
  } finally { btn.disabled = false; btn.textContent = "Update password"; }
}

async function sendSetPasswordLink(btn) {
  const status = $a("setpw-status");
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: acct.me.email }) });
    const data = await readJson(res);
    status.className = `nf-form-status ${res.ok ? "is-ok" : "is-error"}`;
    status.textContent = res.ok ? `If your account can receive it, a link has been sent to ${acct.me.email}. It expires in 1 hour.` : (data.error || "Please try again later.");
  } catch (e) {
    status.className = "nf-form-status is-error"; status.textContent = "We couldn't reach the server. Please try again.";
  } finally { btn.disabled = false; }
}

/* ---------- routing ---------- */
function currentSection() {
  const h = window.location.hash.replace("#", "");
  return ACCOUNT_SECTIONS.includes(h) ? h : "overview";
}

function showSection(section, { focus = false } = {}) {
  document.querySelectorAll(".nf-account-panel").forEach(p => { p.hidden = p.dataset.panel !== section; });
  document.querySelectorAll(".nf-account-nav a[data-section]").forEach(a => {
    if (a.dataset.section === section) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const label = { overview: "My account", profile: "Profile", orders: "Orders", addresses: "Addresses", wishlist: "Wishlist", security: "Security" }[section];
  document.title = `${label} — NeoFragrances`;
  document.querySelector(".nf-account-nav a[aria-current]")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  if (focus) $a(`h-${section}`)?.focus({ preventScroll: true });
}

function renderGreeting() {
  $a("account-greeting").textContent = acct.me ? `Welcome back, ${firstName(acct.me.full_name)}.` : "";
}

function renderAll() {
  renderGreeting(); renderOverview(); renderProfile(); renderOrders(); renderAddresses(); renderWishlist(); renderSecurity();
}

/* ---------- events ---------- */
function bindAccountEvents() {
  window.addEventListener("hashchange", () => showSection(currentSection(), { focus: true }));
  $a("account-logout-btn").addEventListener("click", () => logoutUser());

  document.querySelector(".nf-account-content").addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      const what = retry.dataset.retry;
      acct[what] = null; acct.errors[what] = null; renderAll();
      ({ orders: loadOrders, addresses: loadAddresses, wishlist: loadWishlistItems })[what]().then(renderAll);
      return;
    }
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const id = el.dataset.id ? Number(el.dataset.id) : null;
    switch (el.dataset.action) {
      case "edit-profile": acct.profileEditing = true; renderProfile(); break;
      case "cancel-profile": acct.profileEditing = false; renderProfile(); document.querySelector("[data-action=edit-profile]")?.focus(); break;
      case "add-address": acct.addressFormOpen = true; acct.editingAddressId = null; renderAddresses(); break;
      case "edit-address": acct.editingAddressId = id; renderAddresses(); break;
      case "cancel-address": acct.addressFormOpen = false; acct.editingAddressId = null; renderAddresses(); $a("h-addresses").focus(); break;
      case "delete-address": case "default-address": addressAction(el.dataset.action, id); break;
      case "move-to-bag": case "remove-wish": wishlistAction(el.dataset.action, id); break;
      case "clear-order-filters": acct.ordersFilter = "all"; acct.ordersQuery = ""; renderOrders(); break;
      case "send-set-password": sendSetPasswordLink(el); break;
      case "logout": logoutUser(); break;
      case "toggle-pw": {
        const input = el.parentElement.querySelector("input");
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        el.textContent = show ? "Hide" : "Show";
        el.setAttribute("aria-pressed", String(show));
        el.setAttribute("aria-label", show ? "Hide password" : "Show password");
        break;
      }
    }
  });
  document.querySelector(".nf-account-content").addEventListener("click", (e) => {
    const chip = e.target.closest(".nf-chip-filter");
    if (chip) { acct.ordersFilter = chip.dataset.status; renderOrders(); document.querySelector(`.nf-chip-filter[data-status="${chip.dataset.status}"]`)?.focus(); }
  });
  document.querySelector(".nf-account-content").addEventListener("input", (e) => {
    if (e.target.id === "orders-search") { acct.ordersQuery = e.target.value; renderOrders(); }
  });
  document.querySelector(".nf-account-content").addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "profile-form") saveProfile(e.target);
    if (e.target.id === "address-form") saveAddress(e.target);
    if (e.target.id === "password-form") changePassword(e.target);
  });
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  if (!$a("panel-overview")) return;
  if (!isLoggedIn()) { window.location.replace(nfLoginRedirectUrl().replace("&expired=1", "")); return; }
  bindAccountEvents();
  showSection(currentSection());
  renderAll();
  try {
    await loadMe();
  } catch (e) {
    if (e.message === "Session expired" || e.message === "Not logged in") return;
    $a("overview-body").innerHTML = errorBlock("We couldn't load your account. Please refresh the page.");
    return;
  }
  renderAll();
  // Offers are loaded alongside so wishlist items show genuine sale prices.
  await Promise.all([loadOrders(), loadAddresses(), loadWishlistItems(), nfLoadActiveOffers()]);
  renderAll();
});
