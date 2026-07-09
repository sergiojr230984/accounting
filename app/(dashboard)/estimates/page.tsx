"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, ChevronRight, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";

type EstimateStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";

interface Estimate {
  id: string;
  estimateNumber: string;
  estimateDate: string;
  expiryDate: string | null;
  totalAmount: string;
  status: EstimateStatus;
  convertedInvoiceId: string | null;
  customer: { id: string; name: string };
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
    DRAFT: "Draft",
    SENT: "Sent",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    EXPIRED: "Expired",
  };
  return <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${styles[status]}`}>{labels[status]}</span>;
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (customerFilter) params.set("customerId", customerFilter);
      const res = await fetch(`/api/estimates?${params}`);
      const data = await res.json();
      setEstimates(data.estimates);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customerFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () =>
      estimates.filter(
        (est) =>
          est.estimateNumber.toLowerCase().includes(search.toLowerCase()) ||
          est.customer.name.toLowerCase().includes(search.toLowerCase())
      ),
    [estimates, search]
  );

  const activeFilters = [customerFilter, statusFilter].filter(Boolean).length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Estimates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Give a customer a price before they commit — nothing is due until it becomes an invoice.</p>
        </div>
        <Link href="/estimates/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          Create an estimate
        </Link>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {activeFilters > 0 && (
          <div className="flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-full px-3 py-1 text-xs">
            <span className="bg-brand-600 text-white w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {activeFilters}
            </span>
            <span className="text-brand-700 font-medium">active filter{activeFilters !== 1 ? "s" : ""}</span>
          </div>
        )}
        <select className="input text-sm w-44" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input text-sm w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9 text-sm w-full"
            placeholder="Search estimate # or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activeFilters > 0 && (
          <button onClick={() => { setCustomerFilter(""); setStatusFilter(""); }} className="text-sm text-brand-600 hover:underline">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Date</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Number</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Customer</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Estimated total</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-gray-400">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">No estimates match your filters</p>
                </td>
              </tr>
            ) : (
              filtered.map((est) => (
                <tr key={est.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4"><StatusBadge status={est.status} /></td>
                  <td className="px-5 py-4 text-gray-500">{formatDateOnly(est.estimateDate, "yyyy-MM-dd")}</td>
                  <td className="px-5 py-4">
                    <Link href={`/estimates/${est.id}`} className="text-brand-600 hover:underline font-medium">
                      {est.estimateNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-gray-700">{est.customer.name}</td>
                  <td className="px-5 py-4 text-right font-semibold text-gray-900">
                    {formatCurrency(est.totalAmount)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/estimates/${est.id}`}
                      className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium text-xs"
                    >
                      {est.convertedInvoiceId ? "View" : "Open"}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">{total} total estimate{total !== 1 ? "s" : ""}</p>
    </div>
  );
}
