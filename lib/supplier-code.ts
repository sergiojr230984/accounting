// Shared by both supplier routes (app/api/suppliers/route.ts and
// app/api/suppliers/[id]/route.ts) so the format rule only lives once.
//
// A real supplier's code is exactly 2 uppercase letters (auto-uppercased
// here); the HOUSE/in-stock entry (isHouse: true) is allowed up to 4, since
// "HO" collides too easily with a real 2-letter supplier code and the
// business wants something more explicit like "HSE" for it. Either way,
// Supplier.code itself is a plain, unbounded-length @unique text column --
// this tighter shape is an application rule, not a DB constraint, so it can
// be relaxed later without a migration.
const CODE_RE = /^[A-Z]{2}$/;
const HOUSE_CODE_RE = /^[A-Z]{2,4}$/;

export function validateSupplierCode(
  code: string | null | undefined,
  isHouse: boolean
): { code: string | null } | { error: string } {
  if (!code) return { code: null };
  const upper = code.trim().toUpperCase();
  const re = isHouse ? HOUSE_CODE_RE : CODE_RE;
  if (!re.test(upper)) {
    return {
      error: isHouse
        ? 'The House/in-stock code must be 2-4 letters.'
        : 'Supplier code must be exactly 2 letters (e.g. "TO").',
    };
  }
  return { code: upper };
}
