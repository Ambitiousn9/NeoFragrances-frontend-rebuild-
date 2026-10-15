/* ============================================
   NeoFragrances — payment-result.js
   payment-callback.html: Paystack returns the
   customer here with ?reference=…; the server
   verifies the payment with Paystack and creates
   the order. This page only presents the outcome.
   ============================================ */

const PAYRES_MAX_BUSY_RETRIES = 4;

function payResCard(html, busy = false) {
  const card = document.getElementById("callback-content");
  card.setAttribute("aria-busy", String(busy));
  card.innerHTML = html;
  card.querySelector("h1")?.setAttribute("tabindex", "-1");
  card.querySelector("h1")?.focus({ preventScroll: true });
}

function payResReferenceBlock(reference) {
  if (!reference) return "";
  return `
    <div class="nf-result-ref">
      <span>Payment reference</span>
      <code id="pay-ref">${escapeHtml(reference)}</code>
      <button type="button" class="nf-link-btn" id="copy-ref">Copy</button>
    </div>`;
}

function payResHelpLinks(reference) {
  const msg = `Hello NeoFragrances, I need help with my payment. Reference: ${reference || "(not available)"}`;
  const wa = typeof nfWhatsAppLink === "function" ? nfWhatsAppLink(msg) : "contact.html";
  const email = typeof NF_CONTACT !== "undefined" ? NF_CONTACT.email : "";
  return `
    <div class="nf-result-actions">
      <a class="btn btn-primary" href="${escapeHtml(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp us</a>
      ${email ? `<a class="btn btn-outline" href="mailto:${escapeHtml(email)}?subject=${encodeURIComponent(`Payment help — ${reference || ""}`)}&body=${encodeURIComponent(msg)}">Email us</a>` : ""}
    </div>`;
}

function payResSuccess(data) {
  clearCart();
  try { sessionStorage.removeItem("nf_cart_coupon"); } catch (e) { /* ignore */ }
  document.title = "Order Confirmed — NeoFragrances";
  payResCard(`
    <span class="nf-result-icon nf-result-icon--ok" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
    <h1>Thank you — your order is confirmed</h1>
    <p>Your payment was received and your order is now being processed.</p>
    <dl class="nf-result-facts">
      <div><dt>Order number</dt><dd>#${escapeHtml(data.orderId)}</dd></div>
      <div><dt>Total paid</dt><dd>${money(data.total)}</dd></div>
    </dl>
    <p class="nf-result-small">You can follow this order any time from My Orders, or with the order number on Track an Order.</p>
    <div class="nf-result-actions">
      <a href="my-account.html#orders" class="btn btn-primary">View my orders</a>
      <a href="products.html" class="btn btn-outline">Continue shopping</a>
    </div>`);
}

function payResNotCompleted() {
  document.title = "Payment Not Completed — NeoFragrances";
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-xmark"></i></span>
    <h1>Your payment wasn't completed</h1>
    <p>No order was placed. Your bag is still saved, so you can review it and try again whenever you're ready.</p>
    <div class="nf-result-actions">
      <a href="cart.html" class="btn btn-primary">Return to your bag</a>
      <a href="contact.html" class="btn btn-outline">Get help</a>
    </div>`);
}

function payResNeedsHelp(message, reference) {
  document.title = "Payment Needs Attention — NeoFragrances";
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-circle-exclamation"></i></span>
    <h1>We need to check this payment</h1>
    <p>${escapeHtml(message || "We couldn't confirm your order automatically.")}</p>
    <p class="nf-result-small">Please contact us and share the reference below — we'll sort it out with you.</p>
    ${payResReferenceBlock(reference)}
    ${payResHelpLinks(reference)}`);
}

function payResLogin(reference) {
  const back = `payment-callback.html?reference=${encodeURIComponent(reference)}`;
  payResCard(`
    <span class="nf-result-icon" aria-hidden="true"><i class="fa-solid fa-user-lock"></i></span>
    <h1>Log in to confirm your order</h1>
    <p>Please log in with the account you used to pay. We'll bring you straight back here to confirm the order.</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <a href="login.html?redirect=${encodeURIComponent(back)}" class="btn btn-primary">Log in</a>
    </div>`);
}

function payResWrongAccount(reference) {
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-user-xmark"></i></span>
    <h1>This payment belongs to another account</h1>
    <p>Log out, then log in with the account you used to pay to confirm this order.</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <button type="button" class="btn btn-primary" id="switch-account">Log in with a different account</button>
    </div>`);
  document.getElementById("switch-account").addEventListener("click", () => {
    clearAuth();
    window.location.href = `login.html?redirect=${encodeURIComponent(`payment-callback.html?reference=${encodeURIComponent(reference)}`)}`;
  });
}

function payResOffline(reference) {
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-wifi"></i></span>
    <h1>We couldn't reach our server</h1>
    <p>Your payment may have gone through. Check your connection, then try confirming again.</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <button type="button" class="btn btn-primary" id="retry-verify">Try again</button>
    </div>`);
  document.getElementById("retry-verify").addEventListener("click", () => verifyPayment(reference, 0));
}

async function verifyPayment(reference, attempt) {
  payResCard(`
    <span class="nf-spinner" aria-hidden="true"></span>
    <h1>Confirming your payment…</h1>
    <p>This usually takes a few seconds. Please keep this page open.</p>`, true);

  const auth = getAuth();
  if (!auth || !auth.token) { payResLogin(reference); return; }

  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/payments/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    payResOffline(reference);
    return;
  }

  if (res.ok) { payResSuccess(data); return; }
  if (res.status === 401) { clearAuth(); payResLogin(reference); return; }
  if (res.status === 403) { payResWrongAccount(reference); return; }
  if (data.code === "VERIFY_BUSY" && attempt < PAYRES_MAX_BUSY_RETRIES) {
    setTimeout(() => verifyPayment(reference, attempt + 1), 1500);
    return;
  }
  if (data.code === "PAYMENT_NOT_SUCCESSFUL") { payResNotCompleted(); return; }
  if (data.code === "INVALID_REFERENCE") { payResNeedsHelp("This payment link isn't valid.", reference); return; }
  payResNeedsHelp(data.error, data.reference || reference);
}

document.addEventListener("click", async (e) => {
  if (e.target.id !== "copy-ref") return;
  const ref = document.getElementById("pay-ref")?.textContent || "";
  try { await navigator.clipboard.writeText(ref); e.target.textContent = "Copied"; }
  catch (err) { e.target.textContent = "Select and copy"; }
});

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const reference = (params.get("reference") || params.get("trxref") || "").trim();
  if (!reference) {
    payResCard(`
      <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-circle-question"></i></span>
      <h1>No payment to confirm</h1>
      <p>This page is used to confirm payments returning from Paystack, but no payment reference was found.</p>
      <div class="nf-result-actions">
        <a href="cart.html" class="btn btn-primary">Go to your bag</a>
        <a href="my-account.html#orders" class="btn btn-outline">My orders</a>
      </div>`);
    return;
  }
  verifyPayment(reference, 0);
});
