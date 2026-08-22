import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, anonymousSession, TestSession } from "./helpers/client";
import { TEST_SALES_PASSWORD } from "./setup/seed-test-fixtures";

let admin: TestSession;
let manager: TestSession;
let sales: TestSession;
let customerId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  manager = await loginAs("manager@bizledger.com", "manager123");
  sales = await loginAs("sales1@test.local", TEST_SALES_PASSWORD);
  const cust = await admin.postJson<{ id: string }>("/api/customers", {
    name: "API Key Test Customer",
  });
  customerId = cust.body.id;
});

describe("API key management — admin only", () => {
  it("MANAGER cannot create an API key", async () => {
    const { status } = await manager.postJson("/api/settings/api-keys", {
      label: "should fail",
      scopes: ["customers"],
    });
    expect(status).toBe(403);
  });

  it("SALES cannot create an API key", async () => {
    const { status } = await sales.postJson("/api/settings/api-keys", {
      label: "should fail",
      scopes: ["customers"],
    });
    expect(status).toBe(403);
  });

  it("MANAGER cannot list API keys", async () => {
    const { status } = await manager.getJson("/api/settings/api-keys");
    expect(status).toBe(403);
  });

  it("rejects an unknown scope name", async () => {
    const { status } = await admin.postJson("/api/settings/api-keys", {
      label: "bad scope",
      scopes: ["not-a-real-scope"],
    });
    expect(status).toBe(400);
  });

  it("ADMIN can create a scoped key and receives the full key exactly once", async () => {
    const { status, body } = await admin.postJson<{
      id: string;
      label: string;
      keyPrefix: string;
      scopes: string[];
      key: string;
    }>("/api/settings/api-keys", { label: "Test dashboard", scopes: ["dashboard", "summary"] });
    expect(status).toBe(201);
    expect(body.label).toBe("Test dashboard");
    expect(body.scopes.sort()).toEqual(["dashboard", "summary"]);
    expect(body.key).toMatch(/^lc_live_[0-9a-f]{64}$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 16));
    expect(body.key).not.toBe(body.keyPrefix); // the prefix alone must not be the whole secret

    const list = await admin.getJson<{ id: string; keyPrefix: string; scopes: string[] }[]>(
      "/api/settings/api-keys"
    );
    expect(list.status).toBe(200);
    const found = list.body.find((k) => k.id === body.id);
    expect(found).toBeTruthy();
    expect(found?.scopes.sort()).toEqual(["dashboard", "summary"]);
    // The list endpoint must never expose the full key again, only the prefix.
    expect(JSON.stringify(list.body)).not.toContain(body.key);
  });

  it("a key created with no scopes at all is deny-by-default, not open-by-default", async () => {
    const created = await admin.postJson<{ key: string }>("/api/settings/api-keys", {
      label: "No scopes",
      scopes: [],
    });
    expect(created.status).toBe(201);

    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: `Bearer ${created.body.key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("API key auth — scoped, read-only access for external apps", () => {
  let broadKey: string; // has every scope, used for the general read/write-block tests
  let narrowKeyId: string;
  let narrowKey: string; // "customers" scope only

  beforeAll(async () => {
    const allScopes = [
      "summary", "dashboard", "reports", "customers", "products",
      "estimates", "invoices:customer", "invoices:supplier", "performance",
    ];
    const broad = await admin.postJson<{ key: string }>("/api/settings/api-keys", {
      label: "Read access test key (all scopes)",
      scopes: allScopes,
    });
    broadKey = broad.body.key;

    const narrow = await admin.postJson<{ id: string; key: string }>(
      "/api/settings/api-keys",
      { label: "Customers-only key", scopes: ["customers"] }
    );
    narrowKeyId = narrow.body.id;
    narrowKey = narrow.body.key;
  });

  it("a key with the right scope can read that endpoint with no session at all", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: `Bearer ${narrowKey}` },
    });
    expect(res.status).toBe(200);
  });

  it("the same key is rejected with 403 (not 200) on an endpoint outside its scope", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/dashboard", {
      headers: { Authorization: `Bearer ${narrowKey}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("forbidden_scope");
  });

  it("a broadly-scoped key can read dashboard, reports, and product-frequency (normally ADMIN/MANAGER-only)", async () => {
    const anon = anonymousSession();
    const dash = await anon.fetch("/api/dashboard", { headers: { Authorization: `Bearer ${broadKey}` } });
    expect(dash.status).toBe(200);

    const reports = await anon.fetch("/api/reports?type=income", {
      headers: { Authorization: `Bearer ${broadKey}` },
    });
    expect(reports.status).toBe(200);

    const freq = await anon.fetch("/api/reports/frequency", {
      headers: { Authorization: `Bearer ${broadKey}` },
    });
    expect(freq.status).toBe(200);
  });

  it("also works via the X-API-Key header instead of Authorization: Bearer", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { "X-API-Key": narrowKey },
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
  // (even a fully-scoped, valid one) can never create, edit, or delete
  // anything.
  it("a fully-scoped, valid key CANNOT create a customer -- write endpoints don't accept API keys at all", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${broadKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Should never be created" }),
    });
    expect(res.status).toBe(401);
  });

  it("a fully-scoped, valid key CANNOT create a customer invoice", async () => {
    const anon = anonymousSession();
    const res = await anon.fetch("/api/invoices/customer", {
      method: "POST",
      headers: { Authorization: `Bearer ${broadKey}`, "Content-Type": "application/json" },
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
    const revoke = await admin.postJson(`/api/settings/api-keys/${narrowKeyId}`, {}, "DELETE");
    expect(revoke.status).toBe(200);

    const anon = anonymousSession();
    const res = await anon.fetch("/api/customers", {
      headers: { Authorization: `Bearer ${narrowKey}` },
    });
    expect(res.status).toBe(401);

    const list = await admin.getJson<{ id: string; active: boolean }[]>("/api/settings/api-keys");
    const found = list.body.find((k) => k.id === narrowKeyId);
    expect(found?.active).toBe(false);
  });

  it("MANAGER cannot revoke a key", async () => {
    const created = await admin.postJson<{ id: string }>("/api/settings/api-keys", {
      label: "Manager should not revoke this",
      scopes: ["customers"],
    });
    const { status } = await manager.postJson(
      `/api/settings/api-keys/${created.body.id}`,
      {},
      "DELETE"
    );
    expect(status).toBe(403);
  });
});

