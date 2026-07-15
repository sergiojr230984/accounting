import type { PrismaClient } from "@prisma/client";

interface CatalogItem {
  description: string;
  itemDescription?: string;
  unitPrice: string;
  taxRate: string;
}

/**
 * Auto-saves each line item's description to the product catalog for reuse,
 * skipping any name that already exists (case-insensitive) or is repeated
 * within this same batch. Batched into one existence-check query plus one
 * createMany() -- an invoice with 20 items previously meant up to 40
 * sequential findFirst()+create() round trips just for catalog syncing.
 */
export async function syncProductCatalog(
  client: Pick<PrismaClient, "product">,
  items: CatalogItem[]
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
  }
}
