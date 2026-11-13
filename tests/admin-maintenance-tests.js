// Behavioural test for the admin maintenance page (ADMIN-4): js/admin-maintenance.js.
//
// Loads the REAL js/admin-maintenance.js into a Node vm sandbox with:
//   * a minimal DOM (same approach as admin-payment-issues-tests.js) that parses the
//     HTML the module renders — elements, ids, text, form controls, events;
//   * a fake NFA whose api() returns promises the test settles on demand and honours
//     the AbortSignal it is given (an abort rejects like fetch does), a recording
//     confirm(), toast() and showFormError();
//   * fake timers, so the 15-second timeouts fire deterministically;
//   * the real AbortController.
// No server, browser, network, database or external service is used. Nothing on disk
// is modified.
//
// Run: node tests/admin-maintenance-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "admin-maintenance.js"), "utf8");
const CONFIRM_TEXT = "Customers won’t be able to browse or buy: storefront pages show the maintenance page and customer requests are refused until you turn it off. The admin portal stays available.";

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

// ---------------------------------------------------------------- mini DOM
const VOID = new Set(["input", "br", "img", "meta", "link", "hr", "source", "wbr", "col"]);
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toLowerCase(); this.attrs = { ...attrs }; this.children = []; this.parent = null;
    this.listeners = {}; this.textContent = ""; this.value = attrs.value !== undefined ? attrs.value : "";
    this.disabled = Object.prototype.hasOwnProperty.call(attrs, "disabled");
    this.checked = Object.prototype.hasOwnProperty.call(attrs, "checked");
    this.className = attrs.class || "";
  }
  get id() { return this.attrs.id || ""; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); }
  appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  set innerHTML(html) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.textContent = ""; parseInto(this, String(html)); }
  get innerHTML() { return ""; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  matches(sel) { return sel.split(",").map(s => s.trim()).some(s => matchCompound(this, s)); }
  querySelectorAll(sel) { return [...this.walk()].filter(e => e.matches(sel)); }
  querySelector(sel) { for (const e of this.walk()) if (e.matches(sel)) return e; return null; }
  closest(sel) { let e = this; while (e) { if (e.matches && e.matches(sel)) return e; e = e.parent; } return null; }
  focus() {}
}
function matchCompound(el, sel) {
  const re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1] && el.tagName !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !String(el.className).split(/\s+/).includes(m[3])) return false;
    if (m[4] && (!el.hasAttribute(m[4]) || (m[5] !== undefined && el.attrs[m[4]] !== m[5]))) return false;
  }
  return any;
}
const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
function parseInto(root, html) {
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  const stack = [root];
  let m, last = 0;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index);
    if (text.trim()) stack[stack.length - 1].textContent += decode(text);
    last = tagRe.lastIndex;
    const [, close, tag, rest] = m;
    const lower = tag.toLowerCase();
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === lower) { const el = stack[i]; stack.length = i; if (lower === "form") bindForm(el); break; }
      continue;
    }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(rest))) if (a[1] !== "/") attrs[a[1]] = a[2] === undefined ? "" : decode(a[2]);
    const el = new El(lower, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(lower) && !/\/\s*$/.test(rest)) stack.push(el);
  }
  const tail = html.slice(last);
  if (tail.trim()) stack[stack.length - 1].textContent += decode(tail);
}
function bindForm(form) { form.elements = {}; for (const e of form.walk()) if (e.attrs.name) form.elements[e.attrs.name] = e; }
const txt = el => (el ? [el.textContent, ...el.children.map(txt)].join("") : "");

// ---------------------------------------------------------------- harness
const OFF = { maintenance: false, progress: 0, message: "", message_max: 200, updated_at: "2026-10-17T10:00:00Z", updated_by: 1, updated_by_name: "Store Admin" };
const ON = { ...OFF, maintenance: true, progress: 40, message: "Uploading new fragrances" };
function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const tick = () => new Promise(r => setImmediate(r));
async function flush(n = 12) { for (let i = 0; i < n; i++) await tick(); }
const httpError = (status, message, field) => Object.assign(new Error(message), { status, field });
const abortError = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

