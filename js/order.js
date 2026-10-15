/* ============================================
   NeoFragrances — order.js (order.html?id=…)
   Order details for the logged-in customer. The
   order comes from GET /api/my-orders, which only
   returns this customer's orders — so another
   customer's order id simply isn't found. Its
   status history (real recorded times) comes from
   GET /api/my-orders/:id/history; if that call
   fails the page still renders, undated.
   ============================================ */

const $o = id => document.getElementById(id);

function orderNotFoundHTML(message) {
  return `
    <div class="nf-acc-state">
      <i class="fa-solid fa-receipt" aria-hidden="true"></i>
      <h1 class="nf-order-title-sm">${escapeHtml(message)}</h1>
      <p>If you think this is a mistake, check the order number or contact us.</p>
      <div class="nf-acc-actions nf-acc-actions--center">
        <a href="my-account.html#orders" class="btn btn-primary btn-sm">View my orders</a>
        <a href="contact.html" class="btn btn-outline btn-sm">Contact us</a>
      </div>
    </div>`;
}

function renderOrder(order, history) {
  const items = order.items || [];
  const subtotal = orderItemsSubtotal(order);
  // Orders store the amount actually paid; shipping/discount aren't stored separately,
  // so the difference is shown honestly as one line rather than guessed.
  const adjustments = Math.round((Number(order.total) - subtotal) * 100) / 100;
  const status = String(order.status || "").toLowerCase();
  const canTrack = ["pending", "processing", "shipped"].includes(status);
  const anyAvailable = items.some(i => Array.isArray(PRODUCTS) && PRODUCTS.some(p => p.id === Number(i.product_id) && p.stock));
  const wa = typeof nfWhatsAppLink === "function" ? nfWhatsAppLink(`Hello NeoFragrances, I have a question about order #${order.id}.`) : "contact.html";
  const hasAddress = !!order.address_line1;

  document.title = `Order #${order.id} — NeoFragrances`;
  $o("crumb-order").textContent = `Order #${order.id}`;

  $o("order-root").innerHTML = `
    <header class="nf-order-header">
      <div>
        <h1>Order #${escapeHtml(order.id)}</h1>
        <p class="nf-order-sub">Placed ${escapeHtml(formatOrderDate(order.created_at, true))}</p>
      </div>
      ${orderStatusBadge(order.status)}
    </header>

    <section class="nf-acc-card" aria-labelledby="h-progress">
      <h2 id="h-progress" class="nf-card-title">Progress</h2>
      ${orderTimelineHTML(order, history)}
      ${orderHistoryListHTML(history)}
    </section>

    <div class="nf-order-grid">
      <section class="nf-acc-card" aria-labelledby="h-items">
        <h2 id="h-items" class="nf-card-title">Items <span class="nf-muted">(${orderItemsCount(order)})</span></h2>
        <ul class="nf-order-items">
          ${items.map(i => {
            const link = i.available ? `product-details.html?id=${encodeURIComponent(i.product_id)}` : null;
            return `
            <li class="nf-order-item">
              <span class="nf-order-item-media">${productMedia(i.image, "")}</span>
              <span class="nf-order-item-info">
                ${i.brand ? `<span class="nf-wish-brand">${escapeHtml(i.brand)}</span>` : ""}
                ${link ? `<a href="${link}" class="nf-order-item-name">${escapeHtml(i.name)}</a>` : `<span class="nf-order-item-name">${escapeHtml(i.name)}</span>`}
                <span class="nf-muted">${escapeHtml(i.quantity)} × ${money(i.price_at_purchase)}${i.available ? "" : " · no longer sold"}</span>
              </span>
              <span class="nf-order-item-total">${money(Number(i.price_at_purchase) * Number(i.quantity))}</span>
            </li>`;
          }).join("")}
        </ul>
        <dl class="nf-order-totals">
          <div><dt>Items</dt><dd>${money(subtotal)}</dd></div>
          ${adjustments !== 0 ? `<div><dt>Shipping, discounts &amp; adjustments</dt><dd>${adjustments > 0 ? "" : "−"}${money(Math.abs(adjustments))}</dd></div>` : ""}
          <div class="nf-order-totals-total"><dt>Total paid</dt><dd>${money(order.total)}</dd></div>
        </dl>
      </section>

      <aside class="nf-order-side-col">
        <section class="nf-acc-card" aria-labelledby="h-delivery">
          <h2 id="h-delivery" class="nf-card-title">Delivery address</h2>
          ${hasAddress ? `<address>
            <strong>${escapeHtml(order.address_full_name || "")}</strong><br>
            ${escapeHtml(order.address_line1)}${order.address_line2 ? `<br>${escapeHtml(order.address_line2)}` : ""}<br>
            ${escapeHtml(order.address_city || "")}${order.address_region ? `, ${escapeHtml(order.address_region)}` : ""}<br>${escapeHtml(order.address_country || "")}
            ${order.address_phone ? `<br><span class="nf-muted">${escapeHtml(order.address_phone)}</span>` : ""}
          </address>` : `<p class="nf-muted">No delivery address is on file for this order.</p>`}
        </section>
        <section class="nf-acc-card" aria-labelledby="h-payment">
          <h2 id="h-payment" class="nf-card-title">Payment</h2>
          <dl class="nf-detail-list nf-detail-list--compact">
            <div><dt>Status</dt><dd>${order.payment_reference ? "Paid via Paystack" : "No online payment recorded"}</dd></div>
            ${order.payment_reference ? `<div><dt>Reference</dt><dd><code class="nf-ref">${escapeHtml(order.payment_reference)}</code></dd></div>` : ""}
            <div><dt>Order status</dt><dd>${escapeHtml(orderStatusMeta(order.status).label)}</dd></div>
          </dl>
        </section>
        <div class="nf-order-actions">
          ${canTrack ? `<a class="btn btn-outline btn-sm" href="track-order.html?order=${encodeURIComponent(order.id)}">Track this order</a>` : ""}
          ${anyAvailable ? `<button type="button" class="btn btn-primary btn-sm" id="buy-again">Buy again</button>` : ""}
          <a class="nf-text-link" href="${escapeHtml(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Ask about this order</a>
        </div>
      </aside>
    </div>`;

  $o("buy-again")?.addEventListener("click", () => buyAgain(order));
}

