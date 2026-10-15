/* ============================================
   NeoFragrances — reviews.js (Phase 4)
   Star ratings + written reviews on product-details.html.
   Verified Purchase is checked server-side against
   real order history, not something the browser claims.
   ============================================ */

async function loadReviews(productId) {
  try {
    const res = await fetch(`${API_BASE}/api/products/${productId}/reviews`);
    return res.ok ? await res.json() : [];
  } catch (err) {
    console.error("Could not load reviews:", err);
    return [];
  }
}

function starIcons(rating) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<i class="fa-solid fa-star" style="color:${i <= Math.round(rating) ? 'var(--gold)' : '#E4DAD0'};"></i>`;
  }
  return html;
}

function renderReviewsSummary(reviews) {
  const el = document.getElementById("reviews-summary");
  if (!el) return;
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <span style="font-size:28px; font-weight:700; font-family:var(--font-display);">${avg.toFixed(1)}</span>
      <div>${starIcons(avg)}</div>
      <span style="color:var(--ink-soft); font-size:14px;">(${reviews.length} review${reviews.length !== 1 ? "s" : ""})</span>
    </div>`;
}

function renderReviewsList(reviews) {
  const el = document.getElementById("reviews-list");
  if (!el) return;
  el.innerHTML = reviews.length
    ? reviews.map(r => `
      <div style="border-bottom:1px solid var(--line); padding:18px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
          <strong>${escapeHtml(r.full_name)}</strong>
          ${r.is_verified_purchase ? `<span style="font-size:11px; color:#22733B; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Verified Purchase</span>` : ""}
        </div>
        <div style="margin-bottom:8px;">${starIcons(r.rating)}</div>
        ${r.comment ? `<p style="color:var(--ink-soft); font-size:14px;">${escapeHtml(r.comment)}</p>` : ""}
        <div style="font-size:12px; color:var(--ink-soft); margin-top:6px;">${escapeHtml(new Date(r.created_at).toLocaleDateString())}</div>
      </div>
    `).join("")
    : `<p style="color:var(--ink-soft);">No reviews yet — be the first to review this fragrance.</p>`;
}

function renderReviewForm(productId) {
  const el = document.getElementById("review-form-wrap");
  if (!el) return;

  if (typeof isLoggedIn !== "function" || !isLoggedIn()) {
    el.innerHTML = `<p style="color:var(--ink-soft); font-size:14px;"><a href="login.html" style="color:var(--wine); font-weight:600;">Log in</a> to leave a review.</p>`;
    return;
  }

  el.innerHTML = `
    <h4 style="margin-bottom:12px; font-size:16px;">Write a Review</h4>
    <div class="field">
      <label>Rating</label>
      <select id="review-rating" style="width:160px; padding:10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body);">
        <option value="5">5 - Excellent</option>
        <option value="4">4 - Good</option>
        <option value="3">3 - Average</option>
        <option value="2">2 - Poor</option>
        <option value="1">1 - Terrible</option>
      </select>
    </div>
    <div class="field">
      <label>Comment</label>
      <textarea id="review-comment" rows="3" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body);" placeholder="Share your thoughts..."></textarea>
    </div>
    <button class="btn btn-primary btn-sm" id="submit-review-btn">Submit Review</button>
    <p id="review-msg" style="font-size:13px; margin-top:10px;"></p>
  `;

  document.getElementById("submit-review-btn").addEventListener("click", async () => {
    const rating = Number(document.getElementById("review-rating").value);
    const comment = document.getElementById("review-comment").value.trim();
    const auth = getAuth();
    const btn = document.getElementById("submit-review-btn");
    btn.disabled = true;
    btn.textContent = "Submitting...";
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ rating, comment }),
      });
      // A 401 here means the session is over - an expired token, or an account
      // an administrator has disabled. Either way the saved login is stale, so
      // it is cleared and the customer is sent to log in, exactly as
      // nfAuthFetch and the wishlist do. Without this the server's message was
      // shown as an inline form error while the page carried on looking signed
      // in, which left the customer retrying a request that could never succeed.
      if (res.status === 401 && typeof nfHandleExpiredSession === "function") {
        return nfHandleExpiredSession();
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit review.");
      document.getElementById("review-msg").textContent = "Thanks for your review!";
      document.getElementById("review-msg").style.color = "#22733B";
      document.getElementById("review-comment").value = "";
      const reviews = await loadReviews(productId);
      renderReviewsSummary(reviews);
      renderReviewsList(reviews);
    } catch (err) {
      document.getElementById("review-msg").textContent = err.message;
      document.getElementById("review-msg").style.color = "var(--wine)";
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit Review";
    }
  });
}

async function initReviews(productId) {
  const reviews = await loadReviews(productId);
  renderReviewsSummary(reviews);
  renderReviewsList(reviews);
  renderReviewForm(productId);
}
