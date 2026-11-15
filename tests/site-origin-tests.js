// One public storefront address everywhere (R5).
//
// js/main.js defines NF_SITE_ORIGIN, the storefront's public production address. Script-built
// metadata (the product page's canonical link and structured data) reads that constant. The static
// files (page <head> tags, sitemap.xml, robots.txt) cannot, so they repeat the value; this suite
// fails if any of them disagrees. To move to a custom domain: change NF_SITE_ORIGIN, run this
// suite, and update every file it reports. Reads files only; no browser, server or network.
//
// Run: node tests/site-origin-tests.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

const MAIN = read("js/main.js");
const decl = MAIN.match(/^const NF_SITE_ORIGIN = "([^"]+)";$/m);
check("O1 js/main.js declares NF_SITE_ORIGIN once, as a plain string", !!decl && (MAIN.match(/NF_SITE_ORIGIN =/g) || []).length === 1);
const ORIGIN = decl ? decl[1] : "";
check("O2 NF_SITE_ORIGIN is an https origin with no path or trailing slash", /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(ORIGIN), ORIGIN);

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const files = [...pages, "sitemap.xml", "robots.txt"];

// Every absolute self-reference the storefront publishes.
const refs = [];
for (const f of pages) {
  const head = read(f).split("</head>")[0];
  for (const [, kind, url] of head.matchAll(/(rel="canonical" href|property="og:url" content|property="og:image" content)="([^"]+)"/g)) refs.push({ f, kind, url });
}
for (const [, url] of read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)) refs.push({ f: "sitemap.xml", kind: "loc", url });
for (const [, url] of read("robots.txt").matchAll(/^Sitemap:\s*(\S+)/gm)) refs.push({ f: "robots.txt", kind: "Sitemap", url });

const absolute = refs.filter(r => /^https?:\/\//.test(r.url));
const wrong = absolute.filter(r => !(r.url === `${ORIGIN}/` || r.url.startsWith(`${ORIGIN}/`)));
check(`O3 all ${absolute.length} canonical, og:url, og:image, sitemap and robots URLs use NF_SITE_ORIGIN`, absolute.length > 0 && wrong.length === 0, wrong);
check("O4 canonical links are absolute (no relative canonical except the two redirect stubs)",
  refs.filter(r => r.kind.startsWith("rel=") && !/^https:/.test(r.url) && !["my-orders.html", "wishlist.html"].includes(r.f)).length === 0);
check("O5 robots.txt names the sitemap at NF_SITE_ORIGIN", read("robots.txt").includes(`Sitemap: ${ORIGIN}/sitemap.xml`));

// No other Netlify site (an old or mistyped address) anywhere in the storefront's own files.
const otherHosts = [];
for (const f of [...files, ...fs.readdirSync(path.join(ROOT, "js")).filter(n => n.endsWith(".js")).map(n => `js/${n}`)]) {
  for (const [host] of read(f).matchAll(/https?:\/\/[a-z0-9.-]+\.netlify\.app/gi)) if (host !== ORIGIN) otherHosts.push(`${f}: ${host}`);
}
check("O6 no other *.netlify.app address appears in pages, sitemap, robots or scripts", otherHosts.length === 0, otherHosts);

// Script-built metadata reads the constant instead of repeating the address.
const PDP = read("product-details.html");
check("O7 the product page builds its canonical URL and structured data from NF_SITE_ORIGIN", /const SITE = NF_SITE_ORIGIN;/.test(PDP) && !PDP.includes(ORIGIN));

// Where the address lives, for a future domain change.
const where = files.filter(f => read(f).includes(ORIGIN));
console.log(`\nNF_SITE_ORIGIN = ${ORIGIN}\nRepeated in ${where.length} static files: ${where.join(", ")}`);
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
