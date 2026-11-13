// Static regression test for the admin portal's Netlify security headers (ADMIN-2).
//
// Reads _headers, the admin HTML shells and the scripts they load, and checks that:
//   * a "/admin/*" rule exists, covers every page in admin/, and is the ONLY rule
//     (so the public storefront is not affected);
//   * the required headers are present with safe values;
//   * the CSP is restrictive (default-src 'none', no wildcard, no 'unsafe-eval', no
//     'unsafe-inline' for scripts, framing/base/object locked down);
//   * every external origin the admin pages load is allowed, and nothing more;
//   * the login inline-script hash and every inline event-handler hash match the
//     actual source, and no inline <script> or handler is left unhashed.
// No server, browser, network, database or external service is used. Nothing on disk
// is modified. This does NOT prove what Netlify serves — that needs a deployed preview.
//
// Run: node tests/admin-security-headers-tests.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n?/g, "\n");
const sha = s => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${typeof detail === "string" ? detail : JSON.stringify(detail)}]`}`); }
}

// ---------- parse _headers (Netlify syntax: a path line, then indented "Name: value") ----------
const headersPath = path.join(ROOT, "_headers");
check("H1 _headers exists at the publish root", fs.existsSync(headersPath));
const rules = [];
for (const line of read("_headers").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) { rules.push({ path: line.trim(), headers: {} }); continue; }
  const m = line.match(/^\s+([A-Za-z0-9-]+):\s*(.*)$/);
  if (m && rules.length) rules[rules.length - 1].headers[m[1].toLowerCase()] = m[2].trim();
}
check("H2 exactly one rule, for /admin/* (storefront pages are not matched)", rules.length === 1 && rules[0].path === "/admin/*", rules.map(r => r.path));
const H = (rules.find(r => r.path === "/admin/*") || { headers: {} }).headers;

// Netlify-style matching: "/admin/*" matches any path under /admin/.
const matches = (pattern, url) => new RegExp("^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(url);
const adminPages = fs.readdirSync(path.join(ROOT, "admin")).filter(f => f.endsWith(".html"));
const uncovered = adminPages.flatMap(f => [`/admin/${f}`, `/admin/${f.replace(/\.html$/, "")}`]).filter(u => !rules.some(r => matches(r.path, u)));
check(`H3 the rule covers all ${adminPages.length} admin pages (with and without .html), login included`, adminPages.includes("login.html") && uncovered.length === 0, uncovered);
const storefront = ["/", "/index.html", "/shop.html", "/product.html", "/checkout.html", "/account.html", "/payment-callback.html", "/js/main.js", "/css/admin.css", "/administrator.html"];
check("H4 storefront paths and shared assets are not matched", storefront.every(u => !rules.some(r => matches(r.path, u))), storefront.filter(u => rules.some(r => matches(r.path, u))));

// ---------- simple headers ----------
check("S1 X-Frame-Options: DENY", H["x-frame-options"] === "DENY", H["x-frame-options"]);
check("S2 X-Content-Type-Options: nosniff", H["x-content-type-options"] === "nosniff");
check("S3 Referrer-Policy is privacy-preserving", ["no-referrer", "same-origin", "strict-origin"].includes(H["referrer-policy"]), H["referrer-policy"]);
const pp = H["permissions-policy"] || "";
check("S4 Permissions-Policy disables camera, microphone, geolocation, payment, usb", ["camera", "microphone", "geolocation", "payment", "usb"].every(f => new RegExp(`(^|,\\s*)${f}=\\(\\)`).test(pp)), pp);
check("S5 X-Robots-Tag: noindex, nofollow", /noindex/.test(H["x-robots-tag"] || "") && /nofollow/.test(H["x-robots-tag"] || ""), H["x-robots-tag"]);

// ---------- CSP ----------
const cspRaw = H["content-security-policy"] || "";
const csp = {};
for (const part of cspRaw.split(";").map(s => s.trim()).filter(Boolean)) {
  const [name, ...sources] = part.split(/\s+/);
  csp[name.toLowerCase()] = sources;
}
const has = (d, s) => (csp[d] || []).includes(s);
check("C1 CSP present", cspRaw.length > 0);
check("C2 default-src 'none'", (csp["default-src"] || []).join(" ") === "'none'", csp["default-src"]);
check("C3 frame-ancestors 'none', base-uri 'none', object-src 'none', form-action 'self'",
  (csp["frame-ancestors"] || []).join(" ") === "'none'" && (csp["base-uri"] || []).join(" ") === "'none'" && (csp["object-src"] || []).join(" ") === "'none'" && (csp["form-action"] || []).join(" ") === "'self'");
const allSources = Object.values(csp).flat();
check("C4 no wildcard, scheme-only or insecure sources anywhere", !allSources.some(s => s.includes("*") || /^(https?|data|blob|ws|wss):$/.test(s) || s.startsWith("http://")), allSources.filter(s => s.includes("*") || /^(https?|data|blob):$/.test(s) || s.startsWith("http://")));
check("C5 no 'unsafe-eval' or 'wasm-unsafe-eval'", !allSources.includes("'unsafe-eval'") && !allSources.includes("'wasm-unsafe-eval'"));
check("C6 scripts: no 'unsafe-inline' and no script-src-attr/-elem relaxations", !has("script-src", "'unsafe-inline'") && !csp["script-src-elem"] && !csp["script-src-attr"]);
const unsafeInlineIn = Object.keys(csp).filter(d => has(d, "'unsafe-inline'"));
check("C7 'unsafe-inline' appears only in style-src-attr and the legacy style-src fallback", unsafeInlineIn.every(d => d === "style-src-attr" || d === "style-src") && !has("style-src-elem", "'unsafe-inline'"), unsafeInlineIn);
check("C8 img-src 'self' only", (csp["img-src"] || []).join(" ") === "'self'", csp["img-src"]);

// ---------- origins actually used ----------
const SHARED_SCRIPTS = ["js/main.js", "js/toast.js", "js/auth.js"];
const htmlByPage = Object.fromEntries(adminPages.map(f => [f, read(`admin/${f}`)]));
const loadedScripts = new Set();
const extStyles = new Set(), extScripts = new Set();
for (const html of Object.values(htmlByPage)) {
  for (const m of html.matchAll(/<script\s+src="([^"]+)"/g)) (/^https?:/.test(m[1]) ? extScripts : loadedScripts).add(m[1].replace(/^\.\.\//, ""));
  for (const m of html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)) if (/^https?:/.test(m[1])) extStyles.add(new URL(m[1]).origin);
}
check("O1 admin pages load no external scripts", extScripts.size === 0, [...extScripts]);
const styleElem = csp["style-src-elem"] || [];
check("O2 every external stylesheet origin is allowed by style-src-elem (and style-src)", [...extStyles].every(o => styleElem.includes(o) && has("style-src", o)), [...extStyles]);
const allowedStyleOrigins = styleElem.filter(s => /^https:/.test(s));
check("O3 style-src-elem allows no origin the pages don't load", allowedStyleOrigins.every(o => extStyles.has(o)), allowedStyleOrigins);
const fontsCss = [...extStyles].includes("https://fonts.googleapis.com"), faCss = [...extStyles].includes("https://cdnjs.cloudflare.com");
check("O4 font-src is exactly the Google font files + Font Awesome webfonts origins",
  (csp["font-src"] || []).slice().sort().join(" ") === ["https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"].sort().join(" ") && fontsCss && faCss, csp["font-src"]);
