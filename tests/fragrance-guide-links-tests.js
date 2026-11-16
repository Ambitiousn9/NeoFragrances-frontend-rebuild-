// Fragrance Guide links never point at a missing section (P3.1, roadmap R8).
//
// The guide (learn.html) is reached from the main nav, the footer, the mobile drawer and the product
// page, which links its Concentration value and Top/Heart/Base Notes headings to glossary entries.
// This suite checks that every learn.html#… reference anywhere in the storefront, every in-page
// "#…" link inside the guide, and every glossary term id the product page can build, exists exactly
// once in learn.html; and that the three navigation entry points are present.
// Reads files only; no browser, server or network.
//
// Run: node tests/fragrance-guide-links-tests.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

const GUIDE = read("learn.html");
const idList = [...GUIDE.replace(/<!--[\s\S]*?-->/g, "").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const ids = new Set(idList);
const dupes = idList.filter((v, i) => idList.indexOf(v) !== i);
check(`G1 learn.html has ${idList.length} ids and none is duplicated`, idList.length > 0 && dupes.length === 0, dupes);

// 1. Literal learn.html#anchor links in pages and scripts.
const sources = [...fs.readdirSync(ROOT).filter(f => f.endsWith(".html")), ...fs.readdirSync(path.join(ROOT, "js")).filter(f => f.endsWith(".js")).map(f => `js/${f}`)];
const literal = [];
for (const f of sources) for (const [, a] of read(f).matchAll(/learn\.html#([A-Za-z0-9_-]+)/g)) literal.push({ f, a });
const missingLiteral = literal.filter(x => !ids.has(x.a));
check(`G2 all ${literal.length} literal learn.html#… links in the storefront point at an existing section`, literal.length >= 3 && missingLiteral.length === 0, missingLiteral);

// 2. Glossary terms the product page builds at run time (Concentration → learn.html#${concentrationTerm}).
const PDP = read("product-details.html");
const built = [...new Set([...PDP.matchAll(/"(term-[a-z0-9-]+)"/g)].map(m => m[1]))];
check("G3 the product page builds its concentration link from a term id", /href="learn\.html#\$\{concentrationTerm\}"/.test(PDP) && built.length >= 3, built);
const missingBuilt = built.filter(t => !ids.has(t));
check(`G4 every term id the product page can build exists (${built.join(", ")})`, missingBuilt.length === 0, missingBuilt);
for (const [abbr, term] of [["EDP", "term-eau-de-parfum"], ["EDT", "term-eau-de-toilette"], ["EDC", "term-eau-de-cologne"]]) {
  check(`G5 ${abbr} maps to ${term}`, new RegExp(`${abbr}: "${term}"`).test(PDP));
}
for (const t of ["term-top-notes", "term-heart-notes", "term-base-notes"]) {
  check(`G6 the product page's notes heading links to ${t}`, PDP.includes(`href="learn.html#${t}"`) && ids.has(t));
}

// 3. In-page links inside the guide itself (table of contents, A–Z glossary index).
const inPage = [...new Set([...GUIDE.matchAll(/href="#([^"]+)"/g)].map(m => m[1]))];
const missingInPage = inPage.filter(a => !ids.has(a));
check(`G7 all ${inPage.length} in-page links inside the guide point at an existing section`, inPage.length > 0 && missingInPage.length === 0, missingInPage);

// 4. Every letter the glossary A–Z index offers is followed by at least one term entry.
const letters = inPage.filter(a => /^glossary-[a-z]$/.test(a));
const termIds = idList.filter(i => i.startsWith("term-"));
const emptyLetters = letters.filter(a => {
  const at = idList.indexOf(a);
  const next = idList.findIndex((v, i) => i > at && /^glossary-[a-z]$/.test(v));
  return !idList.slice(at + 1, next < 0 ? idList.length : next).some(v => termIds.includes(v));
});
check(`G8 each of the ${letters.length} letters in the glossary index is followed by at least one term`, letters.length > 0 && emptyLetters.length === 0, emptyLetters);

// 5. Entry points: main nav, footer, mobile drawer.
const LAYOUT = read("js/layout.js"), DRAWER = read("js/mobile-drawer.js");
check("G9 main nav has the Fragrance Guide entry (key guide) and highlights it on learn.html", /\["guide", "learn\.html", "Fragrance Guide"\]/.test(LAYOUT) && /page === "learn\.html"\) return "guide"/.test(LAYOUT));
check("G10 footer links to the Fragrance Guide", /\["learn\.html", "Fragrance Guide"\]/.test(LAYOUT));
check("G11 mobile drawer links to the Fragrance Guide", /href="learn\.html"[^>]*>[\s\S]{0,80}Fragrance Guide/.test(DRAWER));

// 6. The maceration section (P4.5) and its glossary entry are reachable.
check("G12 maceration section and glossary entry exist", ids.has("maceration") && ids.has("term-maceration"));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
