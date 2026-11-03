import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loginAs, TestSession } from "./helpers/client";
import { formatAddress, formatApartment } from "../lib/address";

/**
 * Customer apartment / suite / unit: stored in its own Customer.apartment
 * column and merged into the address by lib/address.ts wherever an address
 * is shown or printed.
 */

const prisma = new PrismaClient();

describe("formatApartment / formatAddress", () => {
  it("labels a bare number or code as Apt, keeps an already-labelled value as typed", () => {
    expect(formatApartment("705")).toBe("Apt 705");
    expect(formatApartment("7B")).toBe("Apt 7B");
    expect(formatApartment("12-A")).toBe("Apt 12-A");
    expect(formatApartment("B")).toBe("Apt B");
    expect(formatApartment("Suite 200")).toBe("Suite 200");
    expect(formatApartment("Apto 705")).toBe("Apto 705");
    expect(formatApartment("#12")).toBe("#12");
    expect(formatApartment("  ")).toBe("");
    expect(formatApartment(null)).toBe("");
  });

  it("puts the apartment right after the street line, before the city", () => {
    expect(formatAddress("2137 NW 36th St, Miami, FL 33142", "705")).toBe("2137 NW 36th St, Apt 705, Miami, FL 33142");
  });

  it("appends it when the address has no comma", () => {
    expect(formatAddress("2137 nw 36 st Miami Fl 33142", "705")).toBe("2137 nw 36 st Miami Fl 33142, Apt 705");
  });

  it("returns the address unchanged with no apartment, and null with no address", () => {
    expect(formatAddress("123 Main St, Miami, FL", null)).toBe("123 Main St, Miami, FL");
    expect(formatAddress("123 Main St, Miami, FL", "")).toBe("123 Main St, Miami, FL");
    expect(formatAddress(null, "705")).toBeNull();
    expect(formatAddress("  ", "705")).toBeNull();
  });

  it("doesn't print the apartment twice when an older address already has it typed in", () => {
    expect(formatAddress("2137 NW 36th St, Apt 705, Miami, FL", "705")).toBe("2137 NW 36th St, Apt 705, Miami, FL");
  });
});

describe("customer API — apartment field", () => {
  let admin: TestSession;
  beforeAll(async () => {
    admin = await loginAs("admin@lacuevita.com", "admin123");
  });

  it("saves the apartment on create and returns it", async () => {
    const res = await admin.postJson<{ id: string; apartment: string | null; address: string | null }>("/api/customers", {
      name: "Apartment Create Test",
      address: "2137 NW 36th St, Miami, FL 33142",
      apartment: " 705 ",
    });
    expect(res.status).toBe(201);
    expect(res.body.apartment).toBe("705");
    // Street line stays clean -- the apartment is not merged into it.
    expect(res.body.address).toBe("2137 NW 36th St, Miami, FL 33142");
  });

  it("an edit that doesn't send the apartment keeps it; sending empty clears it", async () => {
    const created = await admin.postJson<{ id: string }>("/api/customers", {
      name: "Apartment Edit Test",
      address: "1 Ocean Dr, Miami Beach, FL",
      apartment: "12",
    });
    const id = created.body.id;

    const kept = await admin.postJson<{ apartment: string | null }>(
      `/api/customers/${id}`,
      { name: "Apartment Edit Test", address: "1 Ocean Dr, Miami Beach, FL" },
      "PATCH"
    );
    expect(kept.status).toBe(200);
    expect(kept.body.apartment).toBe("12");

    const changed = await admin.postJson<{ apartment: string | null }>(
      `/api/customers/${id}`,
      { name: "Apartment Edit Test", address: "1 Ocean Dr, Miami Beach, FL", apartment: "Suite 4" },
      "PATCH"
    );
    expect(changed.body.apartment).toBe("Suite 4");

    const cleared = await admin.postJson<{ apartment: string | null }>(
      `/api/customers/${id}`,
      { name: "Apartment Edit Test", address: "1 Ocean Dr, Miami Beach, FL", apartment: "" },
      "PATCH"
    );
    expect(cleared.body.apartment).toBeNull();
  });

  it("the delivery board shows the apartment in the delivery address", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", {
      name: "Apartment Delivery Test",
      address: "2137 NW 36th St, Miami, FL 33142",
      apartment: "705",
    });
    const invoice = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `APT-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [
        { description: "Delivery", quantity: "1", unitPrice: "50" },
        { description: "Sofa", quantity: "1", unitPrice: "500" },
      ],
    });
    expect(invoice.status).toBe(201);
    const delivery = await prisma.delivery.findUnique({ where: { customerInvoiceId: invoice.body.id } });
    expect(delivery).not.toBeNull();

    const board = await admin.getJson<{ id: string; deliveryAddress: string | null }[]>("/api/deliveries");
    expect(board.status).toBe(200);
    const row = board.body.find((r) => r.id === delivery!.id);
    expect(row?.deliveryAddress).toBe("2137 NW 36th St, Apt 705, Miami, FL 33142");
  });
});
