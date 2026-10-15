/* ============================================
   NeoFragrances — toast.js (Phase 5)
   Small slide-in confirmation messages for
   actions like Add to Cart and Wishlist toggles.
   ============================================ */

function showToast(message, type = "success") {
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
  // Messages can contain API data (product names, server errors) — set as text, never HTML.
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}