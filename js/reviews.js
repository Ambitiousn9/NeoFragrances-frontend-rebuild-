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

/* ---------- writing and editing (R3) ----------
   One review per customer per product (server: 409 REVIEW_EXISTS, migration 010).
   A signed-in customer who has reviewed this product sees their review with an Edit
   button; editing uses PUT .../reviews/mine. Comments are capped at 1,000 characters,
   the same limit the server enforces. */
const REVIEW_COMMENT_MAX = 1000;
const REVIEW_NETWORK_ERROR = "We couldn't reach the server. Please check your connection and try again.";
const RATING_LABELS = { 5: "5 - Excellent", 4: "4 - Good", 3: "3 - Average", 2: "2 - Poor", 1: "1 - Terrible" };

// The signed-in customer's own review: { review } (review may be null), or { expired: true }, or { error }.
async function loadMyReview(productId) {
  try {
    const auth = getAuth();
    const res = await fetch(`${API_BASE}/api/products/${productId}/reviews/mine`, { headers: { Authorization: `Bearer ${auth.token}` } });
    if (res.status === 401) return { expired: true };
    if (!res.ok) return { error: true };
    const data = await res.json();
    return { review: data && data.review ? data.review : null };
  } catch (err) {
    return { error: true };
  }
}

function setReviewMsg(text, ok) {
  const msg = document.getElementById("review-msg");
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = ok ? "#22733B" : "var(--wine)";
}

