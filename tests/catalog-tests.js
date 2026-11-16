// Product discovery logic (js/catalog.js): URL state, search, filters, sorting, pagination, facets
// and search suggestions (roadmap R8; P3.10 was verified in a browser on 2026-11-15, this pins it).
//
// Runs the REAL js/catalog.js in a Node vm sandbox over a small fixed catalogue, with the two
// globals it reads from main.js (SCENT_FAMILIES, nfEffectivePrice) stubbed. No browser, server,
// network or database. Nothing on disk is modified.
//
// Run: node tests/catalog-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

// The four family keys exactly as main.js defines them (checked below so this stub cannot drift).
const MAIN = fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8");
const familyKeys = [...(MAIN.match(/const SCENT_FAMILIES = \[([\s\S]*?)\];/) || ["", ""])[1].matchAll(/key: "([a-z]+)"/g)].map(m => m[1]);
check("S1 main.js defines the four scent families floral, amber, fresh, woody", JSON.stringify(familyKeys) === JSON.stringify(["floral", "amber", "fresh", "woody"]), familyKeys);

const SALE = { 7: 250 }; // product 7 is on offer at GH₵250 (regular 450)
const ctx = {
  URLSearchParams,
  SCENT_FAMILIES: familyKeys.map(key => ({ key })),
  nfEffectivePrice: p => (SALE[p.id] !== undefined ? SALE[p.id] : p.price),
};
vm.createContext(ctx);
const C = vm.runInContext(`${fs.readFileSync(path.join(__dirname, "..", "js", "catalog.js"), "utf8")}\nNFCatalog;`, ctx);
check("S2 js/catalog.js loads and exposes NFCatalog", !!C && typeof C.query === "function" && typeof C.parseState === "function");