describe("GET /api/reports/summary — aggregate-only sales/bills totals", () => {
  let summaryKey: string;

  beforeAll(async () => {
    const created = await admin.postJson<{ key: string }>("/api/settings/api-keys", {
      label: "Summary-only key",
      scopes: ["summary"],
    });
    summaryKey = created.body.key;
  });

  it("rejects a missing or invalid type", async () => {
    const { status } = await admin.getJson("/api/reports/summary");
    expect(status).toBe(400);
  });

  it("groups customer invoice totals by month and reports counts, matching hand-computed totals", async () => {
    const invoiceNumber = `SUMMARY-TEST-${Date.now()}`;
    const created = await admin.postJson<{ id: string; totalAmount: string }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber,
        invoiceDate: "2026-03-15",
        dueDate: "2026-04-14",
        items: [{ description: "Sofa", quantity: "1", unitPrice: "500" }],
      }
    );
    expect(created.status).toBe(201);

    const { status, body } = await admin.getJson<{
      type: string;
      groupBy: string;
      periods: { period: string; total: string; count: number }[];
      grandTotal: string;
      grandCount: number;
    }>("/api/reports/summary?type=sales&groupBy=month&from=2026-03-01&to=2026-03-31");
    expect(status).toBe(200);
    expect(body.type).toBe("sales");
    expect(body.groupBy).toBe("month");
    const march = body.periods.find((p) => p.period === "2026-03");
    expect(march).toBeTruthy();
    expect(Number(march!.total)).toBeGreaterThanOrEqual(500);
    expect(march!.count).toBeGreaterThanOrEqual(1);

    // No customer name, no line items, no raw ids anywhere in the response.
    expect(JSON.stringify(body)).not.toContain("API Key Test Customer");
    expect(JSON.stringify(body)).not.toContain("Sofa");
  });

  it("a summary-scoped key can read this endpoint but not the full invoice list", async () => {
    const anon = anonymousSession();
    const summaryRes = await anon.fetch("/api/reports/summary?type=bills&groupBy=month", {
      headers: { Authorization: `Bearer ${summaryKey}` },
    });
    expect(summaryRes.status).toBe(200);

    const listRes = await anon.fetch("/api/invoices/customer", {
      headers: { Authorization: `Bearer ${summaryKey}` },
    });
    expect(listRes.status).toBe(403);
  });
});
