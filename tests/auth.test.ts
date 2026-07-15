import { describe, it, expect } from "vitest";
import { loginAs, anonymousSession } from "./helpers/client";
import { BASE_URL } from "./setup/global-setup";

describe("login and logout", () => {
  it("rejects a wrong password and does not issue a session cookie", async () => {
    const s = anonymousSession();
    const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
    await s.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "admin@lacuevita.com",
        password: "wrong-password",
        csrfToken: csrf,
        json: "true",
      }).toString(),
    });
    expect(s.hasCookie("authjs.session-token")).toBe(false);
  });

  it("accepts correct credentials and grants access to a protected API route", async () => {
    const s = await loginAs("admin@lacuevita.com", "admin123");
    expect(s.hasCookie("authjs.session-token")).toBe(true);
    const { status } = await s.getJson("/api/customers");
    expect(status).toBe(200);
  });

  // Fixed: the login lookup used a case-sensitive exact match on email while
  // every other email lookup in this app (session role refresh, SALES
  // employee scoping) is case-insensitive. A user typing their email with
  // different casing than stored -- autocapitalized by a mobile keyboard, or
  // just habit -- got an opaque CredentialsSignin failure despite a correct
  // password.
  it("logs in successfully when the email is typed with different casing than stored", async () => {
    const s = await loginAs("Admin@Lacuevita.com", "admin123");
    expect(s.hasCookie("authjs.session-token")).toBe(true);
    const { status } = await s.getJson("/api/customers");
    expect(status).toBe(200);
  });

  it("rejects a completely invalid/forged session cookie on a real API route", async () => {
    const s = anonymousSession();
    const res = await s.fetch("/api/customers", {
      headers: { Cookie: "authjs.session-token=this-is-not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  // Fixed: NextAuth's JWT-strategy default session lifetime is 30 days --
  // far too long a window for a session with access to customer/bank/
  // financial data. lib/auth.ts now sets an explicit 12-hour maxAge.
  it("a new session expires in roughly 12 hours, not the 30-day default", async () => {
    const s = await loginAs("admin@lacuevita.com", "admin123");
    const { body } = await s.getJson<{ expires: string }>("/api/auth/session");
    const hoursFromNow = (new Date(body.expires).getTime() - Date.now()) / 3_600_000;
    expect(hoursFromNow).toBeGreaterThan(11);
    expect(hoursFromNow).toBeLessThan(13);
  });
});

describe("security headers", () => {
  // Fixed: next.config.ts now sets Content-Security-Policy and
  // Strict-Transport-Security alongside the four headers that were already
  // present (X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  // Permissions-Policy). Verified against a real production build (this
  // suite runs against `next dev`, where the CSP intentionally allows
  // 'unsafe-eval' for React Refresh -- a dev-only requirement, not present
  // in production) with a real browser: login, invoice list, and dashboard
  // all render with zero CSP console violations.
  it("responses include CSP and HSTS headers", async () => {
    const res = await fetch(`${BASE_URL}/login`);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });
});

describe("health check endpoints", () => {
  // /api/health is Railway's liveness probe -- deliberately always 200 (a
  // dependency-free check) so a transient DB blip doesn't trigger a Railway
  // restart loop. DB status is still reported in the response body.
  it("/api/health returns 200 with DB status in the body", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db.ok).toBe(true);
  });

  // Fixed: /api/health/full is the endpoint DEPLOYMENT.md documents for
  // external uptime monitoring specifically because it's supposed to fail
  // its HTTP status on a real DB outage -- it previously always returned
  // 200 just like /api/health, silently defeating that purpose. The 200
  // case (DB reachable) is what this shared test server can safely assert;
  // the 503 case was verified manually against a server pointed at a
  // genuinely unreachable DB host, since simulating a real outage inside
  // this suite would take down the same database every other test file
  // depends on.
  it("/api/health/full returns 200 when the DB is reachable", async () => {
    const res = await fetch(`${BASE_URL}/api/health/full`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db.ok).toBe(true);
  });
});

describe("CSRF defense-in-depth", () => {
  // Fixed: middleware.ts now rejects a mutating API request whose Origin
  // (or Referer, if Origin is absent) names a different host than the one
  // the request arrived on. Live-tested in an earlier audit: a forged
  // Origin header alone was enough to create a real customer, because the
  // only defense was SameSite=Lax on the cookie -- real, but a single
  // point of failure. This is a second, independent layer.
  it("rejects a mutating request with a forged cross-origin Origin header, even with a valid session cookie", async () => {
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const res = await admin.fetch("/api/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil-attacker.example",
        Referer: "https://evil-attacker.example/csrf.html",
      },
      body: JSON.stringify({ name: "CSRF Origin Test Co" }),
    });
    expect(res.status).toBe(403);
  });

  it("still allows a same-origin mutating request through", async () => {
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const res = await admin.fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      body: JSON.stringify({ name: "Legit Same-Origin Co" }),
    });
    expect(res.status).toBe(201);
  });

  it("login itself is unaffected -- /api/auth/** is excluded so NextAuth's own CSRF token still governs it", async () => {
    const s = anonymousSession();
    const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
    await s.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil-attacker.example" },
      body: new URLSearchParams({
        email: "admin@lacuevita.com",
        password: "admin123",
        csrfToken: csrf,
        json: "true",
      }).toString(),
    });
    expect(s.hasCookie("authjs.session-token")).toBe(true);
  });
});

