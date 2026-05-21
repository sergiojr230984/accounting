"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import Decimal from "decimal.js";

const schema = z.object({
  customerId: z.string().min(1, "Select a customer"),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1, "Required"),
  dueDate: z.string().min(1, "Required"),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paidAmount: z.string().default("0"),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1, "Required"),
      quantity: z.string().min(1),
      unitPrice: z.string().min(1),
      taxRate: z.string().default("0"),
    })
  ).min(1),
});

type FormData = z.infer<typeof schema>;

interface Customer { id: string; name: string }

export default function NewCustomerInvoicePage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      paymentStatus: "UNPAID",
      paidAmount: "0",
      items: [{ description: "", quantity: "1", unitPrice: "0", taxRate: "0" }],
    },
  });

  const items = watch("items");
  const subtotal = items?.reduce((sum, item) => {
    try {
      return sum.plus(new Decimal(item.quantity || "0").times(new Decimal(item.unitPrice || "0")));
    } catch { return sum; }
  }, new Decimal(0)) ?? new Decimal(0);

  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then(setCustomers);
  }, []);

  async function onSubmit(data: FormData) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/invoices/customer", {
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
      router.push(`/invoices/customer/${inv.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/invoices/customer" className="btn-secondary p-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Customer Invoice</h1>
          <p className="text-sm text-gray-500">Create a sales invoice</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Invoice Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Customer *</label>
              <select className="input" {...register("customerId")}>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.customerId && <p className="text-red-500 text-xs mt-1">{errors.customerId.message}</p>}
              <Link href="/customers" className="text-xs text-brand-600 mt-1 inline-block">+ Add new customer</Link>
            </div>

            <div>
              <label className="label">Invoice Number *</label>
              <input className="input" placeholder="INV-2024-001" {...register("invoiceNumber")} />
              {errors.invoiceNumber && <p className="text-red-500 text-xs mt-1">{errors.invoiceNumber.message}</p>}
            </div>

            <div>
              <label className="label">Invoice Date *</label>
              <input type="date" className="input" {...register("invoiceDate")} />
              {errors.invoiceDate && <p className="text-red-500 text-xs mt-1">{errors.invoiceDate.message}</p>}
            </div>

            <div>
              <label className="label">Due Date *</label>
              <input type="date" className="input" {...register("dueDate")} />
              {errors.dueDate && <p className="text-red-500 text-xs mt-1">{errors.dueDate.message}</p>}
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
          <InvoiceItemsEditor control={control} type="customer" />
          <div className="mt-4 pt-4 border-t text-right text-sm">
            <span className="text-gray-500">Subtotal (before tax): </span>
            <span className="font-semibold">${subtotal.toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 justify-end">
          <Link href="/invoices/customer" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Invoice
          </button>
        </div>
      </form>
    </div>
  );
}
