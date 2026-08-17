"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Package, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";

type PRStatus = "PENDING" | "FULFILLED" | "HOUSE";

interface Row {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  itemCode: string;
  description: string;
  quantity: string;
  status: PRStatus;
  createdAt: string;
  fulfilledAt: string | null;
  cost: string | null;
}

interface SupplierOpt { id: string; name: string; code: string | null }

const STATUS_STYLES: Record<PRStatus, string> = {
  PENDING: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  FULFILLED: "bg-green-50 text-green-700 border border-green-200",
  HOUSE: "bg-amber-50 text-amber-700 border border-amber-200",
};

const STATUS_LABELS: Record<PRStatus, string> = {
  PENDING: "Pending",
  FULFILLED: "Fulfilled",
  HOUSE: "House stock",
};

export default function PurchasingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cogs, setCogs] = useState("0");
  const [pendingCount, setPendingCount] = useState(0);
  const [fulfilledCount, setFulfilledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PRStatus | "">("PENDING");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SupplierOpt[]) => setSuppliers(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: "items-ordered" });
    if (statusFilter) params.set("status", statusFilter);
    if (supplierFilter) params.set("supplierId", supplierFilter);
    fetch(`/api/reports?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rows: Row[]; cogs: string; pendingCount: number; fulfilledCount: number } | null) => {
        setRows(d?.rows ?? []);
        setCogs(d?.cogs ?? "0");
        setPendingCount(d?.pendingCount ?? 0);
        setFulfilledCount(d?.fulfilledCount ?? 0);
      })
      .finally(() => setLoading(false));
  }, [statusFilter, supplierFilter]);

  // Grouped by supplier per the purchasing workflow -- purchasing works
  // through one supplier's open requests at a time.
  const grouped = useMemo(() => {
    const groups = new Map<string, { supplierName: string; rows: Row[] }>();
    for (const row of rows) {
      const g = groups.get(row.supplierId);
      if (g) g.rows.push(row);
      else groups.set(row.supplierId, { supplierName: row.supplierName, rows: [row] });
    }
    return Array.from(groups.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [rows]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Purchasing</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Items auto-requested for purchase the moment a customer invoice line is paid
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Status</label>
            <select
              className="input w-44"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PRStatus | "")}
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="HOUSE">House stock</option>
            </select>
          </div>
          <div>
            <label className="label">Supplier</label>
            <select className="input w-56" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.code ?? "??"} — {s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 ml-auto">
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] uppercase text-yellow-700 font-semibold">Pending</p>
              <p className="font-bold text-yellow-800">{pendingCount}</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] uppercase text-green-700 font-semibold">Fulfilled</p>
              <p className="font-bold text-green-800">{fulfilledCount}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] uppercase text-blue-700 font-semibold">Cost (fulfilled)</p>
              <p className="font-bold text-blue-800">{formatCurrency(cogs)}</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>
      ) : grouped.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Nothing here yet
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.supplierName} className="card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">{group.supplierName}</h2>
              <span className="text-xs text-gray-400">{group.rows.length} item{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-gray-500 text-xs uppercase">
                  <th className="px-5 py-2">Invoice #</th>
                  <th className="px-3 py-2">Item Code</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-2 font-medium text-gray-900">
                      <Link href={`/invoices/customer/${row.invoiceId}`} className="hover:underline text-brand-700">
                        {row.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.itemCode}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{row.description}</td>
                    <td className="px-3 py-2 text-right">{row.quantity}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {row.status === "FULFILLED" && row.fulfilledAt
                        ? `Closed ${formatDateOnly(row.fulfilledAt)}`
                        : `Requested ${formatDateOnly(row.createdAt)}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.cost ? formatCurrency(row.cost) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {row.status === "PENDING" && (
                        <Link
                          href={`/invoices/supplier/new?purchaseRequestId=${row.id}`}
                          className="btn-primary text-xs py-1 px-2.5 inline-flex"
                        >
                          <ShoppingCart className="w-3 h-3" />
                          Create Bill
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
