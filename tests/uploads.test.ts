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

  // Documents a real, live-verified stored-XSS vulnerability from the companion
  // OWASP audit: the declared Content-Type (checked against the allowlist) and
  // the filename (used to derive the stored extension) are validated
  // independently, so a file claiming application/pdf but named *.html is
  // stored — and served back — as HTML, executing any embedded <script>.
  it.fails("the stored file extension should follow the validated MIME type, not the client-supplied filename", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["<html><body><script>document.title='xss'</script></body></html>"], {
        type: "application/pdf", // passes the allowlist
      }),
      "innocuous.html" // but this is what actually gets stored
    );
    form.append("customerInvoiceId", invoiceId);
    const res = await admin.fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json();
    expect(body.storedName).toMatch(/\.pdf$/); // currently ends in .html
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
    // Whatever the status, the stored path (if any) must stay inside the uploads dir.
    if (res.status === 201) {
      const body = await res.json();
      expect(body.path.startsWith("public/uploads/")).toBe(true);
      expect(body.path).not.toContain("..");
    }
  });
});
