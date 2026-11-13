// Behavioural test for PAY-B-001 (admin payment-issues action lifecycle).
//
// Loads the REAL js/admin-payment-issues.js into a Node vm sandbox with:
//   * a minimal DOM stub (parses the HTML the module generates into element objects
//     with attributes, children, querySelector/All, closest, events, classList);
//   * a fake NFA (the admin-core.js API surface this module uses) whose api() returns
//     deferred promises the test resolves or rejects on demand;
//   * a fake NFA.openDrawer/closeDrawer mirroring admin-core.js: a drawer is appended
//     to the document and removed on close, with a header close button that carries
//     data-drawer-close.
// No server, browser, network, database or external service is used. Nothing on disk
// is modified. Scenario G alone runs an IN-MEMORY instrumented copy of the source that
// exposes the internal helpers (beginAction/endAction/activeAction) — a helper-level
// invariant, explicitly not a reachable production flow.
//
// Run: node tests/admin-payment-issues-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE_PATH = path.join(__dirname, "..", "js", "admin-payment-issues.js");
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf8");

let passed = 0, failed = 0;
const observations = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}
function observe(text) { observations.push(text); console.log(`OBSERVATION ${text}`); }

// ---------------------------------------------------------------- mini DOM
const VOID = new Set(["input", "br", "img", "meta", "link", "hr", "source", "wbr", "col"]);
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toLowerCase(); this.attrs = { ...attrs }; this.children = []; this.parent = null;
    this.listeners = {}; this.textContent = ""; this.value = this.tagName === "select" ? "" : (attrs.value || "");
    this.disabled = Object.prototype.hasOwnProperty.call(attrs, "disabled");
    const self = this;
    this.classList = {
      _set() { return new Set(String(self.attrs.class || "").split(/\s+/).filter(Boolean)); },
      contains(c) { return this._set().has(c); },
      add(c) { const s = this._set(); s.add(c); self.attrs.class = [...s].join(" "); },
      remove(c) { const s = this._set(); s.delete(c); self.attrs.class = [...s].join(" "); },
      toggle(c, force) { const on = force === undefined ? !this.contains(c) : !!force; on ? this.add(c) : this.remove(c); return on; },
    };
  }
  get id() { return this.attrs.id || ""; }
  get dataset() { const d = {}; for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith("data-")) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; return d; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); }
  appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  set innerHTML(html) { this.children.forEach(c => { c.parent = null; }); this.children = []; parseInto(this, String(html)); }
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
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4] && (!el.hasAttribute(m[4]) || (m[5] !== undefined && el.attrs[m[4]] !== m[5]))) return false;
  }
  return any;
}
function parseInto(root, html) {
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  const stack = [root];
  let m;
  while ((m = tagRe.exec(html))) {
    const [, close, tag, rest] = m;
    const lower = tag.toLowerCase();
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === lower) { const el = stack[i]; stack.length = i; if (lower === "form") bindForm(el); break; }
      continue;
    }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(rest))) if (a[1] !== "/") attrs[a[1]] = a[2] === undefined ? "" : a[2];
    const el = new El(lower, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(lower) && !/\/\s*$/.test(rest)) stack.push(el);
  }
}
// Named controls on a form (form.resolution, form.note), as browsers provide.
function bindForm(form) { for (const e of form.walk()) if (e.attrs.name && !(e.attrs.name in form)) form[e.attrs.name] = e; }

// ---------------------------------------------------------------- harness
const ISSUE = {
  id: 41, payment_reference: "NF-1760000000000-990402-abcd1234", evidence: "paystack_verified", category: "settlement_error",
  last_error_code: "ER_LOCK_DEADLOCK", first_source: "callback", last_source: "callback", status: "open", resolution: null,
  user_id: null, customer_name: null, order_id: null, linked_order_id: null, has_order: false, manual_resolution_conflict: false,
  amount_pesewas: 12800, currency: "GHS", expected_total_pesewas: 12800, detail_product_id: null, attempt_count: 1,
  first_seen_at: "2026-10-17T10:00:00Z", last_seen_at: "2026-10-17T10:00:00Z", resolved_by: null, resolved_at: null,
  retry_allowed: true, resolution_note: null, resolved_by_name: null, detail_product_name: null, linked_order: null,
};