function harness() {
  const pageRoot = new El("div", { id: "page-root" });
  const docRoot = new El("html"); docRoot.appendChild(pageRoot);
  const state = { calls: [], confirms: [], toasts: [], formErrors: [], redirects: [], timers: [] };
  const confirmAnswers = []; // deferreds; default = resolve(true)
  const document = { getElementById: id => (id === "page-root" ? pageRoot : docRoot.querySelector(`#${id}`)) };
  const window = { location: { replace(u) { state.redirects.push(u); } } };
  const NFA = {
    esc: s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    int: n => String(Number(n) || 0), date: v => `date(${v})`,
    ready: Promise.resolve({ role: "admin" }),
    errorState: m => `<div class="err"><p class="err-text">${m}</p><button type="button" data-retry>Try again</button></div>`,
    isSessionError: e => !!e && e.message === "Session expired",
    clearFormErrors() {}, showFormError(form, field, msg) { state.formErrors.push({ field, msg }); },
    toast(m, t) { state.toasts.push({ m, t: t || "success" }); },
    confirm(opts) { state.confirms.push(opts); return confirmAnswers.length ? confirmAnswers.shift().promise : Promise.resolve(true); },
    api(p, opts = {}) {
      const call = { method: opts.method || "GET", path: p, body: opts.body, signal: opts.signal, ...deferred() };
      if (opts.signal) opts.signal.addEventListener("abort", () => call.reject(abortError()));
      state.calls.push(call);
      return call.promise;
    },
  };
  const ctx = {
    document, window, NFA, console, AbortController,
    setTimeout: (fn, ms) => { state.timers.push({ fn, ms, cleared: false }); return state.timers.length; },
    clearTimeout: id => { if (state.timers[id - 1]) state.timers[id - 1].cleared = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: "admin-maintenance.js" });
  const sessionExpired = () => { window.location.replace("login.html?redirect=maintenance.html&expired=1"); return new Error("Session expired"); };
  const get = id => document.getElementById(id);
  const form = () => get("maint-form");
  const figures = () => ({ state: txt(get("m-state-value")), badge: txt(get("m-state-badge")), pct: txt(get("m-pct-value")), changed: txt(get("m-changed-value")), by: txt(get("m-changed-meta")) });
  const status = () => ({ text: txt(get("m-status")), error: String((get("m-status") || {}).className || "").includes("is-error") });
  const posts = () => state.calls.filter(c => c.method === "POST");
  const gets = () => state.calls.filter(c => c.method === "GET");
  const last = () => state.calls[state.calls.length - 1];
  async function submit() { form().listeners.submit[0]({ preventDefault() {} }); await flush(); }
  // Returns false (instead of throwing) when there is no Try again button, so a regression
  // shows up as a failed assertion rather than a crashed suite.
  async function retry() { const b = pageRoot.querySelector("[data-retry]"); if (!b) return false; pageRoot.listeners.click[0]({ target: b }); await flush(); return true; }
  const fireOpenTimer = () => { const t = state.timers.find(x => !x.cleared); if (t) t.fn(); return t; };
  // Pending = scheduled and never cleared; cleared timers are kept so tests can tell them apart.
  const openTimers = () => state.timers.filter(t => !t.cleared).length;
  // The n-th timer exists, is the 15-second request timeout, and (optionally) has been cleared.
  const timerOk = (n, { cleared } = {}) => { const t = state.timers[n]; return !!t && t.ms === 15000 && (cleared === undefined || t.cleared === cleared); };
  return { state, confirmAnswers, sessionExpired, get, form, figures, status, posts, gets, last, submit, retry, fireOpenTimer, openTimers, timerOk, pageRoot };
}
async function boot(cfg = OFF) {
  const h = harness();
  await flush();
  h.last().resolve(JSON.parse(JSON.stringify(cfg)));
  await flush();
  return h;
}

