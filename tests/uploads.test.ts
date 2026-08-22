import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

let admin: TestSession;
let invoiceId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  const customer = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Upload Test Customer",
  });
  const invoice = await admin.postJson<{ id: string }>("/api/invoices/customer", {
    customerId: customer.body.id,
    invoiceNumber: `UPLOAD-TEST-${Date.now()}`,
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-31",
    items: [{ description: "x", quantity: "1", unitPrice: "1" }],
  });
  invoiceId = invoice.body.id;
});

describe("file upload validation", () => {
  it("rejects a disallowed declared MIME type outright", async () => {
    const form = new FormData();
    form.append("file", new Blob(["not really an exe"], { type: "application/x-msdownload" }), "virus.exe");
    form.append("customerInvoiceId", invoiceId);
    const res = await admin.fetch("/api/upload", { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("accepts a correctly-typed PDF and stores it with a .pdf extension", async () => {
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 test content"], { type: "application/pdf" }), "invoice-attachment.pdf");
    form.append("customerInvoiceId", invoiceId);
    const res = await admin.fetch("/api/upload", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.storedName).toMatch(/\.pdf$/);
  });

  // Fixed: lib/upload.ts now derives the stored extension from a fixed
  // MIME-type lookup table, never from the client-supplied filename, so a
  // file claiming application/pdf but named *.html is stored -- and served
  // back -- as .pdf regardless of what the filename says.
  it("the stored file extension should follow the validated MIME type, not the client-supplied filename", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["<html><body><script>document.title='xss'</script></body></html>"], {
        type: "application/pdf",
      }),
      "innocuous.html"
    );
    form.append("customerInvoiceId", invoiceId);
    const res = await admin.fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json();
    expect(body.storedName).toMatch(/\.pdf$/);
  });

  it("a path-traversal filename does not escape the uploads directory", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["test"], { type: "application/pdf" }),
      "../../../../../../tmp/should-not-exist-here.pdf"
    );
    form.append("customerInvoiceId", invoiceId);
    const res = await admin.fetch("/api/upload", { method: "POST", body: form });
    if (res.status === 201) {
      const body = await res.json();
      expect(body.path.startsWith("public/uploads/")).toBe(true);
      expect(body.path).not.toContain("..");
    }
  });

  // No ownership/relationship check exists between the caller and the
  // invoice ID being attached to -- confirmed via code review of
  // app/api/upload/route.ts. Any authenticated user, any role, can attach a
  // file to any invoice in the system.
  it.fails("SALES should not be able to attach a file to an invoice they have no relationship to", async () => {
    const { loginAs: login } = await import("./helpers/client");
    const { TEST_SALES_PASSWORD } = await import("./setup/seed-test-fixtures");
    const sales = await login("sales1@test.local", TEST_SALES_PASSWORD);
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "test.pdf");
    form.append("customerInvoiceId", invoiceId);
    const res = await sales.fetch("/api/upload", { method: "POST", body: form });
    expect(res.status).toBe(403); // currently 201 -- no ownership check exists on this route
  });
});
