"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import PaymentBadge from "@/components/PaymentBadge";
import CategoryBadge from "@/components/CategoryBadge";
import { formatCurrency } from "@/lib/money";

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: string;
  paidAmount: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  category: "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER";
  supplier: { id: string; name: string };
}

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/invoices/supplier?${params}`);
      const data = await res.json();
      setInvoices(data.invoices);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, status, category, from, to]);

  useEffect(() => { load(); }, [load]);

  const filtered = invoices.filter(
    (inv) =>
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.supplier.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supplier Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total invoices</p>
        </div>
        <Link href="/invoices/supplier/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Invoice
        </Link>
      </div>

      <div className="card py-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search by invoice # or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select className="input text-sm w-36" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">All categories</option>
              <option value="COGS">Cost of Goods</option>
              <option value="SERVICES_EXPENSE">Services</option>
              <option value="OPERATING_EXPENSE">Operating</option>
              <option value="OTHER">Other</option>
            </select>
            <select className="input text-sm w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partial</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
          <input type="date" className="input text-sm w-36" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input text-sm w-36" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          {(status || category || from || to) && (
            <button onClick={() => { setStatus(""); setCategory(""); setFrom(""); setTo(""); setPage(1); }} className="btn-secondary text-sm py-1.5">Clear</button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Supplier</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-brand-600">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 text-gray-700">{inv.supplier.name}</td>
                    <td className="px-5 py-3 text-gray-500">{format(new Date(inv.invoiceDate), "MMM d, yyyy")}</td>
                    <td className="px-5 py-3"><CategoryBadge category={inv.category} /></td>
                    <td className="px-5 py-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    <td className="px-5 py-3 text-center"><PaymentBadge status={inv.paymentStatus} /></td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/invoices/supplier/${inv.id}`} className="text-brand-600 hover:underline text-xs font-medium">View</Link>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400"><p>No invoices found</p></div>
        )}
      </div>

      {Math.ceil(total / limit) > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Page {page} of {Math.ceil(total / limit)}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary py-1.5 text-xs disabled:opacity-40">Previous</button>
            <button disabled={page >= Math.ceil(total / limit)} onClick={() => setPage((p) => p + 1)} className="btn-secondary py-1.5 text-xs disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
