// Pure data, deliberately dependency-free (no crypto/prisma) so this is
// safe to import from a client component ("use client" pages/settings/api
// key UI) as well as server code -- lib/api-key.ts and lib/api.ts both
// import from here rather than duplicating this list.
//
// What a key can be scoped to see. Deliberately data-category granularity,
// not per-endpoint -- "invoices:customer" covers both the list route and
// any future detail route for the same resource, so adding a new read
// endpoint for an existing category doesn't require a new scope or a key
// migration. "summary" is the odd one out: it's not "customers" or
// "invoices:customer" restricted to fewer fields, it's a genuinely
// different, pre-aggregated shape (see app/api/reports/summary/route.ts)
// with no customer names or line items in it at all -- the right default
// for a dashboard that only wants trend numbers.
export const API_KEY_SCOPES = [
  {
    key: "summary",
    label: "Sales & bills summary",
    description: "Aggregated totals by day/week/month, plus invoice/bill counts. No customer names or line items.",
  },
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Company-wide P&L, COGS, and cash flow summary.",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Income, expenses, profit & loss, supplier-outstanding, and profitability reports.",
  },
  {
    key: "customers",
    label: "Customer list",
    description: "Every customer's name, email, phone, and address.",
  },
  {
    key: "products",
    label: "Product/service catalog",
    description: "Every catalog item's name, price, and tax rate.",
  },
  {
    key: "estimates",
    label: "Estimates",
    description: "Full estimate list, including line items and customer names.",
  },
  {
    key: "invoices:customer",
    label: "Customer invoices",
    description: "Full invoice list, including line items and customer names.",
  },
  {
    key: "invoices:supplier",
    label: "Supplier bills",
    description: "Full bill list, including line items and supplier names.",
  },
  {
    key: "performance",
    label: "Sales performance",
    description: "Per-employee sales totals and commission leaderboard.",
  },
] as const;

export type ApiScope = (typeof API_KEY_SCOPES)[number]["key"];

const VALID_SCOPES = new Set<string>(API_KEY_SCOPES.map((s) => s.key));

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && VALID_SCOPES.has(value);
}
