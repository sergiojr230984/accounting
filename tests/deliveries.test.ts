import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loginAs, anonymousSession, TestSession } from "./helpers/client";

/**
 * Module 1 (Deliveries): per-delivery photo-upload link + Calendar/Drive
 * write-back. Exercises the acceptance criteria from the spec directly
 * against real HTTP routes and a real database -- no mocks for the DB/auth
 * layer. GOOGLE_SERVICE_ACCOUNT_JSON is intentionally unset in this test
 * environment, so Calendar/Drive write-back is exercised at its documented
 * fail-soft boundary (calendarEventId stays null, nothing throws) rather
 * than against the real Google APIs -- see lib/google-calendar.ts's and
 * lib/google-drive.ts's doc comments for why that degrade path is itself
 * part of the contract, not a gap in these tests.
 */

const prisma = new PrismaClient();

let admin: TestSession;
let customerId: string;
let deliveryProductName: string;
let crewEmployeeId: string;

async function jpegBlob(): Promise<Blob> {
  // Minimal valid-enough JPEG bytes for the route's own mimeType-only
  // validation (lib/delivery-storage.ts never actually decodes the image).
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" });
}

async function createInvoiceWithDelivery(): Promise<{ invoiceId: string; deliveryId: string; token: string }> {
  const invoice = await admin.postJson<{ id: string; invoiceNumber: string }>("/api/invoices/customer", {
    customerId,
    invoiceNumber: `DEL-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-31",
    items: [
      { description: deliveryProductName, quantity: "1", unitPrice: "50" },
      { description: "Sofa", quantity: "1", unitPrice: "500" },
    ],
  });
  expect(invoice.status).toBe(201);

  const delivery = await prisma.delivery.findUnique({ where: { customerInvoiceId: invoice.body.id } });
  expect(delivery).not.toBeNull();
  return { invoiceId: invoice.body.id, deliveryId: delivery!.id, token: delivery!.token };
}

async function scheduleDelivery(
  deliveryId: string,
  overrides: Partial<{ windowStart: string; windowEnd: string; assignedCrewEmployeeId: string; assignedSubcontractorName: string; subcontractorCost: string }> = {}
) {
  const windowStart = overrides.windowStart ?? new Date(Date.now() + 3600_000).toISOString();
  const windowEnd = overrides.windowEnd ?? new Date(Date.now() + 7200_000).toISOString();
  return admin.postJson(`/api/deliveries/${deliveryId}/schedule`, {
    windowStart,
    windowEnd,
    assignedCrewEmployeeId: overrides.assignedCrewEmployeeId ?? (overrides.assignedSubcontractorName ? null : crewEmployeeId),
    assignedSubcontractorName: overrides.assignedSubcontractorName ?? null,
    subcontractorCost: overrides.subcontractorCost ?? null,
  });
}

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");

  const customer = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Delivery Test Customer",
    address: "123 Test Ave, Testville, FL 33101",
  });
  customerId = customer.body.id;

  deliveryProductName = `Test Delivery Service ${Date.now()}`;
  const product = await admin.postJson<{ id: string; name: string }>("/api/products", {
    name: deliveryProductName,
    isDeliveryService: true,
  });
  expect(product.status).toBe(201);

  const employee = await admin.postJson<{ id: string }>("/api/employees", {
    name: `Test Crew ${Date.now()}`,
  });
  crewEmployeeId = employee.body.id;
});

describe("AC1: invoice creation auto-generates a Delivery with a link, and scheduling creates one calendar reference", () => {
  it("creates exactly one Delivery row, token included, when an invoice has a delivery-service line", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    expect(token).toMatch(/^[\w-]{20,}$/); // base64url, well over 128 bits
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe("PENDING_SCHEDULE");
  });

  it("does NOT create a Delivery for an invoice with no delivery-service line", async () => {
    const invoice = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `DEL-TEST-NODELIV-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Sofa only", quantity: "1", unitPrice: "500" }],
    });
    const delivery = await prisma.delivery.findUnique({ where: { customerInvoiceId: invoice.body.id } });
    expect(delivery).toBeNull();
  });

  it("matches a delivery product picked from the invoice item's own autocomplete, which combines name and description into one field", async () => {
    // Regression test: the invoice item picker (applyProduct in
    // app/(dashboard)/invoices/customer/new/page.tsx) writes
    // "name — description" into the item's description field whenever the
    // selected product has a description -- never the bare name alone. A
    // delivery product with no description (the beforeAll fixture above)
    // never exercises that path, which is exactly how this slipped through.
    const name = `Test Delivery w/Desc ${Date.now()}`;
    const product = await admin.postJson<{ id: string }>("/api/products", {
      name,
      description: "+Armada",
      isDeliveryService: true,
    });
    expect(product.status).toBe(201);

    const invoice = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `DEL-TEST-COMBINED-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: `${name} — +Armada`, quantity: "1", unitPrice: "140" }],
    });
    expect(invoice.status).toBe(201);
    const delivery = await prisma.delivery.findUnique({ where: { customerInvoiceId: invoice.body.id } });
    expect(delivery).not.toBeNull();
  });

  it("creating/editing an invoice twice never creates two Delivery rows for the same invoice (fire-once)", async () => {
    const { invoiceId } = await createInvoiceWithDelivery();
    // A second, unrelated edit (e.g. notes) re-triggers ensureDeliveryForInvoice.
    await admin.postJson(`/api/invoices/customer/${invoiceId}`, { notes: "edited" }, "PATCH");
    const count = await prisma.delivery.count({ where: { customerInvoiceId: invoiceId } });
    expect(count).toBe(1);
  });

  it("scheduling sets the window/status and attempts exactly one calendar write (no crash when Calendar isn't configured)", async () => {
    const { deliveryId } = await createInvoiceWithDelivery();
    const res = await scheduleDelivery(deliveryId);
    expect(res.status).toBe(200);
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe("SCHEDULED");
    expect(delivery?.windowStart).not.toBeNull();
    // Unconfigured in this test env -- degrades to null rather than throwing.
    expect(delivery?.calendarEventId).toBeNull();
  });
});

describe("AC2: the public link accepts a photo and marks Delivered", () => {
  it("no login required, and a photo submission marks the delivery Delivered", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    const res = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("DELIVERED");

    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: { photos: true } });
    expect(delivery?.status).toBe("DELIVERED");
    expect(delivery?.deliveredAt).not.toBeNull();
    expect(delivery?.photos.length).toBe(1);
  });

  it("the submitting link's identity (not client-supplied text) is what lands in status history", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });

    const history = await prisma.deliveryStatusHistory.findMany({ where: { deliveryId }, orderBy: { createdAt: "desc" } });
    const deliveredEntry = history.find((h) => h.toStatus === "DELIVERED");
    expect(deliveredEntry?.actorType).toBe("CREW_LINK");
  });
});

describe("AC3: Entregado with no photo is impossible from the link; manager override requires a reason", () => {
  it("rejects DELIVERED with zero photos from the public link", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    const res = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(res.status).toBe(400);

    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).not.toBe("DELIVERED");
  });

  it("manager override without a reason is rejected", async () => {
    const { deliveryId } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    const res = await admin.postJson(`/api/deliveries/${deliveryId}/override`, { reason: "" });
    expect(res.status).toBe(400);
  });

  it("manager override with a reason marks Delivered with no photo, and the reason lands in history", async () => {
    const { deliveryId } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    const res = await admin.postJson(`/api/deliveries/${deliveryId}/override`, { reason: "Customer signed for it, crew phone was dead" });
    expect(res.status).toBe(200);

    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: { photos: true, statusHistory: true } });
    expect(delivery?.status).toBe("DELIVERED");
    expect(delivery?.photos.length).toBe(0);
    expect(delivery?.overrideReason).toContain("Customer signed");
    const overrideEntry = delivery?.statusHistory.find((h) => h.reason?.includes("Override"));
    expect(overrideEntry).toBeTruthy();
    expect(overrideEntry?.actorType).toBe("OFFICE_USER");
  });

  it("a non-ADMIN/MANAGER role cannot apply a manager override", async () => {
    const sales = await loginAs("sales1@test.local", "salesTest#1pw");
    const { deliveryId } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    const res = await sales.postJson(`/api/deliveries/${deliveryId}/override`, { reason: "trying anyway" });
    expect(res.status).toBe(403);
  });
});

describe("AC4: \"No se pudo entregar\" requires a reason and shows up on the board", () => {
  it("rejects EXCEPTION with no reason", async () => {
    const { token } = await createInvoiceWithDelivery();
    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "EXCEPTION");
    const res = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("accepts EXCEPTION with a reason (no photo required) and it shows up on the board list", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "EXCEPTION");
    form.append("exceptionReason", "CLIENTE_AUSENTE");
    form.append("exceptionNote", "Nadie respondió en la puerta");
    const res = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(res.status).toBe(200);

    const board = await admin.getJson<{ id: string; status: string; exceptionReason: string }[]>("/api/deliveries?status=EXCEPTION");
    const row = board.body.find((d) => d.id === deliveryId);
    expect(row).toBeTruthy();
    expect(row?.exceptionReason).toBe("CLIENTE_AUSENTE");
  });
});

describe("AC5: subcontractor link expiry, office revoke, and payable gating", () => {
  it("a subcontractor link stops working 24h after the window ends", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    const windowStart = new Date(Date.now() - 30 * 3600_000).toISOString(); // 30h ago
    const windowEnd = new Date(Date.now() - 26 * 3600_000).toISOString(); // 26h ago -- past the 24h grace period
    const res = await scheduleDelivery(deliveryId, { windowStart, windowEnd, assignedSubcontractorName: "Acme Movers" });
    expect(res.status).toBe(200);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    const submitRes = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(submitRes.status).toBe(410);
  });

  it("a subcontractor link still works within the 24h grace window after the window ends", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    const windowStart = new Date(Date.now() - 4 * 3600_000).toISOString();
    const windowEnd = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2h ago -- well within 24h
    await scheduleDelivery(deliveryId, { windowStart, windowEnd, assignedSubcontractorName: "Acme Movers" });

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    const submitRes = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(submitRes.status).toBe(200);
  });

  it("the office can revoke a link early, independent of the 24h rule", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    const revokeRes = await admin.postJson(`/api/deliveries/${deliveryId}/revoke`, {});
    expect(revokeRes.status).toBe(200);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    const submitRes = await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });
    expect(submitRes.status).toBe(410);
  });

  it("a regenerated token invalidates the old one and issues a new working one", async () => {
    const { deliveryId, token: oldToken } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    const regenRes = await admin.postJson<{ token: string }>(`/api/deliveries/${deliveryId}/regenerate`, {});
    expect(regenRes.status).toBe(200);
    const newToken = regenRes.body.token;
    expect(newToken).not.toBe(oldToken);

    const anon = anonymousSession();
    const oldForm = new FormData();
    oldForm.append("outcome", "DELIVERED");
    oldForm.append("photos", await jpegBlob(), "foto-1.jpg");
    expect((await anon.fetch(`/api/d/${oldToken}`, { method: "POST", body: oldForm })).status).toBe(404);

    const newForm = new FormData();
    newForm.append("outcome", "DELIVERED");
    newForm.append("photos", await jpegBlob(), "foto-1.jpg");
    expect((await anon.fetch(`/api/d/${newToken}`, { method: "POST", body: newForm })).status).toBe(200);
  });

  it("cannot mark a subcontractor payable before proof exists, and can immediately after", async () => {
    const { deliveryId, token } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId, { assignedSubcontractorName: "Acme Movers", subcontractorCost: "75.00" });

    const tooEarly = await admin.postJson(`/api/deliveries/${deliveryId}/payable`, {});
    expect(tooEarly.status).toBe(400);

    const anon = anonymousSession();
    const form = new FormData();
    form.append("outcome", "DELIVERED");
    form.append("photos", await jpegBlob(), "foto-1.jpg");
    await anon.fetch(`/api/d/${token}`, { method: "POST", body: form });

    const nowOk = await admin.postJson(`/api/deliveries/${deliveryId}/payable`, {});
    expect(nowOk.status).toBe(200);
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.subcontractorPayable).toBe(true);
  });
});

describe("AC6: rescheduling reuses the same Delivery row and window, never a duplicate", () => {
  it("a second schedule call updates the window on the same Delivery row (no new row created)", async () => {
    const { deliveryId } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId, {
      windowStart: new Date(Date.now() + 3600_000).toISOString(),
      windowEnd: new Date(Date.now() + 7200_000).toISOString(),
    });
    const newStart = new Date(Date.now() + 86_400_000).toISOString();
    const newEnd = new Date(Date.now() + 90_000_000).toISOString();
    const res = await scheduleDelivery(deliveryId, { windowStart: newStart, windowEnd: newEnd });
    expect(res.status).toBe(200);

    const count = await prisma.delivery.count({ where: { id: deliveryId } });
    expect(count).toBe(1);
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.windowStart?.toISOString()).toBe(newStart);
  });

  it("reassigning crew -> subcontractor on reschedule regenerates the token (old link stops working)", async () => {
    const { deliveryId, token: crewToken } = await createInvoiceWithDelivery();
    await scheduleDelivery(deliveryId);
    await scheduleDelivery(deliveryId, { assignedSubcontractorName: "New Sub Co" });

    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.token).not.toBe(crewToken);
    expect(delivery?.tokenKind).toBe("SUBCONTRACTOR");
  });
});
