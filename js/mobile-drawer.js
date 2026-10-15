/* ============================================
   NeoFragrances — mobile-drawer.js
   Slide-in mobile navigation drawer (<=768px).
   Injects its own markup into <body> at runtime —
   no HTML changes needed on any page.

   Reuses, does NOT duplicate:
   - getAuth() / logoutUser()   (js/auth.js)
   - WISHLIST_IDS               (js/wishlist.js)
   - existing CSS variables      (css/style.css)

   Load order required: main.js, auth.js, wishlist.js,
   THEN this file, on every page that has the navbar.

   This REPLACES the old ".nav-links.open" dropdown
   toggle on mobile — see the one-line change needed
   in main.js noted in the deployment instructions.
   ============================================ */

function mnavBuildMarkup() {
  if (document.getElementById("mnav-drawer")) return; // already injected

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="mnav-overlay" id="mnav-overlay"></div>
    <aside class="mnav-drawer" id="mnav-drawer" aria-hidden="true" role="dialog" aria-label="Site menu">
      <div class="mnav-header">
        <a href="index.html" class="logo"><img src="images/logo/logo.png" alt="NeoFragrances" style="height:38px; width:auto;"></a>
        <button class="mnav-close" id="mnav-close" aria-label="Close menu" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div id="mnav-profile"></div>

      <nav class="mnav-nav">
        <div class="mnav-section">
          <div class="mnav-section-title">Shop</div>
          <a href="index.html" class="mnav-link" data-page="index.html"><i class="fa-solid fa-house"></i> Home</a>
          <a href="products.html" class="mnav-link" data-page="products.html"><i class="fa-solid fa-flask"></i> Shop All</a>
          <a href="products.html?category=men" class="mnav-link"><i class="fa-solid fa-mars"></i> Men</a>
          <a href="products.html?category=women" class="mnav-link"><i class="fa-solid fa-venus"></i> Women</a>
          <a href="products.html?category=unisex" class="mnav-link"><i class="fa-solid fa-venus-mars"></i> Unisex</a>
          <a href="special-offers.html" class="mnav-link" data-page="special-offers.html"><i class="fa-solid fa-tag"></i> Special Offers</a>
        </div>

        <div class="mnav-section">
          <div class="mnav-section-title">Help</div>
          <a href="about.html" class="mnav-link" data-page="about.html"><i class="fa-solid fa-circle-info"></i> About Us</a>
          <a href="contact.html" class="mnav-link" data-page="contact.html"><i class="fa-solid fa-phone"></i> Contact Us</a>
          <a href="track-order.html" class="mnav-link" data-page="track-order.html"><i class="fa-solid fa-truck-fast"></i> Track an Order</a>
          <a href="shipping.html" class="mnav-link" data-page="shipping.html"><i class="fa-solid fa-truck"></i> Shipping &amp; Delivery</a>
          <a href="returns.html" class="mnav-link" data-page="returns.html"><i class="fa-solid fa-rotate-left"></i> Returns &amp; Refunds</a>
          <a href="FAQ.html" class="mnav-link" data-page="FAQ.html"><i class="fa-regular fa-circle-question"></i> FAQ</a>
        </div>

        <div class="mnav-section">
          <div class="mnav-section-title">Account</div>
          <a href="my-account.html" class="mnav-link" data-page="my-account.html"><i class="fa-regular fa-user"></i> My Account</a>
          <a href="my-account.html#wishlist" class="mnav-link" data-page="my-account.html#wishlist">
            <i class="fa-regular fa-heart"></i> Wishlist
            <span class="mnav-badge-count" id="mnav-wishlist-count" style="display:none;">0</span>
          </a>
          <a href="my-account.html#orders" class="mnav-link" data-page="my-account.html#orders"><i class="fa-regular fa-clipboard"></i> My Orders</a>
          <button class="mnav-link mnav-logout" id="mnav-logout-btn" type="button">
            <i class="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        </div>
      </nav>

      <div class="mnav-trust">
        <div class="mnav-trust-item"><i class="fa-solid fa-lock"></i><div><strong>Secure checkout</strong><span>Payments processed by Paystack</span></div></div>
        <div class="mnav-trust-item"><i class="fa-brands fa-whatsapp"></i><div><strong>Talk to us</strong><span>Call, email or WhatsApp</span></div></div>
      </div>
    </aside>
  `;
  document.body.appendChild(wrap);
}

function mnavRenderProfile() {
  const el = document.getElementById("mnav-profile");
  if (!el) return;

  const auth = (typeof getAuth === "function") ? getAuth() : null;
  const logoutBtn = document.getElementById("mnav-logout-btn");
  if (logoutBtn) logoutBtn.hidden = !(auth && auth.user);

  if (auth && auth.user) {
    const initial = (auth.user.full_name || "?").charAt(0).toUpperCase();
    const roleLabel = (auth.user.role || "customer").replace(/^\w/, c => c.toUpperCase());
    el.innerHTML = `
      <a href="my-account.html" class="mnav-profile-card">
        <div class="mnav-avatar">${escapeHtml(initial)}</div>
        <div class="mnav-profile-info">
          <strong>${escapeHtml(auth.user.full_name)}</strong>
          <span>${escapeHtml(auth.user.email)}</span>
          <span class="mnav-role-badge"><i class="fa-solid fa-crown"></i> ${escapeHtml(roleLabel)}</span>
        </div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>`;
  } else {
    el.innerHTML = `
      <a href="login.html" class="mnav-profile-card mnav-guest">
        <div class="mnav-avatar"><i class="fa-regular fa-user"></i></div>
        <div class="mnav-profile-info">
          <strong>Welcome</strong>
          <span>Log in or create an account</span>
        </div>
        <i class="fa-solid fa-chevron-right"></i>
      </a>`;
  }
}

function mnavRenderWishlistCount() {
  const badge = document.getElementById("mnav-wishlist-count");
  if (!badge) return;
  const count = (typeof WISHLIST_IDS !== "undefined") ? WISHLIST_IDS.size : 0;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

function mnavMarkActivePage() {
  const current = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".mnav-link[data-page]").forEach(link => {
    link.classList.toggle("active", link.dataset.page === current);
  });
}

function openMobileDrawer() {
  const drawer = document.getElementById("mnav-drawer");
  const overlay = document.getElementById("mnav-overlay");
  if (!drawer || !overlay) return;
  mnavRenderProfile();
  mnavRenderWishlistCount();
  mnavMarkActivePage();
  drawer.classList.add("open");
  overlay.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("mnav-lock-scroll");
}

function closeMobileDrawer() {
  const drawer = document.getElementById("mnav-drawer");
  const overlay = document.getElementById("mnav-overlay");
  if (!drawer || !overlay) return;
  drawer.classList.remove("open");
  overlay.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("mnav-lock-scroll");
}

document.addEventListener("DOMContentLoaded", () => {
  mnavBuildMarkup();

  const toggleBtn = document.querySelector(".nav-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", openMobileDrawer);
  }

  document.getElementById("mnav-close")?.addEventListener("click", closeMobileDrawer);
  document.getElementById("mnav-overlay")?.addEventListener("click", closeMobileDrawer);

  // Close the drawer before navigating when any nav link is clicked
  document.querySelectorAll(".mnav-link[href]").forEach(link => {
    link.addEventListener("click", closeMobileDrawer);
  });

  document.getElementById("mnav-logout-btn")?.addEventListener("click", () => {
    closeMobileDrawer();
    if (typeof logoutUser === "function") {
      if (confirm("Log out of your account?")) logoutUser();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileDrawer();
  });
});

// Keep the wishlist badge live if wishlist.js finishes loading after us
document.addEventListener("productsReady", mnavRenderWishlistCount);
