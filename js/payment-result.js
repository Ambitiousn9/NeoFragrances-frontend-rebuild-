/* ============================================
   NeoFragrances — payment-result.js
   payment-callback.html: Paystack returns the
   customer here with ?reference=…; the server
   verifies the payment with Paystack and creates
   the order. This page only presents the outcome.
   ============================================ */

const PAYRES_MAX_BUSY_RETRIES = 4;
// A pending payment (e.g. Mobile Money awaiting approval) is re-checked automatically
// at most this many times, after these delays; after that only the customer's own
// "Check again" button asks the server again. Never an open-ended polling loop.
const PAYRES_PENDING_AUTO_DELAYS_MS = [5000, 10000, 20000];
let payResAutoChecks = 0;
let payResTimer = null;

function payResSchedule(fn, ms) {
  clearTimeout(payResTimer);
  payResTimer = setTimeout(fn, ms);
}

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

// Shown only for a DEFINITIVE unsuccessful state reported by Paystack
// (PAYMENT_NOT_SUCCESSFUL), never for a timeout, an error or a pending payment.
function payResNotCompleted(reference) {
  document.title = "Payment Not Completed — NeoFragrances";
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-xmark"></i></span>
    <h1>Your payment wasn't completed</h1>
    <p>No order was placed. Your bag is still saved, so you can review it and try again whenever you're ready.</p>
    <p class="nf-result-small">If money did leave your account for this payment, please contact us with the reference below before paying again.</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <a href="cart.html" class="btn btn-primary">Return to your bag</a>
      <a href="contact.html" class="btn btn-outline">Get help</a>
    </div>`);
}

// Paystack reports the payment as still in progress. Nothing is confirmed, nothing
// is cleared, and the customer is told not to pay again.
function payResPending(reference) {
  document.title = "Payment Being Confirmed — NeoFragrances";
  const autoLeft = payResAutoChecks < PAYRES_PENDING_AUTO_DELAYS_MS.length;
  payResCard(`
    <span class="nf-result-icon" aria-hidden="true"><i class="fa-solid fa-hourglass-half"></i></span>
    <h1>Your payment is still being confirmed</h1>
    <p>Paystack hasn't confirmed this payment yet. If you're paying with Mobile Money, approve the prompt on your phone.</p>
    <p><strong>Please don't pay again.</strong> ${autoLeft ? "We'll check again automatically in a few seconds." : "Use the button below to check again."}</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <button type="button" class="btn btn-primary" id="check-again">Check again</button>
    </div>
    <p class="nf-result-small">If it stays like this, contact us with the reference above — don't start a new payment.</p>
    ${payResHelpLinks(reference)}`);
  document.getElementById("check-again").addEventListener("click", () => { clearTimeout(payResTimer); verifyPayment(reference, 0); });
  if (autoLeft) {
    const delay = PAYRES_PENDING_AUTO_DELAYS_MS[payResAutoChecks];
    payResAutoChecks++;
    payResSchedule(() => verifyPayment(reference, 0), delay);
  }
}

// The outcome could not be established (Paystack unreachable or timing out, the
// server busy for too long, or the order could not be written yet). The payment may
// well have succeeded, so the customer is never told that no order exists or
// invited to pay again — only to check again or contact us.
function payResUnconfirmed(message, reference) {
  document.title = "Payment Not Yet Confirmed — NeoFragrances";
  payResCard(`
    <span class="nf-result-icon nf-result-icon--warn" aria-hidden="true"><i class="fa-solid fa-circle-exclamation"></i></span>
    <h1>We couldn't confirm your payment yet</h1>
    <p>${escapeHtml(message || "We couldn't confirm your payment right now.")}</p>
    <p><strong>Please don't pay again.</strong> Your payment may already have gone through.</p>
    ${payResReferenceBlock(reference)}
    <div class="nf-result-actions">
      <button type="button" class="btn btn-primary" id="retry-verify">Check again</button>
    </div>
    ${payResHelpLinks(reference)}`);
  document.getElementById("retry-verify").addEventListener("click", () => { clearTimeout(payResTimer); verifyPayment(reference, 0); });
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

  // Success only when the server returns the order it created (201) or found (200).
  // This is the ONLY path that clears the bag.
  if ((res.status === 200 || res.status === 201) && data && data.orderId) { payResSuccess(data); return; }
  if (res.status === 202 || data.code === "PAYMENT_PENDING") { payResPending(reference); return; }
  if (res.status === 401) { clearAuth(); payResLogin(reference); return; }
  if (res.status === 403) { payResWrongAccount(reference); return; }
  if (data.code === "VERIFY_BUSY" && attempt < PAYRES_MAX_BUSY_RETRIES) {
    payResSchedule(() => verifyPayment(reference, attempt + 1), 1500);
    return;
  }
  if (data.code === "PAYMENT_NOT_SUCCESSFUL") { payResNotCompleted(reference); return; }
  if (data.code === "INVALID_REFERENCE") { payResNeedsHelp("This payment link isn't valid.", reference); return; }
  if (["PAYMENT_VERIFY_UNAVAILABLE", "VERIFY_BUSY", "SETTLEMENT_ERROR"].includes(data.code) || (res.status >= 500 && !data.code)) {
    payResUnconfirmed(data.error, data.reference || reference);
    return;
  }
  // Verified but blocked (sold out after payment, amount/snapshot mismatch, coupon
  // used up, …): the payment exists but no order was created. Never a success.
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
