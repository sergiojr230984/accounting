"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Edit2, Save, X, Trash2, Loader2, Send, Copy, Check } from "lucide-react";
import { format } from "date-fns";
import PaymentBadge from "@/components/PaymentBadge";
import FileUpload from "@/components/FileUpload";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import { formatCurrency } from "@/lib/money";

const editSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paidAmount: z.string(),
  downPayment: z.string().default("0"),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      description: z.string().min(1),
      quantity: z.string(),
      unitPrice: z.string(),
      taxRate: z.string().default("0"),
    })
  ),
});
type EditForm = z.infer<typeof editSchema>;

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  downPayment: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  notes: string | null;
  viewToken: string | null;
  sentAt: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null };
  items: { id: string; description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }[];
  payments: { id: string; amount: string; paymentDate: string; notes: string | null }[];
  files: { id: string; originalName: string; mimeType: string }[];
}

export default function CustomerInvoiceDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/invoices/customer/${id}`);
    if (!res.ok) { router.push("/invoices/customer"); return; }
    const data = await res.json();
    setInvoice(data);
    reset({
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate.split("T")[0],
      dueDate: data.dueDate.split("T")[0],
      paymentStatus: data.paymentStatus,
      paidAmount: data.paidAmount,
      downPayment: data.downPayment ?? "0",
      notes: data.notes ?? "",
      items: data.items.map((item: InvoiceDetail["items"][0]) => ({
        description: item.description,
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
      const res = await fetch(`/api/invoices/customer/${id}`, {
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
    await fetch(`/api/invoices/customer/${id}`, { method: "DELETE" });
    router.push("/invoices/customer");
  }

  async function handleSend() {
    setSending(true);
    setSendMessage(null);
    try {
      const res = await fetch(`/api/invoices/customer/${id}/send`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendMessage({ kind: "error", text: data.error ?? "Failed to send" });
        if (data.link) {
          // even if email failed, we have a public link
          await load();
        }
      } else {
        setSendMessage({ kind: "success", text: `Sent to ${invoice?.customer.email}` });
        await load();
      }
    } catch (e) {
      setSendMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    if (!invoice?.viewToken) return;
    const url = `${window.location.origin}/pay/${invoice.viewToken}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  if (!invoice) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/invoices/customer" className="btn-secondary p-2">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
            <p className="text-sm text-gray-500">{invoice.customer.name}</p>
          </div>
          <PaymentBadge status={invoice.paymentStatus} />
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <button onClick={handleSend} disabled={sending} className="btn-primary">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {invoice.sentAt ? "Resend" : "Send"}
              </button>
              {invoice.viewToken && (
                <button onClick={copyLink} className="btn-secondary" title="Copy payment link">
                  {linkCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  {linkCopied ? "Copied" : "Copy link"}
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

      {invoice.sentAt && (
        <div className="bg-brand-50 border border-brand-200 text-brand-800 px-4 py-2 rounded-lg text-xs">
          Last sent {format(new Date(invoice.sentAt), "MMM d, yyyy 'at' h:mm a")}
        </div>
      )}

      {editing ? (
        <form className="space-y-6">
          <div className="card space-y-4">
            <h2 className="font-semibold">Edit Invoice</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Invoice Number</label>
                <input className="input" {...register("invoiceNumber")} />
                {errors.invoiceNumber && <p className="text-red-500 text-xs mt-1">{errors.invoiceNumber.message}</p>}
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
                <label className="label">Invoice Date</label>
                <input type="date" className="input" {...register("invoiceDate")} />
              </div>
              <div>
                <label className="label">Due Date</label>
                <input type="date" className="input" {...register("dueDate")} />
              </div>
              <div>
                <label className="label">Amount Paid ($)</label>
                <input type="number" step="0.01" min="0" className="input" {...register("paidAmount")} />
              </div>
              <div>
                <label className="label">Down payment ($)</label>
                <input type="number" step="0.01" min="0" className="input" {...register("downPayment")} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} {...register("notes")} />
            </div>
          </div>
          <div className="card">
            <InvoiceItemsEditor control={control} type="customer" />
          </div>
        </form>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6">
            <div className="card space-y-3">
              <h2 className="font-semibold text-gray-800">Invoice Info</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Invoice Date</span>
                  <span>{format(new Date(invoice.invoiceDate), "MMM d, yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Due Date</span>
                  <span>{format(new Date(invoice.dueDate), "MMM d, yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <PaymentBadge status={invoice.paymentStatus} />
                </div>
                {invoice.notes && (
                  <div className="pt-2 border-t">
                    <span className="text-gray-500">Notes: </span>
                    <span>{invoice.notes}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="card space-y-3">
              <h2 className="font-semibold text-gray-800">Customer</h2>
              <div className="space-y-2 text-sm">
                <p className="font-medium">{invoice.customer.name}</p>
                {invoice.customer.email && <p className="text-gray-500">{invoice.customer.email}</p>}
                {invoice.customer.phone && <p className="text-gray-500">{invoice.customer.phone}</p>}
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
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2">{item.description}</td>
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
                <span>{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span>{formatCurrency(invoice.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total</span>
                <span>{formatCurrency(invoice.totalAmount)}</span>
              </div>
              {parseFloat(invoice.downPayment) > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Down payment</span>
                  <span>−{formatCurrency(invoice.downPayment)}</span>
                </div>
              )}
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span>{formatCurrency(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-red-600">
                <span>Balance Due</span>
                <span>
                  {formatCurrency(
                    (
                      parseFloat(invoice.totalAmount) -
                      parseFloat(invoice.paidAmount) -
                      parseFloat(invoice.downPayment)
                    ).toFixed(2)
                  )}
                </span>
              </div>
            </div>
          </div>

          {invoice.payments.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-800 mb-4">Payments</h2>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-gray-500">
                    <th className="pb-2">Date</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoice.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">{format(new Date(p.paymentDate), "MMM d, yyyy")}</td>
                      <td className="py-2 text-right font-medium text-green-700">{formatCurrency(p.amount)}</td>
                      <td className="py-2 text-gray-500">{p.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Attachments</h2>
            <FileUpload invoiceId={id} type="customer" existingFiles={invoice.files} onUploaded={load} />
          </div>
        </>
      )}
    </div>
  );
}