function deferred() { let resolve, reject; const p = new Promise((r, j) => { resolve = r; reject = j; }); return { promise: p, resolve, reject }; }
const tick = () => new Promise(r => setImmediate(r));
async function flush(n = 12) { for (let i = 0; i < n; i++) await tick(); }

function createHarness({ instrument = false } = {}) {
  const docRoot = new El("html");
  const pageRoot = new El("div", { id: "page-root" });
  docRoot.appendChild(pageRoot);
  const state = { calls: [], toasts: [], redirects: [], confirms: [], loadCounts: 0, activeDrawer: null };
  const pendingActions = []; // deferreds for retry/resolve POSTs, in order

  const document = {
    title: "",
    getElementById(id) { return id === "page-root" ? pageRoot : docRoot.querySelector(`#${id}`); },
    contains(el) { let e = el; while (e) { if (e === docRoot) return true; e = e.parent; } return false; },
    querySelector(sel) { return docRoot.querySelector(sel); },
  };
  const window = { location: { pathname: "/admin/payment-issues.html", search: "", hash: "", replace(u) { state.redirects.push(u); } }, scrollTo() {} };

  const confirmQueue = []; // optional held confirms; default = auto-true
  const NFA = {
    esc: s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    int: n => String(Number(n) || 0), money: n => `GH₵${Number(n).toFixed(2)}`, dateTime: v => String(v || "—"),
    readParams: d => ({ ...d }), writeParams() {}, skeletonRows: () => "", tableState: (c, h) => h, stateHTML: () => "<p></p>",
    errorState: m => `<p class="err">${m}</p>`, pagerHTML: () => "", debounce: fn => fn, ready: Promise.resolve({ role: "admin" }),
    loadCounts() { state.loadCounts++; }, toast(m, t) { state.toasts.push({ m, t }); },
    isSessionError: e => !!e && e.message === "Session expired",
    clearFormErrors() {}, showFormError(form, field, msg) { state.formErrors = (state.formErrors || []).concat([{ field, msg }]); },
    confirm(opts) { state.confirms.push(opts.title); return confirmQueue.length ? confirmQueue.shift().promise : Promise.resolve(true); },
    openDrawer({ title, bodyHTML, footHTML }) {
      NFA.closeDrawer();
      const drawer = new El("section", { class: "adm-drawer" });
      const head = new El("div", { class: "adm-drawer-head" });
      head.innerHTML = `<h2 id="adm-drawer-title"></h2><button type="button" class="adm-btn" data-drawer-close aria-label="Close"></button>`;
      const body = new El("div", { class: "adm-drawer-body" }); body.innerHTML = bodyHTML;
      drawer.append(head, body);
      if (footHTML) { const foot = new El("div", { class: "adm-drawer-foot" }); foot.innerHTML = footHTML; drawer.appendChild(foot); }
      docRoot.appendChild(drawer);
      state.activeDrawer = drawer;
      return drawer;
    },
    closeDrawer() { if (state.activeDrawer) { state.activeDrawer.remove(); state.activeDrawer = null; } },
    api(p, opts = {}) {
      const method = opts.method || "GET";
      state.calls.push({ method, path: p });
      if (method === "GET" && p.startsWith("/api/admin/payment-issues?")) return Promise.resolve({ issues: [], total: 0, page: 1, pageSize: 25, status_counts: { open: 1, resolved: 0 } });
      if (method === "GET" && /^\/api\/admin\/payment-issues\/\d+$/.test(p)) return Promise.resolve(JSON.parse(JSON.stringify(ISSUE)));
      if (method === "POST") { const d = deferred(); pendingActions.push({ path: p, ...d }); return d.promise; }
      return Promise.reject(new Error(`unexpected api call ${method} ${p}`));
    },
  };
  // apiFetch's session contract (admin-core.js 80-81): redirect to login, then throw.
  const sessionExpired = () => { window.location.replace("login.html?redirect=payment-issues.html&expired=1"); return new Error("Session expired"); };

  const ctx = { document, window, NFA, console, setTimeout, clearTimeout, encodeURIComponent, URLSearchParams, history: { replaceState() {} } };
  vm.createContext(ctx);
  let code = SOURCE;
  if (instrument) {
    const anchor = "NFA.ready.then(() => { renderFrame(); load(); });";
    if (!code.includes(anchor)) throw new Error("instrumentation anchor not found");
    code = code.replace(anchor, `globalThis.__pi = { beginAction, endAction, setControlsBusy, get activeAction() { return activeAction; } };\n  ${anchor}`);
  }
  vm.runInContext(code, ctx, { filename: "admin-payment-issues.js" });

  const posts = () => state.calls.filter(c => c.method === "POST");
  async function openIssue() {
    const click = pageRoot.listeners.click[0];
    const target = new El("button", { "data-view": String(ISSUE.id) });
    click({ target });
    await flush();
    return state.activeDrawer;
  }
  const retryBtn = drawer => drawer.querySelector("[data-issue-retry]");
  const statusText = drawer => (drawer.querySelector(".adm-form-status") || {}).textContent || "";
  // Returns { run } (the handler promise) AFTER flushing, without adopting it: the request may stay pending.
  async function clickRetry(drawer) { const b = retryBtn(drawer); const run = b.listeners.click[0](); await flush(); return { run }; }
  async function submitResolve(drawer, resolution = "no_action_needed", note = "Checked in Paystack") {
    const form = drawer.querySelector("#pi-resolve");
    form.resolution.value = resolution; form.note.value = note;
    const run = form.listeners.submit[0]({ preventDefault() {} });
    await flush();
    return { run };
  }
  const controls = drawer => drawer.querySelectorAll("button, select, textarea").filter(e => !e.hasAttribute("data-drawer-close"));
  const headerClose = drawer => drawer.querySelector("[data-drawer-close]");
  return { ctx, state, docRoot, pageRoot, document, NFA, pendingActions, confirmQueue, sessionExpired, posts, openIssue, retryBtn, statusText, clickRetry, submitResolve, controls, headerClose };
}

