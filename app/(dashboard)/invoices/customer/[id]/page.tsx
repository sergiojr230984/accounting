"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Edit2, Save, X, Trash2, Loader2, Send, Copy, Check, Printer, Plus, Eye } from "lucide-react";
import { generateInvoicePDF } from "@/lib/invoice-pdf";
import { format } from "date-fns";
import PaymentBadge from "@/components/PaymentBadge";
import FileUpload from "@/components/FileUpload";
import InvoiceItemsEditor from "@/components/InvoiceItemsEditor";
import { formatCurrency } from "@/lib/money";
import Decimal from "decimal.js";

const editSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paidAmount: z.string(),
  downPayment: z.string().default("0"),
  employeeId: z.string().default(""),
  commissionRate: z.string().default("0"),
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
  creditCardFee: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  notes: string | null;
  viewToken: string | null;
  sentAt: string | null;
  employeeId: string | null;
  commissionRate: string;
  employee: { id: string; name: string } | null;
  appliedFees: { id?: string; label: string; rate?: number; amount: string }[];
  customer: { id: string; name: string; email: string | null; phone: string | null; address: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null };
  items: { id: string; description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }[];
  payments: { id: string; amount: string; paymentDate: string; notes: string | null }[];
  files: { id: string; originalName: string; mimeType: string }[];
}

