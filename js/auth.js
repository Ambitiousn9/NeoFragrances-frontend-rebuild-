/* ============================================
   NeoFragrances — auth.js (Phase 4 + email verification)
   Handles real Register/Login against the API,
   and stores the returned token + user info so
   the site can tell if someone is logged in.

   Relies on API_BASE, which is already defined
   in main.js — make sure main.js loads first.
   ============================================ */

const AUTH_KEY = "neofragrances_auth";

function saveAuth(token, user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
}

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY));
  } catch (e) {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function isLoggedIn() {
  return !!getAuth()?.token;
}

/**
 * Registers a new account. Since accounts now require email verification
 * before they can log in, the server does NOT return a token here — it
 * returns { requiresVerification: true, message }. This function does
 * NOT call saveAuth() anymore; the caller (validation.js) is responsible
 * for showing the "check your email" message and redirecting to login.
 *
 * Returns: { requiresVerification: true, message, email }
 */
async function registerUser({ fullName, email, phone, password }) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email, phone, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed.");

  // No token on registration anymore — verification is required first.
  return {
    requiresVerification: true,
    message: data.message || "Please check your email to verify your address before logging in.",
    email,
  };
}

/**
 * Logs a user in. If the account exists but hasn't verified its email yet,
 * the server responds 403 with { error, requiresVerification: true }.
 * We surface that on the thrown Error (err.requiresVerification / err.email)
 * so the UI can offer a "resend verification email" action instead of a
 * generic "wrong password" message.
 */
async function loginUser({ email, password }) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || "Login failed.");
    if (data.requiresVerification) {
      err.requiresVerification = true;
      err.email = email;
    }
    throw err;
  }

  saveAuth(data.token, data.user);
  return data.user;
}

/**
 * Asks the server to send a fresh verification link. The server always
 * responds with the same generic message (whether or not the account
 * exists / is already verified), so we just surface that message as-is.
 */
async function resendVerificationEmail(email) {
  const res = await fetch(`${API_BASE}/api/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not resend verification email.");
  return data.message || "If that email needs verifying, we've sent a new verification link.";
}

function logoutUser() {
  clearAuth();
  window.location.href = "index.html";
}

/* ---------- Authenticated requests + expired sessions ----------
   nfAuthFetch adds the saved token. If the server says the session is no
   longer valid (401), the stale login is cleared and the customer is sent to
   the login page, returning to the current page afterwards. */
function nfLoginRedirectUrl() {
  const here = (window.location.pathname.split("/").pop() || "index.html") + window.location.search + window.location.hash;
  return `login.html?redirect=${encodeURIComponent(here)}&expired=1`;
}

function nfHandleExpiredSession() {
  clearAuth();
  window.location.replace(nfLoginRedirectUrl());
}

async function nfAuthFetch(path, options = {}) {
  const auth = getAuth();
  if (!auth || !auth.token) { nfHandleExpiredSession(); throw new Error("Not logged in"); }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}), Authorization: `Bearer ${auth.token}` },
  });
  if (res.status === 401) { nfHandleExpiredSession(); throw new Error("Session expired"); }
  return res;
}

// Keeps the saved user (shown in the header/drawer) in sync after a profile change.
function updateSavedUser(changes) {
  const auth = getAuth();
  if (!auth) return;
  saveAuth(auth.token, { ...auth.user, ...changes });
}
function updateAccountNav() {
  const auth = getAuth();
  if (!auth || !auth.user) return;

  try {
    const mobileItems = document.querySelectorAll(".mobile-account-item");
    const loginItem = Array.from(mobileItems).find(li => li.querySelector('a[href="login.html"]'));

    if (loginItem) {
      loginItem.innerHTML = `<div style="padding:4px 0; font-weight:700; color:var(--ink);">${escapeHtml(auth.user.full_name)}</div>`;

      const accountLi = document.createElement("li");
      accountLi.className = "mobile-account-item";
      accountLi.innerHTML = `<a href="my-account.html"><i class="fa-regular fa-id-badge"></i>&nbsp;My Account</a>`;
      loginItem.after(accountLi);

      const ordersItem = Array.from(mobileItems).find(li => li.querySelector('a[href="my-account.html#orders"]'));
      if (ordersItem && !document.getElementById("mobile-logout-btn")) {
        const logoutLi = document.createElement("li");
        logoutLi.className = "mobile-account-item";
        logoutLi.innerHTML = `<a href="#" id="mobile-logout-btn" style="color:#C0392B; font-weight:600;"><i class="fa-solid fa-arrow-right-from-bracket"></i>&nbsp;Logout</a>`;
        ordersItem.after(logoutLi);
        document.getElementById("mobile-logout-btn").addEventListener("click", (e) => {
          e.preventDefault();
          if (confirm("Log out of your account?")) logoutUser();
        });
      }
    }
  } catch (err) {
    console.error("Mobile account nav update failed:", err);
  }

  try {
    document.querySelectorAll('.nav-icons a[href="login.html"]').forEach(icon => {
      icon.href = "my-account.html";
      icon.title = auth.user.full_name;
      const i = icon.querySelector("i");
      if (i) { i.classList.remove("fa-regular"); i.classList.add("fa-solid"); }
    });
  } catch (err) {
    console.error("Desktop icon update failed:", err);
  }
}
document.addEventListener("DOMContentLoaded", updateAccountNav);
