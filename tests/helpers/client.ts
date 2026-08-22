import { BASE_URL } from "../setup/global-setup";

/**
 * A minimal cookie-jar-aware HTTP client for driving the real app over real
 * HTTP, the same way a browser or curl would — so tests exercise actual
 * middleware, actual auth() calls, and actual route handlers.
 */
export class TestSession {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private captureCookies(res: Response) {
    const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) headers.set("Cookie", this.cookieHeader());
    const res = await fetch(`${BASE_URL}${pathname}`, { ...init, headers, redirect: "manual" });
    this.captureCookies(res);
    return res;
  }

  async getJson<T = unknown>(pathname: string): Promise<{ status: number; body: T }> {
    const res = await this.fetch(pathname);
    const body = (await res.json().catch(() => null)) as T;
    return { status: res.status, body };
  }

  async postJson<T = unknown>(
    pathname: string,
    data: unknown,
    method: "POST" | "PATCH" | "DELETE" = "POST"
  ): Promise<{ status: number; body: T }> {
    const res = await this.fetch(pathname, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = (await res.json().catch(() => null)) as T;
    return { status: res.status, body };
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** Logs in via the real NextAuth credentials flow — CSRF token then callback POST. */
export async function loginAs(email: string, password: string): Promise<TestSession> {
  const session = new TestSession();
  const csrfRes = await session.getJson<{ csrfToken: string }>("/api/auth/csrf");
  const csrfToken = csrfRes.body.csrfToken;

  await session.fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password, csrfToken, json: "true" }).toString(),
  });

  return session;
}

/** A session with no login performed at all — for unauthenticated-access tests. */
export function anonymousSession(): TestSession {
  return new TestSession();
}