describe("login timing does not reveal account existence", () => {
  // Fixed: authorize() now runs a real bcrypt.compare against a dummy hash
  // for both an unknown email and a wrong password, instead of short-
  // circuiting immediately for the unknown-email case. Averages a handful
  // of samples each way with a generous tolerance, since exact timing is
  // inherently noisy -- the property being asserted is "roughly the same
  // order of magnitude", not an exact match. Previously this gap measured
  // ~7-10x (known ~500-640ms vs unknown ~56-72ms) in the original audit.
  it("an unknown email takes roughly as long to reject as a known email with a wrong password", async () => {
    // Uses a disposable throwaway account, not the shared seeded admin
    // account -- 5 wrong-password attempts here would otherwise eat into
    // admin@lacuevita.com's per-email rate-limit budget (max 10 per 15
    // minutes, added in the previous fix) that every other test file's
    // beforeAll depends on to log in.
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const knownEmail = `timing-test-${Date.now()}@test.local`;
    await admin.postJson("/api/users", { name: "Timing Test", email: knownEmail, password: "timingTest123", role: "SALES" });

    const attemptTiming = async (email: string): Promise<number> => {
      const s = anonymousSession();
      const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
      const start = Date.now();
      await s.fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password: "wrong-password-xyz", csrfToken: csrf, json: "true" }).toString(),
      });
      return Date.now() - start;
    };

    const SAMPLES = 5;
    const knownTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      knownTimes.push(await attemptTiming(knownEmail));
      unknownTimes.push(await attemptTiming(`nonexistent-${Date.now()}-${i}@test.local`));
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const knownAvg = avg(knownTimes);
    const unknownAvg = avg(unknownTimes);

    // The old gap was ~7-10x; require the unknown-email path to cost at
    // least half of the known-email path, which the old vulnerable code
    // would fail by a wide margin.
    expect(unknownAvg).toBeGreaterThan(knownAvg * 0.5);
  });
});

describe("login rate limiting", () => {
  // Fixed: lib/auth.ts now throttles login attempts per submitted email
  // (and separately per IP) before ever touching the database or bcrypt.
  // Uses a disposable throwaway account rather than the shared seeded admin
  // account, so exhausting its rate-limit budget here doesn't lock out
  // every other test file's beforeAll login for the rest of the suite run
  // (the limiter is in-memory and lives for the whole server process).
  it("throttles repeated failed attempts against the same account, even with the correct password", async () => {
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const email = `rate-limit-test-${Date.now()}@test.local`;
    const password = "correctHorseBattery9";
    await admin.postJson("/api/users", { name: "Rate Limit Test", email, password, role: "SALES" });

    const attempt = async (attemptedPassword: string) => {
      const s = anonymousSession();
      const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
      await s.fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password: attemptedPassword, csrfToken: csrf, json: "true" }).toString(),
      });
      return s;
    };

    // Exhaust the per-email budget (max 10 within the window) with wrong passwords.
    for (let i = 0; i < 10; i++) await attempt("wrong-password");

    // The account is now throttled -- even the correct password is rejected,
    // proving this isn't just "wrong credentials" but an active block.
    const stillBlocked = await attempt(password);
    expect(stillBlocked.hasCookie("authjs.session-token")).toBe(false);
  });
});

