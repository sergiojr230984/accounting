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

export function calculateLineTotal(
  quantity: DecimalInput,
  unitPrice: DecimalInput
): Decimal {
  return new Decimal(String(quantity)).times(new Decimal(String(unitPrice)));
}

export function calculateTax(subtotal: Decimal, taxRate: Decimal): Decimal {
  return subtotal.times(taxRate);
}
