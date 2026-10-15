/* ============================================
   NeoFragrances — catalog.js
   Pure product-discovery logic (no DOM): URL state,
   search scoring, filters, facet counts, sorting and
   pagination.

   Everything goes through NFCatalog.query(products, state)
   so the products page never depends on HOW results are
   produced. Today it runs in the browser over PRODUCTS;
   if the catalog grows large, the same state object can be
   sent to a paginated API endpoint instead (?q=&category=
   &brand=&price=&stock=&sort=&page=) without changing the UI.

   Depends on (main.js): SCENT_FAMILIES, nfEffectivePrice
   (falls back to the regular price if not loaded).
   ============================================ */

const NFCatalog = (() => {
  const PAGE_SIZE = 12;

  // Bands chosen from the real price distribution (median ≈ GH₵350, most
  // products GH₵250–500, a long tail up to ≈ GH₵8,500) so each band narrows
  // the catalog meaningfully. Bands with no matching products are hidden.
  const PRICE_BANDS = [
    { key: "under-300", label: "Under GH₵300", min: 0, max: 300 },
    { key: "300-400", label: "GH₵300 – GH₵400", min: 300, max: 400 },
    { key: "400-500", label: "GH₵400 – GH₵500", min: 400, max: 500 },
    { key: "500-1000", label: "GH₵500 – GH₵1,000", min: 500, max: 1000 },
    { key: "1000-plus", label: "GH₵1,000 and above", min: 1000, max: Infinity },
  ];

  const SORTS = [
    { key: "featured", label: "Featured" },
    { key: "newest", label: "Newest" },
    { key: "price-asc", label: "Price: low to high" },
    { key: "price-desc", label: "Price: high to low" },
    { key: "rating", label: "Top rated" },
    { key: "name", label: "Name: A to Z" },
  ];

  const CATEGORY_LABELS = { men: "Men", women: "Women", unisex: "Unisex" };
  // Words shoppers type that mean a category.
  const CATEGORY_ALIASES = {
    men: ["men", "mens", "man", "male", "him", "homme", "masculine"],
    women: ["women", "womens", "woman", "female", "her", "ladies", "femme", "feminine"],
    unisex: ["unisex", "shared", "everyone"],
  };

  // scentInvalid: a ?scent= value that isn't one of the four families (it shows a
  // "family not found" state, never the whole catalogue). scentRaw keeps that value
  // for the URL only, so a refresh keeps the same state; it is never rendered.
  const DEFAULT_STATE = Object.freeze({ q: "", category: "", brands: [], price: "", inStock: false, scent: "", scentInvalid: false, scentRaw: "", sort: "featured", page: 1 });

  /* ---------- helpers ---------- */
  function normalize(value) {
    return String(value || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")   // strip accents
      .toLowerCase()
      .replace(/['’]/g, "")                                // women's → womens
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function categoryLabel(key) {
    return CATEGORY_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
  }

  function priceOf(p) {
    return typeof nfEffectivePrice === "function" ? nfEffectivePrice(p) : p.price;
  }

  function hasScentData(products) {
    return products.some(p => p.scentFamily);
  }

  function categoryForToken(token) {
    return Object.keys(CATEGORY_ALIASES).find(c => CATEGORY_ALIASES[c].includes(token)) || null;
  }

  /* ---------- search scoring ----------
     Every query token must match the product somewhere (name, brand or a
     category word). Higher scores for whole-word and prefix matches. */
  function scoreProduct(p, tokens) {
    if (tokens.length === 0) return 1;
    const name = normalize(p.name);
    const brand = normalize(p.brand);
    const nameWords = name.split(" ");
    const brandWords = brand.split(" ");
    let score = 0;
    for (const t of tokens) {
      let best = 0;
      if (nameWords.includes(t)) best = Math.max(best, 6);
      else if (nameWords.some(w => w.startsWith(t))) best = Math.max(best, 4);
      else if (name.includes(t)) best = Math.max(best, 2);
      if (brandWords.includes(t)) best = Math.max(best, 5);
      else if (brandWords.some(w => w.startsWith(t))) best = Math.max(best, 3);
      else if (brand.includes(t)) best = Math.max(best, 1);
      if (categoryForToken(t) === p.category) best = Math.max(best, 2);
      if (best === 0) return 0;
      score += best;
    }
    if (name.startsWith(tokens.join(" "))) score += 3;
    return score;
  }

  function tokenize(q) {
    return normalize(q).split(" ").filter(Boolean);
  }

  /* ---------- URL state ---------- */
  function parseState(search, products) {
    const params = new URLSearchParams(search);
    const state = { ...DEFAULT_STATE, brands: [] };

    state.q = (params.get("q") || "").trim().slice(0, 80);

    const category = (params.get("category") || "").toLowerCase();
    if (products.some(p => p.category === category)) state.category = category;

    // Brands: repeated ?brand= params, matched case-insensitively to real brands.
    const brandNames = [...new Set(products.map(p => p.brand))];
    params.getAll("brand").forEach(raw => {
      const match = brandNames.find(b => b.toLowerCase() === String(raw).trim().toLowerCase());
      if (match && !state.brands.includes(match)) state.brands.push(match);
    });

    const price = params.get("price") || "";
    if (PRICE_BANDS.some(b => b.key === price)) state.price = price;

    state.inStock = params.get("stock") === "in";

    // Scent family: one of the four keys (case-insensitive) is always honoured, even while
    // no product is classified yet (that family simply has no results). Anything else that
    // is present — unknown, legacy, empty or space-padded — is marked invalid instead of
    // being dropped, so it can never fall back to showing the whole catalogue.
    const rawScent = params.get("scent");
    if (rawScent !== null) {
      const scent = rawScent.toLowerCase();
      if (typeof SCENT_FAMILIES !== "undefined" && SCENT_FAMILIES.some(f => f.key === scent)) state.scent = scent;
      else { state.scentInvalid = true; state.scentRaw = rawScent.slice(0, 40); }
    }

    const sort = params.get("sort") || "";
    if (SORTS.some(s => s.key === sort)) state.sort = sort;

    const page = parseInt(params.get("page"), 10);
    state.page = Number.isInteger(page) && page > 0 ? page : 1;
    return state;
  }

  function serializeState(state) {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.category) params.set("category", state.category);
    state.brands.forEach(b => params.append("brand", b));
    if (state.price) params.set("price", state.price);
    if (state.inStock) params.set("stock", "in");
    if (state.scent) params.set("scent", state.scent);
    else if (state.scentInvalid) params.set("scent", state.scentRaw || "");
    if (state.sort && state.sort !== "featured") params.set("sort", state.sort);
    if (state.page > 1) params.set("page", String(state.page));
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  function activeFilterCount(state) {
    return (state.q ? 1 : 0) + (state.category ? 1 : 0) + state.brands.length + (state.price ? 1 : 0) + (state.inStock ? 1 : 0) + (state.scent || state.scentInvalid ? 1 : 0);
  }

  /* ---------- filtering ---------- */
  function passes(p, state, scores, skip) {
    if (skip !== "q" && state.q && !(scores.get(p.id) > 0)) return false;
    if (skip !== "category" && state.category && p.category !== state.category) return false;
    if (skip !== "brands" && state.brands.length && !state.brands.includes(p.brand)) return false;
    if (skip !== "price" && state.price) {
      const band = PRICE_BANDS.find(b => b.key === state.price);
      const price = priceOf(p);
      if (band && !(price >= band.min && price < band.max)) return false;
    }
    if (skip !== "inStock" && state.inStock && !p.stock) return false;
    if (skip !== "scent" && state.scent && p.scentFamily !== state.scent) return false;
    if (skip !== "scent" && state.scentInvalid) return false; // unknown family: no results, never everything
    return true;
  }

  const BADGE_RANK = { Bestseller: 2, New: 1 };
  function sortProducts(list, sort, scores, hasQuery) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    const sorted = [...list];
    switch (sort) {
      case "newest":
        sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || byName(a, b)); break;
      case "price-asc":
        sorted.sort((a, b) => priceOf(a) - priceOf(b) || byName(a, b)); break;
      case "price-desc":
        sorted.sort((a, b) => priceOf(b) - priceOf(a) || byName(a, b)); break;
      case "rating":
        sorted.sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount || byName(a, b)); break;
      case "name":
        sorted.sort(byName); break;
      default: // featured: best search match, then in stock, then curated badges
        sorted.sort((a, b) =>
          (hasQuery ? (scores.get(b.id) || 0) - (scores.get(a.id) || 0) : 0) ||
          Number(b.stock) - Number(a.stock) ||
          (BADGE_RANK[b.badge] || 0) - (BADGE_RANK[a.badge] || 0) ||
          byName(a, b));
    }
    return sorted;
  }

  /* ---------- main entry point ---------- */
  function query(products, state, pageSize = PAGE_SIZE) {
    const tokens = tokenize(state.q);
    const scores = new Map(products.map(p => [p.id, scoreProduct(p, tokens)]));

    const matched = products.filter(p => passes(p, state, scores));
    const sorted = sortProducts(matched, state.sort, scores, tokens.length > 0);

    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, state.page), pageCount);   // clamp out-of-range pages
    const startIndex = (page - 1) * pageSize;
    const items = sorted.slice(startIndex, startIndex + pageSize);

    // Facet counts: each facet ignores its own selection so options stay discoverable.
    const facetBase = skip => products.filter(p => passes(p, state, scores, skip));
    const countBy = (list, keyFn) => list.reduce((acc, p) => { const k = keyFn(p); if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const facets = {
      categories: countBy(facetBase("category"), p => p.category),
      brands: countBy(facetBase("brands"), p => p.brand),
      price: PRICE_BANDS.reduce((acc, band) => {
        acc[band.key] = facetBase("price").filter(p => { const v = priceOf(p); return v >= band.min && v < band.max; }).length;
        return acc;
      }, {}),
      inStock: facetBase("inStock").filter(p => p.stock).length,
      scent: countBy(facetBase("scent"), p => p.scentFamily),
    };

    return {
      items, total, page, pageCount, pageSize,
      start: total ? startIndex + 1 : 0,
      end: Math.min(startIndex + pageSize, total),
      facets,
    };
  }

  /* ---------- search suggestions ---------- */
  function levenshtein(a, b) {
    if (a === b) return 0;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length];
  }

  function suggest(products, rawQuery, limits = { brands: 3, categories: 2, products: 5 }) {
    const tokens = tokenize(rawQuery);
    const result = { brands: [], categories: [], products: [], didYouMean: null };
    if (tokens.length === 0) return result;
    const q = tokens.join(" ");

    const brandCounts = {};
    products.forEach(p => { brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1; });
    result.brands = Object.keys(brandCounts)
      .filter(b => normalize(b).split(" ").some(w => w.startsWith(q)) || normalize(b).startsWith(q))
      .sort((a, b) => brandCounts[b] - brandCounts[a])
      .slice(0, limits.brands)
      .map(b => ({ name: b, count: brandCounts[b] }));

    result.categories = Object.keys(CATEGORY_ALIASES)
      .filter(c => CATEGORY_ALIASES[c].some(a => a.startsWith(q)) && products.some(p => p.category === c))
      .slice(0, limits.categories)
      .map(c => ({ key: c, label: categoryLabel(c), count: products.filter(p => p.category === c).length }));

    result.products = products
      .map(p => ({ p, s: scoreProduct(p, tokens) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.p.stock) - Number(a.p.stock) || a.p.name.localeCompare(b.p.name))
      .slice(0, limits.products)
      .map(x => x.p);

    // Typo tolerance: if nothing matched, offer the closest brand or name word.
    if (!result.brands.length && !result.products.length && q.length >= 3) {
      const candidates = new Set();
      products.forEach(p => {
        candidates.add(p.brand);
        normalize(p.name).split(" ").filter(w => w.length >= 4).forEach(w => candidates.add(w));
      });
      let best = null;
      candidates.forEach(c => {
        const d = levenshtein(q, normalize(c));
        const allowed = q.length >= 7 ? 2 : 1;
        if (d <= allowed && (!best || d < best.d)) best = { term: c, d };
      });
      if (best) result.didYouMean = best.term;
    }
    return result;
  }

  return {
    PAGE_SIZE, PRICE_BANDS, SORTS, DEFAULT_STATE,
    normalize, categoryLabel, hasScentData,
    parseState, serializeState, activeFilterCount,
    query, suggest,
  };
})();
