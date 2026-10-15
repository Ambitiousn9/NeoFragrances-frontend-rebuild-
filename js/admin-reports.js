/* ============================================
   NeoFragrances — admin-reports.js
   Reports from GET /api/admin/reports?days=N.
   Only real order data (cancelled excluded). Charts
   are plain SVG/CSS with an accessible data table.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;
  const RANGES = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"]];
  const state = NFA.readParams({ days: 30 });

  function fillDays(daily, days) {
    const map = Object.fromEntries(daily.map(d => [d.day, d]));
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ day: key, orders: map[key]?.orders || 0, revenue: map[key]?.revenue || 0 });
    }
    // 12 months: group by month so bars stay readable.
    if (days > 90) {
      const months = {};
      out.forEach(d => { const k = d.day.slice(0, 7); months[k] = months[k] || { day: k, orders: 0, revenue: 0 }; months[k].orders += d.orders; months[k].revenue += d.revenue; });
      return Object.values(months);
    }
    return out;
  }

  function chartSVG(series) {
    const W = 760, H = 220, padL = 8, padB = 22, padT = 10;
    const max = Math.max(...series.map(s => s.revenue), 1);
    const bw = (W - padL * 2) / series.length;
    const label = d => d.length === 7 ? new Date(d + "-01").toLocaleDateString("en-GB", { month: "short" }) : new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const every = Math.ceil(series.length / 8);
    return `<svg class="adm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue per ${series[0]?.day.length === 7 ? "month" : "day"}; the same figures are in the table below.">
      ${[0.25, 0.5, 0.75, 1].map(f => `<line class="grid" x1="0" x2="${W}" y1="${padT + (H - padT - padB) * (1 - f)}" y2="${padT + (H - padT - padB) * (1 - f)}"/>`).join("")}
      ${series.map((s, i) => {
        const h = (s.revenue / max) * (H - padT - padB);
        return `<rect class="bar" x="${padL + i * bw + bw * 0.15}" y="${H - padB - h}" width="${Math.max(1, bw * 0.7)}" height="${Math.max(0, h)}"><title>${esc(label(s.day))}: ${esc(money(s.revenue))} · ${s.orders} order${s.orders !== 1 ? "s" : ""}</title></rect>`;
      }).join("")}
      ${series.map((s, i) => i % every === 0 ? `<text class="axis" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(label(s.day))}</text>` : "").join("")}
    </svg>`;
  }

  function bars(rows, valueKey, fmt, labelFn, gold) {
    if (!rows.length) return `<p class="muted">No sales in this period.</p>`;
    const max = Math.max(...rows.map(r => r[valueKey]), 1);
    return `<ul class="adm-bars">${rows.map(r => `
      <li class="adm-bar-row"><span class="adm-bar-label">${esc(labelFn(r))}</span>
        <span class="adm-bar-track" aria-hidden="true"><span class="adm-bar-fill${gold ? " adm-bar-fill--gold" : ""}" style="width:${(r[valueKey] / max) * 100}%"></span></span>
        <span class="adm-bar-value">${fmt(r)}</span></li>`).join("")}</ul>`;
  }

  function render(d) {
    const series = fillDays(d.daily, d.days);
    const revenue = d.daily.reduce((s, x) => s + x.revenue, 0);
    const orders = d.daily.reduce((s, x) => s + x.orders, 0);
    const units = d.top_products.reduce((s, x) => s + x.units, 0);
    const rangeLabel = RANGES.find(r => r[0] === d.days)[1].toLowerCase();
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Revenue</span><span class="adm-kpi-value">${money(revenue)}</span><span class="adm-kpi-meta">${esc(rangeLabel)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Orders</span><span class="adm-kpi-value">${int(orders)}</span><span class="adm-kpi-meta">Excludes cancelled</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Avg. order value</span><span class="adm-kpi-value">${money(orders ? revenue / orders : 0)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">New customers</span><span class="adm-kpi-value">${int(d.new_customers)}</span><span class="adm-kpi-meta">Registered ${esc(rangeLabel)}</span></div>
      </div>
      <section class="adm-panel" aria-labelledby="h-sales" style="margin-bottom:18px">
        <div class="adm-panel-head"><h2 id="h-sales">Sales over time</h2><span class="adm-legend"><span><i class="fa-solid fa-square" style="color:var(--nf-plum)" aria-hidden="true"></i> Revenue (GH₵)</span></span></div>
        <div class="adm-panel-body">
          ${orders ? chartSVG(series) : NFA.stateHTML({ icon: "fa-solid fa-chart-column", title: "No sales in this period", text: "The chart fills in as paid orders come in." })}
          ${orders ? `<details style="margin-top:10px"><summary class="adm-link">Show figures as a table</summary>
            <table class="adm-table" style="margin-top:10px"><caption class="sr-only">Revenue and orders per period</caption><thead><tr><th>Period</th><th class="ta-r">Orders</th><th class="ta-r">Revenue</th></tr></thead>
            <tbody>${series.filter(s => s.orders).map(s => `<tr><td>${esc(s.day)}</td><td class="ta-r num">${int(s.orders)}</td><td class="ta-r num">${money(s.revenue)}</td></tr>`).join("")}</tbody></table></details>` : ""}
        </div>
      </section>
      <div class="adm-grid adm-grid--main">
        <section class="adm-panel" aria-labelledby="h-top">
          <div class="adm-panel-head"><h2 id="h-top">Best-selling products</h2><span class="adm-count">${int(units)} units in the top ${d.top_products.length}</span></div>
          <div class="adm-panel-body adm-panel-body--flush">
            ${d.top_products.length ? `<table class="adm-table adm-table--cards"><caption class="sr-only">Best-selling products</caption>
              <thead><tr><th>Product</th><th class="ta-r">Units</th><th class="ta-r">Revenue</th></tr></thead>
              <tbody>${d.top_products.map(p => `<tr>
                <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(p.image)}<div><span class="adm-cell-title">${esc(p.name)}</span><span class="adm-cell-sub">${esc(p.brand)}${p.archived ? " · archived" : ""}</span></div></div></td>
                <td data-label="Units" class="ta-r num">${int(p.units)}</td><td data-label="Revenue" class="ta-r num">${money(p.revenue)}</td></tr>`).join("")}</tbody></table>`
              : NFA.stateHTML({ icon: "fa-solid fa-ranking-star", title: "No sales in this period" })}
          </div>
        </section>
        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-brands">
            <div class="adm-panel-head"><h2 id="h-brands">Top brands by revenue</h2></div>
            <div class="adm-panel-body">${bars(d.brands, "revenue", r => money(r.revenue), r => r.brand)}</div>
          </section>
          <section class="adm-panel" aria-labelledby="h-cats">
            <div class="adm-panel-head"><h2 id="h-cats">Categories</h2></div>
            <div class="adm-panel-body">${bars(d.categories, "revenue", r => `${money(r.revenue)} · ${int(r.units)} units`, r => NFA.cap(r.category), true)}</div>
          </section>
          <section class="adm-panel" aria-labelledby="h-status">
            <div class="adm-panel-head"><h2 id="h-status">Orders by status</h2></div>
            <div class="adm-panel-body">${Object.keys(d.statuses).length ? bars(NFA.ORDER_STATUSES.map(s => ({ s, n: d.statuses[s] || 0 })), "n", r => int(r.n), r => r.s) : `<p class="muted">No orders in this period.</p>`}</div>
          </section>
        </div>
      </div>
      <p class="adm-note" style="margin-top:14px">Figures use the price each item was sold at. Shipping and discounts aren't stored separately per order yet, so product revenue can differ slightly from order totals.</p>`;
    root.setAttribute("aria-busy", "false");
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    NFA.writeParams(state, { days: 30 });
    try { render(await NFA.api(`/api/admin/reports?days=${state.days}`)); }
    catch (e) {
      if (NFA.isSessionError(e)) return;
      root.innerHTML = `<div class="adm-panel">${NFA.errorState(e.message)}</div>`;
      root.setAttribute("aria-busy", "false");
    }
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });
  NFA.ready.then(() => {
    const actions = document.getElementById("page-actions");
    actions.innerHTML = `<label for="range" class="sr-only">Date range</label><select id="range" class="adm-select">${RANGES.map(([v, l]) => `<option value="${v}"${state.days === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    actions.querySelector("#range").addEventListener("change", e => { state.days = Number(e.target.value); load(); });
    load();
  });
})();
