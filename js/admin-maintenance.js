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
   ============================================ */

(function () {
  const root = document.getElementById("page-root");
  const { esc, int } = NFA;
  const MESSAGE_MAX = 200; // mirrors MESSAGE_MAX in server settings.js
  let config = null, loadError = null;

  const clampPct = v => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

  function statusBadge(on) {
    return `<span class="adm-badge adm-badge--${on ? "live" : "disabled"}">${on ? "ON — storefront offline" : "OFF — storefront live"}</span>`;
  }

  function render() {
    root.setAttribute("aria-busy", "false");
    if (loadError) { root.innerHTML = `<div class="adm-panel">${NFA.errorState(loadError)}</div>`; return; }
    const pct = clampPct(config.progress);
    root.innerHTML = `
      <div class="adm-kpis">
        <div class="adm-kpi"><span class="adm-kpi-label">Maintenance mode</span><span class="adm-kpi-value" id="m-state-value">${config.maintenance ? "ON" : "OFF"}</span><span class="adm-kpi-meta" id="m-state-badge">${statusBadge(config.maintenance)}</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Progress</span><span class="adm-kpi-value" id="m-pct-value">${int(pct)}%</span><span class="adm-kpi-meta">shown on the maintenance page</span></div>
        <div class="adm-kpi"><span class="adm-kpi-label">Last changed</span><span class="adm-kpi-value">${config.updated_at ? esc(NFA.date(config.updated_at)) : "—"}</span><span class="adm-kpi-meta">${config.updated_by_name ? esc(config.updated_by_name) : "never set"}</span></div>
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

  async function save(form) {
    NFA.clearFormErrors(form);
    const status = document.getElementById("m-status");
    status.textContent = "";
    status.className = "adm-form-status";

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

    const btn = document.getElementById("m-save");
    btn.disabled = true;
    try {
      const saved = await NFA.api("/api/admin/maintenance", { method: "POST", body });
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
      try { const d = await NFA.api("/api/admin/system/maintenance"); config = Object.assign({}, config, d); } catch (e) { if (NFA.isSessionError(e)) return; }
      render();
      const s = document.getElementById("m-status");
      s.className = "adm-form-status";
      s.textContent = "Configuration saved.";
    } catch (e) {
      if (NFA.isSessionError(e)) return;
      // A 400 names the offending field; anything else is a general failure.
      if (e.field) NFA.showFormError(form, e.field, e.message);
      status.className = "adm-form-status is-error";
      status.textContent = e.message || "Could not save the configuration.";
      NFA.toast(e.message || "Could not save the configuration.", "error");
    } finally {
      const b = document.getElementById("m-save");
      if (b) b.disabled = false;
    }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try { config = await NFA.api("/api/admin/system/maintenance"); loadError = null; }
    catch (e) { if (NFA.isSessionError(e)) return; loadError = e.message; }
    render();
  }

  root.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });

  NFA.ready.then(load);
})();
