// Password minimum of 8 characters on every storefront form that sets a password (G-9).
//
// The backend refuses fewer than 8 characters at registration, password reset and
// password change. These pages must say and check the same thing, so a customer is told
// before the request is sent. This runs the REAL validation code in a Node vm sandbox:
// validateField() from js/validation.js with the rules initRegisterValidation() passes for
// the password, the new-password guard line from changePassword() in js/account.js and
// the length guard from js/password-reset.js. It also checks the hints and minlength
// attributes. The login form is deliberately NOT checked for a minimum: accounts whose
// passwords were set under the old 6-character rule must still be able to sign in.
// No browser, server, network or database is used. Nothing on disk is modified.
//
// Run: node tests/password-minimum-tests.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const VALIDATION = read("js/validation.js");
const ACCOUNT = read("js/account.js");
const RESET_JS = read("js/password-reset.js");
const REGISTER = read("register.html");
const RESET_HTML = read("reset-password.html");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : `  [${JSON.stringify(detail)}]`}`); }
}

// Extracts a top-level function declaration by brace matching.
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return "";
}

// ---------- registration: js/validation.js ----------
const register = extractFunction(VALIDATION, "initRegisterValidation");
const pwRules = [...register.matchAll(/\(passwordInput, (\{[^}]*\})\)/g)].map(m => m[1]);
check("V1 initRegisterValidation validates the password with minLength 8, live and on submit", pwRules.length === 2 && pwRules.every(r => /minLength: 8\b/.test(r)), pwRules);

const validateSrc = extractFunction(VALIDATION, "validateField");
function runValidate(value, rules) {
  const ctx = { input: { value }, rules, shown: null, cleared: false, out: null };
  vm.createContext(ctx);
  vm.runInContext(`function showFieldError(i, m) { shown = m; } function clearFieldError() { cleared = true; }
    function isValidEmail() { return true; } function isValidPhone() { return true; }
    ${validateSrc}
    out = validateField(input, rules);`, ctx);
  return ctx;
}
const ruleObj = pwRules[0] ? vm.runInNewContext(`(${pwRules[0]})`) : { required: true };
const r7 = runValidate("Abcdef1", ruleObj), r8 = runValidate("Abcdef12", ruleObj), r6 = runValidate("Abcde1", ruleObj);
check("V2 the real validateField with the register rules refuses 7 characters: 'Must be at least 8 characters.'", r7.out === false && r7.shown === "Must be at least 8 characters.", { out: r7.out, shown: r7.shown });
check("V3 ...refuses 6 characters (the old minimum)", r6.out === false && /at least 8/.test(String(r6.shown)), { out: r6.out, shown: r6.shown });
check("V4 ...accepts exactly 8 characters", r8.out === true && r8.cleared === true && r8.shown === null, { out: r8.out, shown: r8.shown });
check("V5 register.html tells the customer: 'At least 8 characters.'", /id="reg-password-hint">At least 8 characters\.</.test(REGISTER));

const login = extractFunction(VALIDATION, "initLoginValidation");
check("V6 the login form applies no minimum length (older 6-character passwords still sign in)", !!login && !/minLength/.test(login));

// ---------- password change: js/account.js ----------
const guard = (ACCOUNT.match(/^\s*if \(next\.length < \d+\) return fieldError\(.*$/m) || [""])[0].trim();
function runGuard(next) {
  const ctx = { next, form: {}, calls: [], out: undefined };
  vm.createContext(ctx);
  vm.runInContext(`function fieldError(form, field, message) { calls.push({ field, message }); return "refused"; }
    out = (function () { ${guard} return "passed"; })();`, ctx);
  return ctx;
}
check("A1 changePassword has a single-line new-password length guard", !!guard, guard);
const c7 = guard ? runGuard("Abcdef1") : {}, c8 = guard ? runGuard("Abcdef12") : {};
check("A2 the real guard refuses 7 characters on the newPassword field with 'at least 8 characters'",
  c7.out === "refused" && c7.calls.length === 1 && c7.calls[0].field === "newPassword" && /at least 8 characters/.test(c7.calls[0].message), c7.calls);
check("A3 ...and lets exactly 8 characters through", c8.out === "passed" && c8.calls.length === 0, c8.calls);
check("A4 the new and confirm inputs carry minlength=\"8\" and the hint says 'At least 8 characters.'",
  /k !== "current" \? 'minlength="8"'/.test(ACCOUNT) && /id="pw-hint">At least 8 characters\.</.test(ACCOUNT));

// ---------- password reset: js/password-reset.js + reset-password.html ----------
const resetGuard = RESET_JS.match(/if \(password\.length < (\d+)\) \{\s*resultEl\.innerHTML = `[^`]*Password must be at least (\d+) characters\.[^`]*`;\s*return;\s*\}/);
check("P1 the reset form refuses fewer than 8 characters and says 'at least 8 characters'", !!resetGuard && resetGuard[1] === "8" && resetGuard[2] === "8", resetGuard && resetGuard.slice(1));
if (resetGuard) {
  const runReset = password => vm.runInNewContext(`(function () { let resultEl = { innerHTML: "" }; ${resetGuard[0]} return "passed"; })()`, { password });
  check("P2 the real reset guard refuses 7 characters and lets exactly 8 through", runReset("Abcdef1") === undefined && runReset("Abcdef12") === "passed");
} else check("P2 the real reset guard refuses 7 characters and lets exactly 8 through", false, "guard not found");
check("P3 reset-password.html: both password inputs carry minlength=\"8\" and the hint says 'At least 8 characters.'",
  (RESET_HTML.match(/minlength="8"/g) || []).length === 2 && /id="rp-password-hint">At least 8 characters\.</.test(RESET_HTML));

// ---------- nothing still states the old rule ----------
const OLD = /minLength: 6\b|minlength="6"|length < 6\b|at least 6 char/i;
const stale = { "js/validation.js": VALIDATION, "js/account.js": ACCOUNT, "js/password-reset.js": RESET_JS, "register.html": REGISTER, "reset-password.html": RESET_HTML };
const left = Object.entries(stale).filter(([, s]) => OLD.test(s)).map(([f]) => f);
check("N1 no form still states or checks the old 6-character minimum", left.length === 0, left);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
