/* ============================================
   NeoFragrances — toast.js
   Small floating confirmations for actions like
   Add to Cart, wishlist toggles and form saves.

   showToast(message, type) — type is "success"
   (default), "error", "warning" or "info".

   Storefront pages get the compact card: a close
   button, screen-reader announcements, one timer
   per toast (paused while hovered or focused) and
   an identical message refreshes instead of
   stacking. Admin pages load toast.js without the
   storefront stylesheet, so they keep the original
   markup and timing.
   ============================================ */

const NF_TOAST_STOREFRONT = !/\/admin\//i.test(window.location.pathname);
const NF_TOAST_MAX = 3;
const NF_TOAST_ICONS = { success: "fa-check", error: "fa-exclamation", warning: "fa-exclamation", info: "fa-info" };

function showToast(message, type = "success") {
  if (!NF_TOAST_STOREFRONT) return nfLegacyToast(message, type);

  const kind = NF_TOAST_ICONS[type] ? type : "success";
  const text = String(message);
  const container = nfToastContainer();

  // The same message already on screen: restart its timer rather than stacking a copy.
  const twin = [...container.children].find(t => t._nfKey === `${kind}|${text}` && !t._nfLeaving);
  if (twin) { twin._nfRestart(); nfToastAnnounce(text, kind === "error"); return; }

  nfToastAnnounce(text, kind === "error");

  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.innerHTML = `
    <span class="nf-toast-mark" aria-hidden="true"><i class="fa-solid ${NF_TOAST_ICONS[kind]}"></i></span>
    <span class="nf-toast-text"></span>
    <button type="button" class="nf-toast-close" aria-label="Dismiss notification"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
  `;
  // Messages can contain API data (product names, server errors) — set as text, never HTML.
  toast.querySelector(".nf-toast-text").textContent = text;
  toast._nfKey = `${kind}|${text}`;

  const duration = kind === "error" || kind === "warning" ? 6000 : 3500;
  let timer = null;
  const dismiss = () => {
    if (toast._nfLeaving) return;
    toast._nfLeaving = true;
    clearTimeout(timer);
    toast.classList.remove("show");
    toast.classList.add("is-leaving");
    const done = () => toast.remove();
    toast.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400); // reduced motion / no transition
  };
  const start = () => { clearTimeout(timer); timer = setTimeout(dismiss, duration); };
  toast._nfRestart = start;

  toast.querySelector(".nf-toast-close").addEventListener("click", dismiss);
  toast.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
  // Pause while the shopper is reading or about to press the close button.
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", start);
  toast.addEventListener("focusin", () => clearTimeout(timer));
  toast.addEventListener("focusout", (e) => { if (!toast.contains(e.relatedTarget)) start(); });

  container.appendChild(toast);
  // Keep at most a few on screen: the oldest makes way.
  const live = [...container.children].filter(t => !t._nfLeaving);
  if (live.length > NF_TOAST_MAX) live[0].querySelector(".nf-toast-close").click();

  requestAnimationFrame(() => toast.classList.add("show"));
  start();
}

function nfToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  container.className = "toast-container nf-toasts";
  return container;
}

// Screen readers announce changes to a live region that already exists, so two hidden regions
// are created up front: polite for confirmations, assertive for errors. The visible card is
// not itself a live region, which avoids hearing every message twice.
function nfToastLiveRegion(assertive) {
  const id = assertive ? "nf-toast-alert" : "nf-toast-status";
  let region = document.getElementById(id);
  if (!region) {
    region = document.createElement("div");
    region.id = id;
    region.className = "sr-only";
    region.setAttribute("aria-live", assertive ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  return region;
}
function nfToastAnnounce(text, assertive) {
  const region = nfToastLiveRegion(assertive);
  region.textContent = "";
  // A fresh text node a moment later, so a repeated message is announced again.
  setTimeout(() => { region.textContent = text; }, 60);
}
if (NF_TOAST_STOREFRONT) {
  document.addEventListener("DOMContentLoaded", () => { nfToastLiveRegion(false); nfToastLiveRegion(true); });
}

// The original toast, unchanged, for the admin portal (styled by admin.css).
function nfLegacyToast(message, type) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === "success" ? "fa-circle-check" : "fa-circle-exclamation"}"></i>
    <span></span>
  `;
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}
