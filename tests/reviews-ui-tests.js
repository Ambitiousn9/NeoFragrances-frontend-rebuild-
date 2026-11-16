// Product-page reviews (js/reviews.js): rendering, writing and editing (roadmap R8, updated for R3).
//
// Runs the REAL js/reviews.js, with the REAL escapeHtml from js/main.js, in a Node vm sandbox. A
// small fake page stands in for the DOM: assigning innerHTML creates fresh elements for every id in
// the markup (with a textarea's text and a select's selected option as their values), so re-renders
// behave like a browser's. A fake fetch answers by method and path and records what was sent.
// Checks: escaping of names and comments, the Verified Purchase badge, empty states, averages, the
// signed-out prompt, the labelled form (R2), the 1,000-character comment limit and counter, the
// submit flow (success, server error, expired session, network failure), and R3's one-review-per-
// product flow (own review shown with Edit, editing through PUT, Cancel, 409 on a second submission).
// No browser, server, network or database. Nothing on disk is modified.
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
const unescape = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function page() {
  const els = {};
  function el(id) {
    const listeners = {};
    const e = {
      id, textContent: "", value: "", disabled: false, style: {}, _html: "",
      get innerHTML() { return this._html; },
      set innerHTML(html) {
        this._html = html;
        for (const m of html.matchAll(/<(\w+)\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
          const child = el(m[2]);
          if (m[1] === "textarea") child.value = unescape((html.slice(m.index + m[0].length).match(/^([\s\S]*?)<\/textarea>/) || ["", ""])[1]);
          if (m[1] === "select") child.value = ((html.slice(m.index).match(/<option value="([^"]+)" selected>/) || html.slice(m.index).match(/<option value="([^"]+)"/)) || ["", ""])[1];
          if (m[1] === "button") child.textContent = (html.slice(m.index + m[0].length).match(/^([^<]*)</) || ["", ""])[1].trim();
          els[m[2]] = child;
        }
      },
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
      fire: async type => { for (const fn of listeners[type] || []) await fn({}); },
    };
    return e;
  }
  ["reviews-summary", "reviews-list", "review-form-wrap"].forEach(i => { els[i] = el(i); });
  return els;
}

// routes: { "GET /api/products/42/reviews/mine": [responses...] | response }, response = { status, body } or "throw".
function sandbox({ loggedIn = false, routes = {} } = {}) {
  const els = page();
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
      const method = opts.method || "GET";
      const key = `${method} ${url.replace("http://api.test", "")}`;
      calls.push({ key, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
      let r = routes[key];
      if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
      if (r === "throw") throw new TypeError("Failed to fetch");
      if (!r) r = { status: 404, body: { error: "not routed" } };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    },
  };
  ctx.TypeError = TypeError; // so `err instanceof TypeError` inside the sandbox matches the error thrown above
  vm.createContext(ctx);
  vm.runInContext(`${escapeSrc}\n${REVIEWS}`, ctx);
  return { ctx, els, calls, expired: () => expired, $: id => els[id] };
}
const MINE = "GET /api/products/42/reviews/mine", LIST = "GET /api/products/42/reviews", POST = "POST /api/products/42/reviews", PUT = "PUT /api/products/42/reviews/mine";
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- rendering the public list ---------- */
const evil = { full_name: `<img src=x onerror=alert(1)>Ama`, comment: `<script>alert("x")</script> & "quotes"`, rating: 5, is_verified_purchase: 1, created_at: "2026-11-01T10:00:00Z" };
const plain = { full_name: "Kofi", comment: null, rating: 3, is_verified_purchase: 0, created_at: "2026-11-02T10:00:00Z" };
let s = sandbox();
s.ctx.renderReviewsList([evil, plain]);
const listHtml = s.$("reviews-list").innerHTML;
check("R1 a reviewer name containing markup is escaped, never rendered as HTML", listHtml.includes("&lt;img src=x onerror=alert(1)&gt;Ama") && !listHtml.includes("<img"));
check("R2 a comment containing a script tag, ampersand and quotes is escaped", listHtml.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;") && !/<script/i.test(listHtml));
check("R3 Verified Purchase badge only on the review the server flagged", (listHtml.match(/Verified Purchase/g) || []).length === 1 && listHtml.indexOf("Verified Purchase") < listHtml.indexOf("Kofi"));
check("R4 a review without a comment renders no empty comment paragraph", (listHtml.match(/<p /g) || []).length === 1);
const goldStars = h => (h.match(/var\(--gold\)/g) || []).length;
check("R5 star icons follow the rating (5 + 3 = 8 gold of 10)", goldStars(listHtml) === 8);
s.ctx.renderReviewsList([]);
check("R6 no reviews → the invitation to write the first one", /No reviews yet/.test(s.$("reviews-list").innerHTML));
s.ctx.renderReviewsSummary([evil, plain]);
check("R7 summary: average of the listed reviews and plural count (4.0, 2 reviews)", /4\.0/.test(s.$("reviews-summary").innerHTML) && /\(2 reviews\)/.test(s.$("reviews-summary").innerHTML));
s.ctx.renderReviewsSummary([plain]);
check("R8 summary: singular for one review", /\(1 review\)/.test(s.$("reviews-summary").innerHTML));
s.ctx.renderReviewsSummary([]);
check("R9 summary with no reviews shows 0.0 and (0 reviews), never NaN", /0\.0/.test(s.$("reviews-summary").innerHTML) && /\(0 reviews\)/.test(s.$("reviews-summary").innerHTML) && !/NaN/.test(s.$("reviews-summary").innerHTML));
check("R10 star rounding: 4.5 shows 5 gold stars, 4.4 shows 4", goldStars(s.ctx.starIcons(4.5)) === 5 && goldStars(s.ctx.starIcons(4.4)) === 4);

(async () => {
  /* ---------- signed out ---------- */
  s = sandbox({ loggedIn: false });
  await s.ctx.renderReviewForm(42);
  check("F1 signed out: a log-in prompt instead of the form, and no request for 'my review'", /href="login\.html"/.test(s.$("review-form-wrap").innerHTML) && !/review-rating/.test(s.$("review-form-wrap").innerHTML) && s.calls.length === 0);

  /* ---------- signed in, no review yet: the blank form ---------- */
  s = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: null } }, [POST]: { status: 201, body: { success: true, isVerified: false } }, [LIST]: { status: 200, body: [plain] } } });
  await s.ctx.renderReviewForm(42);
  const formHtml = s.$("review-form-wrap").innerHTML;
  check("F2 signed in: asks the server for this customer's own review, with the bearer token", s.calls[0] && s.calls[0].key === MINE && s.calls[0].headers.Authorization === "Bearer tok-123", s.calls[0]);
  check("F3 no review yet → 'Write a Review' form; Rating and Comment labels tied to their fields (R2)", /Write a Review/.test(formHtml) && /<label for="review-rating">Rating<\/label>/.test(formHtml) && /<label for="review-comment">Comment<\/label>/.test(formHtml));
  check("F4 the result message is a polite status region", /id="review-msg" role="status" aria-live="polite"/.test(formHtml));
  check("F5 ratings 1–5 offered, 5 first and selected", (formHtml.match(/<option value="[1-5]"( selected)?>/g) || []).join("") === '<option value="5" selected><option value="4"><option value="3"><option value="2"><option value="1">');
  check("F6 the comment box is limited to 1,000 characters and described by a counter", /maxlength="1000"/.test(formHtml) && /aria-describedby="review-count"/.test(formHtml) && /0 \/ 1,000 characters/.test(formHtml));
  s.$("review-comment").value = "Lovely";
  await s.$("review-comment").fire("input");
  check("F7 the counter follows what is typed", s.$("review-count").textContent === "6 / 1,000 characters", s.$("review-count").textContent);

  s.$("review-rating").value = "4";
  s.$("review-comment").value = "  Lovely scent  ";
  await s.$("submit-review-btn").fire("click");
  const post = s.calls.find(c => c.key === POST) || {};
  check("T1 submit POSTs to /api/products/42/reviews with the bearer token", post.key === POST && post.headers.Authorization === "Bearer tok-123", post);
  check("T2 the body carries a numeric rating and the trimmed comment only", JSON.stringify(post.body) === JSON.stringify({ rating: 4, comment: "Lovely scent" }), post.body);
  check("T3 success: list reloaded from the server, and the thank-you message shown with the customer's review", s.calls.some(c => c.key === LIST) && /Kofi/.test(s.$("reviews-list").innerHTML) && s.$("review-msg").textContent === "Thanks for your review!" && /Your Review/.test(s.$("review-form-wrap").innerHTML));
  check("T4 after submitting, the form becomes the customer's review with an Edit button (no second blank form)", !!s.$("edit-review-btn") && /Lovely scent/.test(s.$("review-form-wrap").innerHTML) && !/Write a Review/.test(s.$("review-form-wrap").innerHTML));

  const e = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: null } }, [POST]: { status: 400, body: { error: "Rating must be a whole number from 1 to 5.", field: "rating" } } } });
  await e.ctx.renderReviewForm(42); e.$("review-comment").value = "x";
  await e.$("submit-review-btn").fire("click");
  check("T5 a server error is shown, nothing is reloaded, the button is usable again", e.$("review-msg").textContent === "Rating must be a whole number from 1 to 5." && !e.calls.some(c => c.key === LIST) && e.$("submit-review-btn").disabled === false && e.$("submit-review-btn").textContent === "Submit Review");

  const x = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: null } }, [POST]: { status: 401, body: { error: "expired" } } } });
  await x.ctx.renderReviewForm(42);
  await x.$("submit-review-btn").fire("click");
  check("T6 a 401 on submit ends the session instead of showing a form error", x.expired() === 1 && x.$("review-msg").textContent === "");

  const n = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: null } }, [POST]: "throw" } });
  await n.ctx.renderReviewForm(42);
  await n.$("submit-review-btn").fire("click");
  check("T7 a network failure shows a plain message (not 'Failed to fetch') and re-enables the button", /couldn't reach the server/.test(n.$("review-msg").textContent) && !/Failed to fetch/.test(n.$("review-msg").textContent) && n.$("submit-review-btn").disabled === false);

  const long = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: null } } } });
  await long.ctx.renderReviewForm(42); long.$("review-comment").value = "y".repeat(1001);
  await long.$("submit-review-btn").fire("click");
  check("T8 a comment over 1,000 characters is stopped before anything is sent", /1,000 characters or fewer/.test(long.$("review-msg").textContent) && !long.calls.some(c => c.key === POST));

  const dup = sandbox({ loggedIn: true, routes: {
    [MINE]: [{ status: 200, body: { review: null } }, { status: 200, body: { review: { rating: 2, comment: "From the other tab", hidden: 0 } } }],
    [POST]: { status: 409, body: { error: "You've already reviewed this fragrance. You can edit your review instead.", code: "REVIEW_EXISTS" } } } });
  await dup.ctx.renderReviewForm(42);
  await dup.$("submit-review-btn").fire("click");
  check("T9 409 REVIEW_EXISTS (e.g. reviewed in another tab): shows that existing review with Edit and the server's message",
    /From the other tab/.test(dup.$("review-form-wrap").innerHTML) && !!dup.$("edit-review-btn") && /already reviewed/.test(dup.$("review-msg").textContent));

  const exp = sandbox({ loggedIn: true, routes: { [MINE]: { status: 401, body: {} } } });
  await exp.ctx.renderReviewForm(42);
  check("T10 an expired session while loading the customer's review ends the session", exp.expired() === 1);

  /* ---------- signed in, already reviewed: show it, edit it ---------- */
  const mine = { id: 9, rating: 4, comment: `Warm <b>amber</b> & "vanilla"`, is_verified_purchase: 1, hidden: 0 };
  const ed = sandbox({ loggedIn: true, routes: {
    [MINE]: [{ status: 200, body: { review: mine } }, { status: 200, body: { review: { ...mine, rating: 2, comment: "Changed my mind" } } }],
    [PUT]: { status: 200, body: { success: true, isVerified: true } }, [LIST]: { status: 200, body: [] } } });
  await ed.ctx.renderReviewForm(42);
  const cardHtml = ed.$("review-form-wrap").innerHTML;
  check("E1 already reviewed → 'Your Review' with the rating, the comment (escaped) and an Edit button, no blank form",
    /Your Review/.test(cardHtml) && cardHtml.includes("Warm &lt;b&gt;amber&lt;/b&gt; &amp; &quot;vanilla&quot;") && !/<b>amber/.test(cardHtml) && /4 out of 5 stars/.test(cardHtml) && !!ed.$("edit-review-btn") && !/Write a Review/.test(cardHtml));
  await ed.$("edit-review-btn").fire("click");
  const editHtml = ed.$("review-form-wrap").innerHTML;
  check("E2 Edit → the form prefilled with their rating and comment, 'Save Changes' and 'Cancel'",
    /Edit Your Review/.test(editHtml) && ed.$("review-rating").value === "4" && ed.$("review-comment").value === mine.comment && ed.$("submit-review-btn").textContent === "Save Changes" && !!ed.$("cancel-edit-btn") && /\d+ \/ 1,000 characters/.test(editHtml));
  check("E3 the prefilled comment is escaped inside the textarea", editHtml.includes(">Warm &lt;b&gt;amber&lt;/b&gt; &amp; &quot;vanilla&quot;</textarea>"));
  ed.$("review-rating").value = "2"; ed.$("review-comment").value = " Changed my mind ";
  await ed.$("submit-review-btn").fire("click");
  const put = ed.calls.find(c => c.key === PUT) || {};
  check("E4 Save sends PUT /api/products/42/reviews/mine with the new rating and trimmed comment (no POST)", JSON.stringify(put.body) === JSON.stringify({ rating: 2, comment: "Changed my mind" }) && put.headers.Authorization === "Bearer tok-123" && !ed.calls.some(c => c.key === POST), put);
  check("E5 after saving: 'Your review has been updated.' and the card shows the new review", ed.$("review-msg").textContent === "Your review has been updated." && /Changed my mind/.test(ed.$("review-form-wrap").innerHTML) && /2 out of 5 stars/.test(ed.$("review-form-wrap").innerHTML));

  const cancel = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: mine } } } });
  await cancel.ctx.renderReviewForm(42);
  await cancel.$("edit-review-btn").fire("click");
  await cancel.$("cancel-edit-btn").fire("click");
  check("E6 Cancel returns to the customer's review without sending anything", /Your Review/.test(cancel.$("review-form-wrap").innerHTML) && cancel.calls.filter(c => c.key !== MINE).length === 0);

  const hid = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: { ...mine, hidden: 1 } } } } });
  await hid.ctx.renderReviewForm(42);
  check("E7 a review hidden by moderation tells its author it isn't shown publicly", /isn't shown publicly/.test(hid.$("review-form-wrap").innerHTML));
  const vis = sandbox({ loggedIn: true, routes: { [MINE]: { status: 200, body: { review: mine } } } });
  await vis.ctx.renderReviewForm(42);
  check("E8 a visible review shows no moderation note", !/isn't shown publicly/.test(vis.$("review-form-wrap").innerHTML));

  const fail = sandbox({ loggedIn: true, routes: { [MINE]: { status: 500, body: {} } } });
  await fail.ctx.renderReviewForm(42);
  check("E9 if the customer's review can't be checked, the blank form is shown (the server still refuses a duplicate)", /Write a Review/.test(fail.$("review-form-wrap").innerHTML));

  await tick();
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
