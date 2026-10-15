/* ============================================
   NeoFragrances — motion.js
   Lightweight scroll-reveal (replaces the AOS
   library). Reveals [data-reveal] and legacy
   [data-aos] elements once as they enter the
   viewport. Optional stagger: data-reveal-delay="1..6".

   Content is only hidden when html.js is set and
   the visitor has not asked for reduced motion
   (see css/components.css), so nothing stays
   invisible if this script fails to load.

   For content rendered after load, call
   nfReveal(containerElement).
   ============================================ */

const NF_REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let nfRevealObserver = null;

function nfRevealTargets(root) {
  return (root || document).querySelectorAll("[data-reveal]:not(.is-visible), [data-aos]:not(.is-visible)");
}

function nfReveal(root) {
  const targets = nfRevealTargets(root);
  if (NF_REDUCED_MOTION || !("IntersectionObserver" in window)) {
    targets.forEach(el => el.classList.add("is-visible"));
    return;
  }
  if (!nfRevealObserver) {
    nfRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        nfRevealObserver.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }
  targets.forEach(el => nfRevealObserver.observe(el));
}

document.addEventListener("DOMContentLoaded", () => nfReveal(document));
