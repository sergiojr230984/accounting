import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Computes the next sequential number formatted as `${prefix}${seq}` (seq
 * zero-padded to 4 digits) for a numbered-document column (invoice/estimate
 * numbers), via a single SQL MAX() aggregate over rows already sharing the
 * prefix -- rather than fetching every matching value and looping in JS.
 * substring(... from '^[0-9]+') mirrors parseInt's leading-digit-run
 * behavior exactly, so a manually-edited value like "0003b" still
 * contributes 3, same as the JS loop this replaced.
 *
 * `table` and `column` are always call-site constants, never user input --
 * safe to splice as raw SQL identifiers via Prisma.raw().
 */
export async function nextSequenceNumber(
  client: Pick<PrismaClient, "$queryRaw">,
  table: string,
  column: string,
  prefix: string,
  floorSeq: number
): Promise<{ nextNumber: string; nextSeq: number }> {
  const columnIdent = Prisma.raw(`"${column}"`);
  const tableIdent = Prisma.raw(`"${table}"`);
  const rows = await client.$queryRaw<{ maxSeq: number | null }[]>(Prisma.sql`
    SELECT MAX(CAST(substring(substring(${columnIdent} from length(${prefix}) + 1) from '^[0-9]+') AS INTEGER)) AS "maxSeq"
    FROM ${tableIdent}
    WHERE ${columnIdent} LIKE ${prefix + "%"}
  `);
  const scannedMax = rows[0]?.maxSeq ?? null;
  const maxSeq = scannedMax !== null && scannedMax > floorSeq ? scannedMax : floorSeq;
  const nextSeq = maxSeq + 1;
  return { nextNumber: `${prefix}${String(nextSeq).padStart(4, "0")}`, nextSeq };
}
