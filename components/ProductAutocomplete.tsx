"use client";

import { useState } from "react";

export interface ProductOption {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  taxRate: string;
  active: boolean;
}

interface ProductAutocompleteProps {
  products: ProductOption[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (product: ProductOption) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

// Free text, not a locked picklist -- typing a genuinely new name is allowed
// (it becomes a new catalog entry other invoices can reuse). The suggestion
// dropdown is what actually keeps the catalog from fragmenting: as soon as
// what's typed matches an existing product, it's surfaced so the user picks
// the real one instead of quietly minting a near-duplicate.
export default function ProductAutocomplete({
  products,
  value,
  onChange,
  onSelect,
  className,
  placeholder = "Item name",
  disabled,
}: ProductAutocompleteProps) {
  const [focused, setFocused] = useState(false);

  const q = value.trim().toLowerCase();
  const matches = q
    ? products
        .filter((p) => p.active)
        .filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  return (
    <div className="relative">
      <input
        className={className}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {matches.map((p) => {
            const price = parseFloat(p.price);
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={() => onSelect(p)}
                className="block w-full text-left px-3 py-2 hover:bg-brand-50 text-sm"
              >
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {price > 0 ? `$${price.toFixed(2)}` : "price varies"}
                  {parseFloat(p.taxRate) > 0 && ` · Tax ${(parseFloat(p.taxRate) * 100).toFixed(2)}%`}
                  {p.description && ` · ${p.description}`}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
