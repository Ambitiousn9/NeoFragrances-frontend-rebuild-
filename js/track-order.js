/* ============================================
   NeoFragrances — track-order.js
   Public order lookup (order number + email).
   POST /api/track-order is rate limited per IP and
   returns only status, total, date and items.
   ============================================ */

(function () {
  const form = document.getElementById("track-order-form");
  if (!form) return;
  const idInput = document.getElementById("track-order-id");
  const emailInput = document.getElementById("track-order-email");
  const resultEl = document.getElementById("track-order-result");
  const btn = form.querySelector("button[type=submit]");

  // Prefill from ?order= (order page "Track this order") and the signed-in email.
  const params = new URLSearchParams(window.location.search);
  const presetOrder = (params.get("order") || "").replace(/[^0-9]/g, "");
  if (presetOrder) idInput.value = presetOrder;
  const auth = typeof getAuth === "function" ? getAuth() : null;
  if (auth && auth.user) {
    if (auth.user.email) emailInput.value = auth.user.email;
    document.getElementById("track-signed-in-note").hidden = false;
  }

  function setFieldError(input, message) {
    const el = document.getElementById(`${input.id}-error`);
    el.textContent = message || "";
    el.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

  function resultHTML(data) {
    const items = data.items || [];
    return `
      <section class="nf-acc-card" aria-labelledby="track-result-title">
        <div class="nf-acc-block-head">
          <h2 id="track-result-title" class="nf-order-title-sm">Order #${escapeHtml(data.id)}</h2>
          ${orderStatusBadge(data.status)}
        </div>
        ${orderTimelineHTML(data)}
        <ul class="nf-track-items">
          ${items.map(i => `<li><span>${escapeHtml(i.name)} × ${escapeHtml(i.quantity)}</span><span>${money(Number(i.price_at_purchase) * Number(i.quantity))}</span></li>`).join("")}
        </ul>
        <dl class="nf-order-totals">
          <div class="nf-order-totals-total"><dt>Total paid</dt><dd>${money(data.total)}</dd></div>
        </dl>
        <p class="nf-acc-note">Placed ${escapeHtml(formatOrderDate(data.created_at))}. Questions? <a href="contact.html">Contact us</a>.</p>
      </section>`;
  }

  function messageHTML(message, tone) {
    return `<div class="nf-acc-state${tone === "error" ? " nf-acc-state--error" : ""}" role="alert">
      <i class="fa-solid ${tone === "error" ? "fa-triangle-exclamation" : "fa-magnifying-glass"}" aria-hidden="true"></i>
      <p>${escapeHtml(message)}</p>
    </div>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const orderId = idInput.value.trim().replace(/^#/, "");
    const email = emailInput.value.trim();
    setFieldError(idInput, /^\d+$/.test(orderId) ? "" : "Enter the order number from your confirmation, e.g. 47.");
    setFieldError(emailInput, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter the email address you ordered with.");
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    if (firstInvalid) { firstInvalid.focus(); return; }

    btn.disabled = true;
    btn.textContent = "Searching…";
    resultEl.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(`${API_BASE}/api/track-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        resultEl.innerHTML = messageHTML("Too many tracking attempts. Please wait a few minutes and try again.", "error");
      } else if (!res.ok) {
        resultEl.innerHTML = messageHTML(data.error || "We could not find an order matching that order number and email address.");
      } else {
        resultEl.innerHTML = resultHTML(data);
      }
    } catch (err) {
      resultEl.innerHTML = messageHTML("We couldn't reach the server. Please check your connection and try again.", "error");
    } finally {
      resultEl.removeAttribute("aria-busy");
      btn.disabled = false;
      btn.textContent = "Track order";
    }
  });
})();
