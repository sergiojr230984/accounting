"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";

const schema = z.object({
  supplierId: z.string().min(1, "Select a supplier"),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1, "Required"),
  dueDate: z.string().optional(),
  category: z.enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"]),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paidAmount: z.string().default("0"),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1, "Required"),
      quantity: z.string().min(1),
      unitCost: z.string().min(1),
      taxRate: z.string().default("0"),
    })
  ).min(1),
});
type FormData = z.infer<typeof schema>;

interface Supplier { id: string; name: string }

export default function NewSupplierInvoicePage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { register, handleSubmit, control, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: "COGS",
      paymentStatus: "UNPAID",
      paidAmount: "0",
      items: [{ description: "", quantity: "1", unitCost: "0", taxRate: "0" }],
    },
  });

  useEffect(() => {
    fetch("/api/suppliers").then((r) => r.json()).then(setSuppliers);
  }, []);

  async function onSubmit(data: FormData) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/invoices/supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error?.formErrors?.[0] ?? d.error ?? "Failed to create invoice");
        return;
      }
      const inv = await res.json();
      router.push(`/invoices/supplier/${inv.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/invoices/supplier" className="btn-secondary p-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Supplier Invoice</h1>
          <p className="text-sm text-gray-500">Create a purchase invoice</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Invoice Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Supplier *</label>
              <select className="input" {...register("supplierId")}>
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {errors.supplierId && <p className="text-red-500 text-xs mt-1">{errors.supplierId.message}</p>}
              <Link href="/suppliers" className="text-xs text-brand-600 mt-1 inline-block">+ Add new supplier</Link>
            </div>

            <div>
              <label className="label">Invoice Number *</label>
              <input className="input" placeholder="SUP-2024-001" {...register("invoiceNumber")} />
              {errors.invoiceNumber && <p className="text-red-500 text-xs mt-1">{errors.invoiceNumber.message}</p>}
            </div>

            <div>
              <label className="label">Invoice Date *</label>
              <input type="date" className="input" {...register("invoiceDate")} />
              {errors.invoiceDate && <p className="text-red-500 text-xs mt-1">{errors.invoiceDate.message}</p>}
            </div>

            <div>
              <label className="label">Due Date</label>
              <input type="date" className="input" {...register("dueDate")} />
            </div>

            <div>
              <label className="label">Category *</label>
              <select className="input" {...register("category")}>
                <option value="COGS">Cost of Goods Sold</option>
                <option value="SERVICES_EXPENSE">Services Expense</option>
                <option value="OPERATING_EXPENSE">Operating Expense</option>
                <option value="OTHER">Other</option>
              </select>
              {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
            </div>

            <div>
              <label className="label">Payment Status</label>
              <select className="input" {...register("paymentStatus")}>
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PAID">Paid</option>
              </select>
            </div>

            <div>
              <label className="label">Amount Paid ($)</label>
              <input type="number" step="0.01" min="0" className="input" {...register("paidAmount")} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} placeholder="Internal notes…" {...register("notes")} />
          </div>
        </div>

        <div className="card">
          <InvoiceItemsEditor control={control} type="supplier" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 justify-end">
          <Link href="/invoices/supplier" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Invoice
          </button>
        </div>
      </form>
    </div>
  );
}
