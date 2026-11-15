// Storefront loading rules (R6): the full catalogue only where a page needs it, and one font request.
//
// main.js fetches the whole product list (/api/products) on every page that loads it. Pages whose
// own content never uses that list declare <body data-catalog="lazy">: the maintenance check still
// runs, and the catalogue is fetched only when the visitor starts a header search. This suite checks
// that no lazy page depends on the catalogue on load, that the hooks that keep search suggestions,
// the wishlist count and the maintenance redirect working are in place, and that Google Fonts is
// requested once per page (no @import in css/style.css; the <link> carries every weight, Inter 700
// included). Reads files only; no browser, server or network.
//
// Run: node tests/catalog-loading-tests.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const body = f => (read(f).match(/<body[^>]*>/) || [""])[0];
const loadsMain = f => /<script src="\/?js\/main\.js"><\/script>/.test(read(f));
const lazy = pages.filter(f => /data-catalog="lazy"/.test(body(f)));

// Scripts every storefront page shares; their catalogue use is covered by the hook checks below.
const SHARED = new Set(["layout", "main", "catalog", "search-suggest", "motion", "toast", "cart", "auth", "wishlist", "mobile-drawer", "validation", "not-found"]);
const usesCatalog = src => /\bPRODUCTS\b|productsReady|ACTIVE_OFFER_BY_PRODUCT|nfLoadActiveOffers/.test(src);

const EXPECTED_LAZY = ["404.html", "contact.html", "FAQ.html", "forgot-password.html", "learn.html", "login.html", "payment-callback.html", "privacy.html", "register.html", "reset-password.html", "returns.html", "shipping.html", "terms.html", "track-order.html", "verify-email.html"];
check(`C1 exactly the ${EXPECTED_LAZY.length} content, sign-in and help pages defer the catalogue`, JSON.stringify(lazy) === JSON.stringify([...EXPECTED_LAZY].sort()), { lazy });

for (const f of lazy) {
  const src = read(f);
  const own = [...src.matchAll(/<script src="\/?js\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]).filter(n => !SHARED.has(n));
  const inline = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  // orders-common.js is a helper library: only its buyAgain() reads PRODUCTS. A page may load it
  // lazily as long as that page's own script never calls buyAgain (track-order uses only the
  // status, date and timeline helpers).
  const ownSrc = own.filter(n => n !== "orders-common").map(n => read(`js/${n}.js`)).join("\n") + inline;
  const users = [
    ...own.filter(n => n !== "orders-common" && usesCatalog(read(`js/${n}.js`))).map(n => `js/${n}.js`),
    ...(own.includes("orders-common") && /\bbuyAgain\(/.test(ownSrc) ? ["buyAgain (orders-common.js)"] : []),
    ...(usesCatalog(inline) ? ["inline script"] : []),
  ];
  check(`C2 ${f}: loads main.js and nothing of its own needs the catalogue on load`, loadsMain(f) && users.length === 0, users);
}

// Pages that keep loading the catalogue do use it (otherwise they should be lazy too).
const eager = pages.filter(f => loadsMain(f) && !lazy.includes(f) && !/data-catalog="off"/.test(body(f)));
const eagerWithoutUse = eager.filter(f => {
  const src = read(f);
  const own = [...src.matchAll(/<script src="\/?js\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]).filter(n => !SHARED.has(n));
  return !usesCatalog(src.replace(/<script src[^>]*><\/script>/g, "")) && !own.some(n => usesCatalog(read(`js/${n}.js`)));
});
check(`C3 every page that still loads the catalogue on arrival uses it (${eager.length} pages)`, eagerWithoutUse.length === 0, eagerWithoutUse);

// main.js boot order: the maintenance probe runs before the lazy branch; admin "off" is unchanged.
const MAIN = read("js/main.js");
const boot = (MAIN.match(/document\.addEventListener\("DOMContentLoaded", \(\) => \{[\s\S]*?\n\}\);/g) || []).pop() || "";
const iOff = boot.indexOf('dataset.catalog === "off"'), iMaint = boot.indexOf("nfCheckMaintenance()"), iLazy = boot.indexOf('dataset.catalog === "lazy"'), iLoad = boot.indexOf("nfEnsureCatalog()");
check("C4 main.js boot: admin opt-out first, then the maintenance check, then the lazy branch, then the catalogue", iOff >= 0 && iOff < iMaint && iMaint < iLazy && iLazy < iLoad, { iOff, iMaint, iLazy, iLoad });
check("C5 the lazy branch announces nfCatalogDeferred and returns without fetching", /dataset\.catalog === "lazy"\) \{\s*document\.dispatchEvent\(new CustomEvent\("nfCatalogDeferred"\)\);\s*return;\s*\}/.test(boot));
check("C6 nfEnsureCatalog fetches at most once", /function nfEnsureCatalog\(\) \{\s*if \(nfCatalogRequested\) return;\s*nfCatalogRequested = true;\s*loadProducts\(\);\s*\}/.test(MAIN));

const SUGGEST = read("js/search-suggest.js");
check("C7 header search fetches the catalogue on focus and on typing, and refreshes when it arrives",
  /input\.addEventListener\("input", \(\) => \{ ensureCatalog\(\);/.test(SUGGEST) && /input\.addEventListener\("focus", \(\) => \{ ensureCatalog\(\);/.test(SUGGEST) && /addEventListener\("productsReady", \(\) => \{ if \(!panel\.hidden\) render\(\); \}\)/.test(SUGGEST));
const WISH = read("js/wishlist.js");
check("C8 the wishlist (and drawer count) also loads on lazy pages", /addEventListener\("nfCatalogDeferred", async \(\) => \{\s*await loadWishlist\(\);\s*refreshWishlistIcons\(\);\s*if \(typeof mnavRenderWishlistCount === "function"\) mnavRenderWishlistCount\(\);/.test(WISH));
// Where a lazy page loads search-suggest.js or wishlist.js (not every page does), it loads it after
// main.js, so nfEnsureCatalog exists and the nfCatalogDeferred listener is registered in time.
const misordered = lazy.filter(f => {
  const s = read(f), m = s.search(/js\/main\.js/);
  return ["search-suggest", "wishlist"].some(n => { const i = s.search(new RegExp(`js/${n}\\.js`)); return i >= 0 && i < m; });
});
check("C9 on lazy pages, search-suggest.js and wishlist.js (where loaded) come after main.js", misordered.length === 0, misordered);

// Fonts: one Google Fonts request per page.
const cssFiles = fs.readdirSync(path.join(ROOT, "css")).filter(n => n.endsWith(".css"));
const imports = cssFiles.filter(n => /@import\b/.test(read(`css/${n}`).replace(/\/\*[\s\S]*?\*\//g, "")));
check("F1 no stylesheet uses @import", imports.length === 0, imports);
const FONT = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap";
const stylePages = pages.filter(f => /href="\/?css\/style\.css"/.test(read(f)));
const badFont = stylePages.filter(f => { const links = [...read(f).matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"/g)].map(m => m[1]); return links.length !== 1 || links[0] !== FONT; });
check(`F2 each of the ${stylePages.length} pages that load css/style.css links Google Fonts exactly once, with Inter 700`, stylePages.length > 0 && badFont.length === 0, badFont);
const weights = new Set([...cssFiles.map(n => read(`css/${n}`)).join("\n").matchAll(/font-weight:\s*(\d{3})/g)].map(m => m[1]));
const linked = new Set(["400", "500", "600", "700"]);
check("F3 every numeric font-weight used in the CSS is a linked Inter weight", [...weights].every(w => linked.has(w)), [...weights]);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