const STILL_FINISHING = /still finishing/i;

// ---------------------------------------------------------------- scenarios
async function scenarioA() {
  const h = createHarness(); await flush();
  check("A-1 setup: the page booted (NFA.ready.then → renderFrame + initial list request)",
    !!h.document.getElementById("pi-tabs") && h.state.calls.some(c => c.method === "GET" && c.path.startsWith("/api/admin/payment-issues?")),
    { calls: h.state.calls, rootChildren: h.pageRoot.children.length });
  const d = await h.openIssue();
  check("A0 setup: detail drawer rendered with Retry and Resolve controls", !!d && !!h.retryBtn(d) && !!d.querySelector("#pi-resolve"));
  const { run } = await h.clickRetry(d);
  check("A1 retry in flight: one POST to /retry, controls disabled, body aria-busy=true",
    h.posts().length === 1 && /\/retry$/.test(h.posts()[0].path) && h.controls(d).every(c => c.disabled) && d.querySelector(".adm-drawer-body").getAttribute("aria-busy") === "true",
    { calls: h.state.calls, confirms: h.state.confirms, status: h.statusText(d), retryListeners: (h.retryBtn(d).listeners.click || []).length });
  check("A2 in flight: the header close button stays enabled (drawer can be closed)", h.headerClose(d).disabled === false);
  h.pendingActions[0].resolve({ settled: true, message: "Order created", outcome: "created" });
  await run; await flush();
  check("A3 completion: toast shown, controls enabled again, aria-busy=false",
    h.state.toasts.some(t => t.m === "Order created") && h.controls(d).every(c => !c.disabled) && d.querySelector(".adm-drawer-body").getAttribute("aria-busy") === "false",
    { toasts: h.state.toasts, disabled: h.controls(d).filter(c => c.disabled).map(c => c.tagName) });
  const before = h.posts().length;
  await h.clickRetry(d);
  check("A4 the action state was released: a new retry starts a new request", h.posts().length === before + 1 && !STILL_FINISHING.test(h.statusText(d)));
  h.pendingActions[1].resolve({ settled: false, message: "still pending", outcome: "pending" }); await flush();
}

