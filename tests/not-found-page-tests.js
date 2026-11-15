// The 404 page (R5) stays safe and working wherever Netlify serves it.
//
// Netlify serves 404.html for any missing path, and picks _headers rules by the requested path,
// so at an unknown address the page may arrive without the storefront's security headers. The page
// therefore carries its own Content-Security-Policy <meta>. This suite checks that the meta policy
// matches the /404.html rule in _headers (script-src reduced to 'self', frame-ancestors left out
// because browsers ignore it in a meta element), that the page needs no inline script, and that
// everything it loads is root-absolute so it also works at nested paths such as /a/b/c.
// Reads files only; no browser, server or network.
//
// Run: node tests/not-found-page-tests.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PAGE = fs.readFileSync(path.join(ROOT, "404.html"), "utf8");
const HEAD = PAGE.split("</head>")[0];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

// _headers rule for /404.html
const rule = {};
{ let cur = null; for (const l of fs.readFileSync(path.join(ROOT, "_headers"), "utf8").split(/\r?\n/)) {
  if (/^\S/.test(l)) cur = l.trim();
  else if (cur === "/404.html" && /^\s+\S/.test(l)) { const i = l.indexOf(":"); rule[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } } }
const parse = csp => Object.fromEntries(csp.split(";").map(s => s.trim()).filter(Boolean).map(d => { const [k, ...v] = d.split(/\s+/); return [k, v.join(" ")]; }));

const metaTag = HEAD.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
check("N1 404.html carries a Content-Security-Policy meta element", !!metaTag);
const firstMeta = HEAD.indexOf("<meta"), charset = HEAD.indexOf('<meta charset="UTF-8">');
const afterCharset = HEAD.slice(charset + '<meta charset="UTF-8">'.length).search(/<(meta|link|script|style|title)\b/);
check("N2 the CSP meta comes right after <meta charset>, before anything it should govern",
  firstMeta === charset && !!metaTag && HEAD.slice(charset + '<meta charset="UTF-8">'.length).indexOf(metaTag[0]) === afterCharset);

if (metaTag && rule["Content-Security-Policy"]) {
  const meta = parse(metaTag[1]), hdr = parse(rule["Content-Security-Policy"]);
  const expected = { ...hdr, "script-src": "'self'" }; delete expected["frame-ancestors"];
  const diff = [...new Set([...Object.keys(expected), ...Object.keys(meta)])].filter(k => expected[k] !== meta[k]).map(k => ({ k, expected: expected[k], meta: meta[k] }));
  check("N3 meta CSP = the /404.html header CSP, with script-src 'self' and no frame-ancestors", diff.length === 0, diff);
  check("N4 the header rule itself keeps frame-ancestors 'none' and base-uri 'none'", hdr["frame-ancestors"] === "'none'" && hdr["base-uri"] === "'none'");
} else check("N3 /404.html rule found in _headers", false);

check("N5 referrer policy meta matches the header", (HEAD.match(/<meta name="referrer" content="([^"]+)">/) || [])[1] === rule["Referrer-Policy"]);
check("N6 no inline script and no inline event handler (script-src 'self' is enough)", !/<script>|<script\s+(?![^>]*\bsrc=)/i.test(PAGE) && !/\son[a-z]+=/i.test(PAGE));
check("N7 noindex", /<meta name="robots" content="noindex">/.test(HEAD));
check("N8 no <base> element (the storefront CSP forbids it)", !/<base\b/i.test(PAGE.replace(/<!--[\s\S]*?-->/g, "")));

const refs = [...PAGE.matchAll(/\s(?:href|src)="([^"]+)"/g)].map(m => m[1]);
const relative = refs.filter(v => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(v));
check(`N9 all ${refs.length} links, stylesheets, scripts and images in 404.html are root-absolute or external`, relative.length === 0, relative);
check("N10 js/not-found.js loads in <head>, before js/layout.js builds the header", HEAD.includes('<script src="/js/not-found.js"></script>') && PAGE.indexOf("/js/not-found.js") < PAGE.indexOf("/js/layout.js"));
check("N11 _headers has a rule for both /404 and /404.html", /^\/404\r?$/m.test(fs.readFileSync(path.join(ROOT, "_headers"), "utf8")) && Object.keys(rule).length > 0);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
