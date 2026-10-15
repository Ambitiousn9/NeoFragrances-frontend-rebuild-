/* ============================================
   NeoFragrances — admin-reviews.js
   Review moderation: search / filter / paginate,
   product + customer context, reversible hide/unhide,
   and permanent delete (with confirmation). The server
   recalculates the product's rating and review count
   from VISIBLE reviews only, so hiding a review removes
   it from the storefront and from the public rating.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, int } = NFA;
  const DEFAULTS = { q: "", rating: "all", verified: "all", visibility: "all", page: 1 };
  const PAGE_SIZE = 20;
  const state = NFA.readParams(DEFAULTS);
  let reviews = null, loadError = null;

  function filtered() {
    const q = NFA.normalize(state.q);
    return reviews.filter(r => {
      if (state.rating !== "all" && String(r.rating) !== state.rating) return false;
      if (state.verified === "yes" && !r.is_verified_purchase) return false;
      if (state.verified === "no" && r.is_verified_purchase) return false;
      if (state.visibility === "visible" && r.hidden) return false;
      if (state.visibility === "hidden" && !r.hidden) return false;
      if (q && !NFA.normalize(`${r.product_name} ${r.product_brand} ${r.customer_name} ${r.customer_email} ${r.comment || ""}`).includes(q)) return false;
      return true;
    });
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    // Average over VISIBLE reviews only, so this KPI matches what customers see.
    const shown = reviews.filter(r => !r.hidden);
    const avg = shown.length ? shown.reduce((s, r) => s + r.rating, 0) / shown.length : null;
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Reviews</span><span class="adm-kpi-value">${int(reviews.length)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Average rating</span><span class="adm-kpi-value">${avg === null ? "—" : avg.toFixed(1)}</span><span class="adm-kpi-meta">${avg === null ? "No visible reviews" : "out of 5, visible only"}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Verified purchases</span><span class="adm-kpi-value">${int(reviews.filter(r => r.is_verified_purchase).length)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Hidden</span><span class="adm-kpi-value">${int(reviews.filter(r => r.hidden).length)}</span><span class="adm-kpi-meta">not shown in the store</span></div>
      </div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="r-search" class="sr-only">Search reviews</label><input id="r-search" class="adm-input" type="search" placeholder="Product, customer or review text" value="${esc(state.q)}"></div>
        <label class="sr-only" for="r-rating">Rating</label>
        <select id="r-rating" class="adm-select" data-filter="rating"><option value="all">Any rating</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${state.rating === String(n) ? " selected" : ""}>${n} star${n !== 1 ? "s" : ""}</option>`).join("")}</select>
        <label class="sr-only" for="r-verified">Purchase</label>
        <select id="r-verified" class="adm-select" data-filter="verified">${[["all", "All reviews"], ["yes", "Verified purchase"], ["no", "Not verified"]].map(([v, l]) => `<option value="${v}"${state.verified === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <label class="sr-only" for="r-visibility">Visibility</label>
        <select id="r-visibility" class="adm-select" data-filter="visibility">${[["all", "All visibility"], ["visible", "Visible"], ["hidden", "Hidden"]].map(([v, l]) => `<option value="${v}"${state.visibility === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <div class="adm-toolbar-right"><span class="adm-count" id="r-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards"><caption class="sr-only">Reviews</caption>
          <thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>Customer</th><th>Status</th><th>Date</th><th class="ta-r"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="r-body"></tbody>
        </table>
        <div id="r-pager"></div>
      </div>`;
    renderTable();
  }

  function renderTable() {
    const list = filtered();
    const pg = NFA.paginate(list, state.page, PAGE_SIZE);
    state.page = pg.page;
    NFA.writeParams(state, DEFAULTS);
    document.getElementById("r-count").textContent = `${int(list.length)} review${list.length !== 1 ? "s" : ""}`;
    document.getElementById("r-body").innerHTML = pg.rows.length ? pg.rows.map(r => `
      <tr>
        <td class="adm-td-primary"><div class="adm-cell-product">${NFA.thumb(r.product_image)}<div><span class="adm-cell-title">${esc(r.product_name)}</span><span class="adm-cell-sub">${esc(r.product_brand)}${r.product_archived ? " · archived" : ""}</span></div></div></td>
        <td data-label="Rating">${NFA.stars(r.rating)}</td>
        <td data-label="Review" style="max-width:360px">${r.comment ? esc(r.comment) : `<span class="muted">No comment</span>`}</td>
        <td data-label="Customer"><a href="customer.html?id=${encodeURIComponent(r.customer_id)}">${esc(r.customer_name)}</a>${r.is_verified_purchase ? ` <span class="adm-badge adm-badge--active">Verified purchase</span>` : ""}</td>
        <td data-label="Status"><span class="adm-badge adm-badge--${r.hidden ? "disabled" : "live"}">${r.hidden ? "Hidden" : "Visible"}</span></td>
        <td data-label="Date" class="nowrap">${esc(NFA.date(r.created_at))}</td>
        <td class="adm-td-actions ta-r"><span class="adm-row-actions">
          <button type="button" class="adm-link" data-visibility="${r.id}" aria-label="${r.hidden ? "Unhide" : "Hide"} review by ${esc(r.customer_name)} on ${esc(r.product_name)}">${r.hidden ? "Unhide" : "Hide"}</button>
          <button type="button" class="adm-link adm-link--danger" data-delete="${r.id}" aria-label="Delete review by ${esc(r.customer_name)} on ${esc(r.product_name)}">Delete</button>
        </span></td>
      </tr>`).join("")
      : NFA.tableState(7, reviews.length
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No reviews match", text: "Try a different search or filter." })
        : NFA.stateHTML({ icon: "fa-regular fa-star", title: "No reviews yet", text: "Reviews written by customers will appear here." }));
    document.getElementById("r-pager").innerHTML = NFA.pagerHTML({ total: list.length, page: pg.page, pageSize: PAGE_SIZE, noun: "reviews" });
  }

  async function remove(reviewId) {
    const r = reviews.find(x => x.id === reviewId);
    if (!r) return;
    const ok = await NFA.confirm({ title: "Delete this review permanently?", text: `${r.customer_name}'s ${r.rating}-star review of “${r.product_name}” will be removed and the product's rating recalculated. This can't be undone.`, okLabel: "Delete review", danger: true });
    if (!ok) return;
    try {
      const res = await NFA.api(`/api/admin/reviews/${reviewId}`, { method: "DELETE" });
      reviews = reviews.filter(x => x.id !== reviewId);
      NFA.toast(`Review deleted — ${r.product_name} now has ${res.review_count} review${res.review_count !== 1 ? "s" : ""}`);
      render();
      root.querySelector("#r-search")?.focus();
    } catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
  }

  // Hide/unhide is reversible, so it needs no confirmation dialog — unlike delete.
  async function setVisibility(reviewId, hidden) {
    const r = reviews.find(x => x.id === reviewId);
    if (!r) return;
    try {
      const res = await NFA.api(`/api/admin/reviews/${reviewId}/hidden`, { method: "PATCH", body: { hidden } });
      r.hidden = hidden;
      NFA.toast(hidden
        ? `Review hidden — ${r.product_name} now shows ${res.review_count} review${res.review_count !== 1 ? "s" : ""}`
        : `Review visible again — ${r.product_name} now shows ${res.review_count} review${res.review_count !== 1 ? "s" : ""}`);
      render();
    } catch (e) { if (!NFA.isSessionError(e)) NFA.toast(e.message, "error"); }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { reviews = await NFA.api("/api/admin/reviews"); loadError = null; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  const onSearch = NFA.debounce(() => { state.page = 1; renderTable(); });
  root.addEventListener("input", e => { if (e.target.id === "r-search") { state.q = e.target.value; onSearch(); } });
  root.addEventListener("change", e => { const f = e.target.dataset.filter; if (f) { state[f] = e.target.value; state.page = 1; renderTable(); } });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); renderTable(); return; }
    const vis = e.target.closest("[data-visibility]");
    if (vis) {
      const id = Number(vis.dataset.visibility);
      const r = reviews.find(x => x.id === id);
      if (r) setVisibility(id, !r.hidden);
      return;
    }
    const del = e.target.closest("[data-delete]");
    if (del) remove(Number(del.dataset.delete));
  });

  NFA.ready.then(load);
})();
