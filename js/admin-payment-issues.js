/* ============================================
   NeoFragrances — admin-payment-issues.js
   Payment issues (Payment Reliability Stage B):
   payments Paystack confirmed — or a signed webhook
   reported — that did not become an order.
   GET  /api/admin/payment-issues          list
   GET  /api/admin/payment-issues/:id      detail
   POST /api/admin/payment-issues/:id/retry    re-run Paystack-verified settlement
   POST /api/admin/payment-issues/:id/resolve  record a manual decision (+ note)
   Nothing here can create an order or mark a payment
   paid; only the server's verified settlement does.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, int } = NFA;
  const DEFAULTS = { status: "open", category: "", evidence: "", from: "", to: "", q: "", page: 1 };
  const PAGE_SIZE = 25;
  const NOTE_MAX = 500;
  const state = NFA.readParams(DEFAULTS);
  let requestId = 0;
  // The retry/resolve request in flight, if any. A token rather than a boolean: only
  // the operation that set it may clear it, and it is ALWAYS cleared when that
  // operation finishes — even if its drawer was closed meanwhile — so the page can
  // never stay busy, and an older request's cleanup can never clear a newer one's.
  let activeAction = null;

  const CATEGORY_LABELS = {
    settlement_blocked: "Settlement blocked",
    integrity_mismatch: "Integrity mismatch",
    settlement_error: "Settlement error",
    unverified_charge: "Unverified charge",
  };
  const CATEGORY_HELP = {
    settlement_blocked: "Paystack confirmed the payment, but the order couldn't be created as paid for (sold out, product archived, address deleted or coupon used up).",
    integrity_mismatch: "Paystack confirmed a payment that doesn't match its order (amount, currency, reference or order details). It is never retried automatically — investigate it in Paystack.",
    settlement_error: "Paystack confirmed the payment, but a database error stopped the order being created. Retrying is safe: it can't create a second order.",
    unverified_charge: "Paystack sent a signed charge.success notification, but the payment couldn't be verified yet (Paystack unreachable or still pending).",
  };
  const EVIDENCE_LABELS = { paystack_verified: "Paystack verified", signed_webhook: "Signed webhook only" };
  const RESOLUTION_LABELS = {
    settled: "Settled (order created)",
    refunded_externally: "Refunded in Paystack",
    no_action_needed: "No action needed",
    duplicate_payment: "Duplicate payment",
  };
  const SOURCE_LABELS = { callback: "Customer return page", webhook: "Paystack webhook", admin_retry: "Admin retry" };
  const pesewas = (amount, currency) => amount === null || amount === undefined ? "—"
    : `${currency && currency !== "GHS" ? esc(currency) + " " : ""}${NFA.money(amount / 100)}`;
  const statusBadge = s => `<span class="adm-badge adm-badge--${s === "open" ? "pending" : "active"}">${s === "open" ? "Open" : "Resolved"}</span>`;

  function query() {
    const p = new URLSearchParams();
    p.set("status", state.status);
    if (state.category) p.set("category", state.category);
    if (state.evidence) p.set("evidence", state.evidence);
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
    if (state.q) p.set("q", state.q);
    p.set("page", state.page); p.set("pageSize", PAGE_SIZE);
    return p.toString();
  }

  function renderFrame() {
    const opt = (map, current, all) => `<option value="">${all}</option>` + Object.entries(map).map(([k, l]) => `<option value="${k}"${current === k ? " selected" : ""}>${esc(l)}</option>`).join("");
    root.innerHTML = `
      <div class="adm-tabs" role="group" aria-label="Issue status" id="pi-tabs"></div>
      <div class="adm-toolbar">
        <div class="adm-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><label for="pi-search" class="sr-only">Search by payment reference</label><input id="pi-search" class="adm-input" type="search" placeholder="Payment reference (NF-…)" value="${esc(state.q)}" maxlength="100"></div>
        <label for="pi-category" class="sr-only">Category</label>
        <select id="pi-category" class="adm-select">${opt(CATEGORY_LABELS, state.category, "All categories")}</select>
        <label for="pi-evidence" class="sr-only">Evidence</label>
        <select id="pi-evidence" class="adm-select">${opt(EVIDENCE_LABELS, state.evidence, "Any evidence")}</select>
        <div class="adm-daterange" role="group" aria-label="Last seen between"><label for="pi-from" class="adm-count">From</label><input id="pi-from" class="adm-input" type="date" value="${esc(state.from)}"><label for="pi-to" class="adm-count">To</label><input id="pi-to" class="adm-input" type="date" value="${esc(state.to)}"></div>
        <div class="adm-toolbar-right"><span class="adm-count" id="pi-count" role="status"></span></div>
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards">
          <caption class="sr-only">Payment issues</caption>
          <thead><tr><th>Payment reference</th><th>Category</th><th>Evidence</th><th class="ta-r">Amount</th><th>Customer</th><th class="ta-r">Attempts</th><th>Status</th><th class="ta-r"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="pi-body">${NFA.skeletonRows(8)}</tbody>
        </table>
        <div id="pi-pager"></div>
      </div>`;
  }

  function renderData(d) {
    const tabs = [["open", "Open", d.status_counts.open], ["resolved", "Resolved", d.status_counts.resolved], ["all", "All", d.status_counts.open + d.status_counts.resolved]];
    document.getElementById("pi-tabs").innerHTML = tabs.map(([k, l, n]) => `<button type="button" class="adm-tab" data-status="${k}" aria-pressed="${state.status === k}">${l}<span class="adm-tab-count">${int(n)}</span></button>`).join("");
    document.getElementById("pi-count").textContent = `${int(d.total)} issue${d.total !== 1 ? "s" : ""}`;
    const filtersOn = state.q || state.category || state.evidence || state.from || state.to;
    document.getElementById("pi-body").innerHTML = d.issues.length ? d.issues.map(i => `
      <tr>
        <td class="adm-td-primary"><span class="adm-code">${esc(i.payment_reference)}</span><span class="adm-cell-sub" style="display:block">Last seen ${esc(NFA.dateTime(i.last_seen_at))}</span></td>
        <td data-label="Category"><span class="adm-tag">${esc(CATEGORY_LABELS[i.category] || i.category)}</span>${i.last_error_code ? `<span class="adm-cell-sub" style="display:block">${esc(i.last_error_code)}</span>` : ""}</td>
        <td data-label="Evidence">${esc(EVIDENCE_LABELS[i.evidence] || i.evidence)}</td>
        <td data-label="Amount" class="ta-r num">${pesewas(i.amount_pesewas, i.currency)}</td>
        <td data-label="Customer">${i.user_id ? `<a class="adm-link" href="customer.html?id=${encodeURIComponent(i.user_id)}">${esc(i.customer_name || `Customer #${i.user_id}`)}</a>` : `<span class="muted">Unknown</span>`}</td>
        <td data-label="Attempts" class="ta-r num">${int(i.attempt_count)}</td>
        <td data-label="Status">${statusBadge(i.status)}${i.manual_resolution_conflict
          ? `<span class="adm-badge adm-badge--danger" style="margin-left:4px">Needs review</span><span class="adm-cell-sub" style="display:block">Resolved manually, but order #${esc(i.linked_order_id)} exists</span>`
          : i.has_order ? `<span class="adm-cell-sub" style="display:block">Order #${esc(i.linked_order_id)} exists</span>` : ""}</td>
        <td class="adm-td-actions ta-r"><button type="button" class="adm-btn adm-btn--sm" data-view="${esc(i.id)}" aria-label="View issue for ${esc(i.payment_reference)}">View</button></td>
      </tr>`).join("")
      : NFA.tableState(8, filtersOn
        ? NFA.stateHTML({ icon: "fa-solid fa-magnifying-glass", title: "No issues match", text: "Try a different reference, category, evidence or date range.", action: `<button type="button" class="adm-btn adm-btn--sm" data-action="clear">Clear filters</button>` })
        : NFA.stateHTML({ icon: "fa-solid fa-circle-check", title: state.status === "open" ? "No open payment issues" : "No payment issues", text: "Issues appear here only when a confirmed or signalled payment couldn't become an order." }));
    document.getElementById("pi-pager").innerHTML = NFA.pagerHTML({ total: d.total, page: d.page, pageSize: d.pageSize, noun: "issues" });
  }

  async function load() {
    const my = ++requestId;
    root.setAttribute("aria-busy", "true");
    NFA.writeParams(state, DEFAULTS);
    try {
      const d = await NFA.api(`/api/admin/payment-issues?${query()}`);
      if (my !== requestId) return;
      if (!d.issues.length && d.total && state.page > 1) { state.page = Math.ceil(d.total / PAGE_SIZE); return load(); }
      renderData(d);
    } catch (e) {
      if (NFA.isSessionError(e) || my !== requestId) return;
      document.getElementById("pi-body").innerHTML = NFA.tableState(8, NFA.errorState(e.message));
    } finally { if (my === requestId) root.setAttribute("aria-busy", "false"); }
  }

  /* ---------- detail drawer ---------- */
  function detailHTML(i) {
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    const facts = [
      row("Reference", `<span class="adm-code">${esc(i.payment_reference)}</span>`),
      row("Status", `${statusBadge(i.status)}${i.resolution ? ` ${esc(RESOLUTION_LABELS[i.resolution] || i.resolution)}` : ""}`),
      row("Category", esc(CATEGORY_LABELS[i.category] || i.category)),
      row("Last error", i.last_error_code ? `<span class="adm-code">${esc(i.last_error_code)}</span>` : "—"),
      row("Evidence", esc(EVIDENCE_LABELS[i.evidence] || i.evidence)),
      row("Paid (Paystack)", pesewas(i.amount_pesewas, i.currency)),
      row("Order total", pesewas(i.expected_total_pesewas, "GHS")),
      row("Customer", i.user_id ? `<a class="adm-link" href="customer.html?id=${encodeURIComponent(i.user_id)}">${esc(i.customer_name || `Customer #${i.user_id}`)}</a>` : "Unknown (no trusted order details)"),
      row("Product", i.detail_product_id ? esc(i.detail_product_name ? `${i.detail_product_name} (#${i.detail_product_id})` : `#${i.detail_product_id}`) : "—"),
      row("Order", i.linked_order ? `<a class="adm-link" href="order.html?id=${encodeURIComponent(i.linked_order.id)}">Order #${esc(i.linked_order.id)}</a> · ${esc(i.linked_order.status)}` : "None"),
      row("Attempts", int(i.attempt_count)),
      row("First seen", `${esc(NFA.dateTime(i.first_seen_at))} · ${esc(SOURCE_LABELS[i.first_source] || i.first_source)}`),
      row("Last seen", `${esc(NFA.dateTime(i.last_seen_at))} · ${esc(SOURCE_LABELS[i.last_source] || i.last_source)}`),
    ];
    if (i.status === "resolved") {
      facts.push(row("Resolved", `${esc(NFA.dateTime(i.resolved_at))}${i.resolved_by_name ? ` by ${esc(i.resolved_by_name)}` : i.resolution === "settled" ? " automatically" : ""}`));
      if (i.resolution_note) facts.push(row("Note", esc(i.resolution_note)));
    }
    let actions = "";
    if (i.status === "open") {
      actions += `<div class="adm-form-section">Recover</div>`;
      actions += i.retry_allowed
        ? `<p class="adm-note">Retry asks Paystack again and, only if Paystack confirms the payment, creates the order through the normal checkout path. It can't create a second order or take stock twice.</p>
           <p><button type="button" class="adm-btn adm-btn--primary" data-issue-retry>Retry settlement</button></p>`
        : i.last_error_code === "PAID_ADDRESS_MISSING"
          ? `<p class="adm-note">This can't be retried: the delivery address chosen at checkout was deleted, and the order must not be sent anywhere else. Contact the customer, then record what you decided below.</p>`
          : `<p class="adm-note">This category can't be retried. Check the payment in your Paystack dashboard, then record what you decided below.</p>`;
      if (i.has_order) {
        actions += `<p class="adm-note">Order #${esc(i.linked_order_id)} already exists for this payment, so it can't be closed manually. ${i.retry_allowed ? "Use Retry settlement to link the order and close the issue." : ""}</p>`;
      } else {
        actions += `
          <form id="pi-resolve" novalidate>
            <div class="adm-form-section">Record a decision</div>
            <p class="adm-note">Use this only after checking the payment in Paystack. A customer's screenshot is not proof of payment, and this never creates an order.</p>
            <div class="adm-field">
              <label for="pi-resolution">Resolution</label>
              <select id="pi-resolution" name="resolution" class="adm-select" required>
                <option value="">Choose…</option>
                <option value="refunded_externally">${RESOLUTION_LABELS.refunded_externally}</option>
                <option value="no_action_needed">${RESOLUTION_LABELS.no_action_needed}</option>
                <option value="duplicate_payment">${RESOLUTION_LABELS.duplicate_payment}</option>
              </select>
              <span class="adm-error" data-error-for="resolution"></span>
            </div>
            <div class="adm-field">
              <label for="pi-note">Note <span class="adm-note-req">(required, up to ${NOTE_MAX} characters)</span></label>
              <textarea id="pi-note" name="note" class="adm-textarea adm-textarea--sm" maxlength="${NOTE_MAX}" required></textarea>
              <span class="adm-error" data-error-for="note"></span>
            </div>
            <p><button type="submit" class="adm-btn">Resolve issue</button></p>
          </form>`;
      }
    }
    // A manual decision was recorded, yet an order also exists for this payment. The
    // decision is kept as recorded; this only states both facts — it does not mean
    // any refund was reversed or that any money moved.
    const conflict = i.manual_resolution_conflict && i.linked_order
      ? `<div class="adm-state adm-state--error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <h3>Needs review: resolved manually, but an order exists</h3>
          <p>This issue was resolved as "${esc(RESOLUTION_LABELS[i.resolution] || i.resolution)}", and order #${esc(i.linked_order.id)} was also created for the same payment — usually because a settlement finished while or just after the decision was recorded. Nothing was changed automatically. Check the order and the payment in your Paystack dashboard and decide whether the order should go ahead.</p>
        </div>`
      : "";
    return `
      ${conflict}
      <p class="adm-note">${esc(CATEGORY_HELP[i.category] || "")}</p>
      <dl class="adm-dl">${facts.join("")}</dl>
      ${actions}`;
  }

  async function openDetail(id) {
    const drawer = NFA.openDrawer({
      title: "Payment issue",
      bodyHTML: `<span class="adm-skel adm-skel--lg"></span><br><span class="adm-skel"></span>`,
      footHTML: `<span class="adm-form-status" role="status"></span><button type="button" class="adm-btn" data-drawer-close-btn>Close</button>`,
    });
    drawer.querySelector("[data-drawer-close-btn]").addEventListener("click", () => NFA.closeDrawer());
    await renderDetail(drawer, id);
  }

  async function renderDetail(drawer, id) {
    const body = drawer.querySelector(".adm-drawer-body");
    try {
      const issue = await NFA.api(`/api/admin/payment-issues/${encodeURIComponent(id)}`);
      if (!document.contains(drawer)) return;
      body.innerHTML = detailHTML(issue);
      wireDetail(drawer, issue);
    } catch (e) {
      if (NFA.isSessionError(e) || !document.contains(drawer)) return;
      body.innerHTML = NFA.errorState(e.message, false);
    }
  }

  function setStatus(drawer, message, isError) {
    const el = drawer.querySelector(".adm-form-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", !!isError);
  }
  // DOM side only, and only while the drawer is still on the page: a detached drawer's
  // controls are never touched.
  function setControlsBusy(drawer, on) {
    if (!document.contains(drawer)) return;
    drawer.querySelectorAll("button, select, textarea").forEach(el => { if (!el.hasAttribute("data-drawer-close")) el.disabled = on; });
    drawer.querySelector(".adm-drawer-body")?.setAttribute("aria-busy", String(on));
  }
  function beginAction(drawer) {
    const token = {};
    activeAction = token;
    setControlsBusy(drawer, true);
    return token;
  }
  function endAction(drawer, token) {
    if (activeAction === token) activeAction = null;
    setControlsBusy(drawer, false);
  }
  // True (and says so) when another retry/resolve is still finishing.
  function actionInFlight(drawer) {
    if (!activeAction) return false;
    setStatus(drawer, "Another payment-issue action is still finishing. Try again in a moment.", true);
    return true;
  }

  function wireDetail(drawer, issue) {
    drawer.querySelector("[data-issue-retry]")?.addEventListener("click", async () => {
      if (actionInFlight(drawer)) return;
      const ok = await NFA.confirm({
        title: "Retry settlement?",
        text: `Paystack will be asked about ${issue.payment_reference} again. An order is created only if Paystack confirms the payment and every check passes.`,
        okLabel: "Retry settlement",
      });
      if (!ok || actionInFlight(drawer)) return;
      const action = beginAction(drawer);
      setStatus(drawer, "Asking Paystack…");
      try {
        const r = await NFA.api(`/api/admin/payment-issues/${encodeURIComponent(issue.id)}/retry`, { method: "POST", body: {} });
        NFA.toast(r.message, r.settled ? "success" : "info");
        setStatus(drawer, r.message, !r.settled);
        await renderDetail(drawer, issue.id);
        if (r.settled) setStatus(drawer, r.message, false);
        load(); NFA.loadCounts(true);
      } catch (e) {
        if (NFA.isSessionError(e)) return;
        setStatus(drawer, e.message, true);
      } finally { endAction(drawer, action); }
    });

    const form = drawer.querySelector("#pi-resolve");
    form?.addEventListener("submit", async ev => {
      ev.preventDefault();
      if (actionInFlight(drawer)) return;
      NFA.clearFormErrors(form);
      const resolution = form.resolution.value;
      const note = form.note.value.trim();
      if (!resolution) return NFA.showFormError(form, "resolution", "Choose a resolution.");
      if (!note) return NFA.showFormError(form, "note", "Add a note explaining the resolution.");
      if (note.length > NOTE_MAX) return NFA.showFormError(form, "note", `The note must be ${NOTE_MAX} characters or fewer.`);
      const ok = await NFA.confirm({
        title: "Resolve this issue?",
        text: `It will be closed as "${RESOLUTION_LABELS[resolution]}". This can't be undone, and it doesn't create an order or a refund.`,
        okLabel: "Resolve issue",
      });
      if (!ok || actionInFlight(drawer)) return;
      const action = beginAction(drawer);
      setStatus(drawer, "Saving…");
      try {
        await NFA.api(`/api/admin/payment-issues/${encodeURIComponent(issue.id)}/resolve`, { method: "POST", body: { resolution, note } });
        NFA.toast("Payment issue resolved");
        await renderDetail(drawer, issue.id);
        setStatus(drawer, "Resolved.", false);
        load(); NFA.loadCounts(true);
      } catch (e) {
        if (NFA.isSessionError(e)) return;
        if (e.field) NFA.showFormError(form, e.field, e.message);
        else setStatus(drawer, e.message, true);
        if (e.status === 409) { await renderDetail(drawer, issue.id); setStatus(drawer, e.message, true); load(); }
      } finally { endAction(drawer, action); }
    });
  }

  /* ---------- events ---------- */
  const onSearch = NFA.debounce(() => { state.page = 1; load(); }, 300);
  root.addEventListener("input", e => { if (e.target.id === "pi-search") { state.q = e.target.value.trim(); onSearch(); } });
  root.addEventListener("change", e => {
    const map = { "pi-category": "category", "pi-evidence": "evidence", "pi-from": "from", "pi-to": "to" };
    if (map[e.target.id]) { state[map[e.target.id]] = e.target.value; state.page = 1; load(); }
  });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) return load();
    const tab = e.target.closest("[data-status]");
    if (tab) { state.status = tab.dataset.status; state.page = 1; load().then(() => root.querySelector(`[data-status="${state.status}"]`)?.focus()); return; }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) { state.page = Number(pageBtn.dataset.page); load(); window.scrollTo({ top: 0 }); return; }
    const view = e.target.closest("[data-view]");
    if (view) { openDetail(view.dataset.view); return; }
    const a = e.target.closest("[data-action]");
    if (a?.dataset.action === "clear") { Object.assign(state, DEFAULTS); renderFrame(); load(); }
  });

  NFA.ready.then(() => { renderFrame(); load(); });
})();
