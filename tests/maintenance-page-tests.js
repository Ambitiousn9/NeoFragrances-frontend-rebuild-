// Behavioural test for the public maintenance page (maintenance.html, Phase 2 R4).
//
// Runs the REAL inline <script> from maintenance.html in a Node vm sandbox with:
//   * the four elements the script paints (status, done, track, bar) as small fakes;
//   * a fake fetch whose answers the test chooses per call (or rejects);
//   * fake setInterval, so a 30-second poll is triggered on demand;
//   * fake sessionStorage (optionally throwing) and a fake location that records replace();
//   * the real URL class, so path checks behave exactly as in a browser.
// Also checks statically that js/main.js records the return path before redirecting.
// No server, browser, network, database or external service is used. Nothing on disk
// is modified.
//
// Run: node tests/maintenance-page-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PAGE = fs.readFileSync(path.join(ROOT, "maintenance.html"), "utf8");
const MAIN = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
const scripts = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const SOURCE = scripts[0];
const RETURN_KEY = "nf_maintenance_return";
const DEFAULT_STATUS = "Status: NeoFragrances is currently undergoing maintenance.";

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

// One page load. `answers` is consumed one per fetch: {status, body} or "reject".
function load({ answers = [], stored, storageThrows = false, hostname = "127.0.0.1", hidden = false } = {}) {
  const el = () => ({ textContent: "", style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const els = { ".maint-progress": el(), ".maint-progress-bar": el(), ".maint-status": el(), ".maint-done": el() };
  els[".maint-status"].textContent = DEFAULT_STATUS;
  const store = new Map(stored === undefined ? [] : [[RETURN_KEY, stored]]);
  const h = { fetches: [], replaced: [], intervals: [], els, store, queue: answers.slice() };
  const origin = `http://${hostname}:5500`;
  const sessionStorage = {
    getItem(k) { if (storageThrows) throw new Error("SecurityError"); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (storageThrows) throw new Error("SecurityError"); store.set(k, String(v)); },
    removeItem(k) { if (storageThrows) throw new Error("SecurityError"); store.delete(k); },
  };
  const document = { visibilityState: hidden ? "hidden" : "visible", querySelector: s => els[s] || null };
  const fetch = url => {
    h.fetches.push(url);
    const a = h.queue.length ? h.queue.shift() : { status: 200, body: { maintenance: true, progress: 0, message: "" } };
    if (a === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body });
  };
  const location = { hostname, protocol: "http:", origin, replace(u) { h.replaced.push(u); } };
  const ctx = {
    window: { location }, document, sessionStorage, fetch, URL, console,
    setInterval: (fn, ms) => { h.intervals.push({ fn, ms }); return h.intervals.length; },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  h.tick = async () => { for (const t of h.intervals) t.fn(); await flush(); };
  h.setHidden = v => { document.visibilityState = v ? "hidden" : "visible"; };
  h.view = () => ({ status: els[".maint-status"].textContent, done: els[".maint-done"].textContent, width: els[".maint-progress-bar"].style.width, aria: els[".maint-progress"].attrs["aria-valuenow"] });
  return h;
}
const on = (progress, message) => ({ status: 200, body: { maintenance: true, progress, message } });
const off = (progress = 0, message = "") => ({ status: 200, body: { maintenance: false, progress, message } });

(async () => {
  check("S0 maintenance.html has exactly one inline script", scripts.length === 1, scripts.length);

  // ---------- painting and polling ----------
  let h = load({ answers: [on(45, "Uploading new fragrances")] });
  await flush();
  check("P1 on load: reads /api/system/status from the local API and paints message, words, bar and aria",
    h.fetches.length === 1 && h.fetches[0] === "http://localhost:5000/api/system/status"
    && h.view().status === "Status: Uploading new fragrances" && h.view().done === "Maintenance is 45% done." && h.view().width === "45%" && h.view().aria === "45", { f: h.fetches, v: h.view() });
  check("P2 one poll is scheduled, every 30 seconds", h.intervals.length === 1 && h.intervals[0].ms === 30000, h.intervals.map(i => i.ms));
  h.queue.push(on(80, "Almost done"));
  await h.tick();
  check("P3 a poll repaints with the new figures, no reload needed", h.fetches.length === 2 && h.view().done === "Maintenance is 80% done." && h.view().status === "Status: Almost done" && h.replaced.length === 0, h.view());
  h.setHidden(true);
  await h.tick();
  check("P4 no request while the tab is hidden", h.fetches.length === 2, h.fetches.length);
  h.setHidden(false);
  h.queue.push(on(90, ""));
  await h.tick();
  check("P5 polling resumes when the tab is visible again; an empty message shows the default copy", h.fetches.length === 3 && h.view().status === DEFAULT_STATUS && h.view().done === "Maintenance is 90% done.", h.view());

  // ---------- returning the customer ----------
  h = load({ answers: [on(30, "Working")], stored: "/products.html?brand=dior#top" });
  await flush();
  check("R1 while maintenance is on, a redirected customer stays and sees the figures", h.replaced.length === 0 && h.view().done === "Maintenance is 30% done.");
  h.queue.push(off());
  await h.tick();
  check("R2 once the server says maintenance is off, the customer goes back to the exact page (path, query, hash)", JSON.stringify(h.replaced) === JSON.stringify(["/products.html?brand=dior#top"]), h.replaced);
  check("R3 the return path is consumed (removed) so it can never fire twice", !h.store.has(RETURN_KEY));
  h = load({ answers: [off()], stored: "/cart.html" });
  await flush();
  check("R4 if maintenance already ended when the page loads, the customer is returned straight away", JSON.stringify(h.replaced) === JSON.stringify(["/cart.html"]), h.replaced);
  h = load({ answers: [off()], stored: "/" });
  await flush();
  check("R5 the home page ('/') is a valid return path", JSON.stringify(h.replaced) === JSON.stringify(["/"]), h.replaced);

  // ---------- direct visits never bounce ----------
  h = load({ answers: [off(0, "")] });
  await flush();
  h.queue.push(off(0, "")); await h.tick();
  check("D1 a direct visit (no return path, e.g. the admin's Preview link) is never redirected, even with maintenance off", h.replaced.length === 0 && h.fetches.length === 2, h.replaced);
  check("D2 ...and it still paints the figures", h.view().done === "Maintenance is 0% done." && h.view().status === DEFAULT_STATUS, h.view());

  // ---------- unsafe or odd return paths are ignored ----------
  const unsafe = ["//evil.example/x", "/\\evil.example/x", "https://evil.example/", "javascript:alert(1)", "evil.html", "",
    "/maintenance.html", "/maintenance", "/MAINTENANCE.HTML", "/maintenance.html?x=1"];
  const bounced = [];
  for (const p of unsafe) {
    const x = load({ answers: [off()], stored: p });
    await flush();
    if (x.replaced.length) bounced.push(`${p} -> ${x.replaced[0]}`);
  }
  check(`U1 none of ${unsafe.length} unsafe or self-referencing return paths causes a redirect (other origins, protocol-relative, backslash, javascript:, relative, the maintenance page itself)`, bounced.length === 0, bounced);

  // ---------- failures never end the wait ----------
  const failures = [
    ["503 from the API", { status: 503, body: { maintenance: false } }],
    ["500 from the API", { status: 500, body: { maintenance: false } }],
    ["network failure", "reject"],
    ["maintenance missing from the answer", { status: 200, body: { progress: 10 } }],
    ["maintenance as the string \"false\"", { status: 200, body: { maintenance: "false", progress: 10 } }],
    ["maintenance null", { status: 200, body: { maintenance: null, progress: 10 } }],
  ];
  const wrong = [];
  for (const [label, a] of failures) {
    const x = load({ answers: [a], stored: "/products.html" });
    await flush();
    if (x.replaced.length || !x.store.has(RETURN_KEY)) wrong.push(label);
  }
  check(`F1 none of ${failures.length} failed or unclear answers returns the customer or spends the return path`, wrong.length === 0, wrong);
  h = load({ answers: ["reject"], stored: "/products.html" });
  await flush();
  check("F2 an unreachable API leaves the page's figures as they were", h.view().status === DEFAULT_STATUS && h.view().done === "", h.view());
  h.queue.push(off()); await h.tick();
  check("F3 ...and the next successful 'off' answer still returns the customer", JSON.stringify(h.replaced) === JSON.stringify(["/products.html"]), h.replaced);

  // ---------- storage unavailable ----------
  h = load({ answers: [off(20, "x")], stored: "/products.html", storageThrows: true });
  await flush();
  check("T1 with storage blocked the page does not crash, does not redirect, and still paints", h.replaced.length === 0 && h.view().done === "Maintenance is 20% done.", h.view());

  // ---------- API base mirrors js/main.js ----------
  h = load({ answers: [on(1, "")], hostname: "neofragrances.netlify.app" });
  await flush();
  check("B1 outside local hosts the page reads the production API", h.fetches[0] === "https://neofragrances-server.onrender.com/api/system/status", h.fetches[0]);

  // ---------- js/main.js records the return path ----------
  const fn = MAIN.slice(MAIN.indexOf("async function nfCheckMaintenance"), MAIN.indexOf("\n}", MAIN.indexOf("async function nfCheckMaintenance")));
  const setAt = fn.indexOf(`sessionStorage.setItem("${RETURN_KEY}", window.location.pathname + window.location.search + window.location.hash)`);
  const replaceAt = fn.indexOf("window.location.replace(NF_MAINTENANCE_PAGE)");
  check("M1 js/main.js stores path + query + hash under the same key before redirecting to the maintenance page", setAt > 0 && replaceAt > setAt, { setAt, replaceAt });
  check("M2 ...inside try, so blocked storage can never stop the redirect", /try \{ sessionStorage\.setItem\("nf_maintenance_return"[^\n]*\} catch \(err\)/.test(fn));
  check("M3 the key is spelled the same in both files", PAGE.includes(`const RETURN_KEY = "${RETURN_KEY}";`));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
