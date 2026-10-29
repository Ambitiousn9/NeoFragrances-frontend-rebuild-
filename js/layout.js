/* ============================================
   NeoFragrances — layout.js
   Shared site header + footer for every
   customer-facing page (admin has its own).

   Usage (top of <body>):
     <div id="site-header"></div>
     <script src="js/layout.js"></script>
   and anywhere before the closing scripts:
     <div id="site-footer"></div>

   The header is rendered synchronously so the
   scripts that bind to it on DOMContentLoaded
   (auth.js, cart.js, mobile-drawer.js) find the
   same hooks as before: .cart-count, .nav-toggle,
   .nav-icons a[href="login.html"], .mobile-account-item.
   ============================================ */

// Confirmed business contact details — the only place they are defined.
const NF_CONTACT = {
  phoneDisplay: "0505 731 824",
  phoneHref: "tel:+233505731824",
  email: "Ambitiousn9@icloud.com",
  whatsappNumber: "233505731824",
};

function nfWhatsAppLink(message) {
  const base = `https://wa.me/${NF_CONTACT.whatsappNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

// Marks the html element so CSS can apply JS-dependent states (e.g. reveal animations)
// without hiding content for visitors whose JavaScript fails.
document.documentElement.classList.add("js");

function nfCurrentNavKey() {
  const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const category = new URLSearchParams(window.location.search).get("category");
  if (page === "products.html") return ["men", "women", "unisex"].includes(category) ? category : "shop";
  if (page === "product-details.html") return "shop";
  if (page === "special-offers.html") return "offers";
  if (page === "about.html") return "about";
  if (page === "contact.html") return "contact";
  return "";
}

function nfHeaderHTML() {
  const navItems = [
    ["shop", "products.html", "Shop All"],
    ["men", "products.html?category=men", "Men"],
    ["women", "products.html?category=women", "Women"],
    ["unisex", "products.html?category=unisex", "Unisex"],
    ["offers", "special-offers.html", "Offers"],
    ["about", "about.html", "About"],
    ["contact", "contact.html", "Contact"],
  ];
  const active = nfCurrentNavKey();
  const links = navItems.map(([key, href, label]) =>
    `<li><a href="${href}" data-nav="${key}"${key === active ? ' class="active" aria-current="page"' : ""}>${label}</a></li>`
  ).join("");

  return `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header nf-header">
    <div class="container navbar">
      <a href="index.html" class="logo nf-wordmark nf-wordmark--header" aria-label="NeoFragrances home">
        <span class="nf-wordmark-neo">Neo</span><span class="nf-wordmark-rest">Fragrances</span>
      </a>
      <nav class="nf-primary-nav" aria-label="Primary">
        <ul class="nav-links">
          ${links}
          <li class="mobile-account-item"><a href="login.html"><i class="fa-regular fa-user"></i>&nbsp;Login / Register</a></li>
          <li class="mobile-account-item"><a href="my-account.html#wishlist"><i class="fa-regular fa-heart"></i>&nbsp;Wishlist</a></li>
          <li class="mobile-account-item"><a href="my-account.html#orders"><i class="fa-solid fa-receipt"></i>&nbsp;My Orders</a></li>
        </ul>
      </nav>
      <div class="nav-icons">
        <button class="nf-icon-btn nf-search-toggle" type="button" aria-label="Search fragrances" aria-expanded="false" aria-controls="nf-search-panel"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>
        <a href="login.html" title="Login / Register" aria-label="Account" class="icon-secondary"><i class="fa-regular fa-user" aria-hidden="true"></i></a>
        <a href="my-account.html#wishlist" title="Wishlist" aria-label="Wishlist" class="icon-secondary"><i class="fa-regular fa-heart" aria-hidden="true"></i></a>
        <a href="cart.html" title="Cart" aria-label="Cart" class="nf-cart-link"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i><span class="cart-count">0</span></a>
        <button class="nav-toggle" type="button" aria-label="Open menu" aria-controls="mnav-drawer"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="nf-search-panel" id="nf-search-panel" hidden>
      <form class="container nf-search-form" action="products.html" method="get" role="search">
        <label for="nf-search-input" class="sr-only">Search fragrances or houses</label>
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input id="nf-search-input" name="q" type="search" placeholder="Search fragrances or houses" autocomplete="off" enterkeyhint="search">
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
        <button type="button" class="nf-icon-btn nf-search-close" aria-label="Close search"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </form>
    </div>
  </header>`;
}

function nfFooterHTML() {
  const year = new Date().getFullYear();
  const newTab = `<span class="sr-only"> (opens in a new tab)</span>`;
  const links = (items) => items.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("");
  const shop = [
    ["products.html", "All Fragrances"],
    ["products.html?category=men", "Men"],
    ["products.html?category=women", "Women"],
    ["products.html?category=unisex", "Unisex"],
    ["special-offers.html", "Special Offers"],
  ];
  const care = [
    ["contact.html", "Contact Us"],
    ["track-order.html", "Track an Order"],
    ["shipping.html", "Shipping &amp; Delivery"],
    ["returns.html", "Returns &amp; Refunds"],
    ["FAQ.html", "FAQ"],
  ];
  const account = [
    ["my-account.html", "My Account"],
    ["my-account.html#orders", "My Orders"],
    ["my-account.html#wishlist", "Wishlist"],
    ["cart.html", "Cart"],
  ];
  const legal = [
    ["about.html", "About Us"],
    ["privacy.html", "Privacy Policy"],
    ["terms.html", "Terms of Service"],
  ];

  // There is no newsletter backend, so the "stay informed" invitation is a WhatsApp message
  // to the confirmed business number — no form, no stored email, no pretend subscription.
  return `
  <footer class="site-footer nf-footer">
    <div class="container nf-footer-main">
      <div class="nf-footer-brand">
        <a href="index.html" class="nf-wordmark nf-wordmark--footer" aria-label="NeoFragrances home"><span class="nf-wordmark-neo">Neo</span><span class="nf-wordmark-rest">Fragrances</span></a>
        <p class="nf-footer-statement">Fragrance as signature — designer icons and Arabian perfumery, chosen for who you are.</p>
      </div>

      <section class="nf-footer-updates" aria-labelledby="nf-footer-updates-title">
        <span class="nf-footer-kicker">Stay in the know</span>
        <h2 class="nf-footer-updates-title" id="nf-footer-updates-title">New arrivals, first.</h2>
        <p>Hear about new fragrances, launches and special offers — straight to your WhatsApp.</p>
        <a class="nf-footer-wa-cta" href="${nfWhatsAppLink("Hello NeoFragrances, please let me know about new arrivals and special offers.")}" target="_blank" rel="noopener">
          <i class="fa-brands fa-whatsapp" aria-hidden="true"></i><span>Get updates on WhatsApp</span><i class="fa-solid fa-arrow-right nf-footer-wa-arrow" aria-hidden="true"></i>${newTab}
        </a>
      </section>

      <nav class="nf-footer-nav" aria-label="Footer">
        <div class="nf-footer-group nf-footer-group--shop">
          <h2 class="nf-footer-title" id="nf-footer-shop">Shop</h2>
          <ul class="nf-footer-pills" aria-labelledby="nf-footer-shop">${shop.map(([href, label]) => `<li><a class="nf-pill nf-pill--dark" href="${href}">${label}</a></li>`).join("")}</ul>
        </div>
        <div class="nf-footer-group">
          <h2 class="nf-footer-title" id="nf-footer-care">Customer Care</h2>
          <ul class="nf-footer-links" aria-labelledby="nf-footer-care">${links(care)}</ul>
        </div>
        <div class="nf-footer-group">
          <h2 class="nf-footer-title" id="nf-footer-account">Account</h2>
          <ul class="nf-footer-links" aria-labelledby="nf-footer-account">${links(account)}</ul>
        </div>
      </nav>

      <div class="nf-footer-contact">
        <h2 class="nf-footer-title">Talk to us</h2>
        <a class="nf-footer-wa" href="${nfWhatsAppLink("Hello NeoFragrances, I have a question.")}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Chat on WhatsApp${newTab}</a>
        <ul class="nf-footer-contact-list">
          <li><a href="${NF_CONTACT.phoneHref}"><i class="fa-solid fa-phone" aria-hidden="true"></i><span class="sr-only">Phone: </span>${NF_CONTACT.phoneDisplay}</a></li>
          <li><a href="mailto:${NF_CONTACT.email}"><i class="fa-regular fa-envelope" aria-hidden="true"></i><span class="sr-only">Email: </span>${NF_CONTACT.email}</a></li>
        </ul>
      </div>
    </div>

    <div class="container nf-footer-bottom">
      <p class="nf-footer-copy">&copy; ${year} NeoFragrances. All rights reserved.</p>
      <ul class="nf-footer-legal" aria-label="Company and legal">${links(legal)}</ul>
      <p class="nf-footer-pay"><i class="fa-solid fa-lock" aria-hidden="true"></i> Payments processed by Paystack</p>
    </div>
  </footer>`;
}

function nfInitSearchPanel() {
  const toggle = document.querySelector(".nf-search-toggle");
  const panel = document.getElementById("nf-search-panel");
  const input = document.getElementById("nf-search-input");
  if (!toggle || !panel || !input) return;

  const currentQuery = new URLSearchParams(window.location.search).get("q");
  if (currentQuery) input.value = currentQuery;

  const open = () => {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-open"));
    toggle.setAttribute("aria-expanded", "true");
    input.focus();
  };
  const close = () => {
    panel.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    panel.hidden = true;
  };

  toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
  panel.querySelector(".nf-search-close")?.addEventListener("click", () => { close(); toggle.focus(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { close(); toggle.focus(); }
  });
  panel.querySelector("form").addEventListener("submit", (e) => {
    if (!input.value.trim()) { e.preventDefault(); input.focus(); }
  });
}

function nfInitHeaderScroll() {
  const header = document.querySelector(".nf-header");
  if (!header) return;
  let ticking = false;
  const update = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}

// Header: render immediately, replacing the placeholder this script follows.
(function renderHeaderNow() {
  const slot = document.getElementById("site-header");
  if (!slot) return;
  slot.outerHTML = nfHeaderHTML();
  nfInitSearchPanel();
  nfInitHeaderScroll();
})();

// Footer: the placeholder sits further down the page, so render once parsed.
// Registered before other scripts' DOMContentLoaded handlers.
document.addEventListener("DOMContentLoaded", () => {
  const slot = document.getElementById("site-footer");
  if (slot) slot.outerHTML = nfFooterHTML();
});