describe("middleware is cookie-presence-only, not signature validation (by design, per code comment)", () => {
  // The forged cookie above correctly fails at the *route* layer (auth()
  // validates the JWT). But middleware.ts only checks that a cookie with
  // the right name exists before letting a request through to the route at
  // all -- this test documents that gap precisely: routes with weak or
  // absent authorization logic of their own are reachable by anyone who
  // can send a cookie named right, with no valid session behind it.
  it("a forged cookie passes middleware and reaches route handlers that don't call auth() themselves", async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: "authjs.session-token=garbage-not-a-real-jwt" },
    });
    expect(res.status).toBe(200); // the route runs; it just reports sessionExists:false internally
    const body = await res.json();
    expect(body.sessionExists).toBe(false);
  });
});

describe("critical: unauthenticated-in-practice admin endpoints", () => {
  // Fixed: this diagnostic endpoint used to report whether AUTH_SECRET was
  // set and its exact character length to anyone with a forged cookie (no
  // real login at all). The env.authSecretLength/authSecretSet fields are
  // removed entirely; the rest of the diagnostic endpoint (session/viewer
  // shape, cookie names) is left as-is since it doesn't reveal anything an
  // unauthenticated forged-cookie caller couldn't already see was absent.
  it("/api/me should not leak AUTH_SECRET length to an unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: "authjs.session-token=garbage-not-a-real-jwt" },
    });
    const body = await res.json();
    expect(body.env?.authSecretLength).toBeUndefined();
    expect(body.env).toBeUndefined();
  });

  // Fixed by removal: this route had no auth() call at all and returned
  // every user's email + role to anyone with a forged cookie, re-promoting
  // hardcoded emails to ADMIN as a side effect. It had no legitimate caller
  // anywhere in the app (confirmed by a repo-wide reference search) and
  // init-db.ts already performs the same admin force-promotion at boot, so
  // the route was deleted rather than gated.
  it("/api/admin/bootstrap no longer exists", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/bootstrap`, {
      headers: { Cookie: "authjs.session-token=garbage-not-a-real-jwt" },
    });
    expect(res.status).toBe(404);
  });

  // Fixed by removal: this endpoint accepted AUTH_SECRET itself -- the same
  // secret that signs every session JWT -- as a URL query-string bearer
  // token, and on match reset admin@lacuevita.com's password to a hardcoded
  // literal returned in plaintext. Deleted rather than patched, since a
  // secure version needs a real, independent credential rather than a
  // reused signing secret, which isn't a minimal fix. The safety-net role
  // this was meant to serve (recovering a fully-locked-out admin) is still
  // covered by lib/init-db.ts's boot-time zero-admin fallback.
  it("/api/admin/reset-admin-password no longer exists", async () => {
    const res = await fetch(
      `${BASE_URL}/api/admin/reset-admin-password?token=${encodeURIComponent(
        process.env.AUTH_SECRET ?? ""
      )}`,
      { headers: { Cookie: "authjs.session-token=garbage-not-a-real-jwt" } }
    );
    expect(res.status).toBe(404);
  });
});

describe("session revocation", () => {
  // A real fix vs. the prior `main`-branch audit: the session callback
  // re-reads `role` from the database on every request, so a role change
  // (e.g. demotion) takes effect on the demoted user's very next request,
  // not just at their next login.
  it("a role change takes effect immediately, without the affected user logging in again", async () => {
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const created = await admin.postJson<{ id: string }>("/api/users", {
      name: "Role Change Test",
      email: "rolechange@test.local",
      password: "roleChange123",
      role: "SALES",
    });

    const target = await loginAs("rolechange@test.local", "roleChange123");
    const before = await target.getJson("/api/employees"); // SALES-accessible
    expect(before.status).toBe(200);

    await admin.postJson(`/api/users/${created.body.id}`, { role: "ADMIN" }, "PATCH");

    // Same still-live session, no re-login -- should now see admin-only data.
    const after = await target.getJson("/api/users");
    expect(after.status).toBe(200); // would be 403 if the role change hadn't propagated
  });

  // Fixed: the session callback now re-checks `active` on every session
  // read, the same way it already re-checks `role`, so deactivating a user
  // revokes their existing session immediately rather than only blocking
  // their next login.
  it("deactivating a user immediately revokes their existing session, not just future logins", async () => {
    const admin = await loginAs("admin@lacuevita.com", "admin123");
    const created = await admin.postJson<{ id: string }>("/api/users", {
      name: "Deactivate Test",
      email: "deactivate@test.local",
      password: "deactivate123",
      role: "MANAGER",
    });

    const target = await loginAs("deactivate@test.local", "deactivate123");
    await admin.postJson(`/api/users/${created.body.id}`, { active: false }, "PATCH");

    const stillWorks = await target.getJson("/api/customers");
    expect(stillWorks.status).toBe(401);
  });
});
