import { Prisma, type PrismaClient } from "@prisma/client";

export type SequenceField = "customerInvoiceNextSeq" | "supplierInvoiceNextSeq" | "estimateNextSeq";

/**
 * Formats a persisted sequence value as `${prefix}${seq}` (seq zero-padded
 * to 4 digits). Pure formatting -- callers read the counter themselves
 * (they already need the CompanyProfile row for the prefix) and pass the
 * value in.
 */
export function formatSequenceNumber(nextSeq: number, prefix: string): string {
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Extracts the leading digit run immediately after `prefix`, mirroring the
 * old MAX-scan's `WHERE column LIKE prefix||'%'` + substring(... from
 * '^[0-9]+') behavior -- so a manually-edited value like "<prefix>0003b"
 * still contributes 3, but a value that doesn't start with `prefix` at all
 * (a legacy/unrelated number, a different document type's number, etc.)
 * contributes nothing, exactly like the old scan would have excluded it.
 * Without the startsWith check, an unrelated number that merely happens to
 * start with digits (e.g. a legacy id like "99999999-unrelated") would
 * wrongly shove this prefix's counter forward by however many digits it has.
 */
export function parseSequenceFromNumber(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) return null;
  const match = value.slice(prefix.length).match(/^\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Advances the persisted "next sequence" counter on CompanyProfile so it
 * can never issue `usedNumber`'s sequence value (or anything at/below it)
 * again. Call this once a document number has actually been assigned --
 * inside the same transaction as the row that used it, so a rollback of
 * one rolls back the other.
 *
 * This -- not a MAX() scan over existing rows -- is the fix for numbers
 * getting reused after a document is deleted. A scan-based "next number"
 * necessarily drops back down the moment the highest-numbered row is
 * deleted, because it has no memory of what used to exist. This counter
 * only ever moves forward: deleting a row has zero effect on it, so a
 * number that's already been handed out is never handed out again.
 *
 * Uses a single atomic SQL UPDATE (GREATEST), not a read-then-write, so
 * concurrent creates can never race each other into both claiming the same
 * number.
 */
export async function claimSequenceNumber(
  tx: Pick<PrismaClient, "$executeRaw">,
  field: SequenceField,
  usedNumber: string,
  prefix: string
): Promise<void> {
  const usedSeq = parseSequenceFromNumber(usedNumber, prefix);
  if (usedSeq === null) return;
  const columnIdent = Prisma.raw(`"${field}"`);
  await tx.$executeRaw`
    UPDATE "CompanyProfile"
    SET ${columnIdent} = GREATEST(${columnIdent}, ${usedSeq + 1})
    WHERE "id" = 'default'
  `;
}
