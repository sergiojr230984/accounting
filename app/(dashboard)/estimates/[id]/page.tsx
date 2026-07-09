"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Edit2, Save, X, Trash2, Loader2, Send, Copy, Check, Printer, ArrowRightCircle } from "lucide-react";
import { generateInvoicePDF } from "@/lib/invoice-pdf";
import { formatDateOnly } from "@/lib/date";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import InvoiceDocumentPreview from "@/components/InvoiceDocumentPreview";
import { formatCurrency } from "@/lib/money";

type EstimateStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";

const editSchema = z.object({
  estimateNumber: z.string().min(1),
  estimateDate: z.string(),
  expiryDate: z.string().optional(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"]),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1),
      itemDescription: z.string().optional(),
      quantity: z.string(),
      unitPrice: z.string(),
      taxRate: z.string().default("0"),
    })
  ),
});
type EditForm = z.infer<typeof editSchema>;

interface EstimateDetail {
  id: string;
  estimateNumber: string;
  estimateDate: string;
  expiryDate: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  status: EstimateStatus;
  notes: string | null;
  viewToken: string | null;
  sentAt: string | null;
  convertedInvoiceId: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null; address: string | null };
  items: { id: string; description: string; itemDescription: string | null; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }[];
}

function StatusBadge({ status }: { status: EstimateStatus }) {
  const styles: Record<EstimateStatus, string> = {
    DRAFT: "bg-gray-100 text-gray-600",
    SENT: "bg-blue-50 text-blue-700 border border-blue-100",
    ACCEPTED: "bg-green-50 text-green-700 border border-green-100",
    DECLINED: "bg-red-50 text-red-700 border border-red-100",
    EXPIRED: "bg-amber-50 text-amber-700 border border-amber-100",
  };
  const labels: Record<EstimateStatus, string> = {
    DRAFT: "Draft", SENT: "Sent", ACCEPTED: "Accepted", DECLINED: "Declined", EXPIRED: "Expired",
  };
  return <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${styles[status]}`}>{labels[status]}</span>;
}

export default function EstimateDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [converting, setConverting] = useState(false);

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  const watchedItems = watch("items");
  const watchedEstimateNumber = watch("estimateNumber");
  const watchedEstimateDate = watch("estimateDate");
  const watchedExpiryDate = watch("expiryDate");
  const watchedNotes = watch("notes");

  const load = useCallback(async () => {
    const res = await fetch(`/api/estimates/${id}`);
    if (!res.ok) { router.push("/estimates"); return; }
    const data = await res.json();
    setEstimate(data);
    reset({
      estimateNumber: data.estimateNumber,
      estimateDate: data.estimateDate.split("T")[0],
      expiryDate: data.expiryDate ? data.expiryDate.split("T")[0] : "",
      status: data.status,
      notes: data.notes ?? "",
      items: data.items.map((item: EstimateDetail["items"][0]) => ({
        description: item.description,
        itemDescription: item.itemDescription ?? "",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
      })),
    });
  }, [id, reset, router]);

  useEffect(() => { load(); }, [load]);

  async function onSave(data: EditForm) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/estimates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed");
        return;
      }
      await load();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/estimates/${id}`, { method: "DELETE" });
    router.push("/estimates");
  }

  async function handleSend() {
    setSending(true);
    setSendMessage(null);
    try {
      const res = await fetch(`/api/estimates/${id}/send`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendMessage({ kind: "error", text: data.error ?? "Failed to send" });
        if (data.link) { await load(); }
      } else {
        setSendMessage({ kind: "success", text: `Sent to ${estimate?.customer.email}` });
        await load();
      }
    } catch (e) {
      setSendMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function handleConvert() {
    setConverting(true);
    try {
      const res = await fetch(`/api/estimates/${id}/convert`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to convert to invoice");
        return;
      }
      router.push(`/invoices/customer/${data.invoiceId}`);
    } finally {
      setConverting(false);
    }
  }

  async function copyLink() {
    if (!estimate?.viewToken) return;
    const url = `${window.location.origin}/estimate/${estimate.viewToken}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function fetchCompany() {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) return await res.json();
    } catch { /* ignore */ }
    return null;
  }

  async function buildPdf() {
    if (!estimate) return null;
    const company = await fetchCompany();
    return generateInvoicePDF({
      invoiceNumber: estimate.estimateNumber,
      invoiceDate: estimate.estimateDate,
      dueDate: estimate.expiryDate,
      subtotal: estimate.subtotal,
      taxAmount: estimate.taxAmount,
      totalAmount: estimate.totalAmount,
      paidAmount: "0",
      notes: estimate.notes,
      customer: estimate.customer,
      items: estimate.items,
      company,
      kind: "estimate",
    });
  }

  async function printPDF() {
    const doc = await buildPdf();
    if (!doc) return;
    const url = doc.output("bloburl");
    window.open(url, "_blank");
  }

  async function downloadPDF() {
    if (!estimate) return;
    const doc = await buildPdf();
    if (!doc) return;
    doc.save(`${estimate.estimateNumber}.pdf`);
  }

  if (!estimate) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/estimates" className="btn-secondary p-2">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{estimate.estimateNumber}</h1>
            <p className="text-sm text-gray-500">{estimate.customer.name}</p>
          </div>
          <StatusBadge status={estimate.status} />
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              {estimate.convertedInvoiceId ? (
                <Link href={`/invoices/customer/${estimate.convertedInvoiceId}`} className="btn-primary" title="View the invoice created from this estimate">
                  <ArrowRightCircle className="w-4 h-4" />
                  View Invoice
                </Link>
              ) : (
                <button onClick={handleConvert} disabled={converting} className="btn-primary" title="Turn this estimate into a real invoice">
                  {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
                  Convert to Invoice
                </button>
              )}
              <button onClick={printPDF} className="btn-secondary" title="Print or save as PDF">
                <Printer className="w-4 h-4" />
                Print
              </button>
              <button onClick={downloadPDF} className="btn-secondary" title="Download PDF">
                <Save className="w-4 h-4" />
                PDF
              </button>
              <button onClick={handleSend} disabled={sending} className="btn-secondary" title="Email estimate to customer">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {estimate.sentAt ? "Resend" : "Email"}
              </button>
              {estimate.viewToken && (
                <button onClick={copyLink} className="btn-secondary" title="Copy shareable link">
                  {linkCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  {linkCopied ? "Copied" : "Link"}
                </button>
              )}
              <button onClick={() => setEditing(true)} className="btn-secondary">
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="btn-danger">
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                  <span className="text-sm text-red-700">Confirm delete?</span>
                  <button onClick={handleDelete} disabled={deleting} className="text-red-700 font-medium text-sm hover:underline">
                    {deleting ? "…" : "Yes"}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-gray-500 text-sm hover:underline">No</button>
                </div>
              )}
            </>
          ) : (
            <>
              <button onClick={() => { setEditing(false); setError(""); reset(); }} className="btn-secondary">
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button onClick={handleSubmit(onSave)} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {sendMessage && (
        <div
          className={`px-4 py-3 rounded-lg text-sm border ${
            sendMessage.kind === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {sendMessage.text}
        </div>
      )}

      {estimate.convertedInvoiceId && (
        <div className="bg-brand-50 border border-brand-200 text-brand-800 px-4 py-2 rounded-lg text-xs">
          This estimate was converted to an invoice.
        </div>
      )}

      {editing ? (
        <form className="space-y-6">
          <div className="card space-y-4">
            <h2 className="font-semibold">Edit Estimate</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Estimate Number</label>
                <input className="input" {...register("estimateNumber")} />
                {errors.estimateNumber && <p className="text-red-500 text-xs mt-1">{errors.estimateNumber.message}</p>}
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" {...register("status")}>
                  <option value="DRAFT">Draft</option>
                  <option value="SENT">Sent</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="DECLINED">Declined</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
              <div>
                <label className="label">Estimate Date</label>
                <input type="date" className="input" {...register("estimateDate")} />
              </div>
              <div>
                <label className="label">Valid Until</label>
                <input type="date" className="input" {...register("expiryDate")} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} {...register("notes")} />
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
            partyName={estimate.customer.name}
            partyEmail={estimate.customer.email}
            partyPhone={estimate.customer.phone}
            partyAddress={estimate.customer.address}
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
        </form>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6">
            <div className="card space-y-3">
              <h2 className="font-semibold text-gray-800">Estimate Info</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Estimate Date</span>
                  <span>{formatDateOnly(estimate.estimateDate)}</span>
                </div>
                {estimate.expiryDate && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Valid Until</span>
                    <span>{formatDateOnly(estimate.expiryDate)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <StatusBadge status={estimate.status} />
                </div>
                {estimate.notes && (
                  <div className="pt-2 border-t">
                    <span className="text-gray-500">Notes: </span>
                    <span>{estimate.notes}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="card space-y-3">
              <h2 className="font-semibold text-gray-800">Customer</h2>
              <div className="space-y-2 text-sm">
                <p className="font-medium">{estimate.customer.name}</p>
                {estimate.customer.email && <p className="text-gray-500">{estimate.customer.email}</p>}
                {estimate.customer.phone && <p className="text-gray-500">{estimate.customer.phone}</p>}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Line Items</h2>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-gray-500">
                  <th className="pb-2">Description</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Unit Price</th>
                  <th className="pb-2 text-right">Tax Rate</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {estimate.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2">
                      <div>{item.description}</div>
                      {item.itemDescription && (
                        <div className="text-xs text-gray-400 mt-0.5">{item.itemDescription}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-2 text-right">{(parseFloat(item.taxRate) * 100).toFixed(0)}%</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 pt-4 border-t space-y-1 text-sm text-right">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{formatCurrency(estimate.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span>{formatCurrency(estimate.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Estimated Total</span>
                <span>{formatCurrency(estimate.totalAmount)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
