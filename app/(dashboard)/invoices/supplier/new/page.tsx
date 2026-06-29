"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import InvoiceExtractor from "@/components/InvoiceExtractor";

const schema = z.object({
  supplierId: z.string().min(1, "Select a supplier"),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1, "Required"),
  dueDate: z.string().optional(),
  category: z.enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"]),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paidAmount: z.string().default("0"),
  notes: z.string().optional(),
  customerInvoiceRef: z.string().optional(),
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
  const [newSupplierName, setNewSupplierName] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const { register, handleSubmit, control, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: "COGS",
      paymentStatus: "UNPAID",
      paidAmount: "0",
      customerInvoiceRef: "",
      items: [{ description: "", quantity: "1", unitCost: "0", taxRate: "0" }],
    },
  });

  async function loadSuppliers() {
    const res = await fetch("/api/suppliers");
    const list = await res.json();
    setSuppliers(list);
    return list as Supplier[];
  }

  useEffect(() => { loadSuppliers(); }, []);

  async function handleExtracted(data: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    supplierName?: string | null;
    category?: "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER" | null;
    items?: { description: string; quantity: string; unitCost: string; taxRate: string }[];
    notes?: string | null;
  }) {
    if (data.invoiceNumber) setValue("invoiceNumber", data.invoiceNumber);
    if (data.invoiceDate) setValue("invoiceDate", data.invoiceDate);
    if (data.dueDate) setValue("dueDate", data.dueDate);
    if (data.notes) setValue("notes", data.notes);
    if (data.category) setValue("category", data.category);

    if (data.items && data.items.length > 0) {
      setValue("items", data.items.map((item) => ({
        description: item.description ?? "",
        quantity: item.quantity ?? "1",
        unitCost: item.unitCost ?? "0",
        taxRate: item.taxRate ?? "0",
      })));
    }

    if (data.supplierName) {
      const current = await loadSuppliers();
      const lower = data.supplierName.toLowerCase();
      const match = current.find(
        (s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())
      );
      if (match) {
        setValue("supplierId", match.id);
      } else {
        setNewSupplierName(data.supplierName);
      }
    }
  }

  async function createAndSelectSupplier() {
    if (!newSupplierName) return;
    setCreatingSupplier(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSupplierName }),
      });
      if (res.ok) {
        const s = await res.json();
        await loadSuppliers();
        setValue("supplierId", s.id);
        setNewSupplierName("");
      }
    } finally {
      setCreatingSupplier(false);
    }
  }

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
          <p className="text-sm text-gray-500">Upload an invoice file or fill in the form manually</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Step 1 — Upload Invoice (optional)</h2>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">AI-powered</span>
        </div>
        <InvoiceExtractor type="supplier" onExtracted={handleExtracted} />
      </div>

      {newSupplierName && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-yellow-800">
              Supplier not found: <span className="font-bold">{newSupplierName}</span>
            </p>
            <p className="text-xs text-yellow-600 mt-0.5">Create them now and auto-select?</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setNewSupplierName("")} className="btn-secondary text-xs py-1.5">Skip</button>
            <button onClick={createAndSelectSupplier} disabled={creatingSupplier} className="btn-primary text-xs py-1.5">
              {creatingSupplier && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create &amp; Select
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Step 2 — Review &amp; Complete Invoice Details</h2>

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

            <div>
              <label className="label">Customer Invoice # (for profitability)</label>
              <input
                className="input"
                placeholder="e.g. INV-2026-1001"
                {...register("customerInvoiceRef")}
              />
              <p className="text-xs text-gray-400 mt-0.5">Links this cost to a customer invoice for the profitability report</p>
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