interface EmployeeOpt { id: string; name: string; commissionRate: string }

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
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "" });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const { register, handleSubmit, control, reset, getValues, setValue, watch, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  // Watch paidAmount and downPayment to auto-derive paymentStatus in real-time
  const watchedPaid = watch("paidAmount");
  const watchedDown = watch("downPayment");

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
      employeeId: data.employeeId ?? "",
      commissionRate: data.commissionRate ?? "0",
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

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string; commissionRate: string; active: boolean }[]) =>
        setEmployees(list.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, commissionRate: e.commissionRate })))
      )
      .catch(() => {});
  }, []);

  // Auto-update paymentStatus when paidAmount or downPayment changes in edit mode
  useEffect(() => {
    if (!editing || !invoice) return;
    try {
      const total = new Decimal(invoice.totalAmount || "0");
      const paid = new Decimal(watchedPaid || "0");
      const down = new Decimal(watchedDown || "0");
      const balance = total.minus(paid).minus(down);
      let status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
      if (balance.lte(0)) {
        status = "PAID";
      } else if (paid.gt(0) || down.gt(0)) {
        status = "PARTIALLY_PAID";
      } else {
        status = "UNPAID";
      }
      setValue("paymentStatus", status, { shouldValidate: false });
    } catch {
      // Ignore Decimal parse errors on incomplete / empty input
    }
  }, [watchedPaid, watchedDown, editing, invoice, setValue]);

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
        if (data.link) { await load(); }
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

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      setPaymentError("Please enter a valid amount");
      return;
    }
    setPaymentSubmitting(true);
    setPaymentError("");
    try {
      const res = await fetch(`/api/invoices/customer/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentForm),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPaymentError(d.error ?? "Failed to record payment");
        return;
      }
      setShowPaymentForm(false);
      setPaymentForm({ amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "" });
      await load();
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    setDeletingPaymentId(paymentId);
    try {
      const res = await fetch(`/api/invoices/customer/${id}/payments/${paymentId}`, { method: "DELETE" });
      if (res.ok) await load();
    } finally {
      setDeletingPaymentId(null);
    }
  }

  async function copyLink() {
    if (!invoice?.viewToken) return;
    const url = `${window.location.origin}/pay/${invoice.viewToken}`;
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

  async function downloadPDF() {
    if (!invoice) return;
    const company = await fetchCompany();
    const doc = generateInvoicePDF({ ...invoice, company });
    doc.save(`${invoice.invoiceNumber}.pdf`);
  }

  async function printPDF() {
    if (!invoice) return;
    const company = await fetchCompany();
    const doc = generateInvoicePDF({ ...invoice, company });
    const url = doc.output("bloburl");
    window.open(url, "_blank");
  }

  async function handlePreview() {
    if (!invoice) return;
    setPreviewing(true);
    try {
      const vals = getValues();
      const company = await fetchCompany();

      // Compute totals from the form's current line items
      let subtotal = new Decimal(0);
      let taxAmount = new Decimal(0);
      const computedItems = (vals.items ?? invoice.items).map((item) => {
        const qty = new Decimal(item.quantity || "0");
        const price = new Decimal(item.unitPrice || "0");
        const rate = new Decimal(item.taxRate || "0");
        const lineTotal = qty.times(price);
        subtotal = subtotal.plus(lineTotal);
        taxAmount = taxAmount.plus(lineTotal.times(rate));
        return { ...item, lineTotal: lineTotal.toFixed(2) };
      });
      const total = subtotal.plus(taxAmount);
      const paid = new Decimal(vals.paidAmount || "0");
      const down = new Decimal(vals.downPayment || "0");

      const emp = employees.find((e) => e.id === (vals.employeeId || (invoice.employeeId ?? "")));

      const doc = generateInvoicePDF({
        invoiceNumber: vals.invoiceNumber || invoice.invoiceNumber,
        invoiceDate: vals.invoiceDate || invoice.invoiceDate,
        dueDate: vals.dueDate || invoice.dueDate,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: total.toFixed(2),
        paidAmount: paid.toFixed(2),
        downPayment: down.toFixed(2),
        creditCardFee: invoice.creditCardFee,
        appliedFees: invoice.appliedFees,
        notes: vals.notes ?? invoice.notes ?? "",
        customer: invoice.customer,
        items: computedItems,
        payments: invoice.payments,
        employee: emp ? { id: emp.id, name: emp.name } : invoice.employee,
        company,
      });

      const blob = doc.output("blob");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShowPreview(true);
    } finally {
      setPreviewing(false);
    }
  }

  function closePreview() {
    setShowPreview(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
  }

  if (!invoice) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  }

  return (
    <>
      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-white border-b shadow-sm shrink-0">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-brand-600" />
              <h2 className="font-semibold text-gray-800">Invoice Preview</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">unsaved changes</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={closePreview} className="btn-secondary">
                <X className="w-4 h-4" /> Close
              </button>
              <button
                onClick={() => { closePreview(); handleSubmit(onSave)(); }}
                disabled={saving}
                className="btn-primary"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save changes
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe src={previewUrl} className="w-full h-full border-0" title="Invoice Preview" />
          </div>
        </div>
      )}

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
                <button onClick={printPDF} className="btn-primary" title="Preview / print as PDF">
                  <Printer className="w-4 h-4" />
                  Print
                </button>
                <button onClick={downloadPDF} className="btn-secondary" title="Download PDF">
                  <Save className="w-4 h-4" />
                  PDF
                </button>
                <button onClick={handleSend} disabled={sending} className="btn-secondary" title="Email invoice to customer">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {invoice.sentAt ? "Resend" : "Email"}
                </button>
                {invoice.viewToken && (
                  <button onClick={copyLink} className="btn-secondary" title="Copy payment link">
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
                <button onClick={handlePreview} disabled={previewing || saving} className="btn-secondary">
                  {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  Preview
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

        {editing && Object.keys(errors).length > 0 && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm space-y-1">
            <p className="font-semibold">Please fix the highlighted fields before saving:</p>
            <ul className="list-disc list-inside">
              {errors.invoiceNumber && <li>Invoice number is required</li>}
              {errors.invoiceDate && <li>Invoice date is required</li>}
              {errors.dueDate && <li>Due date is required</li>}
              {errors.paidAmount && <li>Amount paid must be a number</li>}
              {errors.downPayment && <li>Down payment must be a number</li>}
              {errors.items && (
                <li>
                  One or more line items are missing a description, quantity, or price.
                  Open the Line Items section and fill in every row, or remove empty rows.
                </li>
              )}
            </ul>
          </div>
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
                  <p className="text-xs text-gray-400 mt-1">Auto-updates when Amount Paid changes</p>
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
                <div>
                  <label className="label">Sales rep</label>
                  <select className="input" {...register("employeeId")}>
                    <option value="">— None —</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Commission rate (decimal)</label>
                  <input type="number" step="0.0001" min="0" max="1" className="input" {...register("commissionRate")} />
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
                  {invoice.employeeId && (
                    <div className="flex justify-between pt-2 border-t">
                      <span className="text-gray-500">Sales rep</span>
                      <span className="font-medium">
                        {employees.find((e) => e.id === invoice.employeeId)?.name ?? "—"}
                        {parseFloat(invoice.commissionRate) > 0 && (
                          <span className="text-green-700 text-xs ml-2">
                            ({(parseFloat(invoice.commissionRate) * 100).toFixed(1)}% = {formatCurrency((parseFloat(invoice.totalAmount) * parseFloat(invoice.commissionRate)).toFixed(2))})
                          </span>
                        )}
                      </span>
                    </div>
                  )}
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
                  {(invoice.customer.emergencyContactName || invoice.customer.emergencyContactPhone) && (
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-[10px] font-semibold uppercase text-gray-400 tracking-wide">Emergency contact</p>
                      <p className="text-gray-600 mt-0.5">
                        {[invoice.customer.emergencyContactName, invoice.customer.emergencyContactPhone]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </p>
                    </div>
                  )}
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

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800">Payments</h2>
                {!showPaymentForm && (
                  <button onClick={() => setShowPaymentForm(true)} className="btn-primary text-xs py-1 px-3">
                    <Plus className="w-3 h-3" />
                    Record payment
                  </button>
                )}
              </div>

              {showPaymentForm && (
                <form onSubmit={handleRecordPayment} className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Amount ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        placeholder="0.00"
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="label">Payment date</label>
                      <input
                        type="date"
                        className="input"
                        value={paymentForm.paymentDate}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="label">Notes</label>
                      <input
                        className="input"
                        placeholder="e.g. Check #1234, Cash"
                        value={paymentForm.notes}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                    </div>
                  </div>
                  {paymentError && <p className="text-red-600 text-sm mt-2">{paymentError}</p>}
                  <div className="flex justify-end gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => { setShowPaymentForm(false); setPaymentError(""); }}
                      className="btn-secondary"
                    >
                      <X className="w-4 h-4" /> Cancel
                    </button>
                    <button type="submit" disabled={paymentSubmitting} className="btn-primary">
                      {paymentSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {paymentSubmitting ? "Saving…" : "Save payment"}
                    </button>
                  </div>
                </form>
              )}

              {invoice.payments.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500">
                      <th className="pb-2">Date</th>
                      <th className="pb-2 text-right">Amount</th>
                      <th className="pb-2">Notes</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {invoice.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2">{format(new Date(p.paymentDate), "MMM d, yyyy")}</td>
                        <td className="py-2 text-right font-medium text-green-700">{formatCurrency(p.amount)}</td>
                        <td className="py-2 text-gray-500">{p.notes}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleDeletePayment(p.id)}
                            disabled={deletingPaymentId === p.id}
                            className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                            title="Remove payment"
                          >
                            {deletingPaymentId === p.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No payments recorded yet — click &ldquo;Record payment&rdquo; above to add one</p>
              )}
            </div>

            <div className="card">
              <h2 className="font-semibold text-gray-800 mb-4">Attachments</h2>
              <FileUpload invoiceId={id} type="customer" existingFiles={invoice.files} onUploaded={load} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
