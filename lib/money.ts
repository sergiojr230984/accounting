import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

type DecimalInput = string | number | Decimal;

export function toDecimal(value: DecimalInput): Decimal {
  return new Decimal(String(value));
}

export function formatCurrency(value: DecimalInput): string {
  const d = new Decimal(String(value));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber());
}

export function sumDecimals(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>(
    (acc, v) => acc.plus(new Decimal(String(v))),
    new Decimal(0)
  );
}

export interface ComputedLine {
  lineTotal: string;
  lineTax: string;
}

export interface LineInput {
  quantity: string;
  price: string;
  taxRate: string;
}

// Rounds each line's total (and its tax) to 2 decimals FIRST, then sums the
// already-rounded values into subtotal/taxAmount. Summing full-precision
// values and rounding once at the end can legitimately disagree with the
// stored per-line totals by a cent (e.g. three lines at $3.335 each store as
// $3.34/$3.34/$3.34 = $10.02, but a subtotal rounded once from the unrounded
// $10.005 sum comes out $10.01). Shared by every place that turns line items
// into a subtotal/tax/total -- customer and supplier invoices, estimates,
// create and edit alike -- so a fix here never again needs to be reapplied
// separately at each call site (and risk being missed at one of them).
export function computeLineTotals(lines: LineInput[]): {
  lines: ComputedLine[];
  subtotal: Decimal;
  taxAmount: Decimal;
} {
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);
  const computed = lines.map((line) => {
    const qty = new Decimal(line.quantity || "0");
    const price = new Decimal(line.price || "0");
    const rate = new Decimal(line.taxRate || "0");
    const lineTotal = qty.times(price).toDecimalPlaces(2);
    const lineTax = lineTotal.times(rate).toDecimalPlaces(2);
    subtotal = subtotal.plus(lineTotal);
    taxAmount = taxAmount.plus(lineTax);
    return { lineTotal: lineTotal.toFixed(2), lineTax: lineTax.toFixed(2) };
  });
  return { lines: computed, subtotal, taxAmount };
}
