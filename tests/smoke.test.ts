import { describe, it, expect } from "vitest";
import { loginAs, anonymousSession } from "./helpers/client";

describe("smoke: test harness is wired up correctly", () => {
  it("health check responds", async () => {
    const s = anonymousSession();
    const { status } = await s.getJson("/api/health");
    expect(status).toBe(200);
  });

  it("can log in as the seeded admin", async () => {
    const s = await loginAs("admin@lacuevita.com", "admin123");
    const { status } = await s.getJson("/api/customers");
    expect(status).toBe(200);
  });
});
