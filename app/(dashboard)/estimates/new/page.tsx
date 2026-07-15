"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import InvoiceDocumentPreview from "@/components/InvoiceDocumentPreview";

const schema = z.object({
  customerId: z.string().min(1, "Select a customer"),
  estimateNumber: z.string().min(1, "Required"),
  estimateDate: z.string().min(1, "Required"),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1, "Required"),
      itemDescription: z.string().optional(),
      quantity: z.string().min(1),
      unitPrice: z.string().min(1),
      taxRate: z.string().default("0"),
    })
  ).min(1),
});
type FormData = z.infer<typeof schema>;

interface Customer { id: string; name: string; email: string | null; phone: string | null; address: string | null }

const todayISO = () => new Date().toISOString().split("T")[0];

export default function NewEstimatePage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      estimateDate: todayISO(),
      items: [{ description: "", quantity: "1", unitPrice: "0", taxRate: "0" }],
    },
  });

  const watchedItems = watch("items");
  const watchedCustomerId = watch("customerId");
  const watchedEstimateNumber = watch("estimateNumber");
  const watchedEstimateDate = watch("estimateDate");
  const watchedExpiryDate = watch("expiryDate");
  const watchedNotes = watch("notes");
  const selectedCustomer = customers.find((c) => c.id === watchedCustomerId);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setCustomers(list))
      .catch(() => {});
    fetch("/api/estimates/next-number")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { nextNumber?: string } | null) => { if (d?.nextNumber) setValue("estimateNumber", d.nextNumber); })
      .catch(() => {});
  }, [setValue]);

  async function onSubmit(data: FormData) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error?.formErrors?.[0] ?? d.error ?? "Failed to create estimate");
        return;
      }
      const est = await res.json();
      router.push(`/estimates/${est.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/estimates" className="btn-secondary p-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Estimate</h1>
          <p className="text-sm text-gray-500">Give the customer a price before they've decided — nothing is due until you convert it to an invoice.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Estimate Details</h2>

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
              <label className="label">Estimate Number *</label>
              <input className="input" placeholder="EST-2026-1001" {...register("estimateNumber")} />
              {errors.estimateNumber && <p className="text-red-500 text-xs mt-1">{errors.estimateNumber.message}</p>}
            </div>

            <div>
              <label className="label">Estimate Date *</label>
              <input type="date" className="input" {...register("estimateDate")} />
              {errors.estimateDate && <p className="text-red-500 text-xs mt-1">{errors.estimateDate.message}</p>}
            </div>

            <div>
              <label className="label">Valid Until</label>
              <input type="date" className="input" {...register("expiryDate")} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} placeholder="e.g. Price valid for 30 days, excludes delivery…" {...register("notes")} />
          </div>
        </div>

        <div className="card">
          <InvoiceItemsEditor control={control} register={register} type="customer" />
        </div>

        <InvoiceDocumentPreview
          docType="ESTIMATE"
          number={watchedEstimateNumber ?? ""}
          date={watchedEstimateDate ?? ""}
          dueDate={watchedExpiryDate}
          dueDateLabel="Valid Until"
          partyLabel="Prepared For"
          partyName={selectedCustomer?.name ?? ""}
          partyEmail={selectedCustomer?.email}
          partyPhone={selectedCustomer?.phone}
          partyAddress={selectedCustomer?.address}
          priceLabel="Unit Price"
          items={(watchedItems ?? []).map((item) => ({
            description: item.description,
            quantity: item.quantity,
            price: item.unitPrice,
            taxRate: item.taxRate,
          }))}
          notes={watchedNotes}
          paidAmount="0"
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 justify-end">
          <Link href="/estimates" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Estimate
          </button>
        </div>
      </form>
    </div>
  );
}
