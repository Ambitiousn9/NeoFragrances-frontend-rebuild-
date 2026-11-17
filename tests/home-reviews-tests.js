// Homepage customer reviews (R11, owner decisions D15): data source, thresholds and card markup.
//
// Runs the REAL js/home.js, with the REAL escapeHtml from js/main.js, in a Node vm sandbox. A fake
// fetch stands in for GET /api/reviews/highlights and a few fake elements for the page. Checks:
// 0 reviews → hidden, 1–2 → static grid, 3+ → the moving strip; every star rating is kept (no 4–5
// filter); reviews without text are dropped; names and comments are escaped; decorative copies
// are hidden from assistive technology with untabbable links; failures leave the section hidden;
// and index.html carries the Pause/Play button and the strip container. The moving strip itself
// (speed, seamless loop, pause, reduced motion) is checked in a real browser, not here.
// No browser, server, network or database. Nothing on disk is modified.
//
// Run: node tests/home-reviews-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

const ROOT = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
const HOME = fs.readFileSync(path.join(ROOT, "js", "home.js"), "utf8");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const escapeSrc = (MAIN.match(/^function escapeHtml\(value\) \{[\s\S]*?\n\}/m) || [""])[0];

function sandbox(response) {
  const els = {};
  const el = id => ({ id, hidden: true, innerHTML: "", attrs: {}, removed: false,
    setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } });
  ["reviews", "review-grid", "reviews-marquee", "reviews-toggle"].forEach(i => { els[i] = el(i); });
  const calls = [];
  const ctx = {
    console: { error: () => {} },
    API_BASE: "http://api.test",
    document: { addEventListener: () => {}, getElementById: id => els[id] || null },
    window: { addEventListener: () => {} },
    fetch: async url => {
      calls.push(url);
      if (response === "throw") throw new TypeError("Failed to fetch");
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${escapeSrc}\n${HOME}`, ctx);
  const spy = { marquee: null, static: null };
  ctx.homeRenderReviewMarquee = list => { spy.marquee = list; };
  const realStatic = ctx.homeRenderStaticReviews;
  ctx.homeRenderStaticReviews = list => { spy.static = list; realStatic(list); };
  ctx.homeRevealIn = () => {};
  return { ctx, els, calls, spy };
}
const R = (id, rating, comment, extra = {}) => ({ id, rating, comment, verified: false, reviewer: `Reviewer ${id}`, product: { id: 100 + id, name: `Product ${id}` }, created_at: "2026-11-01T10:00:00Z", ...extra });

/* ---------- thresholds (D15) ---------- */
const s0 = sandbox({ status: 200, body: { total: 0, reviews: [] } });
check("T1 thresholds: 0 → hidden, 1 → static, 2 → static, 3 → marquee, 24 → marquee",
  ["hidden", "static", "static", "marquee", "marquee"].join() === [0, 1, 2, 3, 24].map(n => s0.ctx.homeReviewsMode(n)).join());

(async () => {
  await s0.ctx.homeLoadReviews();
  check("T2 0 eligible reviews: the section stays hidden and nothing is rendered", s0.els.reviews.hidden === true && s0.els["review-grid"].innerHTML === "" && !s0.spy.marquee && !s0.spy.static);
  check("T3 the data comes from GET /api/reviews/highlights only", JSON.stringify(s0.calls) === JSON.stringify(["http://api.test/api/reviews/highlights"]));

  const s2 = sandbox({ status: 200, body: { total: 2, reviews: [R(1, 2, "Not for me"), R(2, 5, "Lovely")] } });
  await s2.ctx.homeLoadReviews();
  const grid = s2.els["review-grid"];
  check("T4 two reviews: a static grid (role=list) is shown, no moving strip", s2.els.reviews.hidden === false && !!s2.spy.static && !s2.spy.marquee && grid.attrs.role === "list" && (grid.innerHTML.match(/role="listitem"/g) || []).length === 2);
  check("T5 a 2-star review is shown too (no 4–5 star filter)", /Not for me/.test(grid.innerHTML) && /2 out of 5 stars/.test(grid.innerHTML));
  check("T6 the static grid keeps the Pause/Play button and the strip hidden", s2.els["reviews-toggle"].hidden === true && s2.els["reviews-marquee"].hidden === true);

  const s3 = sandbox({ status: 200, body: { total: 4, reviews: [R(1, 1, "One star, honest"), R(2, 3, "Fine"), R(3, 5, "Great"), R(4, 4, "   ")] } });
  await s3.ctx.homeLoadReviews();
  check("T7 three reviews with text → the moving strip, with every rating kept and a blank comment dropped",
    s3.spy.marquee && s3.spy.marquee.length === 3 && s3.spy.marquee.map(r => r.rating).join() === "1,3,5" && !s3.spy.static, s3.spy.marquee && s3.spy.marquee.map(r => r.id));

  for (const [label, resp] of [["a 500", { status: 500, body: { error: "x" } }], ["a network failure", "throw"], ["an unexpected body", { status: 200, body: { nope: true } }]]) {
    const sx = sandbox(resp);
    await sx.ctx.homeLoadReviews();
    check(`T8 ${label} leaves the section hidden`, sx.els.reviews.hidden === true && !sx.spy.marquee && !sx.spy.static);
  }

  /* ---------- card markup ---------- */
  const evil = R(9, 4, `<script>alert("x")</script> & "quotes"`, { reviewer: `<img src=x onerror=alert(1)>Ama`, verified: true, product: { id: 7, name: `Oud <b>Royale</b>` } });
  const card = s0.ctx.homeReviewCardHTML(evil);
  check("C1 reviewer name, comment and product name are escaped", card.includes("&lt;img src=x onerror=alert(1)&gt;Ama") && card.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;") && card.includes("Oud &lt;b&gt;Royale&lt;/b&gt;") && !/<script|<img|<b>/.test(card));
  check("C2 the star rating is announced once (role=img with a label), icons hidden", /role="img" aria-label="4 out of 5 stars"/.test(card) && (card.match(/fa-star"/g) || []).length === 4 && (card.match(/is-empty/g) || []).length === 1);
  check("C3 verified purchase badge only when the server says so", /Verified purchase/.test(card) && !/Verified purchase/.test(s0.ctx.homeReviewCardHTML(R(1, 5, "x"))));
  check("C4 the product link points at the product page", card.includes('href="product-details.html?id=7"'));
  const deco = s0.ctx.homeReviewCardHTML(evil, { decorative: true });
  check("C5 a decorative copy has no listitem role and an untabbable product link", !/role="listitem"/.test(deco) && /tabindex="-1"/.test(deco) && /role="listitem"/.test(card) && !/tabindex/.test(card));
  check("C6 a missing reviewer name falls back to 'Customer'; a missing product shows no link", /<strong>Customer<\/strong>/.test(s0.ctx.homeReviewCardHTML({ rating: 5, comment: "x" })) && !/href=/.test(s0.ctx.homeReviewCardHTML({ rating: 5, comment: "x" })));
  check("C7 an out-of-range rating is clamped for display (7 → 5 stars, -2 → 0)", /5 out of 5 stars/.test(s0.ctx.homeReviewCardHTML(R(1, 7, "x"))) && /0 out of 5 stars/.test(s0.ctx.homeReviewCardHTML(R(1, -2, "x"))));

  /* ---------- source checks ---------- */
  check("S1 home.js no longer reads per-product reviews or the stored review totals", !/\/api\/products\/\$\{[^}]*\}\/reviews/.test(HOME) && !/reviewCount/.test(HOME));
  check("S2 home.js has no rating filter", !/rating\)?\s*>=\s*4/.test(HOME));
  check("S3 speed and threshold constants: 30 px/s, minimum 3", /const HOME_REVIEWS_PX_PER_SECOND = 30;/.test(HOME) && /const HOME_REVIEWS_MARQUEE_MIN = 3;/.test(HOME));
  check("S4 reviews load on DOMContentLoaded, independent of the catalogue", /homeLoadOffers\(\);\s*\n\s*homeLoadReviews\(\);/.test(HOME) && !/homeRenderCollections\(\);\s*\n\s*homeLoadReviews\(\);/.test(HOME));
  const section = (INDEX.match(/<section class="nf-section nf-reviews"[\s\S]*?<\/section>/) || [""])[0];
  check("S5 index.html: the section starts hidden, between the notes section and the service strip", /id="reviews"[^>]*hidden/.test(section) && INDEX.indexOf('nf-story') < INDEX.indexOf('id="reviews"') && INDEX.indexOf('id="reviews"') < INDEX.indexOf('nf-service'));
  check("S6 index.html: a real <button> Pause/Play control (type=button, hidden until needed) and the strip container",
    /<button type="button" class="nf-reviews-toggle" id="reviews-toggle" aria-controls="reviews-marquee" hidden>/.test(section) && /id="reviews-marquee" hidden/.test(section));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
