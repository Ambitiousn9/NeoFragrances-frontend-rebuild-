/* ============================================
   NeoFragrances — admin-customer.js (customer.html?id=)
   One customer's account, orders and saved
   addresses, plus the account control (disable /
   enable). No password data is ever sent, and
   disabled_reason is admin-only - it is never part
   of a customer-facing response.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const id = new URLSearchParams(window.location.search).get("id");
  const REASON_MAX = 200; // mirrors ACCOUNT_REASON_MAX in server.js
  let current = null;

  // The control lives in the page header, next to "All customers", so it reads
  // as an action on this account rather than a field of it.
  function actionsHTML(c) {
    const back = `<a class="adm-btn" href="customers.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All customers</a>`;
    if (!c) return back;
    return back + (c.disabled
      ? `<button type="button" class="adm-btn adm-btn--primary" data-account="enable">Enable account</button>`
      : `<button type="button" class="adm-btn adm-btn--danger" data-account="disable">Disable account</button>`);
  }

  function notFound(message) {
    root.setAttribute("aria-busy", "false");
    document.getElementById("page-title").textContent = "Customer not found";
    root.innerHTML = `<div class="adm-panel">${NFA.stateHTML({ icon: "fa-solid fa-user", title: message, text: "Find the customer from the customers list.", action: `<a class="adm-btn adm-btn--sm" href="customers.html">Back to customers</a>` })}</div>`;
  }

  function render(c) {
    current = c;
    document.getElementById("page-actions").innerHTML = actionsHTML(c);
    NFA.setTitle(c.full_name);
    NFA.setCrumbs([{ label: "Customers", href: "customers.html" }, { label: c.full_name }]);
    document.getElementById("page-title").textContent = c.full_name;
    const sub = document.getElementById("page-sub");
    sub.hidden = false;
    sub.textContent = `Customer since ${NFA.date(c.created_at)}`;
    const tel = NFA.telLink(c.phone), wa = NFA.waLink(c.phone);
    const paid = c.orders.filter(o => o.status !== "Cancelled").length;

    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Orders</span><span class="adm-kpi-value">${int(c.orders.length)}</span><span class="adm-kpi-meta">${int(c.orders.length - paid)} cancelled</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Total spent</span><span class="adm-kpi-value">${money(c.total_spent)}</span><span class="adm-kpi-meta">Excludes cancelled orders</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Wishlist</span><span class="adm-kpi-value">${int(c.wishlist_count)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Reviews</span><span class="adm-kpi-value">${int(c.review_count)}</span></div>
      </div>
      <div class="adm-grid adm-grid--main">
        <section class="adm-panel" aria-labelledby="h-orders">
          <div class="adm-panel-head"><h2 id="h-orders">Order history</h2></div>
          <div class="adm-panel-body adm-panel-body--flush">
            ${c.orders.length ? `<table class="adm-table adm-table--cards">
              <caption class="sr-only">Orders by ${esc(c.full_name)}</caption>
              <thead><tr><th>Order</th><th class="ta-r">Items</th><th class="ta-r">Total</th><th>Status</th></tr></thead>
              <tbody>${c.orders.map(o => `
                <tr>
                  <td class="adm-td-primary"><a class="adm-cell-title" href="order.html?id=${encodeURIComponent(o.id)}">Order #${esc(o.id)}</a><span class="adm-cell-sub">${esc(NFA.dateTime(o.created_at))}</span></td>
                  <td data-label="Items" class="ta-r num">${int(o.item_count)}</td>
                  <td data-label="Total" class="ta-r num">${money(o.total)}</td>
                  <td data-label="Status">${NFA.orderBadge(o.status)}</td>
                </tr>`).join("")}</tbody>
            </table>` : NFA.stateHTML({ icon: "fa-solid fa-receipt", title: "No orders yet", text: "This customer hasn't placed an order." })}
          </div>
        </section>
        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-account">
            <div class="adm-panel-head"><h2 id="h-account">Account</h2></div>
            <div class="adm-panel-body">
              <dl class="adm-dl">
                <dt>Status</dt><dd>${c.disabled
                  ? `<span class="adm-badge adm-badge--disabled">Disabled</span>${c.disabled_at ? ` <span class="muted">since ${esc(NFA.dateTime(c.disabled_at))}</span>` : ""}`
                  : `<span class="adm-badge adm-badge--active">Active</span>`}</dd>
                ${c.disabled && c.disabled_reason ? `<dt>Reason</dt><dd>${esc(c.disabled_reason)}</dd>` : ""}
                <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
                <dt>Verification</dt><dd>${c.email_verified ? `<span class="adm-badge adm-badge--active">Verified</span>` : `<span class="adm-badge adm-badge--pending">Not verified</span>`}</dd>
                <dt>Sign-in</dt><dd>${c.auth_provider === "google" ? "Google" : "Email & password"}</dd>
                <dt>Phone</dt><dd>${c.phone ? esc(c.phone) : `<span class="muted">Not provided</span>`}</dd>
                <dt>Joined</dt><dd>${esc(NFA.dateTime(c.created_at))}</dd>
              </dl>
              <div class="adm-contact">
                <a class="adm-btn adm-btn--sm" href="mailto:${esc(c.email)}"><i class="fa-regular fa-envelope" aria-hidden="true"></i> Email</a>
                ${tel ? `<a class="adm-btn adm-btn--sm" href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call</a>` : ""}
                ${wa ? `<a class="adm-btn adm-btn--sm" href="${esc(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp</a>` : ""}
              </div>
            </div>
          </section>
          <section class="adm-panel" aria-labelledby="h-addresses">
            <div class="adm-panel-head"><h2 id="h-addresses">Saved addresses (${int(c.addresses.length)})</h2></div>
            <div class="adm-panel-body adm-panel-body--flush">
              ${c.addresses.length ? `<ul class="adm-list">${c.addresses.map(a => `
                <li><address class="adm-address adm-list-main">
                  <strong>${esc(a.label || "Address")}</strong>${a.is_default ? ` <span class="adm-badge adm-badge--active">Default</span>` : ""}<br>
                  ${esc(a.full_name)} · ${esc(a.address_line1)}${a.address_line2 ? `, ${esc(a.address_line2)}` : ""}<br>
                  ${esc(a.city)}${a.region ? `, ${esc(a.region)}` : ""}, ${esc(a.country)}${a.phone ? ` · ${esc(a.phone)}` : ""}
                </address></li>`).join("")}</ul>` : NFA.stateHTML({ icon: "fa-solid fa-location-dot", title: "No saved addresses" })}
            </div>
          </section>
          <p class="adm-note">Disabling an account signs the customer out and blocks new sign-ins, checkout and reviews. Nothing is deleted &mdash; their orders, addresses, reviews and wishlist are kept, and orders already placed are not cancelled. Re-enabling restores access, but the customer must log in again.</p>
        </div>
      </div>`;
    root.setAttribute("aria-busy", "false");
  }

  // One call for both directions. The server echoes the saved state, but the
  // page is re-loaded rather than patched in place so the KPIs, badges and the
  // header button can never drift from the record.
  async function setDisabled(disabled, reason, statusEl) {
    try {
      const saved = await NFA.api(`/api/admin/customers/${id}/disabled`, { method: "PATCH", body: { disabled, reason } });
      NFA.closeDrawer();
      NFA.toast(saved.disabled ? "Account disabled" : "Account enabled \u2014 the customer must log in again");
      await load();
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      // 400 names a field; 409 is a refusal (an administrator, or yourself).
      if (statusEl) { statusEl.className = "adm-form-status is-error"; statusEl.textContent = e.message; }
      NFA.toast(e.message || "Could not update the account.", "error");
    }
  }

  // Disabling is consequential and takes an optional note, so it gets a drawer
  // rather than a plain confirm. Enabling is restorative and goes straight
  // through - the same reasoning the reviews page uses for hide vs delete.
  function askDisable(c) {
    NFA.openDrawer({
      title: `Disable ${c.full_name}'s account`,
      bodyHTML: `
        <p class="adm-help">${esc(c.full_name)} will be signed out everywhere and won't be able to log in, check out or leave reviews. Their orders, addresses, reviews and wishlist are kept, and orders already placed are <strong>not</strong> cancelled.</p>
        <div class="adm-field">
          <label for="d-reason">Reason <span class="muted">(optional, admin-only)</span></label>
          <input class="adm-input" id="d-reason" type="text" maxlength="${REASON_MAX}" placeholder="e.g. Chargeback under investigation" autocomplete="off">
          <span class="adm-help">Visible to administrators on this page only. Never shown to the customer. <span id="d-count">0</span>/${REASON_MAX}</span>
          <span class="adm-error" data-error-for="reason"></span>
        </div>`,
      footHTML: `
        <span class="adm-form-status" id="d-status"></span>
        <button type="button" class="adm-btn" data-drawer-close>Cancel</button>
        <button type="button" class="adm-btn adm-btn--danger" id="d-confirm">Disable account</button>`,
    });
    const reason = document.getElementById("d-reason");
    const count = document.getElementById("d-count");
    reason.addEventListener("input", () => { count.textContent = String(reason.value.length); });
    reason.focus();
    document.getElementById("d-confirm").addEventListener("click", async e => {
      e.target.disabled = true;
      await setDisabled(true, reason.value, document.getElementById("d-status"));
      const btn = document.getElementById("d-confirm");
      if (btn) btn.disabled = false;
    });
  }

  async function load() {
    if (!/^\d+$/.test(id || "")) return notFound("That isn't a valid customer link");
    root.setAttribute("aria-busy", "true");
    try { render(await NFA.api(`/api/admin/customers/${id}`)); }
    catch (e) {
      if (NFA.isSessionError(e)) return;
      if (e.status === 404) return notFound("This customer doesn't exist");
      root.innerHTML = `<div class="adm-panel">${NFA.errorState(e.message)}</div>`;
      root.setAttribute("aria-busy", "false");
    }
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });
  document.getElementById("page-actions").addEventListener("click", e => {
    const action = e.target.closest("[data-account]");
    if (!action || !current) return;
    if (action.dataset.account === "disable") return askDisable(current);
    setDisabled(false, "", null);
  });
  NFA.ready.then(() => {
    document.getElementById("page-actions").innerHTML = actionsHTML(null);
    load();
  });
})();
