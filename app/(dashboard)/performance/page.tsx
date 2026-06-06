"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Trophy, Loader2, DollarSign, FileText, Award } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/money";
import PaymentBadge from "@/components/PaymentBadge";

interface LeaderboardRow {
  employeeId: string;
  employeeName: string;
  invoiceCount: number;
  salesTotal: string;
  commissionTotal: string;
  paidCount: number;
  paidRate: number;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  totalAmount: string;
  paidAmount: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  employeeId: string | null;
  commissionRate: string;
  commissionAmount: string;
}

const monthAgoISO = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
};
const todayISO = () => new Date().toISOString().split("T")[0];

export default function PerformancePage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthAgoISO());
  const [to, setTo] = useState(todayISO());
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/performance?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setLeaderboard(data.leaderboard);
      setInvoices(data.invoices);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const filteredInvoices = selectedEmployee
    ? invoices.filter((i) => i.employeeId === selectedEmployee)
    : invoices;

  const totalSales = leaderboard.reduce((s, r) => s + parseFloat(r.salesTotal), 0);
  const totalCommission = leaderboard.reduce((s, r) => s + parseFloat(r.commissionTotal), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sales by employee and commissions earned</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input text-sm w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input text-sm w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-50 border border-brand-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Total sales</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(totalSales.toFixed(2))}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 border border-green-100 rounded-lg flex items-center justify-center">
              <Award className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Total commissions</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(totalCommission.toFixed(2))}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Invoices</p>
              <p className="text-xl font-bold text-gray-900">{invoices.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Leaderboard</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-gray-500">
              <th className="px-5 py-2 text-xs font-medium uppercase w-10">#</th>
              <th className="px-5 py-2 text-xs font-medium uppercase">Employee</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Invoices</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Paid rate</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Sales</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : leaderboard.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No employees with invoices in this date range.{" "}
                <Link href="/employees" className="text-brand-600 hover:underline">Add employees</Link>
                {" and assign them to invoices."}
              </td></tr>
            ) : (
              leaderboard.map((row, idx) => (
                <tr
                  key={row.employeeId}
                  onClick={() => setSelectedEmployee((cur) => (cur === row.employeeId ? null : row.employeeId))}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${selectedEmployee === row.employeeId ? "bg-brand-50" : ""}`}
                >
                  <td className="px-5 py-3 font-bold text-gray-400">
                    {idx === 0 && row.invoiceCount > 0 ? "🥇" : idx === 1 && row.invoiceCount > 0 ? "🥈" : idx === 2 && row.invoiceCount > 0 ? "🥉" : idx + 1}
                  </td>
                  <td className="px-5 py-3 font-medium text-gray-900">{row.employeeName}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{row.invoiceCount}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{(row.paidRate * 100).toFixed(0)}%</td>
                  <td className="px-5 py-3 text-right font-medium">{formatCurrency(row.salesTotal)}</td>
                  <td className="px-5 py-3 text-right font-medium text-green-700">{formatCurrency(row.commissionTotal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail invoices */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">
            {selectedEmployee
              ? `Invoices for ${leaderboard.find((r) => r.employeeId === selectedEmployee)?.employeeName ?? ""}`
              : "All commission invoices"}
          </h2>
          {selectedEmployee && (
            <button onClick={() => setSelectedEmployee(null)} className="text-xs text-brand-600 hover:underline">Clear filter</button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-gray-500">
              <th className="px-5 py-2 text-xs font-medium uppercase">Invoice</th>
              <th className="px-5 py-2 text-xs font-medium uppercase">Customer</th>
              <th className="px-5 py-2 text-xs font-medium uppercase">Date</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Total</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Rate</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-right">Commission</th>
              <th className="px-5 py-2 text-xs font-medium uppercase text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredInvoices.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">No invoices in range.</td></tr>
            ) : (
              filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/invoices/customer/${inv.id}`} className="text-brand-600 hover:underline font-medium">
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{inv.customerName}</td>
                  <td className="px-5 py-3 text-gray-500">{format(new Date(inv.invoiceDate), "MMM d, yyyy")}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(inv.totalAmount)}</td>
                  <td className="px-5 py-3 text-right text-gray-500">{(parseFloat(inv.commissionRate) * 100).toFixed(1)}%</td>
                  <td className="px-5 py-3 text-right font-medium text-green-700">{formatCurrency(inv.commissionAmount)}</td>
                  <td className="px-5 py-3 text-center"><PaymentBadge status={inv.paymentStatus} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        </div>
      )}
    </div>
  );
}
