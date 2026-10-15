/* ============================================
   NeoFragrances — orders-common.js
   Shared by the account page (orders list),
   order.html (details) and track-order.html:
   status labels, the order timeline, dates and
   "Buy again". Uses: escapeHtml, money, PRODUCTS,
   addToCart, showToast.
   ============================================ */

// Statuses the backend actually uses (admin: Pending, Processing, Shipped, Delivered, Cancelled).
const ORDER_STATUS_META = {
  pending:    { label: "Pending",    tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  shipped:    { label: "Shipped",    tone: "info" },
  delivered:  { label: "Delivered",  tone: "success" },
  cancelled:  { label: "Cancelled",  tone: "danger" },
};
const ORDER_TIMELINE_STEPS = [
  { key: "ordered", label: "Order placed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

function orderStatusMeta(status) {
  const key = String(status || "").toLowerCase();
  return ORDER_STATUS_META[key] || { label: status || "Unknown", tone: "neutral" };
}

function orderStatusBadge(status) {
  const m = orderStatusMeta(status);
  return `<span class="nf-status nf-status--${m.tone}">${escapeHtml(m.label)}</span>`;
}

function formatOrderDate(value, withTime = false) {
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

// When each status was most recently reached, from GET /api/my-orders/:id/history.
// Only real recorded changes are dated: the "tracking_started" baseline says when
// history began, not when the order reached that status, so it never dates a step.
// A backward correction clears the dates of the steps after it.
function orderStepDates(history) {
  const flow = ["pending", "processing", "shipped", "delivered"];
  const dates = {};
  let cancelledAt = null;
  (history || []).forEach(h => {
    const s = String(h.status || "").toLowerCase();
    if (h.type !== "status_change") return;
    if (s === "cancelled") { cancelledAt = h.at; return; }
    const at = flow.indexOf(s);
    if (at === -1) return;
    flow.slice(at + 1).forEach(later => { delete dates[later]; });
    dates[s] = h.at;
  });
  return { dates, cancelledAt };
}

// Accessible step timeline. Cancelled orders show a single clear state instead.
// `history` is optional: without it (track-order, the orders list) only the
// placed date is shown, exactly as before.
function orderTimelineHTML(order, history) {
  const status = String(order.status || "").toLowerCase();
  const { dates, cancelledAt } = orderStepDates(history);
  if (status === "cancelled") {
    const when = cancelledAt ? ` on ${escapeHtml(formatOrderDate(cancelledAt, true))}` : "";
    return `<div class="nf-timeline-cancelled" role="status"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> This order was cancelled${when}.</div>`;
  }
  const reached = { pending: 0, processing: 1, shipped: 2, delivered: 3 }[status] ?? 0;
  return `
    <ol class="nf-timeline" aria-label="Order progress">
      ${ORDER_TIMELINE_STEPS.map((s, i) => {
        const state = i < reached ? "done" : i === reached ? (status === "delivered" ? "done" : "current") : "todo";
        const stepDate = i === 0 ? order.created_at : (state !== "todo" ? dates[s.key] : null);
        const note = stepDate ? `<span class="nf-timeline-date">${escapeHtml(formatOrderDate(stepDate, i !== 0))}</span>` : "";
        return `<li class="nf-timeline-step is-${state}"${state === "current" ? ' aria-current="step"' : ""}>
          <span class="nf-timeline-dot" aria-hidden="true">${state === "done" ? '<i class="fa-solid fa-check"></i>' : ""}</span>
          <span class="nf-timeline-label">${escapeHtml(s.label)}<span class="sr-only"> — ${state === "done" ? "completed" : state === "current" ? "current step" : "not yet"}</span></span>
          ${note}
        </li>`;
      }).join("")}
    </ol>`;
}

// Every recorded status update, oldest first. Renders nothing when none were recorded
// (orders placed since tracking began have none until their first status change).
function orderHistoryListHTML(history) {
  const rows = history || [];
  if (!rows.length) return "";
  const flow = ["pending", "processing", "shipped", "delivered"];
  return `
    <div class="nf-history">
      <h3 class="nf-history-title">Status updates</h3>
      <ol class="nf-history-list">
        ${rows.map(h => {
          const label = orderStatusMeta(h.status).label;
          const to = String(h.status || "").toLowerCase(), from = String(h.from_status || "").toLowerCase();
          let text;
          if (h.type === "tracking_started") text = `Status tracking began — your order was ${escapeHtml(label)}`;
          else if (to === "cancelled") text = "Order cancelled";
          else if (flow.indexOf(to) < flow.indexOf(from)) text = `Status corrected to ${escapeHtml(label)}`;
          else text = `Marked as ${escapeHtml(label)}`;
          return `<li class="nf-history-item${h.type === "tracking_started" ? " is-baseline" : ""}">
            <span class="nf-history-dot" aria-hidden="true"></span>
            <span class="nf-history-text">${text}</span>
            <time class="nf-history-time" datetime="${escapeHtml(h.at)}">${escapeHtml(formatOrderDate(h.at, true))}</time>
          </li>`;
        }).join("")}
      </ol>
    </div>`;
}

// Re-adds an order's products to the bag using live stock (never more than available).
function buyAgain(order) {
  let added = 0, skipped = 0;
  (order.items || []).forEach(item => {
    const product = Array.isArray(PRODUCTS) ? PRODUCTS.find(p => p.id === Number(item.product_id)) : null;
    if (!product || !product.stock) { skipped++; return; }
    addToCart(product.id, Math.max(1, Math.min(Number(item.quantity) || 1, product.stockQty)));
    added++;
  });
  if (typeof showToast === "function") {
    if (added && !skipped) showToast(`Added ${added} item${added !== 1 ? "s" : ""} to your bag`);
    else if (added) showToast(`Added ${added} item${added !== 1 ? "s" : ""} — ${skipped} no longer available`);
    else showToast("These items aren't available right now", "error");
  }
  return added;
}

function orderItemsCount(order) {
  return (order.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
}

function orderItemsSubtotal(order) {
  return (order.items || []).reduce((s, i) => s + Number(i.price_at_purchase) * Number(i.quantity), 0);
}
