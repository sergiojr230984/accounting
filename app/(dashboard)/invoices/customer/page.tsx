"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Filter, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import PaymentBadge from "@/components/PaymentBadge";
import { formatCurrency } from "@/lib/money";

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  customer: { id: string; name: string };
}

export default function CustomerInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/invoices/customer?${params}`);
      const data = await res.json();
      setInvoices(data.invoices ?? []);
      setTotal(data.total ?? 0);
      setNotLinked(data.notLinked ?? false);
    } finally {
      setLoading(false);
    }
  }, [page, status, from, to]);

  useEffect(() => { load(); }, [load]);

  const filtered = invoices.filter(
    (inv) =>
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.customer.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total invoices</p>
        </div>
        <Link href="/invoices/customer/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Invoice
        </Link>
      </div>

      {notLinked && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Your account is not linked to an employee profile</p>
            <p className="text-sm text-amber-600 mt-0.5">
              Contact your administrator to link your login email to your employee record.
              Until then, your invoices will not appear here.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card py-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search by invoice # or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              className="input text-sm w-40"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partial</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
          <input type="date" className="input text-sm w-36" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input text-sm w-36" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          {(status || from || to) && (
            <button onClick={() => { setStatus(""); setFrom(""); setTo(""); setPage(1); }} className="btn-secondary text-sm py-1.5">Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Due</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Paid</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-brand-600">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 text-gray-700">{inv.customer.name}</td>
                    <td className="px-5 py-3 text-gray-500">{format(new Date(inv.invoiceDate), "MMM d, yyyy")}</td>
                    <td className="px-5 py-3 text-gray-500">{format(new Date(inv.dueDate), "MMM d, yyyy")}</td>
                    <td className="px-5 py-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    <td className="px-5 py-3 text-right text-gray-500">{formatCurrency(inv.paidAmount)}</td>
                    <td className="px-5 py-3 text-center">
                      <PaymentBadge status={inv.paymentStatus} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/invoices/customer/${inv.id}`} className="text-brand-600 hover:underline text-xs font-medium">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && !notLinked && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p>No invoices found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary py-1.5 text-xs disabled:opacity-40">Previous</button>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="btn-secondary py-1.5 text-xs disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
