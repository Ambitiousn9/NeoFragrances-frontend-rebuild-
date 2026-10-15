/* ============================================
   NeoFragrances — admin-order.js (order.html?id=)
   Full order details, fulfilment status and the
   recorded status history. Cancelling (Pending or
   Processing only) returns the items to stock
   (server, same transaction) and is final.
   Cancelling and moving backward need a note.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const id = new URLSearchParams(window.location.search).get("id");
  let order = null;

  function notFound(message) {
    root.setAttribute("aria-busy", "false");
    document.getElementById("page-title").textContent = "Order not found";
    root.innerHTML = `<div class="adm-panel">${NFA.stateHTML({ icon: "fa-solid fa-receipt", title: message, text: "Check the order number, or find it from the orders list.", action: `<a class="adm-btn adm-btn--sm" href="orders.html">Back to orders</a>` })}</div>`;
  }

  // Did THIS system restock the order? Only an admin cancellation recorded in the
  // status history proves it (Phase 5: those always restock in the same transaction).
  function cancelledByAdmin(o) {
    return (o.status_history || []).some(h => h.source === "admin" && h.to_status === "Cancelled");
  }

  function statusPanelHTML(o) {
    if (!o.allowed_statuses.length) {
      const stockLine = cancelledByAdmin(o)
        ? "Its items were returned to stock when it was cancelled."
        : "It was cancelled before status history was recorded, so this page can't confirm whether its items were returned to stock.";
      return `<p class="adm-note"><strong>This order was cancelled.</strong> ${stockLine} Cancelled orders are final.</p>`;
    }
    const canCancel = o.allowed_statuses.includes("Cancelled");
    return `
      <form class="adm-status-form" id="status-form" novalidate>
        <div class="adm-field">
          <label for="status-select">Change status</label>
          <select class="adm-select" id="status-select" name="status">
            <option value="${esc(o.status)}" selected>${esc(o.status)} (current)</option>
            ${o.allowed_statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
          </select>
        </div>
        <div class="adm-field">
          <label for="status-note">Note <span class="adm-note-req" id="status-note-req">(optional)</span></label>
          <textarea class="adm-textarea adm-textarea--sm" id="status-note" name="note" maxlength="500" placeholder="Visible to admins only"></textarea>
          <span class="adm-error" data-error-for="note" aria-live="polite"></span>
        </div>
        <button type="submit" class="adm-btn adm-btn--primary" disabled>Update status</button>
        <p class="adm-note">${canCancel ? "Cancelling returns this order's items to stock and can't be undone. " : `${esc(o.status)} orders can't be cancelled. `}Cancelling or moving an order back to an earlier status needs a note.</p>
      </form>`;
  }

  function historyPanelHTML(o) {
    const rows = o.status_history || [];
    const body = rows.length ? `
      <ol class="adm-history">
        ${rows.map(h => {
          if (h.source === "backfill") {
            return `<li class="adm-history-item is-baseline">
              <div class="adm-history-head"><span class="adm-history-title">Status tracking began</span> ${NFA.orderBadge(h.to_status)}</div>
              <div class="adm-history-meta">Baseline · ${esc(NFA.dateTime(h.created_at))}</div>
              <p class="adm-history-note">The order was already ${esc(h.to_status)} when history began. This is when tracking started, not when it reached that status.</p>
            </li>`;
          }
          const who = h.changed_by_name ? esc(h.changed_by_name) : h.changed_by ? `Admin #${esc(h.changed_by)}` : "a deleted admin account";
          return `<li class="adm-history-item">
            <div class="adm-history-head">${h.from_status ? `${NFA.orderBadge(h.from_status)} <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i><span class="sr-only"> to </span> ` : ""}${NFA.orderBadge(h.to_status)}</div>
            <div class="adm-history-meta">${esc(NFA.dateTime(h.created_at))} · by ${who}</div>
            ${h.note ? `<p class="adm-history-note">${esc(h.note)}</p>` : ""}
          </li>`;
        }).join("")}
      </ol>` : `<p class="adm-note">No status changes have been recorded for this order yet. Changes made on this page are recorded here with who made them and when.</p>`;
    return `
      <section class="adm-panel" aria-labelledby="h-history">
        <div class="adm-panel-head"><h2 id="h-history">Status history</h2></div>
        <div class="adm-panel-body">${body}</div>
      </section>`;
  }

  function render() {
    const o = order;
    const adjustments = Math.round((Number(o.total) - Number(o.items_subtotal)) * 100) / 100;
    const units = o.items.reduce((s, i) => s + Number(i.quantity), 0);
    NFA.setTitle(`Order #${o.id}`);
    NFA.setCrumbs([{ label: "Orders", href: "orders.html" }, { label: `Order #${o.id}` }]);
    document.getElementById("page-title").innerHTML = `Order #${esc(o.id)} ${NFA.orderBadge(o.status)}`;
    const sub = document.getElementById("page-sub");
    sub.hidden = false;
    sub.textContent = `Placed ${NFA.dateTime(o.created_at)} · last updated ${NFA.dateTime(o.updated_at)}`;
    const tel = NFA.telLink(o.customer_phone), wa = NFA.waLink(o.customer_phone);

    root.innerHTML = `
      <div class="adm-grid adm-grid--main">
        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-items">
            <div class="adm-panel-head"><h2 id="h-items">Items (${int(units)})</h2></div>
            <div class="adm-panel-body adm-panel-body--flush">
              <table class="adm-table adm-table--cards">
                <caption class="sr-only">Items in this order</caption>
                <thead><tr><th>Product</th><th class="ta-r">Qty</th><th class="ta-r">Unit price</th><th class="ta-r">Line total</th></tr></thead>
                <tbody>${o.items.map(i => `
                  <tr>
                    <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(i.image)}<div>
                      ${i.name ? `<a class="adm-cell-title" href="products.html?status=all&edit=${encodeURIComponent(i.product_id)}">${esc(i.name)}</a>` : `<span class="adm-cell-title">Product #${esc(i.product_id)}</span>`}
                      <span class="adm-cell-sub">${esc(i.brand || "")}${i.archived ? ` · <span class="adm-badge adm-badge--archived">Archived</span>` : ` · ${int(i.stock_qty)} in stock now`}</span>
                    </div></div></td>
                    <td data-label="Qty" class="ta-r num">${int(i.quantity)}</td>
                    <td data-label="Unit price" class="ta-r num">${money(i.price_at_purchase)}</td>
                    <td data-label="Line total" class="ta-r num">${money(Number(i.price_at_purchase) * Number(i.quantity))}</td>
                  </tr>`).join("")}</tbody>
              </table>
              <dl class="adm-totals">
                <div><dt>Items subtotal</dt><dd>${money(o.items_subtotal)}</dd></div>
                ${adjustments !== 0 ? `<div><dt>Shipping, discounts &amp; adjustments</dt><dd>${adjustments > 0 ? "" : "−"}${money(Math.abs(adjustments))}</dd></div>` : ""}
                <div class="is-total"><dt>Total paid</dt><dd>${money(o.total)}</dd></div>
              </dl>
            </div>
          </section>
          <p class="adm-note">Orders store the amount paid; shipping and discounts aren't stored separately yet, so they're shown together as one adjustment line.</p>
          ${historyPanelHTML(o)}
        </div>

        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-status">
            <div class="adm-panel-head"><h2 id="h-status">Fulfilment status</h2></div>
            <div class="adm-panel-body">
              ${statusPanelHTML(o)}
            </div>
          </section>

          <section class="adm-panel" aria-labelledby="h-customer">
            <div class="adm-panel-head"><h2 id="h-customer">Customer</h2><a class="adm-link" href="customer.html?id=${encodeURIComponent(o.customer_id)}">Profile</a></div>
            <div class="adm-panel-body">
              <dl class="adm-dl">
                <dt>Name</dt><dd>${esc(o.customer_name)}</dd>
                <dt>Email</dt><dd><a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></dd>
                <dt>Phone</dt><dd>${o.customer_phone ? esc(o.customer_phone) : `<span class="muted">Not provided</span>`}</dd>
                <dt>Orders</dt><dd>${int(o.customer_orders)} in total · customer since ${esc(NFA.date(o.customer_since))}</dd>
              </dl>
              <div class="adm-contact">
                <a class="adm-btn adm-btn--sm" href="mailto:${esc(o.customer_email)}?subject=${encodeURIComponent(`Your NeoFragrances order #${o.id}`)}"><i class="fa-regular fa-envelope" aria-hidden="true"></i> Email</a>
                ${tel ? `<a class="adm-btn adm-btn--sm" href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call</a>` : ""}
                ${wa ? `<a class="adm-btn adm-btn--sm" href="${esc(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp</a>` : ""}
              </div>
            </div>
          </section>

          <section class="adm-panel" aria-labelledby="h-delivery">
            <div class="adm-panel-head"><h2 id="h-delivery">Delivery address</h2></div>
            <div class="adm-panel-body">
              ${o.address_line1 ? `<address class="adm-address">
                <strong>${esc(o.delivery_name || "")}</strong><br>
                ${esc(o.address_line1)}${o.address_line2 ? `<br>${esc(o.address_line2)}` : ""}<br>
                ${esc(o.city || "")}${o.region ? `, ${esc(o.region)}` : ""}<br>${esc(o.country || "")}
                ${o.delivery_phone ? `<br>${esc(o.delivery_phone)}` : ""}
              </address>` : `<p class="muted">No delivery address is on file for this order.</p>`}
            </div>
          </section>

          <section class="adm-panel" aria-labelledby="h-payment">
            <div class="adm-panel-head"><h2 id="h-payment">Payment</h2></div>
            <div class="adm-panel-body">
              <dl class="adm-dl">
                <dt>Method</dt><dd>${o.payment_reference ? "Paystack" : `<span class="muted">No online payment recorded</span>`}</dd>
                ${o.payment_reference ? `<dt>Reference</dt><dd><span class="adm-code">${esc(o.payment_reference)}</span></dd>` : ""}
                <dt>Amount</dt><dd class="num">${money(o.total)}</dd>
              </dl>
            </div>
          </section>
        </div>
      </div>`;
    root.setAttribute("aria-busy", "false");

    const form = document.getElementById("status-form");
    if (form) {
      const select = form.status, btn = form.querySelector("[type=submit]");
      select.addEventListener("change", () => {
        btn.disabled = select.value === o.status;
        btn.className = `adm-btn ${select.value === "Cancelled" ? "adm-btn--danger" : "adm-btn--primary"}`;
        btn.textContent = select.value === "Cancelled" ? "Cancel order" : "Update status";
        const required = (o.note_required_statuses || []).includes(select.value);
        document.getElementById("status-note-req").textContent = required ? "(required)" : "(optional)";
        form.note.toggleAttribute("required", required);
        NFA.clearFormErrors(form);
      });
      form.addEventListener("submit", e => { e.preventDefault(); updateStatus(select.value, form.note.value.trim(), form, btn); });
    }
  }

  async function updateStatus(status, note, form, btn) {
    if (status === order.status) return;
    NFA.clearFormErrors(form);
    const noteRequired = (order.note_required_statuses || []).includes(status);
    if (noteRequired && !note) {
      NFA.showFormError(form, "note", status === "Cancelled" ? "Add a note explaining why this order is being cancelled." : `Add a note explaining why this order is moving back to ${status}.`);
      return;
    }
    const units = order.items.reduce((s, i) => s + Number(i.quantity), 0);
    const ok = status === "Cancelled"
      ? await NFA.confirm({ title: `Cancel order #${order.id}?`, text: `${units} item${units !== 1 ? "s" : ""} will be returned to stock. Cancelled orders are final — this can't be undone. Any refund must be handled in Paystack.`, okLabel: "Cancel order", danger: true })
      : noteRequired
        ? await NFA.confirm({ title: `Move order #${order.id} back to ${status}?`, text: `The customer will see “${status}” on their order page. Your note is saved in the status history.`, okLabel: `Move to ${status}` })
        : await NFA.confirm({ title: `Mark order #${order.id} as ${status}?`, text: `The customer will see “${status}” on their order page.`, okLabel: `Mark as ${status}` });
    if (!ok) return;
    btn.disabled = true;
    try {
      const res = await NFA.api(`/api/admin/orders/${order.id}/status`, { method: "PATCH", body: { status, ...(note ? { note } : {}) } });
      NFA.toast(status === "Cancelled" ? `Order cancelled — stock returned for ${res.restocked} product${res.restocked !== 1 ? "s" : ""}` : `Order marked as ${status}`);
      await load();
      NFA.loadCounts(true);
      document.getElementById("h-status")?.focus?.();
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      if (e.field === "note") NFA.showFormError(form, "note", e.message);
      else NFA.toast(e.message, "error");
      if (e.code === "ORDER_FINAL" || e.code === "ORDER_NOT_CANCELLABLE") load();
      btn.disabled = false;
    }
  }

  async function load() {
    if (!/^\d+$/.test(id || "")) return notFound("That isn't a valid order number");
    root.setAttribute("aria-busy", "true");
    try { order = await NFA.api(`/api/admin/orders/${id}`); render(); }
    catch (e) {
      if (NFA.isSessionError(e)) return;
      if (e.status === 404) return notFound(`Order #${id} doesn't exist`);
      root.innerHTML = `<div class="adm-panel">${NFA.errorState(e.message)}</div>`;
      root.setAttribute("aria-busy", "false");
    }
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });
  NFA.ready.then(() => {
    document.getElementById("page-actions").innerHTML = `<a class="adm-btn" href="orders.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All orders</a>`;
    load();
  });
})();