const P = (id, name, brand, category, price, stockQty, extra = {}) => ({ id, name, brand, category, price, stock: stockQty > 0, stockQty, scentFamily: null, badge: null, avgRating: 0, reviewCount: 0, createdAt: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`, ...extra });
const PRODUCTS = [
  P(1, "Oud Mood", "Lattafa", "men", 350, 5, { scentFamily: "amber", badge: "Bestseller" }),
  P(2, "Khamrah", "Lattafa", "unisex", 400, 0, { scentFamily: "amber" }),
  P(3, "Rose Petals", "Maison Alhambra", "women", 299.99, 3, { scentFamily: "floral", badge: "New" }),
  P(4, "Aqua Breeze", "Afnan", "men", 300, 2, { scentFamily: "fresh" }),
  P(5, "Cedar Night 100ml EDP", "Afnan", "men", 1000, 1, { scentFamily: "woody", avgRating: 4.5, reviewCount: 2 }),
  P(6, "Éclat Doré", "Maison Alhambra", "women", 150, 9, { avgRating: 4.5, reviewCount: 7 }),
  P(7, "Oud Royale", "Lattafa", "men", 450, 4, { badge: "Bestseller" }),
  P(8, "Amber Velvet Oud", "Afnan", "unisex", 600, 0), // sold out, and first by name: featured must still list it last
];
for (let i = 9; i <= 30; i++) PRODUCTS.push(P(i, `Filler ${String(i).padStart(2, "0")}`, "Generic House", "unisex", 200 + i, 1));
const state = search => C.parseState(search, PRODUCTS);
const ids = r => r.items.map(p => p.id);
const run = (search, size) => C.query(PRODUCTS, state(search), size);

/* ---------- normalising ---------- */
check("N1 normalize strips accents, apostrophes and punctuation, lower-cases", C.normalize("Éclat  Doré — Women's!") === "eclat dore womens");
check("N2 categoryLabel", C.categoryLabel("men") === "Men" && C.categoryLabel("unisex") === "Unisex" && C.categoryLabel("") === "");

/* ---------- URL state ---------- */
const s1 = state("?q=%20oud%20&category=MEN&brand=lattafa&brand=LATTAFA&brand=Nope&price=300-400&stock=in&scent=Amber&sort=price-asc&page=2");
check("U1 parseState accepts valid values (trimmed query, case-insensitive category, brand and scent)",
  s1.q === "oud" && s1.category === "men" && JSON.stringify(s1.brands) === '["Lattafa"]' && s1.price === "300-400" && s1.inStock === true && s1.scent === "amber" && !s1.scentInvalid && s1.sort === "price-asc" && s1.page === 2, s1);
const s2 = state("?category=kids&price=cheap&sort=random&page=-3&stock=yes");
check("U2 unknown category, price band, sort, a negative page and stock≠in fall back to defaults",
  s2.category === "" && s2.price === "" && s2.sort === "featured" && s2.page === 1 && s2.inStock === false, s2);
check("U3 page 0, NaN and 2.7 → 1, 1, 2", state("?page=0").page === 1 && state("?page=abc").page === 1 && state("?page=2.7").page === 2);
check("U4 the query is capped at 80 characters", state(`?q=${"a".repeat(200)}`).q.length === 80);
for (const raw of ["bogus", "", "%20woody%20"]) {
  const s = state(`?scent=${raw}`);
  check(`U5 ?scent=${JSON.stringify(decodeURIComponent(raw))} is marked invalid (never "all products")`, s.scentInvalid === true && s.scent === "" && run(`?scent=${raw}`).total === 0);
}
check("U6 an invalid scent value is kept for the URL but capped at 40 characters", state(`?scent=${"x".repeat(90)}`).scentRaw.length === 40);
check("U7 no ?scent= at all is not invalid", state("").scentInvalid === false);
check("U8 the default state serialises to an empty query string", C.serializeState(state("")) === "");
const round = "?q=oud&category=men&brand=Lattafa&price=300-400&stock=in&scent=amber&sort=price-asc&page=2";
check("U9 serialise(parse(url)) round-trips a full URL", C.serializeState(state(round)) === round, C.serializeState(state(round)));
check("U10 featured sort and page 1 are left out of the URL", C.serializeState({ ...state(""), sort: "featured", page: 1 }) === "");
check("U11 activeFilterCount counts query, category, each brand, price, stock and scent",
  C.activeFilterCount(state("?q=x&category=men&brand=Lattafa&brand=Afnan&price=under-300&stock=in&scent=bogus")) === 7);

/* ---------- search ---------- */
check("Q1 every word must match: 'oud' finds the three Oud products", JSON.stringify(ids(run("?q=oud")).sort()) === "[1,7,8]", ids(run("?q=oud")));
check("Q2 'oud lattafa' needs both words", JSON.stringify(ids(run("?q=oud%20lattafa")).sort()) === "[1,7]");
check("Q3 a category word counts as a match ('mens oud')", JSON.stringify(ids(run("?q=mens%20oud")).sort()) === "[1,7]", ids(run("?q=mens%20oud")));
check("Q4 accents don't matter ('eclat dore' finds Éclat Doré)", JSON.stringify(ids(run("?q=eclat%20dore"))) === "[6]");
check("Q5 brand prefix ('maison alh')", JSON.stringify(ids(run("?q=maison%20alh")).sort()) === "[3,6]");
check("Q6 no match → 0 results, page 1 of 1", run("?q=zzzqqq").total === 0 && run("?q=zzzqqq").pageCount === 1 && run("?q=zzzqqq").start === 0);
check("Q7 with a query, featured puts the best match first ('oud mood' → #1)", ids(run("?q=oud%20mood"))[0] === 1);

/* ---------- filters ---------- */
check("F1 category", run("?category=women").items.every(p => p.category === "women") && run("?category=women").total === 2);
check("F2 two brands combine as OR", run("?brand=Lattafa&brand=Afnan").total === 6);
check("F3 in stock only drops sold-out products", !ids(run("?stock=in", 100)).includes(2) && !ids(run("?stock=in", 100)).includes(8) && run("?stock=in", 100).total === 28);
check("F4 scent family", JSON.stringify(ids(run("?scent=amber")).sort()) === "[1,2]");
check("F5 price bands: lower bound included, upper excluded (300 → 300–400, 299.99 → under 300, 1000 → 1,000+)",
  ids(run("?price=300-400", 100)).includes(4) && !ids(run("?price=under-300", 100)).includes(4) && ids(run("?price=under-300", 100)).includes(3) && JSON.stringify(ids(run("?price=1000-plus"))) === "[5]");
check("F6 price bands use the sale price (#7: 450 → 250 on offer)", ids(run("?price=under-300", 100)).includes(7) && !ids(run("?price=400-500", 100)).includes(7));
check("F7 filters combine (men + Afnan + in stock)", JSON.stringify(ids(run("?category=men&brand=Afnan&stock=in")).sort()) === "[4,5]");

/* ---------- sorting ---------- */
const order = (s, n = 100) => run(`?sort=${s}`, n).items;
const priced = order("price-asc").map(p => ctx.nfEffectivePrice(p));
check("O1 price low→high uses effective prices", priced.every((v, i) => i === 0 || priced[i - 1] <= v) && order("price-asc")[0].id === 6, priced.slice(0, 4));
const pricedDesc = order("price-desc").map(p => ctx.nfEffectivePrice(p));
check("O2 price high→low", pricedDesc.every((v, i) => i === 0 || pricedDesc[i - 1] >= v) && order("price-desc")[0].id === 5);
const names = order("name").map(p => p.name);
check("O3 name A→Z", names.every((v, i) => i === 0 || names[i - 1].localeCompare(v) <= 0));
check("O4 newest first by date", order("newest")[0].id === 30 && order("newest").slice(-1)[0].id === 1);
check("O5 top rated: higher rating first, then more reviews (#6 4.5×7 before #5 4.5×2)", order("rating")[0].id === 6 && order("rating")[1].id === 5);
const featured = order("featured");
const firstSoldOut = featured.findIndex(p => !p.stock);
check("O6 featured: every in-stock product before every sold-out one", featured.slice(firstSoldOut).every(p => !p.stock) && firstSoldOut === 28);
check("O7 featured: Bestseller, then New, then the rest (in stock)", featured[0].badge === "Bestseller" && featured[1].badge === "Bestseller" && featured[2].badge === "New");

/* ---------- pagination ---------- */
const pg1 = run(""), pg3 = run("?page=3"), pg99 = run("?page=99");
check("P1 12 per page: 30 products → 3 pages, 1–12 on page 1", C.PAGE_SIZE === 12 && pg1.pageCount === 3 && pg1.items.length === 12 && pg1.start === 1 && pg1.end === 12);
check("P2 last page holds the remainder (25–30)", pg3.items.length === 6 && pg3.start === 25 && pg3.end === 30);
check("P3 an out-of-range page is clamped to the last page", pg99.page === 3 && JSON.stringify(ids(pg99)) === JSON.stringify(ids(pg3)));
const all = [1, 2, 3].flatMap(n => ids(run(`?page=${n}`)));
check("P4 the pages together list every product exactly once", all.length === 30 && new Set(all).size === 30);

/* ---------- facets ---------- */
const fq = run("?category=men&brand=Lattafa");
check("X1 the category facet ignores the selected category (shows other categories' counts)", fq.facets.categories.unisex === 1 && fq.facets.categories.men === 2, fq.facets.categories);
check("X2 the brand facet ignores the selected brand", fq.facets.brands.Afnan === 2 && fq.facets.brands.Lattafa === 2, fq.facets.brands);
check("X3 price facet counts use sale prices", run("").facets.price["under-300"] === run("?price=under-300", 100).total);
check("X4 in-stock and scent facets", run("").facets.inStock === 28 && run("").facets.scent.amber === 2 && run("").facets.scent.woody === 1);

/* ---------- suggestions ---------- */
const sg = C.suggest(PRODUCTS, "lat");
check("G1 brand suggestion by prefix with its product count", sg.brands.length === 1 && sg.brands[0].name === "Lattafa" && sg.brands[0].count === 3, sg.brands);
check("G2 category suggestion from a shopper's word ('wom' → Women)", C.suggest(PRODUCTS, "wom").categories.some(c => c.key === "women" && c.count === 2));
check("G3 product suggestions are capped at 5 and in-stock first", C.suggest(PRODUCTS, "filler").products.length === 5 && C.suggest(PRODUCTS, "oud").products.slice(-1)[0].id === 8);
check("G4 typo tolerance: 'latafa' → did you mean Lattafa", C.suggest(PRODUCTS, "latafa").didYouMean === "Lattafa");
check("G5 no 'did you mean' for short or unrelated input", C.suggest(PRODUCTS, "zz").didYouMean === null && C.suggest(PRODUCTS, "qwertyuiop").didYouMean === null);
check("G6 an empty query suggests nothing", JSON.stringify(C.suggest(PRODUCTS, "   ")) === JSON.stringify({ brands: [], categories: [], products: [], didYouMean: null }));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
