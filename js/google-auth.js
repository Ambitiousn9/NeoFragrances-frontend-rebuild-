/* ============================================
   NeoFragrances — google-auth.js
   Renders the Google Sign-In button on login.html
   and register.html, and hands the resulting
   credential to the existing NeoFragrances
   auth/session system.

   Requires: js/main.js (for API_BASE) and js/auth.js
   (for saveAuth) to be loaded before this file.
   ============================================ */

let googleAuthInProgress = false;

async function loginWithGoogleCredential(credential) {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Google sign-in failed.");
  saveAuth(data.token, data.user);
  return data.user;
}

function setGoogleMsg(text, color) {
  const msg = document.getElementById("google-signin-msg");
  if (msg) {
    msg.textContent = text;
    msg.style.color = color || "var(--ink-soft)";
  }
}

function setGoogleBtnBusy(busy) {
  const wrap = document.querySelector(".google-btn-wrap");
  if (wrap) wrap.style.opacity = busy ? "0.5" : "1";
  if (wrap) wrap.style.pointerEvents = busy ? "none" : "auto";
}

async function handleGoogleSignIn(response) {
  if (googleAuthInProgress) return; // prevent duplicate requests
  if (!response || !response.credential) {
    setGoogleMsg("Google sign-in was cancelled or didn't complete.", "var(--wine)");
    return;
  }

  googleAuthInProgress = true;
  setGoogleBtnBusy(true);
  setGoogleMsg("Signing you in with Google...", "var(--ink-soft)");

  try {
    const user = await loginWithGoogleCredential(response.credential);
    setGoogleMsg(`Welcome, ${user.full_name}! Redirecting...`, "#22733B");
    const params = new URLSearchParams(window.location.search);
    const redirectTo = safeRedirectTarget(params.get("redirect"), "index.html");
    setTimeout(() => (window.location.href = redirectTo), 900);
  } catch (err) {
    setGoogleMsg(err.message || "Could not sign in with Google. Please try again.", "var(--wine)");
    setGoogleBtnBusy(false);
    googleAuthInProgress = false;
  }
}

async function initGoogleSignIn() {
  const container = document.getElementById("google-signin-btn");
  if (!container) return; // not on a page with the button (fine — email/password still works)

  if (typeof google === "undefined" || !google.accounts) {
    setGoogleMsg("Google Sign-In is unavailable right now — check your connection.", "var(--ink-soft)");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/config/google-client-id`);
    const { clientId } = await res.json();

    if (!clientId) {
      console.warn("Google Sign-In not configured on the server (missing GOOGLE_CLIENT_ID).");
      return; // fail silently — email/password login/registration still work fine
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleSignIn,
    });

    // Match the container's actual width so the button fills the card responsively
    const width = Math.min(container.parentElement?.offsetWidth || 340, 400);

    google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",       // white background, subtle border
      size: "large",
      shape: "pill",          // rounded corners
      text: "signin_with",    // "Sign in with Google"
      logo_alignment: "left",
      width,
    });
  } catch (err) {
    console.error("Could not initialize Google Sign-In:", err);
    setGoogleMsg("Google Sign-In couldn't load. Email/password login still works below.", "var(--ink-soft)");
  }
}

// The Google block (divider, button, terms) starts hidden and is only shown when
// the server reports a configured GOOGLE_CLIENT_ID. Email/password never depends on it.
let googleConfigured = false;

async function checkGoogleConfigured() {
  try {
    const res = await fetch(`${API_BASE}/api/config/google-client-id`);
    const data = res.ok ? await res.json() : {};
    return !!data.clientId;
  } catch (err) {
    return false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const block = document.getElementById("google-auth-block");
  if (!block) return;
  googleConfigured = await checkGoogleConfigured();
  if (!googleConfigured) return; // stays hidden: no empty divider, no fake button
  block.hidden = false;

  const waitForGoogle = setInterval(() => {
    if (window.google && google.accounts && google.accounts.id) {
      clearInterval(waitForGoogle);
      initGoogleSignIn();
    }
  }, 100);

  setTimeout(() => {
    clearInterval(waitForGoogle);

    if (!window.google || !google.accounts) {
      setGoogleMsg(
        "Google Sign-In could not load. Please check your internet connection.",
        "var(--ink-soft)"
      );
    }
  }, 10000);
});
window.addEventListener("resize", () => {
  if (!googleConfigured) return;
  clearTimeout(window._gsiResizeTimer);
  window._gsiResizeTimer = setTimeout(initGoogleSignIn, 300);
});