(async () => {
  try {
    // ---- load ----
    let h = await boot(OFF);
    check("L1 successful load renders the confirmed state (OFF) and the saved values",
      h.figures().state === "OFF" && /OFF — storefront live/.test(h.figures().badge) && h.figures().pct === "0%" && h.form().elements.maintenance.checked === false
      && h.gets().length === 1 && h.gets()[0].path === "/api/admin/system/maintenance" && h.gets()[0].signal, h.figures());
    check("L1T the load GET is bounded by a 15-second timer that is cleared once the response arrives",
      h.timerOk(0, { cleared: true }) && h.openTimers() === 0, h.state.timers.map(t => ({ ms: t.ms, cleared: t.cleared })));

    h = harness(); await flush();
    h.last().reject(httpError(500, "Could not read the maintenance setting."));
    await flush();
    const loadErr = txt(h.pageRoot.querySelector(".err-text"));
    await h.retry();
    h.last().resolve({ ...OFF }); await flush();
    check("L2 failed load shows the server's message with Try again; retry loads the page", loadErr === "Could not read the maintenance setting." && h.gets().length === 2 && h.figures().state === "OFF", loadErr);

    h = harness(); await flush();
    const t0 = h.fireOpenTimer(); await flush();
    const toErr = txt(h.pageRoot.querySelector(".err-text"));
    check("L3 load timeout (15 s) aborts the request and shows a plain-language error with Try again",
      t0 && t0.ms === 15000 && h.gets()[0].signal.aborted === true && /didn't respond/.test(toErr) && !/abort|Failed to fetch/i.test(toErr) && !!h.pageRoot.querySelector("[data-retry]"), toErr);
    await h.retry(); h.last().resolve({ ...ON }); await flush();
    check("L4 after a load timeout, Try again loads normally", h.figures().state === "ON" && h.gets().length === 2);

    // ---- OFF -> ON: confirmation ----
    h = await boot(OFF);
    h.form().elements.maintenance.checked = true; h.form().elements.message.value = "Back soon";
    const no = deferred(); h.confirmAnswers.push(no);
    await h.submit();
    const shown = h.state.confirms[0] || {};
    no.resolve(false); await flush();
    check("C1 OFF→ON shows the danger confirmation with the approved wording",
      h.state.confirms.length === 1 && shown.title === "Turn on maintenance mode?" && shown.text === CONFIRM_TEXT && shown.danger === true && /maintenance/i.test(shown.okLabel || ""), shown);
    check("C2 Cancel: no POST, confirmed figures unchanged, unsaved edits kept, no success message, Save usable",
      h.posts().length === 0 && h.figures().state === "OFF" && h.form().elements.maintenance.checked === true && h.form().elements.message.value === "Back soon"
      && !h.state.toasts.some(t => t.t === "success") && h.status().text === "" && h.get("m-save").disabled === false);

    h = await boot(OFF);
    h.form().elements.maintenance.checked = true; h.form().elements.progress.value = "25"; h.form().elements.message.value = "Uploading";
    await h.submit();
    const post = h.posts()[0];
    check("S1 confirmed: one POST with the form's body and an abort signal; 'Saving…' shown; Save disabled",
      h.state.confirms.length === 1 && h.posts().length === 1 && post.path === "/api/admin/maintenance" && JSON.stringify(post.body) === JSON.stringify({ maintenance: true, progress: 25, message: "Uploading" })
      && post.signal && h.status().text === "Saving…" && h.get("m-save").disabled === true, { body: post && post.body, status: h.status() });
    check("S2 the confirmed figures stay OFF while the save is pending", h.figures().state === "OFF");
    check("S2T the POST is bounded by its own 15-second timer, still pending while the request is in flight",
      h.timerOk(1, { cleared: false }) && h.openTimers() === 1, h.state.timers.map(t => ({ ms: t.ms, cleared: t.cleared })));
    post.resolve({ success: true, maintenance: true, progress: 25, message: "Uploading" }); await flush();
    h.last().resolve({ ...ON, progress: 25, message: "Uploading", updated_by_name: "Store Admin" }); await flush();
    check("S3 after the server confirms: figures ON 25%, 'Configuration saved.', success toast, Save enabled, timers cleared",
      h.figures().state === "ON" && h.figures().pct === "25%" && h.status().text === "Configuration saved." && !h.status().error
      && h.state.toasts.some(t => t.t === "success" && /maintenance is ON at 25%/.test(t.m)) && h.get("m-save").disabled === false && h.openTimers() === 0, { f: h.figures(), s: h.status() });

    // ---- no confirmation needed ----
    h = await boot(ON);
    h.form().elements.maintenance.checked = false; await h.submit();
    check("N1 ON→OFF sends the POST without a confirmation", h.state.confirms.length === 0 && h.posts().length === 1 && h.posts()[0].body.maintenance === false);
    h = await boot(ON);
    h.form().elements.progress.value = "80"; h.form().elements.message.value = "Nearly done"; await h.submit();
    check("N2 editing progress/message while already ON sends the POST without a confirmation", h.state.confirms.length === 0 && h.posts().length === 1 && h.posts()[0].body.progress === 80 && h.posts()[0].body.maintenance === true);

    // ---- HTTP errors ----
    h = await boot(OFF);
    h.form().elements.message.value = "x"; await h.submit();
    h.posts()[0].reject(httpError(400, "message must be 200 characters or fewer.", "message")); await flush();
    check("E1 400: the named field is flagged, figures unchanged, no re-read, Save restored, timer cleared",
      h.state.formErrors.some(e => e.field === "message") && h.figures().state === "OFF" && h.posts().length === 1 && h.gets().length === 1 && h.status().error
      && h.get("m-save").disabled === false && h.timerOk(1, { cleared: true }) && h.openTimers() === 0, h.state.formErrors);
    h = await boot(OFF);
    h.form().elements.progress.value = "12"; await h.submit();
    h.posts()[0].reject(httpError(409, "This configuration was changed by someone else.")); await flush();
    check("E3 409 (another 4xx): a definite failure — no verification GET, figures/config not updated, message shown, timer cleared, Save restored",
      h.posts().length === 1 && h.gets().length === 1 && h.figures().state === "OFF" && h.figures().pct === "0%" && h.status().error
      && /changed by someone else/.test(h.status().text) && h.state.formErrors.length === 0 && h.openTimers() === 0 && h.get("m-save").disabled === false, h.status());
    h = await boot(OFF);
    h.form().elements.maintenance.checked = true; await h.submit();
    h.posts()[0].reject(httpError(500, "Could not save the maintenance configuration.")); await flush();
    const rereadAfter500 = h.gets().length === 2;
    h.last().resolve({ ...OFF }); await flush();
    check("E2 500: treated as unconfirmed (a lost COMMIT ack or gateway error can follow a write) → re-read; figures from the server; message says what's live",
      rereadAfter500 && h.figures().state === "OFF" && /may or may not/.test(h.status().text) && /currently OFF/.test(h.status().text) && h.get("m-save").disabled === false
      && h.posts().length === 1 && h.gets().length === 2 && h.openTimers() === 0, h.status());

    h = await boot(OFF);
    h.form().elements.progress.value = "30"; await h.submit();
    // What NFA.api produces for a gateway 502 with an HTML (non-JSON) body: the status plus
    // api()'s generic message (admin-core.js: data stays null, message falls back).
    h.posts()[0].reject(httpError(502, "Something went wrong. Please try again.")); await flush();
    const rereads502 = h.gets().length;
    h.last().resolve({ ...OFF, progress: 30 }); await flush();
    check("E4 502 with an unusable body: POST not retried, exactly one verification GET, figures from the server, timers cleared",
      h.posts().length === 1 && rereads502 === 2 && h.gets().length === 2 && h.figures().pct === "30%" && h.figures().state === "OFF"
      && /currently OFF/.test(h.status().text) && !/</.test(h.status().text) && h.openTimers() === 0 && h.get("m-save").disabled === false, h.status());

    // ---- no response ----
    h = await boot(OFF);
    h.form().elements.maintenance.checked = true; await h.submit();
    h.posts()[0].reject(new TypeError("Failed to fetch")); await flush();
    const checking = h.status().text;
    h.last().resolve({ ...ON }); await flush();
    check("U1 network failure: plain-language 'checking' message, one re-read, no automatic POST retry", /may or may not have been saved/.test(checking) && /Checking the current setting/.test(checking) && h.gets().length === 2 && h.posts().length === 1, checking);
    check("U2 …re-read succeeds: figures show the SERVER's state (ON here) and the status says so; no raw browser error",
      h.figures().state === "ON" && /currently ON/.test(h.status().text) && /confirmed by the server/.test(h.status().text) && !/Failed to fetch/.test(h.status().text + JSON.stringify(h.state.toasts)) && h.get("m-save").disabled === false
      && h.posts().length === 1 && h.gets().length === 2 && h.openTimers() === 0, h.status());

    h = await boot(OFF);
    h.form().elements.maintenance.checked = true; await h.submit();
    h.posts()[0].reject(new TypeError("Failed to fetch")); await flush();
    h.last().reject(new TypeError("Failed to fetch")); await flush();
    check("U3 …re-read fails: state shows Unknown (not the old OFF), reload instruction, Save blocked, timers cleared",
      h.figures().state === "Unknown" && /Not confirmed/.test(h.figures().badge) && /Reload this page/.test(h.status().text) && h.get("m-save").disabled === true && !/Failed to fetch/.test(h.status().text)
      && h.posts().length === 1 && h.gets().length === 2 && h.openTimers() === 0, { f: h.figures(), s: h.status() });
    const before = { pct: "0%", changed: `date(${OFF.updated_at})`, by: OFF.updated_by_name };
    const fu = h.figures();
    check("U3b …and NONE of the three figures shows the previous values as current: Progress Unknown, Last changed —, 'not confirmed'",
      fu.pct === "Unknown" && fu.changed === "—" && fu.by === "not confirmed" && fu.pct !== before.pct && fu.changed !== before.changed && fu.by !== before.by, fu);
    await h.submit(); await h.submit();
    check("U4 while Unknown, further submits send nothing, open no confirmation, keep Save disabled and the figures Unknown",
      h.posts().length === 1 && h.state.confirms.length === 1 && /Reload this page/.test(h.status().text) && h.get("m-save").disabled === true && h.figures().state === "Unknown" && h.figures().pct === "Unknown");
    // Within one page view nothing re-confirms the state (no automatic retry, no retry button
    // in this state); a reload is a fresh successful load, which restores normal saving.
    const reloaded = await boot(ON);
    reloaded.form().elements.progress.value = "45"; await reloaded.submit();
    check("U5 after a reload (successful load) the figures are confirmed again and saving works",
      reloaded.figures().state === "ON" && reloaded.figures().pct !== "Unknown" && reloaded.posts().length === 1 && reloaded.get("m-save").disabled === true && reloaded.status().text === "Saving…");

    // ---- timeout ----
    h = await boot(OFF);
    h.form().elements.progress.value = "10"; await h.submit();
    const tp = h.fireOpenTimer(); await flush();
    const abortedPost = h.posts()[0];
    h.last().resolve({ ...OFF, progress: 10 }); await flush();
    check("T1 save timeout: the 15 s timer aborts the POST, then the setting is re-read and confirmed; timers cleared",
      tp && tp.ms === 15000 && abortedPost.signal.aborted === true && h.gets().length === 2 && /currently OFF/.test(h.status().text) && h.openTimers() === 0 && h.get("m-save").disabled === false, h.status());

    // ---- duplicates ----
    h = await boot(OFF);
    h.form().elements.progress.value = "5";
    await h.submit(); await h.submit(); await h.submit();
    check("D1 repeated submits while a save is in flight → exactly one POST", h.posts().length === 1);
    h.posts()[0].resolve({ success: true, maintenance: false, progress: 5, message: "" }); await flush();
    h.last().resolve({ ...OFF, progress: 5 }); await flush();
    check("D2 …and Save is usable again afterwards", h.get("m-save").disabled === false && h.status().text === "Configuration saved.");
    h = await boot(OFF);
    h.form().elements.maintenance.checked = true;
    const held = deferred(); h.confirmAnswers.push(held);
    await h.submit(); await h.submit();
    held.resolve(true); await flush();
    check("D3 a second submit while the confirmation is open opens no second dialog and sends one POST", h.state.confirms.length === 1 && h.posts().length === 1);

    // ---- session expiry ----
    h = await boot(OFF);
    h.form().elements.progress.value = "7"; await h.submit();
    h.posts()[0].reject(h.sessionExpired()); await flush();
    check("X1 session expiry on the POST: the existing redirect stands; no error message or toast; no verification; Save restored; timer cleared",
      h.state.redirects.length === 1 && /login\.html/.test(h.state.redirects[0]) && h.status().text === "Saving…" && !h.state.toasts.length && h.get("m-save").disabled === false
      && h.posts().length === 1 && h.gets().length === 1 && h.openTimers() === 0, { s: h.status(), toasts: h.state.toasts });

    h = harness(); await flush();
    h.last().reject(h.sessionExpired()); await flush();
    check("X2 session expiry on the initial load: redirect only — no maintenance error state, no toast, timer cleared",
      h.state.redirects.length === 1 && /login\.html/.test(h.state.redirects[0]) && !h.pageRoot.querySelector(".err-text") && !h.get("maint-form")
      && !h.state.toasts.length && h.gets().length === 1 && h.openTimers() === 0, { redirects: h.state.redirects });

    h = await boot(OFF);
    h.form().elements.progress.value = "9"; await h.submit();
    h.posts()[0].reject(new TypeError("Failed to fetch")); await flush();
    h.last().reject(h.sessionExpired()); await flush();
    check("X3 session expiry during the verification GET: redirect; no Unknown state, no 'Couldn't confirm' error, no toast; one POST, one re-read; timers cleared",
      h.state.redirects.length === 1 && h.figures().state === "OFF" && !/Couldn't confirm/.test(h.status().text) && !h.state.toasts.length
      && h.posts().length === 1 && h.gets().length === 2 && h.openTimers() === 0 && h.get("m-save").disabled === false, { s: h.status(), toasts: h.state.toasts });
  } catch (err) {
    failed++;
    console.log("FAIL suite crashed:", err && (err.stack || err.message) || err);
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
