/* ============================================
   NeoFragrances — admin-coupons.js (Milestone 6)
   Promo codes: status tabs (active / inactive /
   expired / used up), create + edit in a drawer,
   activate/deactivate, delete. Status is computed
   by the API from active / expires_at / usage, so
   this page never stores or guesses a state.
   A coupon already used on an order cannot be
   deleted — the API returns COUPON_IN_USE.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const STATUS = {
    "Active":   { key: "active",   label: "Active",   badge: "live" },
    "Inactive": { key: "inactive", label: "Inactive", badge: "disabled" },
    "Expired":  { key: "expired",  label: "Expired",  badge: "expired" },
    "Used up":  { key: "usedup",   label: "Used up",  badge: "out" },
  };
  const DEFAULTS = { q: "", tab: "all" };
  const state = NFA.readParams(DEFAULTS);
  let coupons = null, loadError = null;

  const pad = n => String(n).padStart(2, "0");
  const toInput = v => { const d = new Date(v); return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const isAmountKind = c => c.discount_percent === null || c.discount_percent === undefined;
  const discountText = c => isAmountKind(c) ? `${money(c.discount_amount)} off` : `${Number(c.discount_percent)}% off`;
  const usageText = c => c.usage_limit === null
    ? `${int(c.times_used)} used · no limit`
    : `${int(c.times_used)} of ${int(c.usage_limit)} used`;

  function filtered() {
    const q = NFA.normalize(state.q);
    return coupons.filter(c => {
      if (state.tab !== "all" && (STATUS[c.status] || {}).key !== state.tab) return false;
      if (q && !NFA.normalize(c.code).includes(q)) return false;
      return true;
    });
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const count = key => coupons.filter(c => (STATUS[c.status] || {}).key === key).length;
    root.innerHTML = `
      <div class="adm-tabs" role="group" aria-label="Coupon status">
        ${[["all", "All", coupons.length], ["active", "Active", count("active")], ["inactive", "Inactive", count("inactive")], ["expired", "Expired", count("expired")], ["usedup", "Used up", count("usedup")]].map(([k, l, n]) => `<button type="button" class="adm-tab" data-tab="${k}" aria-pressed="${state.tab === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("")}
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="f-search" class="sr-only">Search coupon codes</label><input id="f-search" class="adm-input" type="search" placeholder="Coupon code" value="${esc(state.q)}"></div>
        <div class="adm-toolbar-right"><span class="adm-count" id="f-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards"><caption class="sr-only">Coupons</caption>
          <thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Expires</th><th>Status</th><th class="ta-r"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="f-body"></tbody>
        </table>
      </div>
      <p class="adm-note" style="margin-top:12px">"Active" = switched on, not expired and under its usage limit. Deactivating withdraws a code without changing its discount, expiry or usage count. A coupon used on an order cannot be deleted, so order history keeps its discount.</p>`;
    renderTable();
  }

  function renderTable() {
    NFA.writeParams(state, DEFAULTS);
    const list = filtered();
    document.getElementById("f-count").textContent = `${int(list.length)} coupon${list.length !== 1 ? "s" : ""}`;
    document.getElementById("f-body").innerHTML = list.length ? list.map(c => {
      const st = STATUS[c.status] || { badge: "disabled", label: c.status };
      return `
      <tr>
        <td class="adm-td-primary">
          <button type="button" class="adm-link adm-cell-title" data-action="edit" data-id="${c.id}" style="color:inherit;text-align:left">${esc(c.code)}</button>
          <span class="adm-cell-sub">Created ${esc(NFA.date(c.created_at))}${c.orders_used ? ` · used on ${int(c.orders_used)} order${c.orders_used === 1 ? "" : "s"}` : ""}</span>
        </td>
        <td data-label="Discount" class="nowrap"><strong>${esc(discountText(c))}</strong></td>
        <td data-label="Usage" class="nowrap">${esc(usageText(c))}</td>
        <td data-label="Expires" class="nowrap">${c.expires_at ? esc(NFA.dateTime(c.expires_at)) : `<span class="muted">Never</span>`}</td>
        <td data-label="Status"><span class="adm-badge adm-badge--${st.badge}">${esc(st.label)}</span></td>
        <td class="adm-td-actions ta-r"><span class="adm-row-actions">
          <button type="button" class="adm-link" data-action="edit" data-id="${c.id}" aria-label="Edit ${esc(c.code)}">Edit</button>
          <button type="button" class="adm-link" data-action="toggle" data-id="${c.id}" aria-label="${c.active ? "Deactivate" : "Activate"} ${esc(c.code)}">${c.active ? "Deactivate" : "Activate"}</button>
          <button type="button" class="adm-link adm-link--danger" data-action="delete" data-id="${c.id}" aria-label="Delete ${esc(c.code)}">Delete</button>
        </span></td>
      </tr>`;
    }).join("")
      : NFA.tableState(6, coupons.length
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No coupons here", text: "Try another tab or search." })
        : NFA.stateHTML({ icon: "fa-solid fa-ticket", title: "No coupons yet", text: "Create a promo code customers can enter at checkout.", action: `<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" data-action="new">Create coupon</button>` }));
  }

  /* ---------- drawer form ---------- */
  function formHTML(c) {
    const amount = !!c && isAmountKind(c);
    return `
      <form id="coupon-form" novalidate>
        <div class="adm-form-grid">
          <div class="adm-field adm-field--wide"><label for="cp-code">Coupon code *</label><input class="adm-input" id="cp-code" name="code" maxlength="50" required value="${c ? esc(c.code) : ""}" placeholder="e.g. WELCOME10" style="text-transform:uppercase"><span class="adm-help">Letters, numbers, hyphens and underscores. Customers can type it in any case.</span><span class="adm-error" data-error-for="code"></span></div>
          <div class="adm-field"><label for="cp-kind">Discount type *</label><select class="adm-select" id="cp-kind" name="kind"><option value="percent"${amount ? "" : " selected"}>Percentage off</option><option value="amount"${amount ? " selected" : ""}>Fixed amount off</option></select></div>
          <div class="adm-field" id="cp-percent-field"${amount ? " hidden" : ""}><label for="cp-percent">Percentage off *</label><input class="adm-input" id="cp-percent" name="discount_percent" type="number" min="0.01" max="100" step="0.01" value="${c && !amount ? esc(Number(c.discount_percent)) : ""}"><span class="adm-help">More than 0, up to 100.</span><span class="adm-error" data-error-for="discount_percent"></span></div>
          <div class="adm-field" id="cp-amount-field"${amount ? "" : " hidden"}><label for="cp-amount">Amount off (GH₵) *</label><input class="adm-input" id="cp-amount" name="discount_amount" type="number" min="0.01" step="0.01" value="${c && amount ? esc(Number(c.discount_amount)) : ""}"><span class="adm-help">Never discounts more than the cart subtotal.</span><span class="adm-error" data-error-for="discount_amount"></span></div>
          <div class="adm-field"><label for="cp-limit">Usage limit <span class="muted">(optional)</span></label><input class="adm-input" id="cp-limit" name="usage_limit" type="number" min="1" step="1" value="${c && c.usage_limit !== null ? esc(c.usage_limit) : ""}" placeholder="Unlimited"><span class="adm-help">Total redemptions allowed. Leave blank for unlimited — to withdraw a code use Deactivate, not a limit of 0.</span><span class="adm-error" data-error-for="usage_limit"></span></div>
          <div class="adm-field"><label for="cp-expires">Expires <span class="muted">(optional)</span></label><input class="adm-input" id="cp-expires" name="expires_at" type="datetime-local" value="${c && c.expires_at ? toInput(c.expires_at) : ""}"><span class="adm-help">Leave blank to never expire.</span><span class="adm-error" data-error-for="expires_at"></span></div>
          <div class="adm-field adm-field--wide adm-fieldset" role="group" aria-label="Availability">
            <label class="adm-check"><input type="checkbox" name="active" ${!c || c.active ? "checked" : ""}> Active — customers can use this code at checkout</label>
          </div>
          ${c ? `<div class="adm-field adm-field--wide"><span class="adm-help">Used ${int(c.times_used)} time${c.times_used === 1 ? "" : "s"} so far${c.orders_used ? ` on ${int(c.orders_used)} order${c.orders_used === 1 ? "" : "s"}` : ""}. Editing never resets the usage count.</span></div>` : ""}
        </div>
        <button type="submit" hidden></button>
      </form>`;
  }

  function syncKind(form) {
    const amount = form.elements.kind.value === "amount";
    document.getElementById("cp-percent-field").hidden = amount;
    document.getElementById("cp-amount-field").hidden = !amount;
  }

  function openForm(c) {
    let dirty = false;
    const drawer = NFA.openDrawer({
      title: c ? "Edit coupon" : "Create coupon",
      bodyHTML: formHTML(c),
      footHTML: `<span class="adm-form-status" role="status"></span><button type="button" class="adm-btn" data-drawer-cancel>Cancel</button><button type="button" class="adm-btn adm-btn--primary" data-drawer-save>${c ? "Save coupon" : "Create coupon"}</button>`,
      onClose: async () => !dirty || NFA.confirm({ title: "Discard changes?", text: "Your unsaved changes to this coupon will be lost.", okLabel: "Discard", danger: true }),
    });
    const form = drawer.querySelector("#coupon-form");
    syncKind(form);
    form.addEventListener("input", () => { dirty = true; });
    form.elements.kind.addEventListener("change", () => { dirty = true; syncKind(form); });
    form.addEventListener("submit", e => { e.preventDefault(); save(form, c, () => { dirty = false; }); });
    drawer.querySelector("[data-drawer-save]").addEventListener("click", () => form.requestSubmit());
    drawer.querySelector("[data-drawer-cancel]").addEventListener("click", () => drawer.querySelector("[data-drawer-close]").click());
  }

  async function save(form, c, markClean) {
    NFA.clearFormErrors(form);
    const amount = form.elements.kind.value === "amount";
    // Exactly one discount field is sent; the API rejects both or neither.
    const body = {
      code: form.elements.code.value.trim().toUpperCase(),
      discount_percent: amount ? null : (form.elements.discount_percent.value === "" ? null : Number(form.elements.discount_percent.value)),
      discount_amount: amount ? (form.elements.discount_amount.value === "" ? null : Number(form.elements.discount_amount.value)) : null,
      usage_limit: form.elements.usage_limit.value === "" ? null : Number(form.elements.usage_limit.value),
      expires_at: form.elements.expires_at.value === "" ? null : form.elements.expires_at.value,
      active: form.elements.active.checked,
    };
    if (!body.code) return NFA.showFormError(form, "code", "Enter a coupon code.");
    if (!amount && !(body.discount_percent > 0)) return NFA.showFormError(form, "discount_percent", "Enter a percentage above 0.");
    if (amount && !(body.discount_amount > 0)) return NFA.showFormError(form, "discount_amount", "Enter an amount above 0.");
    const btn = form.closest(".adm-drawer").querySelector("[data-drawer-save]");
    btn.disabled = true;
    try {
      await NFA.api(c ? `/api/admin/coupons/${c.id}` : "/api/admin/coupons", { method: c ? "PUT" : "POST", body });
      markClean();
      NFA.closeDrawer();
      NFA.toast(c ? "Coupon updated" : "Coupon created");
      await load();
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      // A 409 duplicate code is a validation result, not an auth failure, so it is shown
      // inline on the code field. Only 401/403 reach isSessionError and sign the admin out.
      NFA.showFormError(form, e.field || "code", e.message);
    } finally { btn.disabled = false; }
  }

  async function action(kind, c) {
    try {
      if (kind === "toggle") {
        await NFA.api(`/api/admin/coupons/${c.id}/active`, { method: "PATCH", body: { active: !c.active } });
        NFA.toast(c.active ? "Coupon deactivated — customers can no longer use it" : "Coupon activated");
      } else if (kind === "delete") {
        const ok = await NFA.confirm({
          title: `Delete "${c.code}"?`,
          text: "The code is removed permanently and stops working immediately. To withdraw it but keep its settings, deactivate it instead.",
          okLabel: "Delete coupon", danger: true,
        });
        if (!ok) return;
        await NFA.api(`/api/admin/coupons/${c.id}`, { method: "DELETE" });
        NFA.toast("Coupon deleted");
      }
      await load();
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      // COUPON_IN_USE (409) is the expected answer for a coupon attached to an order.
      NFA.toast(e.message, "error");
      if (e.code === "COUPON_IN_USE") await load();
    }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      coupons = await NFA.api("/api/admin/coupons");
      loadError = null;
    } catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  const onSearch = NFA.debounce(renderTable);
  root.addEventListener("input", e => { if (e.target.id === "f-search") { state.q = e.target.value; onSearch(); } });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; render(); root.querySelector(`[data-tab="${state.tab}"]`).focus(); return; }
    const a = e.target.closest("[data-action]");
    if (!a) return;
    if (a.dataset.action === "new") return openForm(null);
    const c = coupons.find(x => x.id === Number(a.dataset.id));
    if (!c) return;
    if (a.dataset.action === "edit") openForm(c); else action(a.dataset.action, c);
  });

  NFA.ready.then(async () => {
    const actions = document.getElementById("page-actions");
    actions.innerHTML = `<button type="button" class="adm-btn adm-btn--primary" id="new-coupon"><i class="fa-solid fa-plus" aria-hidden="true"></i> Create coupon</button>`;
    actions.querySelector("#new-coupon").addEventListener("click", () => openForm(null));
    await load();
  });
})();
