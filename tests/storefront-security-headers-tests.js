// Static regression test for the public storefront's Netlify security headers (G-2).
//
// Reads _headers, every storefront page (*.html at the publish root) and the storefront scripts
// (js/*.js except the admin-only admin-*.js), and checks that:
//   * every page has a rule for both URL forms ("/about" and "/about.html"; "/" and "/index.html"),
//     all storefront rules carry identical headers, and none of them matches an admin page;
//   * the required headers are present with the agreed values;
//   * the CSP is restrictive: no 'unsafe-eval', no 'unsafe-inline' or relaxations for scripts, no
//     wildcard / scheme-only / insecure sources, framing / base / object locked down;
//   * every inline <script> has its exact sha256 in script-src and no hash is stale;
//   * no inline event handler (onclick=, onerror=, ...) and no injected <style> element exists in
//     storefront HTML or in markup the storefront scripts generate;
//   * every external script / stylesheet / font origin the pages use is allowed, and nothing more;
//     connect-src carries the production API_BASE from js/main.js;
//   * the asset folders get nosniff and no CSP.
// No server, browser, network, database or external service is used. Nothing on disk is modified.
// This does NOT prove what Netlify serves — that needs a deploy preview. The behaviour of the
// pages under this policy was verified separately in headless Edge (2026-11-13, all 50 paths).
//
// Run: node tests/storefront-security-headers-tests.js
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

