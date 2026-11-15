/* ============================================
   NeoFragrances — not-found.js (404.html only)
   Netlify serves 404.html for any missing path, including
   nested ones such as /old/page. The shared header, footer,
   drawer and search suggestions use relative links and image
   paths ("products.html", "images/..."), which would then
   resolve under the wrong folder. The storefront CSP has
   base-uri 'none', so a <base> element is not an option;
   instead every relative href/src is made root-absolute,
   including markup added after load.
   Loaded in <head> so it is in place before layout.js runs.
   ============================================ */
(function () {
  // Relative = not absolute ("/..."), not a scheme ("https:", "mailto:", "tel:", "data:") and not a fragment.
  const isRelative = v => !!v && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(v);

  function fix(root) {
    if (!root || root.nodeType !== 1) return;
    const nodes = root.matches("a[href], img[src]") ? [root] : [];
    root.querySelectorAll("a[href], img[src]").forEach(n => nodes.push(n));
    nodes.forEach(n => {
      const attr = n.tagName === "A" ? "href" : "src";
      const v = n.getAttribute(attr);
      if (isRelative(v)) n.setAttribute(attr, "/" + v.replace(/^\.\//, ""));
    });
  }

  new MutationObserver(records => {
    records.forEach(r => {
      if (r.type === "attributes") fix(r.target);
      else r.addedNodes.forEach(fix);
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src"] });

  document.addEventListener("DOMContentLoaded", () => fix(document.body));
})();
