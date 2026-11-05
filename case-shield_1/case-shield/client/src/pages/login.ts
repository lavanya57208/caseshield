import { api, ApiError } from "../api.js";
import { setSession } from "../state.js";
import { navigate } from "../router.js";
import { icon, logoMark } from "../components/icons.js";

export async function renderLogin(content: HTMLElement) {
  content.innerHTML = `
    <div class="login-screen">
      <div class="login-visual">
        <div>
          <div class="brand-row">
            ${logoMark(34)}
            <div>
              <div class="brand-name">CASE SHIELD</div>
              <div class="brand-sub">Secure Legal &amp; Investigation Document Management</div>
            </div>
          </div>
          <h1 style="margin-top:48px;">A controlled, auditable workspace for case documents and evidence.</h1>
        </div>
        <div class="pillars">
          <div class="pillar">
            <div class="label">${icon("lock", 15)} Secure Authentication</div>
            <div class="desc">Session-based sign-in, scoped to your role and assigned cases.</div>
          </div>
          <div class="pillar">
            <div class="label">${icon("shield", 15)} Protected Access</div>
            <div class="desc">Every document and evidence view is authorization-checked server-side.</div>
          </div>
          <div class="pillar">
            <div class="label">${icon("audit", 15)} Audit-Ready Activity</div>
            <div class="desc">Logins, views, downloads and approvals are recorded to a tamper-evident log.</div>
          </div>
        </div>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <div class="brand-row-mobile"></div>
          <h2>Sign in</h2>
          <p class="sub">Enter your credentials to access Case Shield.</p>
          <div data-el="error"></div>
          <form data-el="login-form">
            <div class="field">
              <label for="employeeId">Employee ID / Username</label>
              <input id="employeeId" name="employeeId" type="text" autocomplete="username" placeholder="e.g. INV-1001" required />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
            </div>
            <div class="field-row">
              <label><input type="checkbox" name="remember" /> Remember me</label>
              <a href="#" data-el="forgot">Forgot password?</a>
            </div>
            <button class="btn btn-primary" type="submit" data-el="submit">Login</button>
            <button class="btn btn-secondary" type="button" data-el="sso">Government SSO</button>
          </form>
          <div class="login-security-note">
            Access Case Shield only through your organization's approved URL. This is a demonstration
            prototype - it does not represent a live government deployment.
            <div class="login-security-labels">
              <span class="chip">${icon("lock", 13)} Secure Authentication</span>
              <span class="chip">${icon("shield", 13)} Protected Access</span>
              <span class="chip">${icon("audit", 13)} Audit-Ready Activity</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const form = content.querySelector<HTMLFormElement>('[data-el="login-form"]')!;
  const errorEl = content.querySelector<HTMLElement>('[data-el="error"]')!;
  const submitBtn = content.querySelector<HTMLButtonElement>('[data-el="submit"]')!;

  content.querySelector('[data-el="forgot"]')!.addEventListener("click", (e) => {
    e.preventDefault();
    errorEl.innerHTML = `<div class="banner banner-info">${icon("info", 15)} Password reset isn't wired up in this prototype. Contact your system administrator.</div>`;
  });

  content.querySelector('[data-el="sso"]')!.addEventListener("click", () => {
    errorEl.innerHTML = `<div class="banner banner-info">${icon("info", 15)} Government SSO is an integration placeholder - connect a real identity provider to enable it.</div>`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.innerHTML = "";
    const fd = new FormData(form);
    const employeeId = String(fd.get("employeeId") || "").trim();
    const password = String(fd.get("password") || "");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      const result = await api.post<{ token: string; user: any }>("/auth/login", { employeeId, password });
      setSession(result.token, result.user);
      navigate("/dashboard");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unable to sign in. Please try again.";
      errorEl.innerHTML = `<div class="form-error">${message}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
    }
  });
}
