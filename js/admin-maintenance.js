/* ============================================
   NeoFragrances — admin-maintenance.js
   System > Maintenance: one card holding the
   mode toggle, the 0-100 progress value and the
   status message. All three are saved together
   by POST /api/admin/maintenance.

   The browser constraints below (type=number,
   min/max, maxlength) are convenience only — the
   server validates every value again and is the
   authority. A 400 comes back with a `field`, and
   that is what decides which input is flagged.

   ADMIN-4: switching maintenance ON asks for
   confirmation first (decided from the last
   server-confirmed state, never the checkbox).
   Requests are bounded (15 s). When a save gets no
   usable answer — no response, or any 5xx — the
   outcome is unknown (the server may have committed),
   so the page re-reads the setting instead of
   presenting the old state as fact; if that re-read
   fails too, the state shows as Unknown and saving
   is blocked until the page is reloaded.
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, int } = NFA;
  const MESSAGE_MAX = 200; // mirrors MESSAGE_MAX in server settings.js
  const REQUEST_TIMEOUT_MS = 15000;
  const NO_RESPONSE = "The server didn't respond, so the change may or may not have been saved.";
  const LOAD_NO_RESPONSE = "The server didn't respond. Check your connection, then try again.";
  const CONFIRM_ON = {
    title: "Turn on maintenance mode?",
    text: "Customers won’t be able to browse or buy: storefront pages show the maintenance page and customer requests are refused until you turn it off. The admin portal stays available.",
    okLabel: "Turn on maintenance",
    danger: true,
  };
  let config = null, loadError = null;
  let saving = false;        // explicit in-flight guard (covers the confirmation dialog too)
  let stateUnknown = false;  // a save's outcome could not be confirmed, even by a re-read

  const clampPct = v => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

  // NFA.api bounded by an AbortController; the timer is cleared on every path.
  async function timedApi(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try { return await NFA.api(path, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }
  // No usable HTTP answer: network failure, timeout/abort, or a non-JSON body.
  const noResponse = e => !e || typeof e.status !== "number";

  function statusBadge(on) {
    return `<span class="adm-badge adm-badge--${on ? "live" : "disabled"}">${on ? "ON — storefront offline" : "OFF — storefront live"}</span>`;
  }

  // Updates the three figures in place from the confirmed config (or Unknown),
  // without re-rendering the form, so unsaved edits survive.
  function renderFigures() {
    const value = document.getElementById("m-state-value");
    const badge = document.getElementById("m-state-badge");
    if (stateUnknown) {
      // Presentation only: `config` keeps the last confirmed values, but none of the
      // three figures may present them as current while the save's outcome is unknown.
      if (value) value.textContent = "Unknown";
      if (badge) badge.innerHTML = `<span class="adm-badge adm-badge--pending">Not confirmed — reload this page</span>`;
      const pctUnknown = document.getElementById("m-pct-value");
      if (pctUnknown) pctUnknown.textContent = "Unknown";
      const changedUnknown = document.getElementById("m-changed-value");
      if (changedUnknown) changedUnknown.textContent = "—";
      const byUnknown = document.getElementById("m-changed-meta");
      if (byUnknown) byUnknown.textContent = "not confirmed";
      return;
    }
    if (value) value.textContent = config.maintenance ? "ON" : "OFF";
    if (badge) badge.innerHTML = statusBadge(config.maintenance);
    const pctEl = document.getElementById("m-pct-value");
    if (pctEl) pctEl.textContent = `${int(clampPct(config.progress))}%`;
    const changed = document.getElementById("m-changed-value");
    if (changed) changed.textContent = config.updated_at ? NFA.date(config.updated_at) : "—";
    const by = document.getElementById("m-changed-meta");
    if (by) by.textContent = config.updated_by_name || "never set";
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const pct = clampPct(config.progress);
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Maintenance mode</span><span class="adm-kpi-value" id="m-state-value">${config.maintenance ? "ON" : "OFF"}</span><span class="adm-kpi-meta" id="m-state-badge">${statusBadge(config.maintenance)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Progress</span><span class="adm-kpi-value" id="m-pct-value">${int(pct)}%</span><span class="adm-kpi-meta">shown on the maintenance page</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Last changed</span><span class="adm-kpi-value" id="m-changed-value">${config.updated_at ? esc(NFA.date(config.updated_at)) : "—"}</span><span class="adm-kpi-meta" id="m-changed-meta">${config.updated_by_name ? esc(config.updated_by_name) : "never set"}</span></div>
      </div>

      <div class="adm-panel">
        <div class="adm-panel-body">
          <form id="maint-form" novalidate>
            <div class="adm-form-grid">
              <div class="adm-field adm-field--wide adm-fieldset" role="group" aria-label="Maintenance mode">
                <label class="adm-check"><input type="checkbox" id="m-mode" name="maintenance" ${config.maintenance ? "checked" : ""}> <strong>Maintenance Mode</strong> — turn the storefront off for customers</label>
                <span class="adm-help">Customer APIs return 503 while this is on. The admin portal, admin login, health checks, payment verification and the Paystack webhook stay reachable.</span>
                <span class="adm-error" data-error-for="maintenance"></span>
              </div>

              <div class="adm-field">
                <label for="m-progress">Maintenance Progress</label>
                <input class="adm-input" id="m-progress" name="progress" type="number" min="0" max="100" step="1" inputmode="numeric" value="${int(pct)}" aria-describedby="m-progress-help">
                <span class="adm-help" id="m-progress-help">A whole number from 0 to 100. Drives the progress bar on the public page.</span>
                <span class="adm-error" data-error-for="progress"></span>
              </div>

              <div class="adm-field">
                <label for="m-message">Current Maintenance Status</label>
                <input class="adm-input" id="m-message" name="message" type="text" maxlength="${MESSAGE_MAX}" value="${esc(config.message || "")}" placeholder="e.g. Uploading new fragrances" aria-describedby="m-message-help">
                <span class="adm-help" id="m-message-help">Plain text, up to ${MESSAGE_MAX} characters. <span id="m-count">${int((config.message || "").length)}</span>/${MESSAGE_MAX} used. Shown to customers as "Status: …".</span>
                <span class="adm-error" data-error-for="message"></span>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap">
              <button type="submit" class="adm-btn adm-btn--primary" id="m-save">Save Configuration</button>
              <a class="adm-btn" href="../maintenance.html" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Preview the page</a>
              <span class="adm-form-status" id="m-status" role="status"></span>
            </div>
          </form>
        </div>
      </div>

      <p class="adm-note" style="margin-top:12px">All three values save together. If the settings table cannot be read the storefront stays <strong>live</strong> — maintenance never switches itself on because of a database problem.</p>`;
    wire();
  }

  function wire() {
    const form = document.getElementById("maint-form");
    const msg = document.getElementById("m-message");
    msg.addEventListener("input", () => { document.getElementById("m-count").textContent = String(msg.value.length); });
    // Keep the number input inside 0-100 as the operator types. The server
    // re-checks it regardless; this just avoids an obviously doomed request.
    const pct = document.getElementById("m-progress");
    pct.addEventListener("input", () => {
      if (pct.value === "") return;
      const n = clampPct(pct.value);
      if (String(n) !== pct.value) pct.value = String(n);
    });
    form.addEventListener("submit", e => { e.preventDefault(); save(form); });
  }

  function setStatus(text, isError) {
    const s = document.getElementById("m-status");
    if (!s) return;
    s.className = isError ? "adm-form-status is-error" : "adm-form-status";
    s.textContent = text;
  }

  // The save's outcome is unknown: re-read the setting (no retry of the POST).
  async function verifyAfterUnclearSave(lead) {
    setStatus(`${lead} Checking the current setting…`, true);
    try {
      const d = await timedApi("/api/admin/system/maintenance");
      config = Object.assign({}, config, d);
      stateUnknown = false;
      renderFigures();
      const now = config.maintenance ? "ON — the storefront is offline" : "OFF — the storefront is live";
      const text = `${lead} Maintenance is currently ${now} (confirmed by the server). Check the values below before saving again.`;
      setStatus(text, true);
      NFA.toast(text, "error");
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      stateUnknown = true;
      renderFigures();
      const text = `${lead} Couldn't confirm the current setting. Reload this page before changing it again.`;
      setStatus(text, true);
      NFA.toast(text, "error");
    }
  }

  async function save(form) {
    if (saving) return; // a save (or its confirmation) is already in progress
    NFA.clearFormErrors(form);
    setStatus("", false);
    if (stateUnknown) {
      setStatus("The current setting couldn't be confirmed. Reload this page before changing it again.", true);
      return;
    }

    const raw = form.elements.progress.value.trim();
    const body = {
      maintenance: form.elements.maintenance.checked,
      progress: raw === "" ? null : Number(raw),
      message: form.elements.message.value,
    };
    // Minimal pre-flight so an empty or non-integer box gets instant feedback.
    if (raw === "" || !Number.isInteger(body.progress) || body.progress < 0 || body.progress > 100) {
      return NFA.showFormError(form, "progress", "Enter a whole number from 0 to 100.");
    }
    if (body.message.length > MESSAGE_MAX) {
      return NFA.showFormError(form, "message", `Use ${MESSAGE_MAX} characters or fewer.`);
    }

    saving = true;
    const btn = document.getElementById("m-save");
    try {
      // Taking the storefront offline needs an explicit yes. Decided from the last
      // CONFIRMED state: OFF -> ON only (not ON -> OFF, not edits while already ON).
      if (body.maintenance && config && config.maintenance === false) {
        if (!(await NFA.confirm(CONFIRM_ON))) return; // nothing sent, edits kept
      }
      if (btn) btn.disabled = true;
      setStatus("Saving…", false);
      let saved;
      try {
        saved = await timedApi("/api/admin/maintenance", { method: "POST", body });
      } catch (e) {
        if (NFA.isSessionError(e)) return;
        if (noResponse(e)) return await verifyAfterUnclearSave(NO_RESPONSE);
        if (e.status >= 500) {
          // The handler rolls back on error, but a COMMIT whose acknowledgement was
          // lost, or a gateway 502/503/504, can follow a committed write: verify.
          return await verifyAfterUnclearSave(`${e.message || "The server reported an error."} The change may or may not have been saved.`);
        }
        // 4xx: rejected before anything was written — the confirmed state stands.
        if (e.field) NFA.showFormError(form, e.field, e.message);
        const text = e.message || "Could not save the configuration.";
        setStatus(text, true);
        NFA.toast(text, "error");
        return;
      }
      // Trust the server's echo, not the form, so normalisation is visible.
      config = Object.assign({}, config, {
        maintenance: saved.maintenance,
        progress: saved.progress,
        message: saved.message,
      });
      NFA.toast(saved.maintenance
        ? `Saved — maintenance is ON at ${saved.progress}%`
        : "Saved — maintenance is OFF, the storefront is live");
      // Refresh the audit fields without a full page reload.
      try { const d = await timedApi("/api/admin/system/maintenance"); config = Object.assign({}, config, d); } catch (e) { if (NFA.isSessionError(e)) return; }
      render();
      setStatus("Configuration saved.", false);
    } finally {
      saving = false;
      const b = document.getElementById("m-save");
      if (b) b.disabled = stateUnknown;
    }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { config = await timedApi("/api/admin/system/maintenance"); loadError = null; stateUnknown = false; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = noResponse(e) ? LOAD_NO_RESPONSE : (e.message || LOAD_NO_RESPONSE); }
    render();
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });

  NFA.ready.then(load);
})();
