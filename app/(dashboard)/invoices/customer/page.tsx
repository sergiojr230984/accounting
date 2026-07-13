"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, ChevronRight, DollarSign, AlertTriangle } from "lucide-react";
import PaymentBadge from "@/components/PaymentBadge";
import { formatCurrency } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";

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

interface Stats {
  overdue: number;
  dueNext30: number;
  paidThisMonth: number;
  totalUnpaid: number;
}

type Tab = "unpaid" | "draft" | "all";

export default function CustomerInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("unpaid");
  const limit = 20;

  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setCustomers(list.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter) params.set("status", statusFilter);
      else if (tab === "unpaid") params.set("status", "UNPAID");
      if (customerFilter) params.set("customerId", customerFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/invoices/customer?${params}`);
      const data = await res.json();
      setInvoices(data.invoices);
      setTotal(data.total);
      setNotLinked(data.notLinked ?? false);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, customerFilter, from, to, tab]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () =>
      invoices.filter(
        (inv) =>
          inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
          inv.customer.name.toLowerCase().includes(search.toLowerCase())
      ),
    [invoices, search]
  );

  const stats: Stats = useMemo(() => {
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400000);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let overdue = 0,
      dueNext30 = 0,
      paidThisMonth = 0,
      totalUnpaid = 0;
    for (const inv of invoices) {
      const balance = Math.max(parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount), 0);
      const due = new Date(inv.dueDate);
      if (inv.paymentStatus !== "PAID" && due < today) overdue += balance;
      if (inv.paymentStatus !== "PAID" && due >= today && due <= in30) dueNext30 += balance;
      if (inv.paymentStatus === "PAID" && new Date(inv.invoiceDate) >= monthStart) paidThisMonth += parseFloat(inv.paidAmount);
      if (inv.paymentStatus !== "PAID") totalUnpaid += balance;
    }
    return { overdue, dueNext30, paidThisMonth, totalUnpaid };
  }, [invoices]);

  const totalPages = Math.ceil(total / limit);
  const activeFilters = [customerFilter, statusFilter, from, to].filter(Boolean).length;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
        <Link href="/invoices/customer/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          Create an invoice
        </Link>
      </div>

      {notLinked && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Your account is not linked to an employee profile</p>
            <p className="text-sm text-amber-600 mt-0.5">
              Contact your administrator to link your login email to your employee record in Admin &rarr; Employees.
              Until then, your invoices will not appear here.
            </p>
          </div>
        </div>
      )}

      {/* Stats banner */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-sm font-semibold text-gray-900">Overdue</p>
            <p className="text-3xl font-bold text-red-600 mt-1">
              {formatCurrency(stats.overdue.toFixed(2))}
              <span className="text-sm text-gray-400 font-normal ml-1">USD</span>
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Due within next 30 days</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {formatCurrency(stats.dueNext30.toFixed(2))}
              <span className="text-sm text-gray-400 font-normal ml-1">USD</span>
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Total unpaid balance</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {formatCurrency(stats.totalUnpaid.toFixed(2))}
              <span className="text-sm text-gray-400 font-normal ml-1">USD</span>
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Paid this month</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {formatCurrency(stats.paidThisMonth.toFixed(2))}
              <span className="text-sm text-gray-400 font-normal ml-1">USD</span>
            </p>
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-full px-3 py-1 text-xs">
          <span className="bg-brand-600 text-white w-5 h-5 rounded-full flex items-center justify-center font-bold">
            {activeFilters}
          </span>
          <span className="text-brand-700 font-medium">active filter{activeFilters !== 1 ? "s" : ""}</span>
        </div>
        <select className="input text-sm w-44" value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input text-sm w-40" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIALLY_PAID">Partial</option>
          <option value="PAID">Paid</option>
        </select>
        <input type="date" className="input text-sm w-36" placeholder="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <input type="date" className="input text-sm w-36" placeholder="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9 text-sm w-full"
            placeholder="Enter invoice #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activeFilters > 0 && (
          <button
            onClick={() => { setCustomerFilter(""); setStatusFilter(""); setFrom(""); setTo(""); setPage(1); }}
            className="text-sm text-brand-600 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        {(
          [
            { key: "unpaid" as const, label: "Unpaid", count: invoices.filter((i) => i.paymentStatus !== "PAID").length },
            { key: "draft" as const, label: "Draft", count: 0 },
            { key: "all" as const, label: "All invoices", count: total },
          ]
        ).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              if (key === "unpaid") setStatusFilter("");
              else if (key === "all") setStatusFilter("");
              setPage(1);
            }}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <span className="flex items-center gap-2">
              {label}
              {count > 0 && (
                <span className={`text-xs ${tab === key ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-600"} px-1.5 py-0.5 rounded-full`}>
                  {count}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Due</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Date</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Number</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Customer</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Amount due</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">
                    {notLinked ? "No invoices to show until your account is linked" : "No invoices match your filters"}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((inv) => {
                const today = new Date();
                const due = new Date(inv.dueDate);
                const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
                const overdue = inv.paymentStatus !== "PAID" && due < today;
                const balance = Math.max(parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount), 0);

                let dueLabel = formatDateOnly(inv.dueDate);
                if (overdue) dueLabel = `${days} day${days !== 1 ? "s" : ""} ago`;
                else if (inv.paymentStatus !== "PAID") {
                  const forward = -days;
                  if (forward === 0) dueLabel = "Today";
                  else if (forward < 14) dueLabel = `in ${forward} days`;
                }

                return (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      {overdue ? (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-50 text-red-700 border border-red-100">
                          Overdue
                        </span>
                      ) : (
                        <PaymentBadge status={inv.paymentStatus} />
                      )}
                    </td>
                    <td className={`px-5 py-4 ${overdue ? "text-red-600 font-medium" : "text-gray-500"}`}>{dueLabel}</td>
                    <td className="px-5 py-4 text-gray-500">{formatDateOnly(inv.invoiceDate, "yyyy-MM-dd")}</td>
                    <td className="px-5 py-4">
                      <Link href={`/invoices/customer/${inv.id}`} className="text-brand-600 hover:underline font-medium">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{inv.customer.name}</td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                      {formatCurrency(balance.toFixed(2))}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/invoices/customer/${inv.id}`}
                        className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium text-xs"
                      >
                        {inv.paymentStatus === "PAID" ? "View" : "Record payment"}
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
