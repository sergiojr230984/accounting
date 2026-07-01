"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Send,
  Loader2,
  Search,
  X,
  Printer,
  Eye,
} from "lucide-react";
import Decimal from "decimal.js";
import CustomerCreateModal from "@/components/CustomerCreateModal";
import InvoiceExtractor from "@/components/InvoiceExtractor";
import { formatCurrency } from "@/lib/money";
import { generateInvoicePDF } from "@/lib/invoice-pdf";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  taxRate: string;
  incomeAccount: string | null;
  active: boolean;
}

interface Employee {
  id: string;
  name: string;
  commissionRate: string;
  active: boolean;
}

interface LineItem {
  description: string;
  itemDescription: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  fees: (string | null)[];
}

const blankItem = (): LineItem => ({
  description: "",
  itemDescription: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: "0",
  fees: [],
});

const todayISO = () => new Date().toISOString().split("T")[0];
const plusDaysISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

export default function NewCustomerInvoicePage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productFocusIdx, setProductFocusIdx] = useState<number | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [commissionRate, setCommissionRate] = useState("0");

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(plusDaysISO(30));
  const [downPayment, setDownPayment] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([blankItem()]);
  const [taxRates, setTaxRates] = useState<{ id: string; name: string; rate: string; active: boolean }[]>([]);
  const [ccFeeRate, setCcFeeRate] = useState("0");
  const [customFees, setCustomFees] = useState<{ id: string; label: string; rate: number }[]>([]);

  const allFees = useMemo(
    () => [
      ...(parseFloat(ccFeeRate) > 0
        ? [{ id: "__cc__", label: "CARD FEE", rate: parseFloat(ccFeeRate) }]
        : []),
      ...customFees,
    ],
    [ccFeeRate, customFees]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSeedName, setModalSeedName] = useState("");

  const [saving, setSaving] = useState<"idle" | "save" | "print" | "send">("idle");
  const [error, setError] = useState("");

  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);

  async function loadCustomers() {
    const res = await fetch("/api/customers");
    if (!res.ok) return [] as Customer[];
    const list: Customer[] = await res.json();
    setCustomers(list);
    return list;
  }

  useEffect(() => {
    loadCustomers();
    fetch("/api/employees")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Employee[]) => setEmployees(list.filter((e) => e.active)))
      .catch(() => {});
    fetch("/api/settings/taxes")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string; rate: string; active: boolean }[]) =>
        setTaxRates(list.filter((t) => t.active))
      )
      .catch(() => {});
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Product[]) => setProducts(list.filter((p) => p.active)))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          p: {
            creditCardFeeRate: string;
            customerInvoicePrefix?: string;
            customerInvoiceNextSeq?: number;
            customFees?: { id: string; label: string; rate: number }[];
          } | null
        ) => {
          if (!p) return;
          setCcFeeRate(p.creditCardFeeRate);
          if (Array.isArray(p.customFees) && p.customFees.length > 0) {
            setCustomFees(p.customFees);
          }
          const prefix = p.customerInvoicePrefix ?? "INV-2026-";
          const seq = p.customerInvoiceNextSeq ?? 1001;
          setInvoiceNumber(`${prefix}${String(seq).padStart(4, "0")}`);
        }
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (allFees.length > 0) {
      setItems((prev) =>
        prev.map((it) => (it.fees && it.fees.length > 0 ? it : { ...it, fees: [null] }))
      );
    }
  }, [allFees.length]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;
  const filteredCustomers = useMemo(
    () => customers.filter((c) => c.name.toLowerCase().includes(customerQuery.toLowerCase())),
    [customers, customerQuery]
  );

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    const feeAgg = new Map<string, { id: string; label: string; rate: number; amount: Decimal }>();

    for (const item of items) {
      let lineTotal = new Decimal(0);
      try {
        lineTotal = new Decimal(item.quantity || "0").times(item.unitPrice || "0");
      } catch {}
      subtotal = subtotal.plus(lineTotal);

      let lineTax = new Decimal(0);
      try {
        lineTax = lineTotal.times(new Decimal(item.taxRate || "0"));
      } catch {}
      taxAmount = taxAmount.plus(lineTax);

      const base = lineTotal.plus(lineTax);
      for (const feeId of item.fees || []) {
        if (!feeId) continue;
        const f = allFees.find((cf) => cf.id === feeId);
        if (!f) continue;
        let amt = new Decimal(0);
        try {
          amt = base.times(new Decimal(f.rate));
        } catch {}
        const cur = feeAgg.get(feeId);
        if (cur) {
          cur.amount = cur.amount.plus(amt);
        } else {
          feeAgg.set(feeId, { id: f.id, label: f.label, rate: f.rate, amount: amt });
        }
      }
    }

    const appliedFees = Array.from(feeAgg.values()).map((f) => ({
      id: f.id,
      label: f.label,
      rate: f.rate,
      amount: f.amount.toFixed(2),
    }));
    let feesSum = new Decimal(0);
    for (const f of feeAgg.values()) feesSum = feesSum.plus(f.amount);

    const total = subtotal.plus(taxAmount).plus(feesSum);
    const down = (() => {
      try { return new Decimal(downPayment || "0"); } catch { return new Decimal(0); }
    })();
    const balance = Decimal.max(total.minus(down), 0);
    const commission = (() => {
      try { return total.times(new Decimal(commissionRate || "0")); } catch { return new Decimal(0); }
    })();
    return { subtotal, taxAmount, appliedFees, total, downPayment: down, balance, commission };
  }, [items, downPayment, commissionRate, allFees]);

  function updateItem(idx: number, field: keyof LineItem, value: string) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "description" && idx === next.length - 1 && value.trim() !== "") {
        const fresh = blankItem();
        if (allFees.length > 0) fresh.fees = [null];
        next.push(fresh);
      }
      return next;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function selectLineFee(lineIdx: number, feeIdx: number, newId: string | null) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[lineIdx];
      const fees = item.fees && item.fees.length > 0 ? [...item.fees] : [null];
      fees[feeIdx] = newId;
      if (newId && feeIdx === fees.length - 1) {
        fees.push(null);
      }
      next[lineIdx] = { ...item, fees };
      return next;
    });
  }

  function removeLineFee(lineIdx: number, feeIdx: number) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[lineIdx];
      const filtered = (item.fees || []).filter((_, i) => i !== feeIdx);
      next[lineIdx] = { ...item, fees: filtered.length === 0 ? [null] : filtered };
      return next;
    });
  }

  function applyProduct(idx: number, product: Product) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        description: product.name,
        itemDescription: product.description ?? "",
        unitPrice: product.price,
        taxRate: product.taxRate,
      };
      if (idx === next.length - 1) {
        const fresh = blankItem();
        if (allFees.length > 0) fresh.fees = [null];
        next.push(fresh);
      }
      return next;
    });
    setProductFocusIdx(null);
  }

  async function handleExtracted(data: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    customerName?: string | null;
    items?: { description: string; quantity: string; unitPrice: string; taxRate: string }[];
    notes?: string | null;
  }) {
    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
    if (data.dueDate) setDueDate(data.dueDate);
    if (data.notes) setNotes(data.notes);
    if (data.items?.length) {
      const fresh: LineItem[] = data.items.map((i) => ({
        ...i,
        itemDescription: "",
        taxRate: i.taxRate || "0",
        fees: allFees.length > 0 ? [null] : [],
      }));
      setItems([...fresh, { ...blankItem(), fees: allFees.length > 0 ? [null] : [] }]);
    }
    if (data.customerName) {
      const current = await loadCustomers();
      const lower = data.customerName.toLowerCase();
      const match = current.find((c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
      if (match) {
        setCustomerId(match.id);
      } else {
        setModalSeedName(data.customerName);
        setModalOpen(true);
      }
    }
  }

  function buildPdfData(company: unknown) {
    const customer = customers.find((c) => c.id === customerId);
    const real = items.filter((i) => i.description.trim() !== "");
    return {
      invoiceNumber,
      invoiceDate,
      dueDate,
      subtotal: totals.subtotal.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalAmount: totals.total.toFixed(2),
      creditCardFee: "0",
      appliedFees: totals.appliedFees.map((f) => ({ label: f.label, amount: f.amount })),
      paidAmount: "0",
      downPayment: downPayment || "0",
      notes,
      customer: {
        name: customer?.name ?? "",
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
        address: customer?.address ?? null,
        emergencyContactName: customer?.emergencyContactName ?? null,
        emergencyContactPhone: customer?.emergencyContactPhone ?? null,
      },
      items: real.map((i) => ({
        description: i.description,
        itemDescription: i.itemDescription,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate,
        lineTotal: new Decimal(i.quantity || "0").times(i.unitPrice || "0").toFixed(2),
      })),
      employee: (() => {
        const emp = employees.find((e) => e.id === employeeId);
        return emp ? { id: emp.id, name: emp.name } : null;
      })(),
      company: company as Parameters<typeof generateInvoicePDF>[0]["company"],
    };
  }

  async function handlePreview() {
    if (!customerId) { setError("Please select a customer"); return; }
    const real = items.filter((i) => i.description.trim() !== "");
    if (real.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    setPreviewing(true);
    try {
      const company = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const doc = generateInvoicePDF(buildPdfData(company));
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

  async function save(action: "save" | "print" | "send"): Promise<void> {
    setError("");
    if (!customerId) {
      setError("Please select a customer");
      return;
    }
    const real = items.filter((i) => i.description.trim() !== "");
    if (real.length === 0) {
      setError("Add at least one line item");
      return;
    }
    setSaving(action);
    try {
      const res = await fetch("/api/invoices/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          invoiceNumber,
          invoiceDate,
          dueDate,
          items: real.map(({ fees: _fees, ...rest }) => rest),
          notes,
          downPayment,
          employeeId: employeeId || null,
          commissionRate: commissionRate || "0",
          paidAmount: "0",
          paymentStatus: "UNPAID",
          appliedFees: totals.appliedFees,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.formErrors?.[0] ?? (typeof d.error === "string" ? d.error : "Failed to create"));
        return;
      }
      const inv = await res.json();
      if (action === "send") {
        const sendRes = await fetch(`/api/invoices/customer/${inv.id}/send`, { method: "POST" });
        if (!sendRes.ok) {
          const d = await sendRes.json().catch(() => ({}));
          router.push(`/invoices/customer/${inv.id}?sendError=${encodeURIComponent(d.error ?? "send failed")}`);
          return;
        }
      }
      if (action === "print") {
        const company = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const doc = generateInvoicePDF(buildPdfData(company));
        const url = doc.output("bloburl");
        window.open(url, "_blank");
      }
      router.push(`/invoices/customer/${inv.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving("idle");
    }
  }

  return (
    <>
      {showPreview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-white border-b shadow-sm shrink-0">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-brand-600" />
              <h2 className="font-semibold text-gray-800">Invoice Preview</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">not saved yet</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={closePreview} className="btn-secondary">
                <X className="w-4 h-4" /> Close
              </button>
              <button
                onClick={async () => { closePreview(); await save("save"); }}
                disabled={saving !== "idle"}
                className="btn-secondary"
              >
                {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save draft
              </button>
              <button
                onClick={async () => { closePreview(); await save("send"); }}
                disabled={saving !== "idle"}
                className="btn-secondary"
              >
                {saving === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Save &amp; Email
              </button>
              <button
                onClick={async () => { closePreview(); await save("print"); }}
                disabled={saving !== "idle"}
                className="btn-primary"
              >
                {saving === "print" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Save &amp; Print
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe src={previewUrl} className="w-full h-full border-0" title="Invoice Preview" />
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto">
        <div className="flex-1 min-w-0 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Link href="/invoices/customer" className="btn-secondary p-2"><ArrowLeft className="w-4 h-4" /></Link>
              <h1 className="text-3xl font-bold text-gray-900">New invoice</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                disabled={previewing || saving !== "idle"}
                className="btn-secondary"
                title="Preview the invoice without saving"
              >
                {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Preview
              </button>
              <button
                onClick={() => save("save")}
                disabled={saving !== "idle"}
                className="btn-primary"
              >
                {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save and continue
              </button>
            </div>
          </div>

          <details className="card group">
            <summary className="cursor-pointer flex items-center justify-between list-none">
              <div>
                <h2 className="font-semibold text-gray-800">Import from file (optional)</h2>
                <p className="text-xs text-gray-500 mt-0.5">Upload an existing invoice PDF/image and AI will fill it in</p>
              </div>
              <span className="text-xs text-brand-600 group-open:hidden">Expand ↓</span>
              <span className="text-xs text-brand-600 hidden group-open:inline">Collapse ↑</span>
            </summary>
            <div className="mt-4 pt-4 border-t">
              <InvoiceExtractor type="customer" onExtracted={handleExtracted} />
            </div>
          </details>

          <div className="card space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="label">Bill To</label>
                {selectedCustomer ? (
                  <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-sm text-gray-900">{selectedCustomer.name}</p>
                      {selectedCustomer.email && <p className="text-xs text-gray-500">{selectedCustomer.email}</p>}
                    </div>
                    <button onClick={() => { setCustomerId(""); setCustomerQuery(""); }} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      className="input pl-9"
                      placeholder="Search customer or type a new name…"
                      value={customerQuery}
                      onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                      onFocus={() => setCustomerOpen(true)}
                    />
                    {customerOpen && (customerQuery.trim() !== "" || filteredCustomers.length > 0) && (
                      <div className="absolute z-10 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {filteredCustomers.length > 0 && (
                          <div className="max-h-64 overflow-y-auto">
                            {filteredCustomers.slice(0, 8).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { setCustomerId(c.id); setCustomerOpen(false); setCustomerQuery(""); }}
                                className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                              >
                                <p className="font-medium">{c.name}</p>
                                {c.email && <p className="text-xs text-gray-500">{c.email}</p>}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => { setModalSeedName(customerQuery); setModalOpen(true); setCustomerOpen(false); }}
                          className={`block w-full text-left px-3 py-2.5 text-sm text-brand-700 font-medium bg-gray-50 hover:bg-brand-50 ${
                            filteredCustomers.length > 0 ? "border-t-2 border-gray-200" : ""
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5 inline mr-1" />
                          Create new customer{customerQuery.trim() && `: "${customerQuery.trim()}"`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="label">Invoice number</label>
                <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>

              <div>
                <label className="label">Invoice date</label>
                <input type="date" className="input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>

              <div>
                <label className="label">Due date</label>
                <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800 text-sm">Items</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-gray-500">
                  <th className="px-3 py-2 text-xs font-medium uppercase">Item / Description</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase w-20 text-right">Qty</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase w-28 text-right">Unit price</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase w-20 text-right">Tax</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase w-28 text-right">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  let line = new Decimal(0);
                  try { line = new Decimal(item.quantity || "0").times(item.unitPrice || "0"); } catch {}
                  let lineTax = new Decimal(0);
                  try { lineTax = line.times(new Decimal(item.taxRate || "0")); } catch {}
                  const feeSlots = allFees.length > 0
                    ? (item.fees && item.fees.length > 0 ? item.fees : [null])
                    : [];
                  const usedFeeIds = feeSlots.filter((id): id is string => id !== null);

                  return (
                    <Fragment key={`item-${idx}`}>
                      <tr className="border-b last:border-b-0 hover:bg-gray-50/50">
                        <td className="px-2 py-1 relative">
                          <input
                            className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm"
                            placeholder="Item name"
                            value={item.description}
                            onChange={(e) => updateItem(idx, "description", e.target.value)}
                            onFocus={() => setProductFocusIdx(idx)}
                            onBlur={() => setTimeout(() => setProductFocusIdx(null), 150)}
                          />
                          <input
                            className="w-full px-2 py-1 border-0 focus:outline-none focus:bg-gray-50 rounded text-xs text-gray-500"
                            placeholder="Description (optional)"
                            value={item.itemDescription}
                            onChange={(e) => updateItem(idx, "itemDescription", e.target.value)}
                          />
                          {productFocusIdx === idx && (() => {
                            const q = item.description.toLowerCase();
                            const matches = products.filter(
                              (p) =>
                                p.name.toLowerCase().includes(q) ||
                                (p.description ?? "").toLowerCase().includes(q)
                            ).slice(0, 8);
                            if (matches.length === 0) return null;
                            return (
                              <div className="absolute z-20 left-2 right-2 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                                {matches.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onMouseDown={() => applyProduct(idx, p)}
                                    className="block w-full text-left px-3 py-2 hover:bg-brand-50 text-sm"
                                  >
                                    <p className="font-medium text-gray-900">{p.name}</p>
                                    <p className="text-xs text-gray-500">
                                      ${parseFloat(p.price).toFixed(2)}
                                      {parseFloat(p.taxRate) > 0 && ` · Tax ${(parseFloat(p.taxRate) * 100).toFixed(2)}%`}
                                      {p.description && ` · ${p.description}`}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm text-right"
                            value={item.quantity}
                            onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm text-right"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          {taxRates.length > 0 ? (
                            <select
                              className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm text-right bg-transparent"
                              value={item.taxRate}
                              onChange={(e) => updateItem(idx, "taxRate", e.target.value)}
                            >
                              <option value="0">No tax</option>
                              {taxRates.map((t) => (
                                <option key={t.id} value={t.rate}>
                                  {t.name} ({(parseFloat(t.rate) * 100).toFixed(2)}%)
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              max="1"
                              className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm text-right"
                              value={item.taxRate}
                              onChange={(e) => updateItem(idx, "taxRate", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-sm text-gray-700">
                          {formatCurrency(line.toFixed(2))}
                        </td>
                        <td className="pr-2">
                          {items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>

                      {feeSlots.map((feeId, fIdx) => {
                        const f = feeId ? allFees.find((cf) => cf.id === feeId) : null;
                        const base = line.plus(lineTax);
                        let amt = new Decimal(0);
                        if (f) {
                          try { amt = base.times(new Decimal(f.rate)); } catch {}
                        }
                        const isLast = fIdx === feeSlots.length - 1;
                        return (
                          <tr key={`fee-${idx}-${fIdx}`} className="bg-gray-50/40 border-b last:border-b-0">
                            <td className="pl-8 pr-2 py-1">
                              <span className="inline-block w-3 border-t border-gray-300 align-middle" />
                            </td>
                            <td className="px-2 py-1 text-right text-xs uppercase tracking-wide text-gray-400 font-medium">
                              Tax
                            </td>
                            <td colSpan={2} className="px-2 py-1">
                              <select
                                value={feeId ?? ""}
                                onChange={(e) => selectLineFee(idx, fIdx, e.target.value || null)}
                                className="w-full px-2 py-1.5 border border-gray-200 bg-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-700"
                              >
                                <option value="">Select a fee</option>
                                {allFees
                                  .filter((cf) => cf.id === feeId || !usedFeeIds.includes(cf.id))
                                  .map((cf) => (
                                    <option key={cf.id} value={cf.id}>
                                      {cf.label} {(cf.rate * 100).toFixed(2)}%
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium text-sm text-gray-700">
                              {feeId ? formatCurrency(amt.toFixed(2)) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="pr-2">
                              {(feeId || !isLast) && (
                                <button
                                  type="button"
                                  onClick={() => removeLineFee(idx, fIdx)}
                                  className="text-gray-300 hover:text-red-500 p-1"
                                  aria-label="Remove fee"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            <button
              onClick={() => {
                const fresh = blankItem();
                if (allFees.length > 0) fresh.fees = [null];
                setItems((prev) => [...prev, fresh]);
              }}
              className="w-full px-5 py-2.5 text-left text-sm text-brand-600 hover:bg-brand-50 border-t flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add a line
            </button>
          </div>

          <div className="card space-y-3">
            <label className="label">Notes / Terms</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Thanks for your business. Payment due in 30 days."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}
        </div>

        <aside className="lg:w-80 lg:shrink-0 w-full">
          <div className="lg:sticky lg:top-6 space-y-4">
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Summary</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium">{formatCurrency(totals.subtotal.toFixed(2))}</span>
                </div>
                {totals.appliedFees.map((a) => (
                  <div key={a.id} className="flex justify-between">
                    <span className="text-gray-500 truncate pr-2">{a.label} {(a.rate * 100).toFixed(2)}%</span>
                    <span className="font-medium shrink-0">{formatCurrency(a.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-gray-500">Tax</span>
                  <span className="font-medium">{formatCurrency(totals.taxAmount.toFixed(2))}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                  <span>Total</span>
                  <span>{formatCurrency(totals.total.toFixed(2))}</span>
                </div>
                {parseFloat(ccFeeRate) === 0 && (
                  <p className="text-[11px] text-gray-400 pt-1">
                    Set a card processing fee in <a href="/settings" className="text-brand-600 hover:underline">Settings</a> to add it per line.
                  </p>
                )}
              </div>
            </div>

            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Financing</h3>
              <div>
                <label className="label">Down payment ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value)}
                />
              </div>
              <div className="flex justify-between text-sm pt-1 border-t">
                <span className="text-gray-500">Remaining balance</span>
                <span className="font-bold text-brand-700">{formatCurrency(totals.balance.toFixed(2))}</span>
              </div>
            </div>

            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Sales rep</h3>
              <div>
                <label className="label">Employee</label>
                <select
                  className="input"
                  value={employeeId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setEmployeeId(id);
                    const match = employees.find((emp) => emp.id === id);
                    if (match) setCommissionRate(match.commissionRate);
                    if (!id) setCommissionRate("0");
                  }}
                >
                  <option value="">— None —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({(parseFloat(emp.commissionRate) * 100).toFixed(1)}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Commission rate (decimal)</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  className="input"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  disabled={!employeeId}
                />
              </div>
              {employeeId && (
                <div className="flex justify-between text-sm pt-1 border-t">
                  <span className="text-gray-500">Commission earned</span>
                  <span className="font-bold text-green-700">{formatCurrency(totals.commission.toFixed(2))}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <button
                onClick={handlePreview}
                disabled={previewing || saving !== "idle"}
                className="btn-primary w-full justify-center"
              >
                {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Preview invoice
              </button>
              <button
                onClick={() => save("print")}
                disabled={saving !== "idle"}
                className="btn-secondary w-full justify-center"
              >
                {saving === "print" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Save &amp; Print PDF
              </button>
              <button
                onClick={() => save("save")}
                disabled={saving !== "idle"}
                className="btn-secondary w-full justify-center"
              >
                {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save as draft
              </button>
              <button
                onClick={() => save("send")}
                disabled={saving !== "idle"}
                className="btn-secondary w-full justify-center"
                title="Email invoice to customer (requires RESEND_API_KEY)"
              >
                {saving === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Save &amp; Email
              </button>
            </div>
          </div>
        </aside>

        <CustomerCreateModal
          open={modalOpen}
          initialName={modalSeedName}
          onClose={() => setModalOpen(false)}
          onCreated={(c) => {
            setCustomers((prev) => [...prev, c as Customer]);
            setCustomerId(c.id);
            setCustomerQuery("");
          }}
        />
      </div>
    </>
  );
}
