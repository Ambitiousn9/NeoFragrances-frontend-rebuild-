/* ============================================
   NeoFragrances — wishlist.js (Phase 4)
   Heart-button save/remove on every product card;
   the full list lives in My Account (account.js).
   ============================================ */

let WISHLIST_IDS = new Set();

async function loadWishlist() {
  if (typeof isLoggedIn !== "function" || !isLoggedIn()) {
    WISHLIST_IDS = new Set();
    return;
  }
  try {
    const auth = getAuth();
    const res = await fetch(`${API_BASE}/api/wishlist`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    // A stale/expired token: forget it quietly so the page stops acting logged in.
    if (res.status === 401) {
      if (typeof clearAuth === "function") clearAuth();
      WISHLIST_IDS = new Set();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    WISHLIST_IDS = new Set(data.map(p => p.id));
  } catch (err) {
    console.error("Could not load wishlist:", err);
  }
}

function refreshWishlistIcons() {
  document.querySelectorAll(".wishlist-btn").forEach(btn => {
    const id = Number(btn.dataset.id);
    const icon = btn.querySelector("i");
    // Some elements (e.g. the product page's Share button) reuse the
    // .wishlist-btn class purely for matching styles but aren't actual
    // wishlist toggles — they have no <i> icon and no data-id. Skip
    // them instead of crashing, which used to silently stop every
    // script that ran after this one on the page.
    if (!icon || !btn.dataset.id) return;

    if (WISHLIST_IDS.has(id)) {
      icon.classList.remove("fa-regular");
      icon.classList.add("fa-solid");
      btn.classList.add("active");
    } else {
      icon.classList.remove("fa-solid");
      icon.classList.add("fa-regular");
      btn.classList.remove("active");
    }
  });
}

async function toggleWishlist(productId, btn) {
  if (typeof isLoggedIn !== "function" || !isLoggedIn()) {
    if (confirm("You need to be logged in to save items. Go to the login page?")) {
      window.location.href = typeof nfLoginRedirectUrl === "function"
        ? nfLoginRedirectUrl().replace("&expired=1", "")
        : "login.html";
    }
    return;
  }

  const auth = getAuth();
  const inWishlist = WISHLIST_IDS.has(productId);

  try {
    let res;
    if (inWishlist) {
      res = await fetch(`${API_BASE}/api/wishlist/${productId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } else {
      res = await fetch(`${API_BASE}/api/wishlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ productId }),
      });
    }
    if (res.status === 401 && typeof nfHandleExpiredSession === "function") return nfHandleExpiredSession();
    if (!res.ok) throw new Error("Wishlist update failed");
    if (inWishlist) WISHLIST_IDS.delete(productId); else WISHLIST_IDS.add(productId);
    refreshWishlistIcons();
    if (typeof showToast === "function") showToast(inWishlist ? "Removed from wishlist" : "Saved to wishlist");
  } catch (err) {
    if (typeof showToast === "function") showToast("Something went wrong updating your wishlist.", "error");
  }
}

document.addEventListener("productsReady", async (e) => {
  if (!e.detail.success) return;
  await loadWishlist();
  refreshWishlistIcons();
});
