/* ============================================
   NeoFragrances — admin-core.js (Milestone 5)
   Shared admin architecture: access guard, layout
   (sidebar + topbar), authenticated API calls,
   dialogs, drawers, toasts, table helpers and
   formatting. Every admin page loads:
     main.js → toast.js → auth.js → admin-core.js → page script
   and calls NFA.ready.then(init).

   Security: the server re-checks the admin role on
   every /api/admin request; the client guard only
   decides what to render. Expired/revoked sessions
   are sent back to the admin login.
   ============================================ */

const NFA = (() => {
  const NAV = [
    { group: "Overview", items: [
      { id: "dashboard", href: "dashboard.html", icon: "fa-solid fa-gauge-high", label: "Dashboard" },
      { id: "reports", href: "reports.html", icon: "fa-solid fa-chart-column", label: "Reports" },
    ] },
    { group: "Catalog", items: [
      { id: "products", href: "products.html", icon: "fa-solid fa-flask", label: "Products" },
      { id: "inventory", href: "inventory.html", icon: "fa-solid fa-boxes-stacked", label: "Inventory", count: "low_stock" },
      { id: "scent-families", href: "scent-families.html", icon: "fa-solid fa-spray-can-sparkles", label: "Scent families" },
      { id: "offers", href: "special-offers.html", icon: "fa-solid fa-tag", label: "Special offers" },
      { id: "coupons", href: "coupons.html", icon: "fa-solid fa-ticket", label: "Coupons" },
    ] },
    { group: "Sales", items: [
      { id: "orders", href: "orders.html", icon: "fa-solid fa-receipt", label: "Orders", count: "pending" },
      { id: "customers", href: "customers.html", icon: "fa-solid fa-users", label: "Customers" },
      { id: "reviews", href: "reviews.html", icon: "fa-regular fa-star", label: "Reviews" },
    ] },
    { group: "System", items: [
      { id: "maintenance", href: "maintenance.html", icon: "fa-solid fa-wrench", label: "Maintenance" },
    ] },
  ];
  const ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
  const LOW_STOCK = 5; // mirrors LOW_STOCK_THRESHOLD on the server (1–5 units = low)

  const esc = v => escapeHtml(v);
  const pageId = () => document.body.dataset.adminPage || "";
  const here = () => (window.location.pathname.split("/").pop() || "dashboard.html") + window.location.search + window.location.hash;
  const loginUrl = extra => `login.html?redirect=${encodeURIComponent(here())}${extra || ""}`;

  /* ---------- access guard ---------- */
  function storedAdmin() {
    const auth = typeof getAuth === "function" ? getAuth() : null;
    return auth && auth.token && auth.user && auth.user.role === "admin" ? auth : null;
  }
  function toLogin(extra) { if (typeof clearAuth === "function") clearAuth(); window.location.replace(loginUrl(extra)); }

  let me = null;
  const ready = new Promise(resolve => {
    if (!storedAdmin()) { window.location.replace(loginUrl()); return; }
    const start = async () => {
      renderShell();
      try {
        const res = await apiFetch("/api/me");
        if (!res.ok) throw new Error("profile");
        me = await res.json();
        if (me.role !== "admin") return toLogin("&denied=1");
        renderUser();
        loadCounts();
        resolve(me);
      } catch (e) {
        if (e.message === "Session expired") return;
        document.getElementById("adm-main").innerHTML = stateHTML({ icon: "fa-solid fa-plug-circle-exclamation", title: "Can't reach the server", text: "Check that the backend is running, then reload this page.", error: true });
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  });

  /* ---------- API ---------- */
  async function apiFetch(path, options = {}) {
    const auth = storedAdmin();
    if (!auth) { toLogin(); throw new Error("Session expired"); }
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}), Authorization: `Bearer ${auth.token}` };
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (res.status === 401) { toLogin("&expired=1"); throw new Error("Session expired"); }
    if (res.status === 403) { toLogin("&denied=1"); throw new Error("Session expired"); }
    return res;
  }
  // JSON helper: resolves with data, rejects with an Error carrying status/field/code.
  async function api(path, { method = "GET", body } = {}) {
    const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || "Something went wrong. Please try again.");
      Object.assign(err, { status: res.status, field: data && data.field, code: data && data.code });
      throw err;
    }
    return data;
  }
  const isSessionError = e => e && e.message === "Session expired";

  let summaryPromise = null;
  function summary(force) {
    if (!summaryPromise || force) summaryPromise = api("/api/admin/summary");
    return summaryPromise;
  }
  async function loadCounts(force) {
    try {
      const s = await summary(force);
      setNavCount("low_stock", s.products.low_stock + s.products.out_of_stock, "products low or out of stock");
      setNavCount("pending", s.orders.by_status.Pending, "pending orders");
    } catch (e) { /* counts are optional */ }
  }
  function setNavCount(key, n, label) {
    const el = document.querySelector(`[data-nav-count="${key}"]`);
    if (!el) return;
    el.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
    el.setAttribute("aria-label", n > 0 ? `${n} ${label}` : "");
  }

  /* ---------- layout ---------- */
  function renderShell() {
    const main = document.getElementById("adm-main");
    if (!main || document.querySelector(".adm-shell")) return;
    const current = pageId();
    const shell = document.createElement("div");
    shell.className = "adm-shell";
    shell.innerHTML = `
      <a class="adm-skip" href="#adm-main">Skip to content</a>
      <aside class="adm-sidebar" id="adm-sidebar" aria-label="Admin navigation">
        <a class="adm-brand" href="dashboard.html" aria-label="NeoFragrances admin — dashboard">
          <span class="adm-brand-mark">Neo</span><span class="adm-brand-word">Fragrances</span><span class="adm-brand-tag">Admin</span>
        </a>
        ${NAV.map(g => `
          <div class="adm-nav-group">
            <div class="adm-nav-title" id="nav-${g.group.toLowerCase()}">${g.group}</div>
            <ul class="adm-nav" aria-labelledby="nav-${g.group.toLowerCase()}">
              ${g.items.map(i => `<li><a href="${i.href}"${i.id === current ? ' aria-current="page"' : ""}><i class="${i.icon}" aria-hidden="true"></i><span>${i.label}</span>${i.count ? `<span class="adm-nav-count" data-nav-count="${i.count}"></span>` : ""}</a></li>`).join("")}
            </ul>
          </div>`).join("")}
        <div class="adm-sidebar-foot">
          <a href="../index.html" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> View store</a>
          <button type="button" data-adm-logout><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i> Log out</button>
        </div>
      </aside>
      <div class="adm-overlay" data-adm-close-nav></div>
      <div class="adm-main-wrap">
        <header class="adm-topbar">
          <button type="button" class="adm-btn adm-btn--ghost adm-btn--icon adm-menu-btn" aria-label="Open navigation" aria-controls="adm-sidebar" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
          <nav class="adm-crumbs" aria-label="Breadcrumb" id="adm-crumbs"></nav>
          <div class="adm-topbar-right">
            <div class="adm-user" id="adm-user"></div>
          </div>
        </header>
      </div>`;
    document.body.insertBefore(shell, main);
    shell.querySelector(".adm-main-wrap").appendChild(main);
    main.setAttribute("tabindex", "-1");
    setCrumbs();

    const menuBtn = shell.querySelector(".adm-menu-btn");
    const sidebar = shell.querySelector(".adm-sidebar");
    const setNav = open => {
      shell.classList.toggle("is-nav-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      if (open) sidebar.querySelector("a")?.focus(); else menuBtn.focus();
    };
    menuBtn.addEventListener("click", () => setNav(!shell.classList.contains("is-nav-open")));
    shell.querySelector("[data-adm-close-nav]").addEventListener("click", () => setNav(false));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && shell.classList.contains("is-nav-open")) setNav(false); });
    shell.querySelector("[data-adm-logout]").addEventListener("click", logout);
  }

  function setCrumbs(trail) {
    const el = document.getElementById("adm-crumbs");
    if (!el) return;
    const item = NAV.flatMap(g => g.items).find(i => i.id === pageId());
    const parts = trail || (item ? [{ label: item.label }] : []);
    el.innerHTML = [`<a href="dashboard.html">Admin</a>`, ...parts.map((p, i) => i === parts.length - 1
      ? `<span aria-current="page">${esc(p.label)}</span>`
      : `<a href="${esc(p.href)}">${esc(p.label)}</a>`)].join(' <span aria-hidden="true">/</span> ');
  }

  function renderUser() {
    const el = document.getElementById("adm-user");
    if (!el || !me) return;
    el.innerHTML = `<span class="adm-avatar" aria-hidden="true">${esc((me.full_name || "A").trim().charAt(0).toUpperCase())}</span><span class="adm-user-name">${esc(me.full_name)}</span>`;
  }

  async function logout() {
    if (!(await confirmDialog({ title: "Log out?", text: "You'll need to sign in again to use the admin dashboard.", okLabel: "Log out" }))) return;
    if (typeof clearAuth === "function") clearAuth();
    window.location.href = "login.html";
  }

  /* ---------- focus trapping ---------- */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function trapFocus(container, e) {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- confirm dialog ---------- */
  function confirmDialog({ title, text, okLabel = "Confirm", danger = false }) {
    return new Promise(resolve => {
      const returnTo = document.activeElement;
      const wrap = document.createElement("div");
      wrap.className = "adm-dialog-wrap";
      wrap.innerHTML = `
        <div class="adm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="adm-dlg-title" aria-describedby="adm-dlg-text">
          <h2 id="adm-dlg-title"></h2>
          <p id="adm-dlg-text"></p>
          <div class="adm-dialog-actions">
            <button type="button" class="adm-btn" data-dlg="cancel">Cancel</button>
            <button type="button" class="adm-btn ${danger ? "adm-btn--danger" : "adm-btn--primary"}" data-dlg="ok"></button>
          </div>
        </div>`;
      wrap.querySelector("#adm-dlg-title").textContent = title;
      wrap.querySelector("#adm-dlg-text").textContent = text || "";
      wrap.querySelector('[data-dlg="ok"]').textContent = okLabel;
      document.body.appendChild(wrap);
      const dialog = wrap.querySelector(".adm-dialog");
      const close = result => {
        document.removeEventListener("keydown", onKey, true);
        wrap.remove();
        returnTo?.focus?.();
        resolve(result);
      };
      const onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
        else trapFocus(dialog, e);
      };
      document.addEventListener("keydown", onKey, true);
      wrap.addEventListener("click", e => {
        if (e.target === wrap) close(false);
        const b = e.target.closest("[data-dlg]");
        if (b) close(b.dataset.dlg === "ok");
      });
      wrap.querySelector('[data-dlg="cancel"]').focus();
    });
  }

  /* ---------- drawer (slide-over form) ---------- */
  let activeDrawer = null;
  function openDrawer({ title, bodyHTML, footHTML, onClose }) {
    closeDrawer();
    const returnTo = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "adm-backdrop";
    const drawer = document.createElement("section");
    drawer.className = "adm-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "adm-drawer-title");
    drawer.innerHTML = `
      <div class="adm-drawer-head"><h2 id="adm-drawer-title"></h2><button type="button" class="adm-btn adm-btn--ghost adm-btn--icon" data-drawer-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
      <div class="adm-drawer-body">${bodyHTML}</div>
      ${footHTML ? `<div class="adm-drawer-foot">${footHTML}</div>` : ""}`;
    drawer.querySelector("#adm-drawer-title").textContent = title;
    document.body.append(backdrop, drawer);
    document.body.style.overflow = "hidden";
    const onKey = e => {
      if (document.querySelector(".adm-dialog-wrap")) return;
      if (e.key === "Escape") { e.preventDefault(); requestClose(); }
      else trapFocus(drawer, e);
    };
    const requestClose = async () => { if (onClose && (await onClose()) === false) return; closeDrawer(); };
    activeDrawer = { drawer, backdrop, onKey, returnTo };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", requestClose);
    drawer.querySelector("[data-drawer-close]").addEventListener("click", requestClose);
    (drawer.querySelector(".adm-drawer-body " + FOCUSABLE) || drawer.querySelector("[data-drawer-close]")).focus();
    return drawer;
  }
  function closeDrawer() {
    if (!activeDrawer) return;
    const { drawer, backdrop, onKey, returnTo } = activeDrawer;
    activeDrawer = null;
    document.removeEventListener("keydown", onKey);
    drawer.remove(); backdrop.remove();
    document.body.style.overflow = "";
    if (returnTo && document.contains(returnTo)) returnTo.focus();
  }

  /* ---------- form errors ---------- */
  function clearFormErrors(form) {
    form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    form.querySelectorAll(".adm-error").forEach(el => { el.textContent = ""; });
    const status = form.querySelector(".adm-form-status") || form.closest(".adm-drawer")?.querySelector(".adm-form-status");
    if (status) { status.textContent = ""; status.classList.remove("is-error"); }
  }
  function showFormError(form, field, message) {
    const input = field ? form.querySelector(`[name="${field}"]`) : null;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const err = form.querySelector(`[data-error-for="${field}"]`);
      if (err) err.textContent = message;
      input.focus();
    }
    const status = form.querySelector(".adm-form-status") || form.closest(".adm-drawer")?.querySelector(".adm-form-status");
    if (status && (!input || !form.querySelector(`[data-error-for="${field}"]`))) { status.textContent = message; status.classList.add("is-error"); }
  }

  /* ---------- formatting ---------- */
  const moneyFmt = new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = n => `GH₵${moneyFmt.format(Number(n) || 0)}`;
  const int = n => new Intl.NumberFormat("en-GH").format(Number(n) || 0);
  const date = v => v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const dateTime = v => v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const cap = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
  function orderBadge(status) {
    const s = String(status || "");
    return `<span class="adm-badge adm-badge--${esc(s.toLowerCase())}">${esc(s || "Unknown")}</span>`;
  }
  function stockState(p) {
    if (p.deleted_at) return { key: "archived", label: "Archived" };
    const q = Number(p.stock_qty);
    if (q <= 0) return { key: "out", label: "Out of stock" };
    if (q <= LOW_STOCK) return { key: "low", label: "Low stock" };
    return { key: "in", label: "In stock" };
  }
  function stockBadge(p) { const s = stockState(p); return `<span class="adm-badge adm-badge--${s.key}">${s.label}</span>`; }
  function thumb(image, cls = "") {
    return `<span class="adm-thumb ${cls}" aria-hidden="true">${image ? `<img src="../${esc(image)}" alt="" loading="lazy" onerror="handleImageError(this)">` : bottleSVG()}</span>`;
  }
  function stars(rating) {
    const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return `<span class="adm-stars" aria-label="${r} out of 5 stars">${"★".repeat(r)}${"☆".repeat(5 - r)}</span>`;
  }
  function telLink(phone) { const p = String(phone || "").replace(/[^\d+]/g, ""); return p ? `tel:${p}` : null; }
  function waLink(phone) {
    let p = String(phone || "").replace(/\D/g, "");
    if (!p) return null;
    if (p.startsWith("0")) p = "233" + p.slice(1);
    return `https://wa.me/${p}`;
  }

  /* ---------- states ---------- */
  function stateHTML({ icon = "fa-regular fa-folder-open", title, text, action = "", error = false }) {
    return `<div class="adm-state${error ? " adm-state--error" : ""}"${error ? ' role="alert"' : ""}><i class="${icon}" aria-hidden="true"></i>${title ? `<h3>${esc(title)}</h3>` : ""}${text ? `<p>${esc(text)}</p>` : ""}${action}</div>`;
  }
  const errorState = (message, retry = true) => stateHTML({ icon: "fa-solid fa-triangle-exclamation", title: "Couldn't load this", text: message, error: true, action: retry ? `<button type="button" class="adm-btn adm-btn--sm" data-retry>Try again</button>` : "" });
  function skeletonRows(cols, rows = 6) {
    return Array.from({ length: rows }, () => `<tr aria-hidden="true">${Array.from({ length: cols }, (_, i) => `<td><span class="adm-skel" style="width:${i === 0 ? 70 : 40 + ((i * 17) % 40)}%"></span></td>`).join("")}</tr>`).join("");
  }
  const tableState = (cols, html) => `<tr><td colspan="${cols}">${html}</td></tr>`;

  /* ---------- table helpers ---------- */
  function paginate(list, page, pageSize) {
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const p = Math.min(Math.max(1, page), pages);
    return { rows: list.slice((p - 1) * pageSize, p * pageSize), page: p, pages, total: list.length };
  }
  function pagerHTML({ total, page, pageSize, noun = "items" }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (!total) return "";
    const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
    return `<div class="adm-pager"><span>Showing ${int(from)}–${int(to)} of ${int(total)} ${esc(noun)}</span>
      <div class="adm-pager-btns">
        <button type="button" class="adm-btn adm-btn--sm" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
        <span class="num">Page ${page} of ${pages}</span>
        <button type="button" class="adm-btn adm-btn--sm" data-page="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="Next page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
      </div></div>`;
  }
  function sortBy(list, key, dir, getters = {}) {
    const get = getters[key] || (x => x[key]);
    const mult = dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      let x = get(a), y = get(b);
      if (x === null || x === undefined) x = "";
      if (y === null || y === undefined) y = "";
      if (typeof x === "number" && typeof y === "number") return (x - y) * mult;
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * mult;
    });
  }
  // Sortable header: <th aria-sort> + button. Clicking cycles asc/desc.
  function sortHeader(label, key, state, cls = "") {
    const active = state.sort === key;
    const sortAttr = active ? ` aria-sort="${state.dir === "desc" ? "descending" : "ascending"}"` : "";
    const icon = active ? (state.dir === "desc" ? "fa-sort-down" : "fa-sort-up") : "fa-sort";
    return `<th class="${cls}"${sortAttr}><button type="button" class="adm-sort" data-sort="${key}">${esc(label)}<i class="fa-solid ${icon}" aria-hidden="true"></i></button></th>`;
  }
  function nextSort(state, key) {
    if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
    else { state.sort = key; state.dir = "asc"; }
  }
  const normalize = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  /* ---------- URL state ---------- */
  function readParams(defaults) {
    const p = new URLSearchParams(window.location.search);
    const out = { ...defaults };
    Object.keys(defaults).forEach(k => {
      if (!p.has(k)) return;
      out[k] = typeof defaults[k] === "number" ? (parseInt(p.get(k), 10) || defaults[k]) : p.get(k);
    });
    return out;
  }
  function writeParams(state, defaults) {
    const p = new URLSearchParams();
    Object.keys(defaults).forEach(k => { if (state[k] !== defaults[k] && state[k] !== "" && state[k] !== null && state[k] !== undefined) p.set(k, state[k]); });
    const qs = p.toString();
    history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }

  /* ---------- misc ---------- */
  function debounce(fn, ms = 220) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function toast(message, type = "success") { if (typeof showToast === "function") showToast(message, type); }
  // CSV export; neutralises spreadsheet formulas (=, +, -, @) in cell values.
  function downloadCSV(filename, rows) {
    const cell = v => {
      let s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = "﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setTitle(text) { document.title = `${text} — NeoFragrances Admin`; }

  return {
    ready, api, apiFetch, isSessionError, summary, loadCounts, setCrumbs, setTitle,
    confirm: confirmDialog, openDrawer, closeDrawer, clearFormErrors, showFormError, trapFocus,
    esc, money, int, date, dateTime, cap, orderBadge, stockState, stockBadge, thumb, stars, telLink, waLink,
    stateHTML, errorState, skeletonRows, tableState,
    paginate, pagerHTML, sortBy, sortHeader, nextSort, normalize, readParams, writeParams,
    debounce, toast, downloadCSV,
    ORDER_STATUSES, LOW_STOCK, get me() { return me; },
  };
})();