function myReviewHTML(review) {
  return `
    <h4 style="margin-bottom:12px; font-size:16px;">Your Review</h4>
    <div id="my-review" style="border:1px solid var(--line); border-radius:4px; padding:14px 16px; margin-bottom:12px;">
      <div style="margin-bottom:6px;">${starIcons(review.rating)} <span class="sr-only">${escapeHtml(review.rating)} out of 5 stars</span></div>
      ${review.comment ? `<p style="color:var(--ink-soft); font-size:14px;">${escapeHtml(review.comment)}</p>` : `<p style="color:var(--ink-soft); font-size:14px; font-style:italic;">No comment added.</p>`}
      ${review.hidden ? `<p style="font-size:12px; color:var(--wine); margin-top:8px;">This review isn't shown publicly at the moment.</p>` : ""}
    </div>
    <button type="button" class="btn btn-outline btn-sm" id="edit-review-btn">Edit Review</button>
    <p id="review-msg" role="status" aria-live="polite" style="font-size:13px; margin-top:10px;"></p>`;
}

function reviewFormHTML(review) {
  const editing = !!review;
  const rating = editing ? Number(review.rating) : 5;
  const comment = editing && review.comment ? review.comment : "";
  return `
    <h4 style="margin-bottom:12px; font-size:16px;">${editing ? "Edit Your Review" : "Write a Review"}</h4>
    <div class="field">
      <label for="review-rating">Rating</label>
      <select id="review-rating" style="width:160px; padding:10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body);">
        ${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${n === rating ? " selected" : ""}>${RATING_LABELS[n]}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="review-comment">Comment</label>
      <textarea id="review-comment" rows="3" maxlength="${REVIEW_COMMENT_MAX}" aria-describedby="review-count" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body);" placeholder="Share your thoughts...">${escapeHtml(comment)}</textarea>
      <p id="review-count" style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${comment.length.toLocaleString("en-GB")} / ${REVIEW_COMMENT_MAX.toLocaleString("en-GB")} characters</p>
    </div>
    <button type="button" class="btn btn-primary btn-sm" id="submit-review-btn">${editing ? "Save Changes" : "Submit Review"}</button>
    ${editing ? `<button type="button" class="btn btn-outline btn-sm" id="cancel-edit-btn" style="margin-left:8px;">Cancel</button>` : ""}
    <p id="review-msg" role="status" aria-live="polite" style="font-size:13px; margin-top:10px;"></p>`;
}

async function refreshPublicReviews(productId) {
  const reviews = await loadReviews(productId);
  renderReviewsSummary(reviews);
  renderReviewsList(reviews);
}

// Shows the customer's own review (with Edit), or the form. `review` is null for a new review.
function showMyReview(productId, review, message) {
  const el = document.getElementById("review-form-wrap");
  if (!el) return;
  el.innerHTML = myReviewHTML(review);
  document.getElementById("edit-review-btn").addEventListener("click", () => showReviewForm(productId, review));
  if (message) setReviewMsg(message, true);
}

function showReviewForm(productId, review) {
  const el = document.getElementById("review-form-wrap");
  if (!el) return;
  const editing = !!review;
  el.innerHTML = reviewFormHTML(review);

  const textarea = document.getElementById("review-comment");
  const counter = document.getElementById("review-count");
  textarea.addEventListener("input", () => {
    counter.textContent = `${textarea.value.length.toLocaleString("en-GB")} / ${REVIEW_COMMENT_MAX.toLocaleString("en-GB")} characters`;
  });
  if (editing) document.getElementById("cancel-edit-btn").addEventListener("click", () => showMyReview(productId, review));

  document.getElementById("submit-review-btn").addEventListener("click", async () => {
    const rating = Number(document.getElementById("review-rating").value);
    const comment = document.getElementById("review-comment").value.trim();
    if (comment.length > REVIEW_COMMENT_MAX) {
      setReviewMsg(`Please keep your comment to ${REVIEW_COMMENT_MAX.toLocaleString("en-GB")} characters or fewer.`, false);
      return;
    }
    const auth = getAuth();
    const btn = document.getElementById("submit-review-btn");
    btn.disabled = true;
    btn.textContent = editing ? "Saving..." : "Submitting...";
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}/reviews${editing ? "/mine" : ""}`, {
        method: editing ? "PUT" : "POST",
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
      const data = await res.json().catch(() => ({}));
      // Already reviewed (another tab, or a double submit): show that review with its Edit option.
      if (res.status === 409 && data.code === "REVIEW_EXISTS") {
        const mine = await loadMyReview(productId);
        if (mine.review) { showMyReview(productId, mine.review); setReviewMsg(data.error, false); return; }
      }
      if (!res.ok) throw new Error(data.error || (editing ? "Could not update your review." : "Could not submit review."));
      await refreshPublicReviews(productId);
      const mine = await loadMyReview(productId);
      const saved = mine.review || (editing ? { ...review, rating, comment: comment || null } : { rating, comment: comment || null, hidden: 0 });
      showMyReview(productId, saved, editing ? "Your review has been updated." : "Thanks for your review!");
    } catch (err) {
      // fetch() rejects with a TypeError when the server can't be reached; show a plain message, not "Failed to fetch".
      setReviewMsg(err instanceof TypeError ? REVIEW_NETWORK_ERROR : err.message, false);
      const b = document.getElementById("submit-review-btn");
      if (b) { b.disabled = false; b.textContent = editing ? "Save Changes" : "Submit Review"; }
    }
  });
}

async function renderReviewForm(productId) {
  const el = document.getElementById("review-form-wrap");
  if (!el) return;

  if (typeof isLoggedIn !== "function" || !isLoggedIn()) {
    el.innerHTML = `<p style="color:var(--ink-soft); font-size:14px;"><a href="login.html" style="color:var(--wine); font-weight:600;">Log in</a> to leave a review.</p>`;
    return;
  }

  const mine = await loadMyReview(productId);
  if (mine.expired && typeof nfHandleExpiredSession === "function") return nfHandleExpiredSession();
  if (mine.review) return showMyReview(productId, mine.review);
  // No review yet (or it couldn't be checked: the server still refuses a second one with 409).
  showReviewForm(productId, null);
}

async function initReviews(productId) {
  const reviews = await loadReviews(productId);
  renderReviewsSummary(reviews);
  renderReviewsList(reviews);
  renderReviewForm(productId);
}
