// Product-page reviews (js/reviews.js): rendering and submission (roadmap R8).
//
// Runs the REAL js/reviews.js, with the REAL escapeHtml from js/main.js, in a Node vm sandbox. A
// minimal fake page supplies the elements reviews.js looks up by id, and a fake fetch records what
// would be sent. Checks: reviewer names and comments are escaped, the Verified Purchase badge follows
// the server's flag, the empty state, the average and singular/plural, the signed-out prompt, the
// labelled form (R2), and the submit flow (success reloads the list; a server error is shown; a 401
// ends the session). No browser, server, network or database. Nothing on disk is modified.
//
// Run: node tests/reviews-ui-tests.js
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
const escapeSrc = (MAIN.match(/^function escapeHtml\(value\) \{[\s\S]*?\n\}/m) || [""])[0];
check("S1 js/main.js defines escapeHtml", escapeSrc.length > 0);
const REVIEWS = fs.readFileSync(path.join(ROOT, "js", "reviews.js"), "utf8");

// A fake element: innerHTML/textContent/value, style, disabled and click listeners.
function el(id) {
  const listeners = {};
  return { id, innerHTML: "", textContent: "", value: "", disabled: false, style: {},
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: async type => { for (const fn of listeners[type] || []) await fn({}); } };
}

function sandbox({ loggedIn = false, responses = [] } = {}) {
  const els = {};
  const ids = ["reviews-summary", "reviews-list", "review-form-wrap", "review-rating", "review-comment", "submit-review-btn", "review-msg"];
  ids.forEach(i => { els[i] = el(i); });
  const calls = [];
  let expired = 0;
  const ctx = {
    console: { error: () => {} },
    API_BASE: "http://api.test",
    document: { getElementById: id => els[id] || null },
    isLoggedIn: () => loggedIn,
    getAuth: () => (loggedIn ? { token: "tok-123" } : null),
    nfHandleExpiredSession: () => { expired++; },
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
      const r = responses.length ? responses.shift() : { status: 200, body: [] };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${escapeSrc}\n${REVIEWS}`, ctx);
  return { ctx, els, calls, expired: () => expired };
}

/* ---------- rendering ---------- */
const evil = { full_name: `<img src=x onerror=alert(1)>Ama`, comment: `<script>alert("x")</script> & "quotes"`, rating: 5, is_verified_purchase: 1, created_at: "2026-11-01T10:00:00Z" };
const plain = { full_name: "Kofi", comment: null, rating: 3, is_verified_purchase: 0, created_at: "2026-11-02T10:00:00Z" };
let s = sandbox();
s.ctx.renderReviewsList([evil, plain]);
const listHtml = s.els["reviews-list"].innerHTML;
check("R1 a reviewer name containing markup is escaped, never rendered as HTML", listHtml.includes("&lt;img src=x onerror=alert(1)&gt;Ama") && !listHtml.includes("<img"));
check("R2 a comment containing a script tag, ampersand and quotes is escaped", listHtml.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;") && !/<script/i.test(listHtml));
check("R3 Verified Purchase badge only on the review the server flagged", (listHtml.match(/Verified Purchase/g) || []).length === 1 && listHtml.indexOf("Verified Purchase") < listHtml.indexOf("Kofi"));
check("R4 a review without a comment renders no empty comment paragraph", (listHtml.match(/<p /g) || []).length === 1);
const goldStars = h => (h.match(/var\(--gold\)/g) || []).length;
check("R5 star icons follow the rating (5 + 3 = 8 gold of 10)", goldStars(listHtml) === 8);

s.ctx.renderReviewsList([]);
check("R6 no reviews → the invitation to write the first one", /No reviews yet/.test(s.els["reviews-list"].innerHTML));

s.ctx.renderReviewsSummary([evil, plain]);
check("R7 summary: average of the listed reviews and plural count (4.0, 2 reviews)", /4\.0/.test(s.els["reviews-summary"].innerHTML) && /\(2 reviews\)/.test(s.els["reviews-summary"].innerHTML));
s.ctx.renderReviewsSummary([plain]);
check("R8 summary: singular for one review", /\(1 review\)/.test(s.els["reviews-summary"].innerHTML));
s.ctx.renderReviewsSummary([]);
check("R9 summary with no reviews shows 0.0 and (0 reviews), never NaN", /0\.0/.test(s.els["reviews-summary"].innerHTML) && /\(0 reviews\)/.test(s.els["reviews-summary"].innerHTML) && !/NaN/.test(s.els["reviews-summary"].innerHTML));
check("R10 star rounding: 4.5 shows 5 gold stars, 4.4 shows 4", goldStars(s.ctx.starIcons(4.5)) === 5 && goldStars(s.ctx.starIcons(4.4)) === 4);

/* ---------- the form ---------- */
s = sandbox({ loggedIn: false });
s.ctx.renderReviewForm(42);
check("F1 signed out: a log-in prompt instead of the form", /href="login\.html"/.test(s.els["review-form-wrap"].innerHTML) && !/review-rating/.test(s.els["review-form-wrap"].innerHTML));

s = sandbox({ loggedIn: true, responses: [{ status: 201, body: { success: true, isVerified: false } }, { status: 200, body: [plain] }] });
s.ctx.renderReviewForm(42);
const formHtml = s.els["review-form-wrap"].innerHTML;
check("F2 signed in: Rating and Comment labels are tied to their fields (R2)", /<label for="review-rating">Rating<\/label>/.test(formHtml) && /<label for="review-comment">Comment<\/label>/.test(formHtml) && /id="review-rating"/.test(formHtml) && /id="review-comment"/.test(formHtml));
check("F3 the result message is a polite status region", /id="review-msg" role="status" aria-live="polite"/.test(formHtml));
check("F4 ratings 1–5 are offered, 5 first", (formHtml.match(/<option value="[1-5]">/g) || []).join("") === '<option value="5"><option value="4"><option value="3"><option value="2"><option value="1">');

/* ---------- submitting ---------- */
(async () => {
  s.els["review-rating"].value = "4";
  s.els["review-comment"].value = "  Lovely scent  ";
  await s.els["submit-review-btn"].fire("click");
  const post = s.calls[0] || {};
  check("T1 submit POSTs to /api/products/42/reviews with the bearer token", post.method === "POST" && post.url === "http://api.test/api/products/42/reviews" && post.headers.Authorization === "Bearer tok-123", post);
  check("T2 the body carries a numeric rating and the trimmed comment only", JSON.stringify(post.body) === JSON.stringify({ rating: 4, comment: "Lovely scent" }), post.body);
  check("T3 success: thanks message, comment box cleared, list reloaded from the server", s.els["review-msg"].textContent === "Thanks for your review!" && s.els["review-comment"].value === "" && s.calls[1] && s.calls[1].method === "GET" && /Kofi/.test(s.els["reviews-list"].innerHTML));
  check("T4 the button is re-enabled afterwards", s.els["submit-review-btn"].disabled === false && s.els["submit-review-btn"].textContent === "Submit Review");

  const e = sandbox({ loggedIn: true, responses: [{ status: 400, body: { error: "Rating must be between 1 and 5." } }] });
  e.ctx.renderReviewForm(7); e.els["review-rating"].value = "5"; e.els["review-comment"].value = "x";
  await e.els["submit-review-btn"].fire("click");
  check("T5 a server error is shown to the customer and nothing is reloaded", e.els["review-msg"].textContent === "Rating must be between 1 and 5." && e.calls.length === 1 && e.els["submit-review-btn"].disabled === false);

  const x = sandbox({ loggedIn: true, responses: [{ status: 401, body: { error: "expired" } }] });
  x.ctx.renderReviewForm(7); x.els["review-rating"].value = "5";
  await x.els["submit-review-btn"].fire("click");
  check("T6 a 401 ends the session (nfHandleExpiredSession) instead of showing a form error", x.expired() === 1 && x.els["review-msg"].textContent === "");

  const n = sandbox({ loggedIn: true, responses: [] });
  n.ctx.fetch = async () => { throw new Error("offline"); };
  n.ctx.renderReviewForm(7); n.els["review-rating"].value = "5";
  await n.els["submit-review-btn"].fire("click");
  check("T7 a network failure shows a message and re-enables the button", n.els["review-msg"].textContent === "offline" && n.els["submit-review-btn"].disabled === false);

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
