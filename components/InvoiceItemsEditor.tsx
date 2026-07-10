"use client";

import { useEffect, useState } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormRegister,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import Decimal from "decimal.js";

interface ItemRow {
  description: string;
  itemDescription?: string;
  quantity: string;
  unitPrice?: string;
  unitCost?: string;
  taxRate: string;
}

interface FeeOption {
  id: string;
  label: string;
  rate: number;
}

interface AppliedFee {
  id: string;
  label: string;
  rate: number;
  amount: string;
}

interface InvoiceItemsEditorProps<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T> | any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<T> | any;
  fieldName?: string;
  type: "customer" | "supplier";
  // Optional per-line fees (credit card fee / custom fees from Settings).
  // Only rendered when provided and non-empty.
  feeOptions?: FeeOption[];
  // Fee ids previously applied to the invoice as a whole — seeded onto the
  // first line item the first time fee options become available, since
  // fees aren't tracked per-line in the database.
  initialAppliedFeeIds?: string[];
  onFeesChange?: (fees: AppliedFee[]) => void;
}

function LinePreview({ quantity, price, taxRate }: { quantity: string; price: string; taxRate: string }) {
  try {
    const q = new Decimal(quantity || "0");
    const p = new Decimal(price || "0");
    const r = new Decimal(taxRate || "0");
    const sub = q.times(p);
    const tax = sub.times(r);
    const total = sub.plus(tax);
    return (
      <span className="text-sm font-medium text-gray-700">
        ${total.toFixed(2)}
      </span>
    );
  } catch {
    return <span className="text-sm text-gray-400">—</span>;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function InvoiceItemsEditor<T extends FieldValues = any>({
  control,
  register,
  fieldName = "items",
  type,
  feeOptions = [],
  initialAppliedFeeIds = [],
  onFeesChange,
}: InvoiceItemsEditorProps<T>) {
  const { fields, append, remove } = useFieldArray({ control, name: fieldName as Path<T> as never });
  const items = useWatch({ control, name: fieldName as Path<T> as never }) as unknown as ItemRow[];

  const priceField = type === "customer" ? "unitPrice" : "unitCost";
  const priceLabel = type === "customer" ? "Unit Price" : "Unit Cost";

  const [taxRates, setTaxRates] = useState<{ id: string; name: string; rate: string; active: boolean }[]>([]);
  useEffect(() => {
    fetch("/api/settings/taxes")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string; rate: string; active: boolean }[]) =>
        setTaxRates(list.filter((t) => t.active))
      )
      .catch(() => {});
  }, []);

  // Per-line fee selections, kept positionally in sync with `fields`.
  const [itemFeeSlots, setItemFeeSlots] = useState<(string | null)[][]>([]);
  const [feesSeeded, setFeesSeeded] = useState(false);

  // Seed previously-applied fees onto the first line the first time fee
  // options are available (fees aren't tracked per-line in the database).
  useEffect(() => {
    if (feesSeeded || feeOptions.length === 0 || fields.length === 0) return;
    if (initialAppliedFeeIds.length > 0) {
      setItemFeeSlots((prev) => {
        const next = fields.map((_, i) => prev[i] ?? []);
        next[0] = [...initialAppliedFeeIds, null];
        return next;
      });
    }
    setFeesSeeded(true);
  }, [feeOptions.length, fields.length, feesSeeded, initialAppliedFeeIds]);

  // Keep itemFeeSlots positionally aligned with the items field array.
  useEffect(() => {
    setItemFeeSlots((prev) => {
      if (prev.length === fields.length) return prev;
      const next = fields.map((_, i) => prev[i] ?? []);
      return next;
    });
  }, [fields.length]);

  function selectLineFee(itemIdx: number, slotIdx: number, feeId: string | null) {
    setItemFeeSlots((prev) => {
      const next = [...prev];
      const slots = next[itemIdx] && next[itemIdx].length > 0 ? [...next[itemIdx]] : [null];
      slots[slotIdx] = feeId;
      if (feeId && slotIdx === slots.length - 1) slots.push(null);
      next[itemIdx] = slots;
      return next;
    });
  }

  function removeLineFee(itemIdx: number, slotIdx: number) {
    setItemFeeSlots((prev) => {
      const next = [...prev];
      const filtered = (next[itemIdx] ?? []).filter((_, i) => i !== slotIdx);
      next[itemIdx] = filtered;
      return next;
    });
  }

  // Aggregate all per-line fee selections into totals and report them up.
  useEffect(() => {
    if (!onFeesChange) return;
    const feeAgg = new Map<string, AppliedFee>();
    (items ?? []).forEach((item, idx) => {
      let lineTotal = new Decimal(0);
      let lineTax = new Decimal(0);
      try {
        const price = (item as unknown as Record<string, string>)[priceField] ?? "0";
        lineTotal = new Decimal(item.quantity || "0").times(price || "0");
        lineTax = lineTotal.times(item.taxRate || "0");
      } catch {
        // ignore unparsable rows while the user is still typing
      }
      const base = lineTotal.plus(lineTax);
      for (const feeId of itemFeeSlots[idx] ?? []) {
        if (!feeId) continue;
        const opt = feeOptions.find((f) => f.id === feeId);
        if (!opt) continue;
        let amt = new Decimal(0);
        try {
          amt = base.times(opt.rate);
        } catch {
          // ignore
        }
        const cur = feeAgg.get(feeId);
        if (cur) {
          cur.amount = new Decimal(cur.amount).plus(amt).toFixed(2);
        } else {
          feeAgg.set(feeId, { id: opt.id, label: opt.label, rate: opt.rate, amount: amt.toFixed(2) });
        }
      }
    });
    onFeesChange(Array.from(feeAgg.values()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, itemFeeSlots, feeOptions]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
        <button
          type="button"
          onClick={() => {
            append({
              description: "",
              itemDescription: "",
              quantity: "1",
              [priceField]: "0",
              taxRate: "0",
            } as never);
            setItemFeeSlots((prev) => [...prev, []]);
          }}
          className="btn-secondary text-xs py-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field, index) => {
          const feeSlots = feeOptions.length > 0
            ? (itemFeeSlots[index] && itemFeeSlots[index].length > 0 ? itemFeeSlots[index] : [null])
            : [];
          const usedFeeIds = feeSlots.filter((fid): fid is string => fid !== null);

          return (
            <div key={field.id} className="bg-gray-50 rounded-lg p-2 space-y-1">
              <div className="grid grid-cols-12 gap-2 items-start">
                {/* Item name — col 0-2 */}
                <div className="col-span-3">
                  <input
                    className="input text-sm"
                    placeholder="Item name"
                    {...register(`${fieldName}.${index}.description` as Path<T>)}
                  />
                </div>
                {/* Item description — col 3-5 */}
                <div className="col-span-3">
                  <input
                    className="input text-sm text-gray-600"
                    placeholder="Description (optional)"
                    {...register(`${fieldName}.${index}.itemDescription` as Path<T>)}
                  />
                </div>
                {/* Qty */}
                <div className="col-span-1">
                  <input
                    className="input text-sm"
                    placeholder="Qty"
                    type="number"
                    step="0.0001"
                    min="0"
                    {...register(`${fieldName}.${index}.quantity` as Path<T>)}
                  />
                </div>
                {/* Price */}
                <div className="col-span-2">
                  <input
                    className="input text-sm"
                    placeholder={priceLabel}
                    type="number"
                    step="0.01"
                    min="0"
                    {...register(`${fieldName}.${index}.${priceField}` as Path<T>)}
                  />
                </div>
                {/* Tax rate */}
                <div className="col-span-1">
                  {taxRates.length > 0 ? (
                    <select
                      className="input text-sm"
                      {...register(`${fieldName}.${index}.taxRate` as Path<T>)}
                    >
                      <option value="0">No tax</option>
                      {taxRates.map((t) => (
                        <option key={t.id} value={t.rate}>
                          {t.name} ({(parseFloat(t.rate) * 100).toFixed(2)}%)
                        </option>
                      ))}
                      {(() => {
                        const currentRate = items?.[index]?.taxRate;
                        if (
                          currentRate &&
                          parseFloat(currentRate) !== 0 &&
                          !taxRates.some((t) => parseFloat(t.rate) === parseFloat(currentRate))
                        ) {
                          return (
                            <option value={currentRate}>
                              Custom ({(parseFloat(currentRate) * 100).toFixed(2)}%)
                            </option>
                          );
                        }
                        return null;
                      })()}
                    </select>
                  ) : (
                    <input
                      className="input text-sm"
                      placeholder="Tax"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      {...register(`${fieldName}.${index}.taxRate` as Path<T>)}
                    />
                  )}
                </div>
                {/* Line total */}
                <div className="col-span-1 text-right pt-2">
                  <LinePreview
                    quantity={items?.[index]?.quantity ?? "0"}
                    price={(items?.[index] as unknown as Record<string, string>)?.[priceField] ?? "0"}
                    taxRate={items?.[index]?.taxRate ?? "0"}
                  />
                </div>
                {/* Delete */}
                <div className="col-span-1 flex justify-end pt-1">
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        remove(index);
                        setItemFeeSlots((prev) => prev.filter((_, i) => i !== index));
                      }}
                      className="p-1 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Per-line fees */}
              {feeSlots.map((feeId, slotIdx) => {
                const opt = feeId ? feeOptions.find((f) => f.id === feeId) : null;
                let amt: Decimal | null = null;
                if (opt) {
                  try {
                    const price = (items?.[index] as unknown as Record<string, string>)?.[priceField] ?? "0";
                    const lineTotal = new Decimal(items?.[index]?.quantity || "0").times(price || "0");
                    const lineTax = lineTotal.times(items?.[index]?.taxRate || "0");
                    amt = lineTotal.plus(lineTax).times(opt.rate);
                  } catch {
                    amt = new Decimal(0);
                  }
                }
                const isLast = slotIdx === feeSlots.length - 1;
                return (
                  <div key={slotIdx} className="grid grid-cols-12 gap-2 items-center pl-4">
                    <div className="col-span-1 text-right text-xs uppercase tracking-wide text-gray-400 font-medium">
                      Fee
                    </div>
                    <div className="col-span-6">
                      <select
                        className="input text-sm"
                        value={feeId ?? ""}
                        onChange={(e) => selectLineFee(index, slotIdx, e.target.value || null)}
                      >
                        <option value="">Select a fee</option>
                        {feeOptions
                          .filter((f) => f.id === feeId || !usedFeeIds.includes(f.id))
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label} ({(f.rate * 100).toFixed(2)}%)
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-gray-700">
                      {amt !== null ? `$${amt.toFixed(2)}` : <span className="text-gray-300">—</span>}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {(feeId || !isLast) && (
                        <button
                          type="button"
                          onClick={() => removeLineFee(index, slotIdx)}
                          className="p-1 text-gray-300 hover:text-red-500"
                          aria-label="Remove fee"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-10 text-right text-xs text-gray-500 pr-2">
          <span className="uppercase tracking-wide">Name · Description · Qty · {priceLabel} · Tax · Total</span>
        </div>
      </div>
    </div>
  );
}
