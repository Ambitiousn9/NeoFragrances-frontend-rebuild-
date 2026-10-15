/* ============================================
   NeoFragrances — admin-orders.js
   Orders list with server-side search, status /
   date filters and pagination (GET /api/admin/orders).
   Details open on admin/order.html?id=.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const DEFAULTS = { q: "", status: "all", from: "", to: "", page: 1 };
  const PAGE_SIZE = 25;
  const state = NFA.readParams(DEFAULTS);
  let lastData = null, requestId = 0;

  function query(extra = {}) {
    const p = new URLSearchParams();
    const s = { ...state, ...extra };
    if (s.q) p.set("q", s.q);
    if (s.status !== "all") p.set("status", s.status);
    if (s.from) p.set("from", s.from);
    if (s.to) p.set("to", s.to);
    p.set("page", s.page); p.set("pageSize", s.pageSize || PAGE_SIZE);
    return p.toString();
  }

  function renderFrame() {
    root.innerHTML = `
      <div class="adm-tabs" role="group" aria-label="Order status" id="o-tabs"></div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="o-search" class="sr-only">Search orders</label><input id="o-search" class="adm-input" type="search" placeholder="Order #, customer name/email or payment reference" value="${esc(state.q)}"></div>
        <div class="adm-daterange" role="group" aria-label="Date range"><label for="o-from" class="adm-count">From</label><input id="o-from" class="adm-input" type="date" value="${esc(state.from)}"><label for="o-to" class="adm-count">To</label><input id="o-to" class="adm-input" type="date" value="${esc(state.to)}"></div>
        <div class="adm-toolbar-right"><span class="adm-count" id="o-count" role="status"></span><button type="button" class="adm-btn adm-btn--sm" data-action="export"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Export CSV</button></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards">
          <caption class="sr-only">Orders</caption>
          <thead><tr><th>Order</th><th>Customer</th><th class="ta-r">Items</th><th class="ta-r">Total</th><th>Status</th><th>Payment reference</th><th class="ta-r"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="o-body">${NFA.skeletonRows(7)}</tbody>
        </table>
        <div id="o-pager"></div>
      </div>`;
  }

  function renderData(d) {
    const tabs = [["all", "All", Object.values(d.status_counts).reduce((a, b) => a + b, 0)], ...NFA.ORDER_STATUSES.map(s => [s, s, d.status_counts[s]])];
    document.getElementById("o-tabs").innerHTML = tabs.map(([k, l, n]) => `<button type="button" class="adm-tab" data-status="${k}" aria-pressed="${state.status === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("");
    document.getElementById("o-count").textContent = `${int(d.total)} order${d.total !== 1 ? "s" : ""}`;
    const filtersOn = state.q || state.status !== "all" || state.from || state.to;
    document.getElementById("o-body").innerHTML = d.orders.length ? d.orders.map(o => `
      <tr>
        <td class="adm-td-primary"><a class="adm-cell-title" href="order.html?id=${encodeURIComponent(o.id)}">Order #${esc(o.id)}</a><span class="adm-cell-sub">${esc(NFA.dateTime(o.created_at))}</span></td>
        <td data-label="Customer"><span>${esc(o.customer_name)}</span><span class="adm-cell-sub" style="display:block">${esc(o.customer_email)}</span></td>
        <td data-label="Items" class="ta-r num">${int(o.item_count)}</td>
        <td data-label="Total" class="ta-r num">${money(o.total)}</td>
        <td data-label="Status">${NFA.orderBadge(o.status)}</td>
        <td data-label="Reference">${o.payment_reference ? `<span class="adm-code">${esc(o.payment_reference)}</span>` : `<span class="muted">—</span>`}</td>
        <td class="adm-td-actions ta-r"><a class="adm-btn adm-btn--sm" href="order.html?id=${encodeURIComponent(o.id)}" aria-label="View order ${esc(o.id)}">View</a></td>
      </tr>`).join("")
      : NFA.tableState(7, filtersOn
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No orders match", text: "Try a different search, status or date range.", action: `<button type="button" class="adm-btn adm-btn--sm" data-action="clear">Clear filters</button>` })
        : NFA.stateHTML({ icon: "fa-solid fa-receipt", title: "No orders yet", text: "Orders appear here once customers complete a Paystack payment." }));
    document.getElementById("o-pager").innerHTML = NFA.pagerHTML({ total: d.total, page: d.page, pageSize: d.pageSize, noun: "orders" });
  }

  async function load() {
    const my = ++requestId;
    root.setAttribute("aria-busy", "true");
    NFA.writeParams(state, DEFAULTS);
    try {
      const d = await NFA.api(`/api/admin/orders?${query()}`);
      if (my !== requestId) return;
      // A filter change can leave us past the last page — step back.
      if (!d.orders.length && d.total && state.page > 1) { state.page = Math.ceil(d.total / PAGE_SIZE); return load(); }
      lastData = d;
      renderData(d);
    } catch (e) {
      if (NFA.isSessionError(e) || my !== requestId) return;
      document.getElementById("o-body").innerHTML = NFA.tableState(7, NFA.errorState(e.message));
    } finally { if (my === requestId) root.setAttribute("aria-busy", "false"); }
  }

  async function exportCSV(btn) {
    btn.disabled = true;
    try {
      const rows = [];
      for (let page = 1; ; page++) {
        const d = await NFA.api(`/api/admin/orders?${query({ page, pageSize: 1000 })}`);
        rows.push(...d.orders);
        if (rows.length >= d.total || !d.orders.length) break;
      }
      NFA.downloadCSV(`neofragrances-orders-${new Date().toISOString().slice(0, 10)}.csv`, [
        ["Order ID", "Date", "Customer", "Email", "Phone", "Items", "Total (GHS)", "Status", "Payment reference", "City", "Region"],
        ...rows.map(o => [o.id, new Date(o.created_at).toISOString(), o.customer_name, o.customer_email, o.customer_phone || "", o.item_count, Number(o.total).toFixed(2), o.status, o.payment_reference || "", o.city || "", o.region || ""]),
      ]);
      NFA.toast(`Exported ${int(rows.length)} order${rows.length !== 1 ? "s" : ""}`);
    } catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
    finally { btn.disabled = false; }
  }

  const onSearch = NFA.debounce(() => { state.page = 1; load(); }, 300);
  root.addEventListener("input", e => { if (e.target.id === "o-search") { state.q = e.target.value.trim(); onSearch(); } });
  root.addEventListener("change", e => {
    if (e.target.id === "o-from" || e.target.id === "o-to") { state[e.target.id === "o-from" ? "from" : "to"] = e.target.value; state.page = 1; load(); }
  });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-status]");
    if (tab) { state.status = tab.dataset.status; state.page = 1; load().then(() => root.querySelector(`[data-status="${state.status}"]`)?.focus()); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); load(); window.scrollTo({ top: 0 }); return; }
    const a = e.target.closest("[data-action]");
    if (a?.dataset.action === "export") exportCSV(a);
    if (a?.dataset.action === "clear") { Object.assign(state, DEFAULTS); renderFrame(); load(); }
  });

  NFA.ready.then(() => { renderFrame(); load(); });
})();
