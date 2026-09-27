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

type NumberingTx = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

/**
 * Document types whose numbers must be unique across the whole company.
 * The DB's own unique constraints are only per-(number, customerId), so on
 * their own they let two different customers' documents share a number --
 * which is exactly what happened in production (two invoices #1393 saved
 * by two users at the same time for two different customers). The helpers
 * below are the company-wide guard. Supplier bills are deliberately NOT
 * here: a bill's number is the supplier's own number, so two suppliers
 * legitimately reuse the same one.
 */
const NUMBERED_DOCS = {
  customerInvoice: { table: "CustomerInvoice", column: "invoiceNumber", field: "customerInvoiceNextSeq" },
  estimate: { table: "Estimate", column: "estimateNumber", field: "estimateNextSeq" },
} as const satisfies Record<string, { table: string; column: string; field: SequenceField }>;

export type NumberedDoc = keyof typeof NUMBERED_DOCS;

/**
 * Serializes every number-assigning write for one document type (create,
 * number-changing edit, estimate->invoice conversion) for the rest of the
 * transaction. Without it, "is this number free?" followed by the insert
 * is a check-then-act race: two users saving at the same moment both see
 * the number as free and both insert it. Transaction-scoped, so it is
 * released automatically on commit/rollback.
 */
export async function lockDocumentNumbering(tx: NumberingTx, doc: NumberedDoc): Promise<void> {
  const key = `numbering:${NUMBERED_DOCS[doc].table}`;
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, which
  // Prisma can't deserialize as a result column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** True if any document of this type (any customer), other than `excludeId`, already uses `number`. */
export async function isDocumentNumberTaken(
  tx: NumberingTx,
  doc: NumberedDoc,
  number: string,
  excludeId?: string
): Promise<boolean> {
  const { table, column } = NUMBERED_DOCS[doc];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${Prisma.raw(`"${table}"`)}
    WHERE ${Prisma.raw(`"${column}"`)} = ${number}
      AND "id" <> ${excludeId ?? ""}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Atomically takes the next value off the persisted counter, skipping any
 * number that's somehow already in use (e.g. a manually-set number from
 * before the counter existed).
 */
async function takeNextFreeNumber(tx: NumberingTx, doc: NumberedDoc, prefix: string): Promise<string> {
  const { field } = NUMBERED_DOCS[doc];
  const columnIdent = Prisma.raw(`"${field}"`);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rows = await tx.$queryRaw<{ seq: number }[]>`
      UPDATE "CompanyProfile" SET ${columnIdent} = ${columnIdent} + 1
      WHERE "id" = 'default'
      RETURNING ${columnIdent} - 1 AS "seq"
    `;
    if (rows.length === 0) {
      // No settings row yet -- create it with schema defaults and retry.
      await tx.$executeRaw`INSERT INTO "CompanyProfile" ("id", "updatedAt") VALUES ('default', NOW()) ON CONFLICT ("id") DO NOTHING`;
      continue;
    }
    const candidate = formatSequenceNumber(Number(rows[0].seq), prefix);
    if (!(await isDocumentNumberTaken(tx, doc, candidate))) return candidate;
  }
  throw new Error(`Could not find a free ${doc} number`);
}

export type ResolvedNumber = { number: string } | { conflict: string };

/**
 * Decides the number a new document is actually saved under. Must be
 * called inside the same transaction as the insert (it takes the
 * numbering lock, so the "is it free" check and the insert are atomic
 * with respect to every other save).
 *
 * - No number requested -> the next free number from the counter.
 * - Requested number is free company-wide -> used as-is.
 * - Requested number is taken, and it's a system-format number
 *   (`${prefix}<digits>`) -> it was the "next number" preview the New
 *   Invoice/Estimate page showed when it loaded, which someone else has
 *   since used. That preview was never a reservation, so the document just
 *   gets the next free number instead of failing the save.
 * - Requested number is taken and custom-formatted -> `{ conflict }`; the
 *   caller must reject with a 409.
 */
export async function resolveNewDocumentNumber(
  tx: NumberingTx,
  doc: NumberedDoc,
  requested: string | undefined,
  prefix: string
): Promise<ResolvedNumber> {
  await lockDocumentNumbering(tx, doc);
  if (requested) {
    if (!(await isDocumentNumberTaken(tx, doc, requested))) return { number: requested };
    if (parseSequenceFromNumber(requested, prefix) === null) return { conflict: requested };
  }
  return { number: await takeNextFreeNumber(tx, doc, prefix) };
}