const mainJs = read("js/main.js");
const apiProd = (mainJs.match(/:\s*"(https:\/\/[^"]+)";/) || [])[1];
check("O5 connect-src is exactly the production API_BASE origin from js/main.js", !!apiProd && (csp["connect-src"] || []).join(" ") === new URL(apiProd).origin, { apiProd, connect: csp["connect-src"] });
const adminScripts = [...loadedScripts].filter(s => s.startsWith("js/"));
check("O6 every page script is same-origin under js/ (covered by script-src 'self')", has("script-src", "'self'") && adminScripts.length > 0 && [...loadedScripts].every(s => s.startsWith("js/")), [...loadedScripts]);

// ---------- inline scripts and handlers vs hashes ----------
const scriptHashes = (csp["script-src"] || []).filter(s => s.startsWith("'sha256-"));
const inlineScripts = Object.entries(htmlByPage).flatMap(([f, html]) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => ({ f, body: m[1] })));
check("I1 the only inline <script> is in login.html", inlineScripts.length === 1 && inlineScripts[0].f === "login.html", inlineScripts.map(s => s.f));
check("I2 login.html inline-script hash in CSP matches its exact contents", inlineScripts.every(s => scriptHashes.includes(sha(s.body))), inlineScripts.map(s => sha(s.body)));
const scriptSources = [...new Set([...adminScripts, ...SHARED_SCRIPTS])].filter(s => fs.existsSync(path.join(ROOT, s)));
const handlers = new Map();
for (const file of [...scriptSources.map(s => [s, read(s)]), ...Object.entries(htmlByPage).map(([f, h]) => [`admin/${f}`, h])]) {
  for (const m of file[1].matchAll(/\son([a-z]+)="([^"$]*)"/g)) handlers.set(m[2], (handlers.get(m[2]) || []).concat(`${file[0]}:on${m[1]}`));
}
// main.js's productCard onclick (toggleWishlist) is storefront-only markup: admin pages set
// data-catalog="off" and never render product cards, so it must NOT be hashed here.
const adminHandlers = [...handlers].filter(([, where]) => where.some(w => !w.startsWith("js/main.js")) || where.some(w => w.includes("onerror")));
check("I3 every inline handler rendered on admin pages has its exact hash, with 'unsafe-hashes'",
  has("script-src", "'unsafe-hashes'") && adminHandlers.length > 0 && adminHandlers.every(([code]) => scriptHashes.includes(sha(code))), adminHandlers.map(([code, where]) => ({ code, where, hash: sha(code) })));
const expectedHashes = new Set([...inlineScripts.map(s => sha(s.body)), ...adminHandlers.map(([code]) => sha(code))]);
check("I4 script-src carries no stale or unexplained hash", scriptHashes.every(h => expectedHashes.has(h)), scriptHashes.filter(h => !expectedHashes.has(h)));
const adminHtmlAndScripts = [...Object.values(htmlByPage), ...scriptSources.filter(s => s.startsWith("js/admin-")).map(read)].join("\n");
check("I5 admin pages create no <style> elements (style-src-elem stays strict)", !/<style[\s>]|createElement\(["']style["']\)/.test(adminHtmlAndScripts));
check("I6 admin code uses no eval / new Function / string timers", !/\beval\(|new Function\(|setTimeout\(\s*["'`]|setInterval\(\s*["'`]/.test(adminHtmlAndScripts));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
