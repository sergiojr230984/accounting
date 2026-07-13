import { describe, it, expect } from "vitest";
import { loginAs, anonymousSession } from "./helpers/client";

describe("login and logout", () => {
  it("rejects an unknown email with a generic error, not a 500", async () => {
    const s = anonymousSession();
    const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
    const res = await s.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "definitely-not-a-real-user@nowhere.example",
        password: "whatever",
        csrfToken: csrf,
        json: "true",
      }).toString(),
    });
    expect(res.status).toBeLessThan(500);
    expect(s.hasCookie("authjs.session-token")).toBe(false);
  });

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

  it("rejects a forged session cookie (right name, invalid value)", async () => {
    const s = anonymousSession();
    const res = await s.fetch("/api/customers", {
      headers: { Cookie: "authjs.session-token=this-is-not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("logout clears the session cookie client-side", async () => {
    const s = await loginAs("admin@lacuevita.com", "admin123");
    const csrf = (await s.getJson<{ csrfToken: string }>("/api/auth/csrf")).body.csrfToken;
    await s.fetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: csrf, json: "true" }).toString(),
    });
    expect(s.hasCookie("authjs.session-token")).toBe(false);
  });

  // Documents a real gap found in the companion authentication-security audit:
  // this app uses stateless JWT sessions with no server-side revocation, so a
  // token captured before logout keeps working until it naturally expires.
  // This is written as an `it.fails` specification of the CORRECT behavior —
  // it stays green while the bug exists, and turns red the moment someone
  // adds real session revocation, as a prompt to promote it to a normal `it`.
  it.fails(
    "a session token captured before logout should stop working after logout",
    async () => {
      const s = await loginAs("admin@lacuevita.com", "admin123");
      const csrfRes = await s.getJson<{ csrfToken: string }>("/api/auth/csrf");
      const capturedCookie = `authjs.session-token=${s.getCookie("authjs.session-token")}`;

      await s.fetch("/api/auth/signout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrfToken: csrfRes.body.csrfToken, json: "true" }).toString(),
      });

      const replay = anonymousSession();
      const res = await replay.fetch("/api/customers", { headers: { Cookie: capturedCookie } });
      expect(res.status).toBe(401); // currently still 200 — the token remains valid post-logout
    }
  );
});
