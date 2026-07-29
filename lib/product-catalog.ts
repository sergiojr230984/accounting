import type { PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";

interface CatalogItem {
  description: string;
  itemDescription?: string;
  unitPrice: string;
  taxRate: string;
}

interface CatalogActor {
  actorId?: string | null;
  actorName: string;
  actorRole: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Auto-saves each line item's description to the product catalog for reuse,
 * skipping any name that already exists (case-insensitive) or is repeated
 * within this same batch. Batched into one existence-check query plus one
 * createMany() -- an invoice with 20 items previously meant up to 40
 * sequential findFirst()+create() round trips just for catalog syncing.
 *
 * When `actor` is passed, each newly created product is written to the
 * audit ledger -- this is the one place invoice line items turn into
 * catalog items, so it's also the one place that needs to log it, rather
 * than duplicating the lookup in every caller.
 */
export async function syncProductCatalog(
  client: Pick<PrismaClient, "product">,
  items: CatalogItem[],
  actor?: CatalogActor
): Promise<void> {
  const names = Array.from(new Set(items.map((item) => item.description.trim()).filter(Boolean)));
  if (names.length === 0) return;

  const existingProducts = await client.product.findMany({
    where: { OR: names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
    select: { name: true },
  });
  const existingLower = new Set(existingProducts.map((p) => p.name.toLowerCase()));

  const seen = new Set<string>();
  const creates: { name: string; description: string | null; price: string; taxRate: string; active: boolean }[] = [];
  for (const item of items) {
    const name = item.description.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (existingLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    creates.push({
      name,
      description: item.itemDescription ?? null,
      price: item.unitPrice,
      taxRate: item.taxRate,
      active: true,
    });
  }

  if (creates.length > 0) {
    await client.product.createMany({ data: creates });

    if (actor) {
      const created = await client.product.findMany({
        where: { OR: creates.map((c) => ({ name: { equals: c.name, mode: "insensitive" as const } })) },
        select: { id: true, name: true },
      });
      for (const product of created) {
        await writeAuditLog({
          ...actor,
          action: "CREATE",
          entityType: "product",
          entityId: product.id,
          entityLabel: product.name,
        });
      }
    }
  }
}

/**
 * Non-admins can only invoice line items that already exist as an active
 * catalog product -- this is what actually stops the catalog from
 * fragmenting into near-duplicates (the thing syncProductCatalog above
 * papers over by silently minting a new product for whatever text was
 * typed). Admin keeps a free-text escape hatch: their typed items still
 * flow through syncProductCatalog above and land in the catalog for reuse.
 * Returns the first name that isn't in the active catalog, or null if every
 * item checks out.
 */
export async function findUncatalogedItem(
  client: Pick<PrismaClient, "product">,
  role: string | undefined,
  items: { description: string }[]
): Promise<string | null> {
  if (role === "ADMIN") return null;

  const active = await client.product.findMany({
    where: { active: true },
    select: { name: true },
  });
  const catalog = new Set(active.map((p) => p.name.trim().toLowerCase()));

  for (const item of items) {
    const name = item.description.trim();
    if (!name) continue;
    if (!catalog.has(name.toLowerCase())) return name;
  }
  return null;
}