async function loadOrderPage() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || !/^\d+$/.test(id)) { $o("order-root").innerHTML = orderNotFoundHTML("We couldn't find that order"); return; }
  if (!isLoggedIn()) { window.location.replace(nfLoginRedirectUrl().replace("&expired=1", "")); return; }
  try {
    // History is secondary: a failure there must not hide the order itself.
    const [res, history] = await Promise.all([
      nfAuthFetch("/api/my-orders"),
      nfAuthFetch(`/api/my-orders/${id}/history`).then(r => (r.ok ? r.json() : null)).then(d => (d && Array.isArray(d.history) ? d.history : null)).catch(() => null),
    ]);
    if (!res.ok) throw new Error("load");
    const orders = await res.json();
    const order = orders.find(o => String(o.id) === id);
    if (!order) { $o("order-root").innerHTML = orderNotFoundHTML("We couldn't find that order in your account"); return; }
    renderOrder(order, history);
  } catch (e) {
    if (e.message === "Session expired" || e.message === "Not logged in") return;
    $o("order-root").innerHTML = `<div class="nf-acc-state nf-acc-state--error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>We couldn't load this order. Please check your connection and try again.</p><button type="button" class="btn btn-outline btn-sm" onclick="loadOrderPage()">Try again</button></div>`;
  }
}

// Buy again needs live stock from PRODUCTS, so render after the catalog loads.
document.addEventListener("productsReady", () => { if ($o("order-root")) loadOrderPage(); });