async function scenarioB() {
  const h = createHarness(); await flush();
  const dA = await h.openIssue();
  const { run } = await h.clickRetry(dA);
  check("B1 retry in flight on drawer A", h.posts().length === 1 && h.controls(dA).every(c => c.disabled));
  h.NFA.closeDrawer();
  check("B2 drawer A is detached while its request is pending", !h.document.contains(dA));
  const dB = await h.openIssue();
  const beforeBlocked = h.posts().length;
  await h.clickRetry(dB);
  check("B3 while A's request is still pending, an action in a NEW drawer is refused with a message (no request)", h.posts().length === beforeBlocked && STILL_FINISHING.test(h.statusText(dB)), h.statusText(dB));
  const snapshot = h.controls(dA).map(c => c.disabled);
  const ariaBefore = dA.querySelector(".adm-drawer-body").getAttribute("aria-busy");
  h.pendingActions[0].resolve({ settled: true, message: "Order created", outcome: "created" });
  await run; await flush();
  check("B4 A's completion ran (toast, list reload, counts refresh) although A was closed",
    h.state.toasts.some(t => t.m === "Order created") && h.state.loadCounts >= 1 && h.state.calls.filter(c => c.method === "GET" && c.path.startsWith("/api/admin/payment-issues?")).length >= 2);
  check("B5 detached drawer A's controls were NOT re-enabled or otherwise toggled (still as they were)",
    JSON.stringify(h.controls(dA).map(c => c.disabled)) === JSON.stringify(snapshot) && snapshot.every(Boolean) && dA.querySelector(".adm-drawer-body").getAttribute("aria-busy") === ariaBefore);
  check("B6 drawer A was not re-rendered after detaching (its old Retry button is still the same element)", h.document.contains(dA) === false && !!h.retryBtn(dA));
  const before = h.posts().length;
  await h.clickRetry(dB);
  check("B7 after A's request finished, the newly opened drawer B can start an action", h.posts().length === before + 1, { before, after: h.posts().length });
  h.pendingActions[1].resolve({ settled: false, message: "x", outcome: "temporary" }); await flush();
}

async function scenarioC() {
  const h = createHarness(); await flush();
  const dA = await h.openIssue();
  const { run } = await h.submitResolve(dA);
  check("C1 resolve in flight on drawer A: one POST to /resolve with the chosen resolution, controls disabled",
    h.posts().length === 1 && /\/resolve$/.test(h.posts()[0].path) && h.controls(dA).every(c => c.disabled));
  h.NFA.closeDrawer();
  const snapshot = h.controls(dA).map(c => c.disabled);
  h.pendingActions[0].resolve({ success: true });
  await run; await flush();
  check("C2 resolve completed after A was closed: toast shown, A's controls untouched", h.state.toasts.some(t => t.m === "Payment issue resolved") && JSON.stringify(h.controls(dA).map(c => c.disabled)) === JSON.stringify(snapshot));
  const dB = await h.openIssue();
  const before = h.posts().length;
  await h.submitResolve(dB);
  check("C3 cleanup ran despite the removed drawer: a new drawer can resolve again", h.posts().length === before + 1 && !STILL_FINISHING.test(h.statusText(dB)));
  h.pendingActions[1].resolve({ success: true }); await flush();
}

async function scenarioD() {
  const h = createHarness(); await flush();
  const d = await h.openIssue();
  // 1) same drawer: retry in flight, then attempt resolve.
  const { run: run1 } = await h.clickRetry(d);
  const form = d.querySelector("#pi-resolve");
  form.resolution.value = "no_action_needed"; form.note.value = "x";
  form.listeners.submit[0]({ preventDefault() {} }); await flush();
  check("D1 a second action while the first is in flight is refused: no second request, message shown", h.posts().length === 1 && STILL_FINISHING.test(h.statusText(d)), h.statusText(d));
  h.pendingActions[0].resolve({ settled: false, message: "pending", outcome: "pending" }); await run1; await flush();

  // 2) confirmation-dialog timing: retry passes the first check, its confirm is HELD;
  //    a resolve then starts and is in flight; when the held confirm returns true the
  //    retry must re-check and refuse.
  const d2 = await h.openIssue();
  const held = deferred(); h.confirmQueue.push(held);
  const retryRun = h.retryBtn(d2).listeners.click[0](); await flush();
  check("D2 setup: retry is waiting on its confirmation dialog, no request yet", h.posts().length === 1 && h.state.confirms.slice(-1)[0] === "Retry settlement?");
  const { run: resolveRun } = await h.submitResolve(d2);
  check("D3 a resolve started meanwhile (one new request in flight)", h.posts().length === 2 && /\/resolve$/.test(h.posts()[1].path));
  held.resolve(true); await retryRun; await flush();
  check("D4 the retry's post-confirmation re-check refuses it: no retry request was sent", h.posts().length === 2 && STILL_FINISHING.test(h.statusText(d2)), { posts: h.posts().map(p => p.path) });
  h.pendingActions[1].resolve({ success: true }); await resolveRun; await flush();
  const d3 = await h.openIssue();
  const before = h.posts().length;
  await h.clickRetry(d3);
  check("D5 after the in-flight action finished, a new action starts normally", h.posts().length === before + 1);
  h.pendingActions[2].resolve({ settled: true, message: "ok", outcome: "created" }); await flush();
}

