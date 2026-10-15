/* ============================================
   NeoFragrances — admin-customers.js
   Customer accounts: search, filters, sort,
   pagination, and the disabled/active status set from
   the detail page. No password data is ever sent.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const DEFAULTS = { q: "", verified: "all", orders: "all", provider: "all", status: "all", sort: "created_at", dir: "desc", page: 1 };
  const PAGE_SIZE = 25;
  const state = NFA.readParams(DEFAULTS);
  let customers = null, loadError = null;
  const getters = {
    full_name: c => c.full_name.toLowerCase(), created_at: c => new Date(c.created_at).getTime(),
    order_count: c => c.order_count, total_spent: c => c.total_spent, last_order_at: c => c.last_order_at ? new Date(c.last_order_at).getTime() : 0,
  };

  function filtered() {
    const q = NFA.normalize(state.q);
    return customers.filter(c => {
      if (state.status === "active" && c.disabled) return false;
      if (state.status === "disabled" && !c.disabled) return false;
      if (state.verified === "yes" && !c.email_verified) return false;
      if (state.verified === "no" && c.email_verified) return false;
      if (state.orders === "with" && !c.order_count) return false;
      if (state.orders === "none" && c.order_count) return false;
      if (state.provider !== "all" && (c.auth_provider || "local") !== state.provider) return false;
      if (q && !NFA.normalize(`${c.full_name} ${c.email} ${c.phone || ""}`).includes(q)) return false;
      return true;
    });
  }

  function select(id, label, key, options) {
    return `<label class="sr-only" for="${id}">${label}</label><select id="${id}" class="adm-select" data-filter="${key}">${options.map(([v, l]) => `<option value="${v}"${state[key] === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const withOrders = customers.filter(c => c.order_count).length;
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Customers</span><span class="adm-kpi-value">${int(customers.length)}</span><span class="adm-kpi-meta">${int(customers.filter(c => c.disabled).length)} disabled</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Verified email</span><span class="adm-kpi-value">${int(customers.filter(c => c.email_verified).length)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Have ordered</span><span class="adm-kpi-value">${int(withOrders)}</span><span class="adm-kpi-meta">${int(customers.length - withOrders)} haven't ordered yet</span></div>
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="c-search" class="sr-only">Search customers</label><input id="c-search" class="adm-input" type="search" placeholder="Name, email or phone" value="${esc(state.q)}"></div>
        ${select("c-status", "Account status", "status", [["all", "Any status"], ["active", "Active"], ["disabled", "Disabled"]])}
        ${select("c-verified", "Email verification", "verified", [["all", "Any verification"], ["yes", "Verified"], ["no", "Not verified"]])}
        ${select("c-orders", "Orders", "orders", [["all", "Any orders"], ["with", "Has ordered"], ["none", "No orders"]])}
        ${select("c-provider", "Sign-in method", "provider", [["all", "Any sign-in"], ["local", "Email & password"], ["google", "Google"]])}
        <div class="adm-toolbar-right"><span class="adm-count" id="c-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards"><caption class="sr-only">Customers</caption><thead id="c-head"></thead><tbody id="c-body"></tbody></table>
        <div id="c-pager"></div>
      </div>`;
    renderTable();
  }

  function renderTable() {
    const list = NFA.sortBy(filtered(), state.sort, state.dir, getters);
    const pg = NFA.paginate(list, state.page, PAGE_SIZE);
    state.page = pg.page;
    NFA.writeParams(state, DEFAULTS);
    document.getElementById("c-head").innerHTML = `<tr>${NFA.sortHeader("Customer", "full_name", state)}<th>Account</th>${NFA.sortHeader("Orders", "order_count", state, "ta-r")}${NFA.sortHeader("Spent", "total_spent", state, "ta-r")}${NFA.sortHeader("Last order", "last_order_at", state)}${NFA.sortHeader("Joined", "created_at", state)}</tr>`;
    document.getElementById("c-count").textContent = `${int(list.length)} customer${list.length !== 1 ? "s" : ""}`;
    document.getElementById("c-body").innerHTML = pg.rows.length ? pg.rows.map(c => `
      <tr>
        <td class="adm-td-primary"><a class="adm-cell-title" href="customer.html?id=${encodeURIComponent(c.id)}">${esc(c.full_name)}</a><span class="adm-cell-sub">${esc(c.email)}${c.phone ? ` · ${esc(c.phone)}` : ""}</span></td>
        <td data-label="Account">${c.disabled ? `<span class="adm-badge adm-badge--disabled">Disabled</span> ` : ""}${c.email_verified ? `<span class="adm-badge adm-badge--active">Verified</span>` : `<span class="adm-badge adm-badge--pending">Unverified</span>`} <span class="adm-tag">${c.auth_provider === "google" ? "Google" : "Email"}</span></td>
        <td data-label="Orders" class="ta-r num">${int(c.order_count)}</td>
        <td data-label="Spent" class="ta-r num">${money(c.total_spent)}</td>
        <td data-label="Last order" class="nowrap">${c.last_order_at ? esc(NFA.date(c.last_order_at)) : `<span class="muted">—</span>`}</td>
        <td data-label="Joined" class="nowrap">${esc(NFA.date(c.created_at))}</td>
      </tr>`).join("")
      : NFA.tableState(6, customers.length
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No customers match", text: "Try a different search or filter." })
        : NFA.stateHTML({ icon: "fa-solid fa-users", title: "No customers yet", text: "Customer accounts appear here after people register." }));
    document.getElementById("c-pager").innerHTML = NFA.pagerHTML({ total: list.length, page: pg.page, pageSize: PAGE_SIZE, noun: "customers" });
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { customers = await NFA.api("/api/admin/customers"); loadError = null; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  const onSearch = NFA.debounce(() => { state.page = 1; renderTable(); });
  root.addEventListener("input", e => { if (e.target.id === "c-search") { state.q = e.target.value; onSearch(); } });
  root.addEventListener("change", e => { const f = e.target.dataset.filter; if (f) { state[f] = e.target.value; state.page = 1; renderTable(); } });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const sort = e.target.closest("[data-sort]");
    if (sort) { NFA.nextSort(state, sort.dataset.sort); renderTable(); root.querySelector(`[data-sort="${sort.dataset.sort}"]`).focus(); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); renderTable(); }
  });

  NFA.ready.then(load);
})();
