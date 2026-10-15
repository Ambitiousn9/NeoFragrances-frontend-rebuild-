/* ============================================
   NeoFragrances — admin-dashboard.js
   Real figures from GET /api/admin/summary.
   Nothing is estimated or invented; empty data
   shows empty states.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, money, int } = NFA;

  function kpi({ label, value, meta, href, alert }) {
    const tag = href ? "a" : "div";
    return `<${tag} class="adm-kpi${alert ? " adm-kpi--alert" : ""}"${href ? ` href="${href}"` : ""}>
      <span class="adm-kpi-label">${esc(label)}</span>
      <span class="adm-kpi-value">${value}</span>
      ${meta ? `<span class="adm-kpi-meta">${meta}</span>` : ""}
    </${tag}>`;
  }

  function render(s) {
    const o = s.orders, p = s.products;
    const alerts = [];
    if (o.by_status.Pending) alerts.push({ tone: "", icon: "fa-solid fa-hourglass-half", text: `${int(o.by_status.Pending)} order${o.by_status.Pending !== 1 ? "s are" : " is"} waiting to be processed.`, href: "orders.html?status=Pending", cta: "Review orders" });
    if (p.out_of_stock) alerts.push({ tone: "danger", icon: "fa-solid fa-box-open", text: `${int(p.out_of_stock)} active product${p.out_of_stock !== 1 ? "s are" : " is"} out of stock.`, href: "inventory.html?stock=out", cta: "View" });
    if (p.low_stock) alerts.push({ tone: "", icon: "fa-solid fa-triangle-exclamation", text: `${int(p.low_stock)} product${p.low_stock !== 1 ? "s are" : " is"} low on stock (${s.low_stock_threshold} or fewer).`, href: "inventory.html?stock=low", cta: "Restock" });

    root.innerHTML = `
      ${alerts.length ? `<div class="adm-alerts" role="region" aria-label="Needs attention">${alerts.map(a => `
        <div class="adm-alert${a.tone ? " adm-alert--" + a.tone : ""}"><i class="${a.icon}" aria-hidden="true"></i><span>${esc(a.text)}</span><a href="${a.href}">${esc(a.cta)} →</a></div>`).join("")}</div>` : ""}

      <h2 class="sr-only">Key figures</h2>
      <div class="adm-kpis">
        ${kpi({ label: "Revenue", value: money(o.revenue), meta: `Excludes cancelled orders · last 30 days ${money(o.last_30_days.revenue)}`, href: "reports.html" })}
        ${kpi({ label: "Orders", value: int(o.total), meta: `${int(o.last_30_days.orders)} in the last 30 days`, href: "orders.html" })}
        ${kpi({ label: "Avg. order value", value: money(o.average_order_value), meta: "Excludes cancelled orders" })}
        ${kpi({ label: "Customers", value: int(s.customers.total), meta: `${int(s.customers.new_30d)} new in 30 days · ${int(s.customers.verified)} verified`, href: "customers.html" })}
        ${kpi({ label: "Active products", value: int(p.active), meta: `${int(p.archived)} archived`, href: "products.html" })}
        ${kpi({ label: "Out of stock", value: int(p.out_of_stock), meta: `${int(p.low_stock)} low on stock`, href: "inventory.html?stock=out", alert: p.out_of_stock > 0 })}
        ${kpi({ label: "Live offers", value: int(s.offers.live), meta: `${int(s.offers.scheduled)} scheduled`, href: "special-offers.html" })}
        ${kpi({ label: "Reviews", value: int(s.reviews.total), meta: s.reviews.average_rating === null ? "No reviews yet" : `Average ${s.reviews.average_rating} / 5`, href: "reviews.html" })}
      </div>

      <div class="adm-grid adm-grid--main">
        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-orders-status">
            <div class="adm-panel-head"><h2 id="h-orders-status">Orders by status</h2><a class="adm-link" href="orders.html">All orders</a></div>
            <div class="adm-panel-body">${statusBars(o.by_status, o.total)}</div>
          </section>
          <section class="adm-panel" aria-labelledby="h-recent-orders">
            <div class="adm-panel-head"><h2 id="h-recent-orders">Recent orders</h2><a class="adm-link" href="orders.html">View all</a></div>
            <div class="adm-panel-body adm-panel-body--flush">
              ${s.recent_orders.length ? `<ul class="adm-list">${s.recent_orders.map(r => `
                <li>
                  <div class="adm-list-main">
                    <a class="adm-list-title" href="order.html?id=${encodeURIComponent(r.id)}">Order #${esc(r.id)} · ${esc(r.customer_name)}</a>
                    <span class="adm-list-sub">${esc(NFA.dateTime(r.created_at))} · ${int(r.item_count)} item${r.item_count !== 1 ? "s" : ""}</span>
                  </div>
                  <div class="adm-list-side">${NFA.orderBadge(r.status)}<div class="num" style="margin-top:4px">${money(r.total)}</div></div>
                </li>`).join("")}</ul>` : NFA.stateHTML({ icon: "fa-solid fa-receipt", title: "No orders yet", text: "Orders appear here as soon as customers complete a payment." })}
            </div>
          </section>
        </div>
        <div class="adm-stack">
          <section class="adm-panel" aria-labelledby="h-low-stock">
            <div class="adm-panel-head"><h2 id="h-low-stock">Low stock</h2><a class="adm-link" href="inventory.html?stock=low">Inventory</a></div>
            <div class="adm-panel-body adm-panel-body--flush">
              ${s.low_stock_products.length ? `<ul class="adm-list">${s.low_stock_products.map(item => `
                <li>${NFA.thumb(item.image)}
                  <div class="adm-list-main"><span class="adm-list-title">${esc(item.name)}</span><span class="adm-list-sub">${esc(item.brand)}</span></div>
                  <div class="adm-list-side"><span class="adm-badge adm-badge--low">${int(item.stock_qty)} left</span></div>
                </li>`).join("")}</ul>` : NFA.stateHTML({ icon: "fa-solid fa-check", title: "Nothing low on stock", text: `No active product has between 1 and ${s.low_stock_threshold} units.${p.out_of_stock ? " Out-of-stock products are listed in Inventory." : ""}` })}
            </div>
          </section>
          <section class="adm-panel" aria-labelledby="h-reviews">
            <div class="adm-panel-head"><h2 id="h-reviews">Recent reviews</h2><a class="adm-link" href="reviews.html">All reviews</a></div>
            <div class="adm-panel-body adm-panel-body--flush">
              ${s.recent_reviews.length ? `<ul class="adm-list">${s.recent_reviews.map(r => `
                <li><div class="adm-list-main">
                  <span class="adm-list-title">${esc(r.product_name)}</span>
                  <span class="adm-list-sub">${NFA.stars(r.rating)} · ${esc(r.customer_name)} · ${esc(NFA.date(r.created_at))}</span>
                </div></li>`).join("")}</ul>` : NFA.stateHTML({ icon: "fa-regular fa-star", title: "No reviews yet", text: "Customer reviews will appear here." })}
            </div>
          </section>
        </div>
      </div>`;
    root.setAttribute("aria-busy", "false");
  }

  function statusBars(byStatus, total) {
    if (!total) return `<p class="muted">No orders yet.</p>`;
    const max = Math.max(...Object.values(byStatus), 1);
    return `<ul class="adm-bars">${NFA.ORDER_STATUSES.map(st => `
      <li class="adm-bar-row">
        <a class="adm-bar-label" href="orders.html?status=${st}">${st}</a>
        <span class="adm-bar-track" aria-hidden="true"><span class="adm-bar-fill${st === "Cancelled" ? " adm-bar-fill--gold" : ""}" style="width:${(byStatus[st] / max) * 100}%"></span></span>
        <span class="adm-bar-value">${int(byStatus[st])}</span>
      </li>`).join("")}</ul>`;
  }

  async function load(force = false) {
    root.setAttribute("aria-busy", "true");
    try {
      render(await NFA.summary(force));
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      root.innerHTML = `<div class="adm-panel">${NFA.errorState(e.message)}</div>`;
      root.setAttribute("aria-busy", "false");
    }
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(true); });
  NFA.ready.then(() => {
    document.getElementById("page-actions").innerHTML = `<a class="adm-btn" href="orders.html?status=Pending"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> Pending orders</a><a class="adm-btn adm-btn--primary" href="products.html?new=1"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add product</a>`;
    load();
  });
})();
