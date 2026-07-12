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

  it("rejects a completely invalid/forged session cookie on a real API route", async () => {
    const s = anonymousSession();
    const res = await s.fetch("/api/customers", {
      headers: { Cookie: "authjs.session-token=this-is-not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
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

  // NOT a fix: the session callback re-checks `role` but never re-checks
  // `active`. Deactivating a user only blocks their *next login* -- an
  // already-issued session keeps working until it naturally expires.
  it.fails("deactivating a user should immediately revoke their existing session, not just block future logins", async () => {
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
    expect(stillWorks.status).toBe(401); // currently still 200 -- the session outlives deactivation
  });
});
