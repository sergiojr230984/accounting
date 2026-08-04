import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, anonymousSession, TestSession } from "./helpers/client";
import { TEST_SALES_PASSWORD } from "./setup/seed-test-fixtures";

let admin: TestSession;
let manager: TestSession;
let sales: TestSession;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  manager = await loginAs("manager@bizledger.com", "manager123");
  sales = await loginAs("sales1@test.local", TEST_SALES_PASSWORD);
});

describe("API key management — admin only", () => {
  it("MANAGER cannot create an API key", async () => {
    const { status } = await manager.postJson("/api/settings/api-keys", { label: "should fail" });
    expect(status).toBe(403);
  });

  it("SALES cannot create an API key", async () => {
    const { status } = await sales.postJson("/api/settings/api-keys", { label: "should fail" });
    expect(status).toBe(403);
  });

  it("MANAGER cannot list API keys", async () => {
    const { status } = await manager.getJson("/api/settings/api-keys");
    expect(status).toBe(403);
  });

  it("ADMIN can create a key and receives the full key exactly once", async () => {
    const { status, body } = await admin.postJson<{
      id: string;
      label: string;
      keyPrefix: string;
      key: string;
    }>("/api/settings/api-keys", { label: "Test dashboard" });
    expect(status).toBe(201);
    expect(body.label).toBe("Test dashboard");
    expect(body.key).toMatch(/^lc_live_[0-9a-f]{64}$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 16));
    expect(body.key).not.toBe(body.keyPrefix); // the prefix alone must not be the whole secret

    const list = await admin.getJson<{ id: string; keyPrefix: string }[]>("/api/settings/api-keys");
    expect(list.status).toBe(200);
    const found = list.body.find((k) => k.id === body.id);
    expect(found).toBeTruthy();
    // The list endpoint must never expose the full key again, only the prefix.
    expect(JSON.stringify(list.body)).not.toContain(body.key);
  });
});

describe("API key auth — read-only access for external apps", () => {
  let fullKey: string;
  let keyId: string;

  beforeAll(async () => {
    const { body } = await admin.postJson<{ id: string; key: string }>(
      "/api/settings/api-keys",
      { label: "Read access test key" }
    );
    fullKey = body.key;
    keyId = body.id;
  });

  it("a valid key can read the customer list with no session at all", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(res.status).toBe(200);
  });

  it("a valid key can read the dashboard (normally ADMIN/MANAGER only)", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/dashboard", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(res.status).toBe(200);
  });

  it("a valid key can read reports and the product-frequency report (normally ADMIN only)", async () => {
    const anon = anonymousSession();
    const reports = await anon.fetch("/api/reports?type=income", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(reports.status).toBe(200);

    const freq = await anon.fetch("/api/reports/frequency", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(freq.status).toBe(200);
  });

  it("also works via the X-API-Key header instead of Authorization: Bearer", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { "X-API-Key": fullKey },
    });
    expect(res.status).toBe(200);
  });

  it("a garbage/invalid key is rejected, not silently ignored into a 401 that leaks info", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: "Bearer lc_live_not_a_real_key" },
    });
    expect(res.status).toBe(401);
  });

  it("no key and no session still 401s (the feature didn't accidentally open anything)", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers");
    expect(res.status).toBe(401);
  });

  // The core safety guarantee: API-key auth is only wired into read (GET)
  // endpoints. No write path checks for a key at all, so presenting one
  // (even a valid one) can never create, edit, or delete anything.
  it("a valid key CANNOT create a customer -- write endpoints don't accept API keys at all", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${fullKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Should never be created" }),
    });
    expect(res.status).toBe(401);
  });

  it("a valid key CANNOT create a customer invoice", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/invoices/customer", {
      method: "POST",
      headers: { Authorization: `Bearer ${fullKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "whatever",
        invoiceNumber: "SHOULD-NOT-EXIST",
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "x", quantity: "1", unitPrice: "1" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("revoking a key immediately stops it from working", async () => {
    const revoke = await admin.postJson(`/api/settings/api-keys/${keyId}`, {}, "DELETE");
    expect(revoke.status).toBe(200);

    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(res.status).toBe(401);

    const list = await admin.getJson<{ id: string; active: boolean }[]>("/api/settings/api-keys");
    const found = list.body.find((k) => k.id === keyId);
    expect(found?.active).toBe(false);
  });

  it("MANAGER cannot revoke a key", async () => {
    const created = await admin.postJson<{ id: string }>("/api/settings/api-keys", {
      label: "Manager should not revoke this",
    });
    const { status } = await manager.postJson(
      `/api/settings/api-keys/${created.body.id}`,
      {},
      "DELETE"
    );
    expect(status).toBe(403);
  });
});