// ---------- parse _headers ----------
const rules = [];
for (const line of read("_headers").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) { rules.push({ path: line.trim(), headers: {} }); continue; }
  const m = line.match(/^\s+([A-Za-z0-9-]+):\s*(.*)$/);
  if (m && rules.length) rules[rules.length - 1].headers[m[1].toLowerCase()] = m[2].trim();
}
const matches = (pattern, url) => new RegExp("^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(url);

// ---------- storefront pages and their URL forms ----------
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const urlsFor = f => (f === "index.html" ? ["/", "/index.html"] : [`/${f.replace(/\.html$/, "")}`, `/${f}`]);
const storefrontUrls = pages.flatMap(urlsFor);
const sfRules = rules.filter(r => storefrontUrls.includes(r.path));
const missing = storefrontUrls.filter(u => !rules.some(r => r.path === u));
check(`R1 every storefront page (${pages.length}) has a rule for both URL forms (${storefrontUrls.length} paths)`, pages.length > 0 && missing.length === 0, missing);
const sig = r => JSON.stringify(Object.entries(r.headers).sort());
check("R2 all storefront rules carry identical headers", sfRules.length === storefrontUrls.length && new Set(sfRules.map(sig)).size === 1, [...new Set(sfRules.map(sig))].length);
const multi = storefrontUrls.filter(u => rules.filter(r => matches(r.path, u)).length !== 1);
check("R3 each storefront URL is matched by exactly one rule (no stacked CSPs)", multi.length === 0, multi);
const adminUrls = fs.readdirSync(path.join(ROOT, "admin")).filter(f => f.endsWith(".html")).flatMap(f => [`/admin/${f}`, `/admin/${f.replace(/\.html$/, "")}`]);
const leak = adminUrls.filter(u => rules.some(r => r.path !== "/admin/*" && matches(r.path, u)));
check("R4 no storefront or asset rule matches an admin page", leak.length === 0, leak);
check("R5 no catch-all rule (/* or /*.html) that would also reach the admin portal", !rules.some(r => r.path === "/*" || r.path === "/*.html"), rules.map(r => r.path).filter(p => p.startsWith("/*")));

const H = (sfRules[0] || { headers: {} }).headers;
// ---------- required headers ----------
check("S1 X-Frame-Options: DENY", H["x-frame-options"] === "DENY", H["x-frame-options"]);
check("S2 X-Content-Type-Options: nosniff", H["x-content-type-options"] === "nosniff");
check("S3 Referrer-Policy: strict-origin-when-cross-origin", H["referrer-policy"] === "strict-origin-when-cross-origin", H["referrer-policy"]);
check("S4 Cross-Origin-Opener-Policy: same-origin-allow-popups (Google Sign-In popup)", H["cross-origin-opener-policy"] === "same-origin-allow-popups", H["cross-origin-opener-policy"]);
check("S5 Permissions-Policy disables camera, microphone, geolocation, payment, usb", ["camera", "microphone", "geolocation", "payment", "usb"].every(f => new RegExp(`(^|,\\s*)${f}=\\(\\)`).test(H["permissions-policy"] || "")), H["permissions-policy"]);
check("S6 storefront pages are indexable (no X-Robots-Tag)", !H["x-robots-tag"]);

// ---------- CSP ----------
const cspRaw = H["content-security-policy"] || "";
const csp = Object.fromEntries(cspRaw.split(";").map(d => d.trim()).filter(Boolean).map(d => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
const has = (d, s) => (csp[d] || []).includes(s);
const all = Object.values(csp).flat();
check("C1 CSP present", cspRaw.length > 0);
check("C2 default-src 'self'", (csp["default-src"] || []).join(" ") === "'self'", csp["default-src"]);
check("C3 frame-ancestors 'none', base-uri 'none', object-src 'none', form-action 'self'",
  (csp["frame-ancestors"] || []).join(" ") === "'none'" && (csp["base-uri"] || []).join(" ") === "'none'" && (csp["object-src"] || []).join(" ") === "'none'" && (csp["form-action"] || []).join(" ") === "'self'");
check("C4 no wildcard, scheme-only (except data: for images) or insecure sources", !all.some(s => s.includes("*") || s.startsWith("http:") || (/^(https?|blob|ws|wss|data):$/.test(s) && !(s === "data:" && (csp["img-src"] || []).includes(s)))), all.filter(s => s.includes("*") || s.startsWith("http:")));
check("C5 data: only in img-src", Object.entries(csp).every(([d, v]) => d === "img-src" || !v.includes("data:")));
check("C6 no 'unsafe-eval' / 'wasm-unsafe-eval'", !all.includes("'unsafe-eval'") && !all.includes("'wasm-unsafe-eval'"));
check("C7 scripts: no 'unsafe-inline', no 'unsafe-hashes', no script-src-attr/-elem relaxations", !has("script-src", "'unsafe-inline'") && !has("script-src", "'unsafe-hashes'") && !csp["script-src-elem"] && !csp["script-src-attr"]);
const unsafeInlineIn = Object.entries(csp).filter(([, v]) => v.includes("'unsafe-inline'")).map(([d]) => d);
check("C8 'unsafe-inline' only in style-src-attr and the legacy style-src fallback", unsafeInlineIn.every(d => d === "style-src-attr" || d === "style-src"), unsafeInlineIn);
check("C9 style-src-elem has no 'unsafe-inline' (no inline <style> elements)", !has("style-src-elem", "'unsafe-inline'") && has("style-src-elem", "'self'"));

// ---------- inline scripts, handlers, injected styles ----------
const inline = [];
for (const f of pages) for (const m of read(f).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) inline.push({ f, h: sha(m[1]) });
const scriptHashes = (csp["script-src"] || []).filter(s => s.startsWith("'sha256-"));
const unhashed = inline.filter(s => !scriptHashes.includes(s.h));
check(`I1 every inline <script> (${inline.length}) has its exact hash in script-src`, inline.length > 0 && unhashed.length === 0, unhashed.map(s => `${s.f} needs ${s.h}`));
const stale = scriptHashes.filter(h => !inline.some(s => s.h === h));
check("I2 script-src carries no stale hash", stale.length === 0, stale);
const sfScripts = fs.readdirSync(path.join(ROOT, "js")).filter(f => f.endsWith(".js") && !f.startsWith("admin-")).map(f => `js/${f}`);
// Comments may mention "<style>" or "onclick=" in prose: drop /* ... */ blocks and whole-line //
// comments before scanning (a "//" inside a line is kept — it may be part of a URL in markup).
const code = rel => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
const handlerHits = [];
for (const rel of [...pages, ...sfScripts]) {
  const src = code(rel);
  for (const m of src.matchAll(/\son[a-z]+\s*=\s*["']/g)) handlerHits.push(`${rel}: ${src.slice(m.index, m.index + 40).trim()}`);
}
check("I3 no inline event handler attributes in storefront HTML or generated markup", handlerHits.length === 0, handlerHits);
const styleHits = [...pages, ...sfScripts].filter(rel => /<style[\s>]|createElement\(\s*["']style["']\s*\)/.test(code(rel)));
check("I4 no <style> element in storefront pages or created by storefront scripts", styleHits.length === 0, styleHits);
const evalHits = [...pages, ...sfScripts].filter(rel => /\beval\(|new Function\(|setTimeout\(\s*["'`]|setInterval\(\s*["'`]/.test(code(rel)));
check("I5 no eval / new Function / string timers", evalHits.length === 0, evalHits);

// ---------- origins ----------
const origin = u => { try { return new URL(u).origin; } catch (e) { return null; } };
const extScriptUrls = new Set(), extStyleOrigins = new Set();
for (const f of pages) {
  const h = read(f);
  for (const m of h.matchAll(/<script[^>]*\bsrc="(https?:[^"]+)"/g)) extScriptUrls.add(m[1]);
  for (const m of h.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(https?:[^"]+)"/g)) extStyleOrigins.add(origin(m[1]));
  for (const m of h.matchAll(/<link[^>]*href="(https?:[^"]+)"[^>]*rel="stylesheet"/g)) extStyleOrigins.add(origin(m[1]));
}
const scriptAllowed = u => (csp["script-src"] || []).some(s => s === u || (s.endsWith("/") && u.startsWith(s)) || s === origin(u));
check("O1 every external script is allowed by script-src", extScriptUrls.size > 0 && [...extScriptUrls].every(scriptAllowed), [...extScriptUrls].filter(u => !scriptAllowed(u)));
check("O2 script-src allows no external source the pages don't load", (csp["script-src"] || []).filter(s => /^https:/.test(s)).every(s => [...extScriptUrls].some(u => u === s || u.startsWith(s))), csp["script-src"]);
const styleElem = csp["style-src-elem"] || [];
check("O3 every external stylesheet origin is allowed by style-src-elem and style-src", [...extStyleOrigins].every(o => styleElem.includes(o) && has("style-src", o)), [...extStyleOrigins]);
check("O4 font-src is exactly the Google font files + Font Awesome webfonts origins", (csp["font-src"] || []).slice().sort().join(" ") === ["https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"].join(" "), csp["font-src"]);
check("O5 img-src is 'self' data:", (csp["img-src"] || []).join(" ") === "'self' data:", csp["img-src"]);
const apiProd = (read("js/main.js").match(/"(https:\/\/[^"]+onrender\.com)"/) || [])[1];
check("O6 connect-src carries the production API_BASE from js/main.js", !!apiProd && has("connect-src", new URL(apiProd).origin), { apiProd, connect: csp["connect-src"] });
const usesGsi = pages.some(f => /accounts\.google\.com\/gsi\/client/.test(read(f)));
check("O7 Google Sign-In: script, style, connect and frame sources present (pages load it)",
  usesGsi && has("script-src", "https://accounts.google.com/gsi/client") && has("style-src-elem", "https://accounts.google.com/gsi/style") && has("connect-src", "https://accounts.google.com/gsi/") && has("frame-src", "https://accounts.google.com/gsi/"));

// ---------- asset rules ----------
const assetRules = ["/css/*", "/js/*", "/images/*"].map(p => rules.find(r => r.path === p));
check("A1 /css/*, /js/* and /images/* get X-Content-Type-Options: nosniff", assetRules.every(r => r && r.headers["x-content-type-options"] === "nosniff"));
check("A2 asset rules carry no CSP (and so cannot stack with a page CSP)", assetRules.every(r => r && !r.headers["content-security-policy"]));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
