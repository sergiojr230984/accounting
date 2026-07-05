"use client";

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

interface InvoiceItemsEditorProps<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T> | any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<T> | any;
  fieldName?: string;
  type: "customer" | "supplier";
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
}: InvoiceItemsEditorProps<T>) {
  const { fields, append, remove } = useFieldArray({ control, name: fieldName as Path<T> as never });
  const items = useWatch({ control, name: fieldName as Path<T> as never }) as unknown as ItemRow[];

  const priceField = type === "customer" ? "unitPrice" : "unitCost";
  const priceLabel = type === "customer" ? "Unit Price" : "Unit Cost";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
        <button
          type="button"
          onClick={() =>
            append({
              description: "",
              itemDescription: "",
              quantity: "1",
              [priceField]: "0",
              taxRate: "0",
            } as never)
          }
          className="btn-secondary text-xs py-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-12 gap-2 items-start bg-gray-50 rounded-lg p-2">
            {/* Item name */}
            <div className="col-span-3">
              <input
                className="input text-sm"
                placeholder="Item name"
                {...register(`${fieldName}.${index}.description` as Path<T>)}
              />
            </div>
            {/* Item description */}
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
              <input
                className="input text-sm"
                placeholder="Tax"
                type="number"
                step="0.001"
                min="0"
                max="1"
                {...register(`${fieldName}.${index}.taxRate` as Path<T>)}
              />
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
                  onClick={() => remove(index)}
                  className="p-1 text-red-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-10 text-right text-xs text-gray-500 pr-2">
          <span className="uppercase tracking-wide">Name · Description · Qty · {priceLabel} · Tax · Total</span>
        </div>
      </div>
    </div>
  );
}
