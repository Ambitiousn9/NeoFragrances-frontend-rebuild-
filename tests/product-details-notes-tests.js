// Product page never shows placeholder notes (P3.4).
//
// The catalogue uses "—" and "???" as note placeholders. Before this fix the product page
// treated "???" as real, so 15 products showed "???" note cards and the generated line
// "built around ???". This runs the REAL pdRealNote / notesComplete lines from the inline
// script in product-details.html in a Node vm sandbox, and checks the markup around them.
// No browser, server, network or database is used. Nothing on disk is modified.
//
// Run: node tests/product-details-notes-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PAGE = fs.readFileSync(path.join(__dirname, "..", "product-details.html"), "utf8");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

const realLine = (PAGE.match(/^\s*const pdRealNote = .*$/m) || [""])[0];
const completeLine = (PAGE.match(/^\s*const notesComplete = .*$/m) || [""])[0];
check("S1 the page defines pdRealNote and notesComplete on single lines", !!realLine && !!completeLine, { realLine, completeLine });

// Evaluate exactly those two lines for a given product.
function evaluate(notes) {
  const ctx = { p: { notes }, out: null };
  vm.createContext(ctx);
  vm.runInContext(`${realLine}\n${completeLine}\nout = { real: pdRealNote, complete: notesComplete };`, ctx);
  return ctx.out;
}
const isReal = v => evaluate(null).real(v);
const complete = (top, middle, base) => evaluate({ top, middle, base }).complete;

// ---------- single values ----------
const placeholders = ["—", "???", "??", "?", "", "   ", " — ", "-", "--", "?? ", "Rose??", "??? Bergamot", null, undefined, 0, {}];
const wrong = placeholders.filter(v => isReal(v));
check(`N1 none of ${placeholders.length} placeholder, empty, non-text or "??"-tainted values counts as a real note`, wrong.length === 0, wrong);
const real = ["Bergamot", "Lemon, Bergamot", "Oud", "Rose · Jasmine", "Ambroxan", "Vanilla & Tonka", "Pink pepper (Piper nigrum)", "Fleur d'oranger", "Ylang-ylang", "Accord 7"];
const missed = real.filter(v => !isReal(v));
check(`N2 all ${real.length} real note texts count as real (including accents, punctuation and digits)`, missed.length === 0, missed);

// ---------- whole products, as the catalogue stores them ----------
check("P1 a product with all three notes '???' is NOT complete (the 15 '???' products)", complete("???", "???", "???") === false);
check("P2 a product with all three notes '—' is NOT complete (the 145 '—' products)", complete("—", "—", "—") === false);
check("P3 a product with no notes at all (NULL) is NOT complete", complete(null, null, null) === false && evaluate(null).complete === false && evaluate(undefined).complete === false);
check("P4 a product with real notes is complete", complete("Bergamot, Pink Pepper", "Rose, Jasmine", "Oud, Amber") === true);
check("P5 one placeholder among real notes makes it NOT complete", complete("Bergamot", "???", "Amber") === false && complete("Bergamot", "Rose", "—") === false);
check("P6 notesComplete is always a boolean", [evaluate(null).complete, complete("a", "b", "c"), complete("???", "x", "y")].every(v => typeof v === "boolean"));

// ---------- the markup that depends on it ----------
check("M1 the generated 'built around …' description is used only when notesComplete is true",
  /:\s*notesComplete\s*\n\s*\?\s*`A \$\{p\.category\} fragrance built around/.test(PAGE));
check("M2 the note cards are rendered only when notesComplete is true, otherwise the 'not added yet' message",
  /\$\{notesComplete \? `\s*<div class="pd-notes-grid">/.test(PAGE) && /Fragrance notes haven't been added for this product yet\./.test(PAGE));
check("M3 note text is HTML-escaped when shown", (PAGE.match(/escapeHtml\(p\.notes\.(top|middle|base)\)/g) || []).length === 3);
check("M4 no other '!== \"—\"'-style placeholder check is left on the page", !/notes\.(top|middle|base) !== "—"/.test(PAGE));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
