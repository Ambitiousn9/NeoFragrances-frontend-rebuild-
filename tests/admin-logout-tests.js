// Behavioural test for admin logout (ADMIN-3): js/admin-core.js logout().
//
// Loads the REAL js/auth.js and js/admin-core.js into a Node vm sandbox with:
//   * an in-memory localStorage (the real auth.js getAuth/clearAuth run against it);
//   * a fake fetch whose outcome each scenario chooses (200, 401, 500, network error,
//     or hanging until its AbortSignal fires);
//   * fake timers, so the bounded timeout can be fired deterministically;
//   * fake window.location (href / replace) and a minimal DOM for the REAL
//     confirmDialog (the elements it creates, queries, focuses and clicks).
// admin-core.js does not export logout(), so — as in admin-payment-issues-tests.js
// scenario G — an IN-MEMORY copy of the source adds `__logout: logout` to the returned
// object. The production file is not modified. No server, browser, network, database
// or external service is used, and nothing on disk is modified.
//
// Run: node tests/admin-logout-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const AUTH_SRC = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8");
const CORE_SRC = fs.readFileSync(path.join(ROOT, "js", "admin-core.js"), "utf8");
const API = "https://api.test.invalid";
const TOKEN = "test-admin-token.not-a-real-jwt.abc123";
const AUTH_KEY = "neofragrances_auth";

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${typeof detail === "string" ? detail : JSON.stringify(detail)}]`}`); }
}

const HOOK_FROM = "  return {\n    ready, api,";
const HOOK_TO = "  return {\n    __logout: logout, ready, api,";
const occurrences = CORE_SRC.split(HOOK_FROM).length - 1;
check("T0 the in-memory instrumentation point exists exactly once in admin-core.js", occurrences === 1, occurrences);
const INSTRUMENTED = CORE_SRC.replace(HOOK_FROM, HOOK_TO);

function sandbox({ fetchMode = "ok", stored = { token: TOKEN, user: { id: 1, role: "admin", full_name: "Admin" } } } = {}) {
  const store = new Map();
  const logs = [];
  const timers = [];
  const calls = [];
  const appended = [];
  // href records, at the moment of each navigation, whether the login was still stored,
  // so the test can tell "cleared, then redirected" from "redirected, then cleared".
  const loc = {
    _href: "dashboard.html", navs: [], pathname: "/admin/dashboard.html", search: "", hash: "", replaced: [],
    get href() { return this._href; },
    set href(v) { this.navs.push({ to: v, storedAtNav: store.has(AUTH_KEY) }); this._href = v; },
    replace(u) { this.replaced.push(u); },
  };
  const makeEl = (extra = {}) => ({ textContent: "", dataset: {}, focus() {}, closest(sel) { return sel === "[data-dlg]" && this.dataset.dlg ? this : null; }, ...extra });
  const document = {
    readyState: "complete", activeElement: null, body: { dataset: {}, appendChild(el) { appended.push(el); } },
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
    createElement() {
      const kids = {};
      return {
        className: "", listeners: {}, removed: false,
        set innerHTML(v) {
          this._html = v;
          kids["#adm-dlg-title"] = makeEl(); kids["#adm-dlg-text"] = makeEl(); kids[".adm-dialog"] = makeEl();
          kids['[data-dlg="ok"]'] = makeEl({ dataset: { dlg: "ok" } }); kids['[data-dlg="cancel"]'] = makeEl({ dataset: { dlg: "cancel" } });
        },
        get innerHTML() { return this._html; },
        querySelector(sel) { return kids[sel] || null; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { this.removed = true; },
      };
    },
  };
  const fakeFetch = (url, init = {}) => {
    calls.push({ url, init });
    if (fetchMode === "ok") return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    if (fetchMode === "401") return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "x" }) });
    if (fetchMode === "500") return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "x" }) });
    if (fetchMode === "network") return Promise.reject(new TypeError("Failed to fetch"));
    if (fetchMode === "hang") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    throw new Error("unknown mode");
  };
  const ctx = {
    window: null, document, console: { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), info: (...a) => logs.push(a.join(" ")) },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    fetch: fakeFetch, AbortController, setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    API_BASE: API, escapeHtml: s => String(s), URLSearchParams, Promise, JSON, Object, Array, String, Number, Error, TypeError, Map,
  };
  ctx.window = { location: loc };
  vm.createContext(ctx);
  vm.runInContext(`${AUTH_SRC}\n${INSTRUMENTED}\n;globalThis.NFA = NFA;`, ctx, { filename: "auth+admin-core.js" });
  if (stored) store.set(AUTH_KEY, JSON.stringify(stored)); // signed in AFTER load, so boot skipped the shell
  const dialog = () => appended[appended.length - 1];
  const click = which => dialog().listeners.click({ target: dialog().querySelector(`[data-dlg="${which}"]`) });
  const flush = () => new Promise(r => setImmediate(r));
  return { ctx, store, logs, timers, calls, loc, dialog, click, flush };
}