async function scenarioE() {
  const h = createHarness(); await flush();
  const d = await h.openIssue();
  const { run } = await h.clickRetry(d);
  const err = Object.assign(new Error("Could not load the payment issue."), { status: 500 });
  h.pendingActions[0].reject(err);
  await run; await flush();
  check("E1 request failure: error shown in the drawer status, controls re-enabled", /Could not load the payment issue/.test(h.statusText(d)) && h.controls(d).every(c => !c.disabled), h.statusText(d));
  const before = h.posts().length;
  await h.clickRetry(d);
  check("E2 the failure did not leave the action stuck: another action starts", h.posts().length === before + 1);
  h.pendingActions[1].reject(Object.assign(new Error("Conflict"), { status: 409, code: "ALREADY_RESOLVED" })); await flush();
  const before2 = h.posts().length;
  await h.submitResolve(h.state.activeDrawer);
  check("E3 a resolve rejected with 409 (re-render path) also releases the action", (() => { h.pendingActions[2].reject(Object.assign(new Error("Already resolved"), { status: 409, code: "ALREADY_RESOLVED" })); return true; })() && h.posts().length === before2 + 1);
  await flush();
  const d4 = h.state.activeDrawer;
  const before3 = h.posts().length;
  await h.clickRetry(d4);
  check("E4 …after which a new action starts", h.posts().length === before3 + 1);
  h.pendingActions[3].resolve({ settled: true, message: "ok" }); await flush();
}

async function scenarioF() {
  const h = createHarness(); await flush();
  const d = await h.openIssue();
  const { run } = await h.clickRetry(d);
  h.pendingActions[0].reject(h.sessionExpired());
  await run; await flush();
  check("F1 session expiry (redirect-and-throw contract): redirect requested, no error text written", h.state.redirects.length === 1 && !/Session expired/.test(h.statusText(d)), h.state.redirects);
  const before = h.posts().length;
  await h.clickRetry(d);
  check("F2 the catch's early return still ran finally: the action was released", h.posts().length === before + 1);
  h.pendingActions[1].resolve({ settled: true, message: "ok" }); await flush();
  const d2 = await h.openIssue();
  const { run: run2 } = await h.submitResolve(d2);
  h.pendingActions[2].reject(h.sessionExpired());
  await run2; await flush();
  const before2 = h.posts().length;
  await h.submitResolve(h.state.activeDrawer);
  check("F3 same for resolve: released after a session-expiry early return", h.posts().length === before2 + 1);
  h.pendingActions[3].resolve({ success: true }); await flush();
}

async function scenarioG() {
  // HELPER-LEVEL INVARIANT on an in-memory instrumented copy (production flows cannot
  // start a second action while one is active, so this state is not reachable through
  // the public handlers).
  const h = createHarness({ instrument: true }); await flush();
  const d = await h.openIssue();
  const pi = h.ctx.__pi;
  const t1 = pi.beginAction(d);
  const t2 = pi.beginAction(d); // bypasses actionInFlight on purpose
  pi.endAction(d, t1);
  check("G1 [helper-level] an older action's cleanup does not clear a newer active token", pi.activeAction === t2 && pi.activeAction !== null);
  const reEnabled = h.controls(d).every(c => !c.disabled);
  pi.endAction(d, t2);
  check("G2 [helper-level] the owner's cleanup clears its token", pi.activeAction === null);
  if (reEnabled) observe("endAction(drawer, olderToken) re-enabled the attached drawer's controls although a newer token was still active (review residual R1). Not reachable through the public handlers; production code unchanged.");
  else observe("endAction(drawer, olderToken) left the controls disabled while a newer token was active.");
}

(async () => {
  try {
    for (const s of [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF, scenarioG]) await s();
  } catch (err) {
    failed++;
    console.log("FAIL harness crashed:", err && err.stack || err);
  }
  console.log(`\n${passed}/${passed + failed} passed${observations.length ? `, ${observations.length} observation(s)` : ""}`);
  process.exit(failed ? 1 : 0);
})();
