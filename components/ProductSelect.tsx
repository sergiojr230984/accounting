"use client";

export interface ProductOption {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  taxRate: string;
  active: boolean;
}

interface ProductSelectProps {
  products: ProductOption[];
  value: string;
  onSelect: (name: string, product: ProductOption | null) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

// Deliberately a plain <select> (not a text input) — the only way to add a
// choice that isn't already here is for an admin to add it in Products &
// Services. That's what keeps the catalog (and the frequency report) from
// fragmenting into near-duplicate item names.
export default function ProductSelect({
  products,
  value,
  onSelect,
  className,
  placeholder = "Select product/service…",
  disabled,
}: ProductSelectProps) {
  const active = products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const matchesActive = active.some((p) => p.name === value);
  const legacyValue = value.trim() && !matchesActive ? value : null;

  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const name = e.target.value;
        if (!name) {
          onSelect("", null);
          return;
        }
        const product = active.find((p) => p.name === name) ?? null;
        onSelect(name, product);
      }}
    >
      <option value="">{placeholder}</option>
      {legacyValue && (
        <option value={legacyValue}>{legacyValue} (not in current catalog)</option>
      )}
      {active.map((p) => {
        // A catalog price of exactly $0 usually means "varies" (e.g. delivery
        // priced by area), not that the item is actually free -- showing
        // "$0.00" there reads as broken. Only show a price when it's set.
        const price = parseFloat(p.price);
        return (
          <option key={p.id} value={p.name}>
            {p.name}{price > 0 ? ` — $${price.toFixed(2)}` : " — price varies"}
          </option>
        );
      })}
    </select>
  );
}
