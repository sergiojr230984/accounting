"use client";

import { useEffect, useMemo, useState } from "react";
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
}

interface Employee {
  id: string;
  name: string;
  commissionRate: string;
  active: boolean;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

const blankItem = (): LineItem => ({ description: "", quantity: "1", unitPrice: "0", taxRate: "0" });

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

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [commissionRate, setCommissionRate] = useState("0");

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(plusDaysISO(30));
  const [downPayment, setDownPayment] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([blankItem()]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSeedName, setModalSeedName] = useState("");

  const [saving, setSaving] = useState<"idle" | "save" | "print" | "send">("idle");
  const [error, setError] = useState("");

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
    fetch("/api/invoices/customer?page=1&limit=1")
      .then((r) => r.json())
      .then(({ total }: { total: number }) => {
        const next = String(1001 + total).padStart(4, "0");
        setInvoiceNumber(`INV-${new Date().getFullYear()}-${next}`);
      })
      .catch(() => {});
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;
  const filteredCustomers = useMemo(
    () => customers.filter((c) => c.name.toLowerCase().includes(customerQuery.toLowerCase())),
    [customers, customerQuery]
  );

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    for (const item of items) {
      try {
        const line = new Decimal(item.quantity || "0").times(item.unitPrice || "0");
        subtotal = subtotal.plus(line);
        taxAmount = taxAmount.plus(line.times(item.taxRate || "0"));
      } catch {
        // skip invalid rows
      }
    }
    const total = subtotal.plus(taxAmount);
    const down = (() => {
      try { return new Decimal(downPayment || "0"); } catch { return new Decimal(0); }
    })();
    const balance = Decimal.max(total.minus(down), 0);
    const commission = (() => {
      try { return total.times(new Decimal(commissionRate || "0")); } catch { return new Decimal(0); }
    })();
    return { subtotal, taxAmount, total, downPayment: down, balance, commission };
  }, [items, downPayment, commissionRate]);

  function updateItem(idx: number, field: keyof LineItem, value: string) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Wave-style: auto-add a fresh blank row when typing in the last row's description
      if (field === "description" && idx === next.length - 1 && value.trim() !== "") {
        next.push(blankItem());
      }
      return next;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handleExtracted(data: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    customerName?: string | null;
    items?: LineItem[];
    notes?: string | null;
  }) {
    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
    if (data.dueDate) setDueDate(data.dueDate);
    if (data.notes) setNotes(data.notes);
    if (data.items?.length) {
      setItems([...data.items.map((i) => ({ ...i, taxRate: i.taxRate || "0" })), blankItem()]);
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
          items: real,
          notes,
          downPayment,
          employeeId: employeeId || null,
          commissionRate: commissionRate || "0",
          paidAmount: "0",
          paymentStatus: "UNPAID",
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
        const customer = customers.find((c) => c.id === customerId);
        if (customer) {
          const doc = generateInvoicePDF({
            invoiceNumber,
            invoiceDate,
            dueDate,
            subtotal: totals.subtotal.toFixed(2),
            taxAmount: totals.taxAmount.toFixed(2),
            totalAmount: totals.total.toFixed(2),
            paidAmount: "0",
            downPayment: downPayment || "0",
            notes,
            customer: { name: customer.name, email: customer.email, phone: null, address: null },
            items: real.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              taxRate: i.taxRate,
              lineTotal: new Decimal(i.quantity || "0").times(i.unitPrice || "0").toFixed(2),
            })),
          });
          const url = doc.output("bloburl");
          window.open(url, "_blank");
        }
      }
      router.push(`/invoices/customer/${inv.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving("idle");
    }
  }

  return (
    <div className="flex gap-6 max-w-7xl mx-auto">
      {/* Main column */}
      <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/invoices/customer" className="btn-secondary p-2"><ArrowLeft className="w-4 h-4" /></Link>
            <h1 className="text-3xl font-bold text-gray-900">New invoice</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => save("print")}
              disabled={saving !== "idle"}
              className="btn-secondary"
              title="Preview as PDF in a new tab"
            >
              {saving === "print" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
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

        {/* Optional AI extractor */}
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

        {/* Bill To + Invoice meta */}
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
                    <div className="absolute z-10 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
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
                      <button
                        type="button"
                        onClick={() => { setModalSeedName(customerQuery); setModalOpen(true); setCustomerOpen(false); }}
                        className="block w-full text-left px-3 py-2 hover:bg-brand-50 text-sm text-brand-700 border-t font-medium"
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

        {/* Line items */}
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <h2 className="font-semibold text-gray-800 text-sm">Items</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 text-xs font-medium uppercase">Description</th>
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
                return (
                  <tr key={idx} className="border-b last:border-b-0 hover:bg-gray-50/50">
                    <td className="px-2 py-1">
                      <input
                        className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm"
                        placeholder="Item or service description"
                        value={item.description}
                        onChange={(e) => updateItem(idx, "description", e.target.value)}
                      />
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
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          className="w-full px-2 py-1.5 pr-5 border-0 focus:outline-none focus:bg-brand-50 rounded text-sm text-right"
                          value={item.taxRate}
                          onChange={(e) => updateItem(idx, "taxRate", e.target.value)}
                        />
                      </div>
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
                );
              })}
            </tbody>
          </table>
          <button
            onClick={() => setItems((prev) => [...prev, blankItem()])}
            className="w-full px-5 py-2.5 text-left text-sm text-brand-600 hover:bg-brand-50 border-t flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add a line
          </button>
        </div>

        {/* Notes */}
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

      {/* Sticky totals panel */}
      <aside className="w-80 shrink-0 hidden lg:block">
        <div className="sticky top-6 space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Summary</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">{formatCurrency(totals.subtotal.toFixed(2))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span className="font-medium">{formatCurrency(totals.taxAmount.toFixed(2))}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                <span>Total</span>
                <span>{formatCurrency(totals.total.toFixed(2))}</span>
              </div>
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
              onClick={() => save("print")}
              disabled={saving !== "idle"}
              className="btn-primary w-full justify-center"
            >
              {saving === "print" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Save & Print PDF
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
              Save & Email
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
  );
}