async function runLogout(mode, { answer = "ok", fireTimeout = false } = {}) {
  const s = sandbox({ fetchMode: mode });
  const done = s.ctx.NFA.__logout();
  await s.flush();
  const d = s.dialog();
  const dialogInfo = d ? { title: d.querySelector("#adm-dlg-title").textContent, ok: d.querySelector('[data-dlg="ok"]').textContent } : null;
  s.click(answer);
  await s.flush();
  if (fireTimeout) { const t = s.timers.find(x => !x.cleared); if (t) t.fn(); }
  await done;
  return { ...s, dialogInfo };
}
const signedOut = s => !s.store.has(AUTH_KEY) && s.loc.href === "login.html";

(async () => {
  try {
    // 1. confirmation preserved
    const cancel = await runLogout("ok", { answer: "cancel" });
    check("F1 the existing confirmation is shown (\"Log out?\" / \"Log out\") and Cancel changes nothing",
      cancel.dialogInfo && cancel.dialogInfo.title === "Log out?" && cancel.dialogInfo.ok === "Log out" && cancel.calls.length === 0 && cancel.store.has(AUTH_KEY) && cancel.loc.href === "dashboard.html", cancel.dialogInfo);

    // 2–4. success
    const ok = await runLogout("ok");
    const call = ok.calls[0] || { init: {} };
    check("F2 confirming calls POST /api/admin/logout once", ok.calls.length === 1 && call.url === `${API}/api/admin/logout` && call.init.method === "POST", { url: call.url, method: call.init.method });
    check("F3 the token travels only in the Authorization header (not the URL, not a body)",
      call.init.headers && call.init.headers.Authorization === `Bearer ${TOKEN}` && !String(call.url).includes(TOKEN) && call.init.body === undefined);
    check("F4 the request is bounded: an AbortSignal plus a 5-second timer, cleared afterwards",
      call.init.signal && typeof call.init.signal.aborted === "boolean" && ok.timers.length === 1 && ok.timers[0].ms === 5000 && ok.timers[0].cleared === true, ok.timers.map(t => ({ ms: t.ms, cleared: t.cleared })));
    check("F5 success → stored login cleared and redirected to login.html", signedOut(ok), { href: ok.loc.href, stored: ok.store.has(AUTH_KEY) });

    // 5–8. failures still sign out locally
    const outcomes = [ok];
    for (const [mode, label, opts] of [["401", "401 response", {}], ["500", "500 response", {}], ["network", "network error", {}], ["hang", "timeout (request aborted by the timer)", { fireTimeout: true }]]) {
      const r = await runLogout(mode, opts);
      outcomes.push(r);
      check(`F6 ${label} → still cleared and redirected`, r.calls.length === 1 && signedOut(r), { href: r.loc.href, stored: r.store.has(AUTH_KEY) });
    }
    check("F10 for every outcome the redirect happens once, only after the stored login is cleared",
      outcomes.every(r => r.loc.navs.length === 1 && r.loc.navs[0].to === "login.html" && r.loc.navs[0].storedAtNav === false),
      outcomes.map(r => r.loc.navs));

    // no stored admin login: still signs out, no request
    const s = sandbox({ fetchMode: "ok", stored: { token: TOKEN, user: { id: 2, role: "customer" } } });
    const done = s.ctx.NFA.__logout(); await s.flush(); s.click("ok"); await done;
    check("F7 without a stored ADMIN login: no request is sent, local sign-out still completes", s.calls.length === 0 && signedOut(s));

    // 9. no token printed or placed in the redirect
    const all = [cancel, ok, s];
    check("F8 no token in any console output or redirect URL", all.every(x => !x.logs.some(l => l.includes(TOKEN)) && !String(x.loc.href).includes(TOKEN) && !x.loc.replaced.some(u => u.includes(TOKEN))));

    // 10. storefront logout untouched
    let headAuth = null;
    try { headAuth = execFileSync("git", ["show", "HEAD:js/auth.js"], { cwd: ROOT, encoding: "utf8" }); } catch (e) { headAuth = null; }
    const norm = t => String(t).replace(/\r\n?/g, "\n");
    check("F9 storefront js/auth.js (logoutUser, clearAuth, storage key) is identical to the committed version",
      headAuth !== null && norm(headAuth) === norm(AUTH_SRC) && /function logoutUser\(\)/.test(AUTH_SRC) && !AUTH_SRC.includes("/api/admin/logout"));
  } catch (err) {
    failed++;
    console.log("FAIL suite crashed:", err && (err.stack || err.message) || err);
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
