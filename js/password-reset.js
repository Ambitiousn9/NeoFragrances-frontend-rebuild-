/* ============================================
   NeoFragrances — password-reset.js
   Handles forgot-password.html and reset-password.html.

   Real, email-based flow: the backend emails the reset
   link. It is never returned in the API response and
   never rendered on screen.
   ============================================ */

function togglePasswordVisibility(btn) {
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const showing = input.type === "password";
  input.type = showing ? "text" : "password";
  btn.textContent = showing ? "Hide" : "Show";
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".auth-toggle-pw");
  if (btn) togglePasswordVisibility(btn);
});

document.addEventListener("DOMContentLoaded", () => {
  initForgotPasswordForm();
  if (document.getElementById("reset-form")) {
    initResetPasswordPage();
  }
});

/* ---------- Forgot Password ---------- */
function initForgotPasswordForm() {
  const forgotForm = document.getElementById("forgot-form");
  if (!forgotForm) return;

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("fp-email").value.trim();
    const resultEl = document.getElementById("fp-result");
    const btn = forgotForm.querySelector("button[type=submit]");

    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>&nbsp; Sending...`;
    resultEl.innerHTML = "";

    try {
      const res = await fetch(`${API_BASE}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");

      resultEl.innerHTML = `
        <div class="fp-success">
          <i class="fa-solid fa-envelope-circle-check"></i>
          <p>${escapeHtml(data.message)}</p>
        </div>`;
    } catch (err) {
      resultEl.innerHTML = `<p class="fp-error"><i class="fa-solid fa-circle-exclamation"></i>&nbsp; ${escapeHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });
}

/* ---------- Reset Password ---------- */
async function initResetPasswordPage() {
  const resetForm = document.getElementById("reset-form");
  const loadingEl = document.getElementById("rp-loading");
  const invalidWrap = document.getElementById("rp-invalid-wrap");
  const successWrap = document.getElementById("rp-success-wrap");

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  function showInvalid() {
    loadingEl.classList.add("hidden");
    resetForm.classList.add("hidden");
    invalidWrap.classList.remove("hidden");
  }

  if (!token) {
    showInvalid();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/reset-password/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    loadingEl.classList.add("hidden");

    if (!data.valid) {
      showInvalid();
      return;
    }
    resetForm.classList.remove("hidden");
  } catch (err) {
    showInvalid();
    return;
  }

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("rp-password").value;
    const confirm = document.getElementById("rp-confirm").value;
    const resultEl = document.getElementById("rp-result");
    resultEl.innerHTML = "";

    if (password.length < 6) {
      resultEl.innerHTML = `<p class="fp-error"><i class="fa-solid fa-circle-exclamation"></i>&nbsp; Password must be at least 6 characters.</p>`;
      return;
    }
    if (password !== confirm) {
      resultEl.innerHTML = `<p class="fp-error"><i class="fa-solid fa-circle-exclamation"></i>&nbsp; Passwords do not match.</p>`;
      return;
    }

    const btn = resetForm.querySelector("button[type=submit]");
    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>&nbsp; Resetting...`;

    try {
      const res = await fetch(`${API_BASE}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reset your password.");

      resetForm.classList.add("hidden");
      successWrap.classList.remove("hidden");
    } catch (err) {
      // If the token became invalid/expired/used between page-load and
      // submit (e.g. used in another tab), fall back to the same
      // full invalid-link state rather than an inline error.
      if (/invalid|expired/i.test(err.message)) {
        showInvalid();
        return;
      }
      resultEl.innerHTML = `<p class="fp-error"><i class="fa-solid fa-circle-exclamation"></i>&nbsp; ${escapeHtml(err.message)}</p>`;
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });
}
