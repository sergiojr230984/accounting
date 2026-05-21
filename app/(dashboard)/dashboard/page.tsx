"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  BarChart2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/money";

interface DashboardData {
  totalIncome: string;
  totalCOGS: string;
  totalServices: string;
  totalOperating: string;
  totalOther: string;
  grossProfit: string;
  netProfit: string;
  unpaidCustomerCount: number;
  unpaidCustomerTotal: string;
  unpaidSupplierCount: number;
  unpaidSupplierTotal: string;
  totalSupplierExpenses: string;
  monthlyChart: { month: string; income: number; expenses: number; profit: number }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/dashboard?${params}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [from, to]);

  const profitPositive = data ? parseFloat(data.netProfit) >= 0 : true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial overview at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input text-sm w-40"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input text-sm w-40"
          />
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} className="btn-secondary text-sm py-1.5">
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-100" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Income & profit cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Income" value={data.totalIncome} icon={DollarSign} color="green" />
            <StatCard label="Cost of Goods" value={data.totalCOGS} icon={ShoppingCart} color="yellow" />
            <StatCard label="Gross Profit" value={data.grossProfit} icon={TrendingUp} color={parseFloat(data.grossProfit) >= 0 ? "green" : "red"} />
            <StatCard
              label="Net Profit"
              value={data.netProfit}
              icon={profitPositive ? TrendingUp : TrendingDown}
              color={profitPositive ? "green" : "red"}
            />
          </div>

          {/* Expense breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Services Expense" value={data.totalServices} icon={BarChart2} color="blue" />
            <StatCard label="Operating Expenses" value={data.totalOperating} icon={BarChart2} color="purple" />
            <StatCard
              label="Unpaid Customer Invoices"
              value={data.unpaidCustomerTotal}
              icon={AlertTriangle}
              color="yellow"
              subtitle={`${data.unpaidCustomerCount} invoice${data.unpaidCustomerCount !== 1 ? "s" : ""}`}
            />
            <StatCard
              label="Unpaid Supplier Invoices"
              value={data.unpaidSupplierTotal}
              icon={AlertTriangle}
              color="red"
              subtitle={`${data.unpaidSupplierCount} invoice${data.unpaidSupplierCount !== 1 ? "s" : ""}`}
            />
          </div>

          {/* P&L Summary */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Profit & Loss Summary</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Income</span>
                <span className="font-medium text-green-700">{formatCurrency(data.totalIncome)}</span>
              </div>
              <div className="flex justify-between text-sm pl-4">
                <span className="text-gray-500">Less: Cost of Goods Sold</span>
                <span className="font-medium text-red-600">({formatCurrency(data.totalCOGS)})</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t pt-2">
                <span>= Gross Profit</span>
                <span className={parseFloat(data.grossProfit) >= 0 ? "text-green-700" : "text-red-700"}>
                  {formatCurrency(data.grossProfit)}
                </span>
              </div>
              <div className="flex justify-between text-sm pl-4">
                <span className="text-gray-500">Less: Services Expense</span>
                <span className="font-medium text-red-600">({formatCurrency(data.totalServices)})</span>
              </div>
              <div className="flex justify-between text-sm pl-4">
                <span className="text-gray-500">Less: Operating Expenses</span>
                <span className="font-medium text-red-600">({formatCurrency(data.totalOperating)})</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t pt-2 text-base">
                <span>= Net Profit</span>
                <span className={profitPositive ? "text-green-700" : "text-red-700"}>
                  {formatCurrency(data.netProfit)}
                </span>
              </div>
            </div>
          </div>

          {/* Monthly chart */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Trend (Last 12 Months)</h2>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.monthlyChart} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Area type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
                <Area type="monotone" dataKey="profit" stroke="#0ea5e9" fill="url(#profitGrad)" strokeWidth={2} name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : null}
    </div>
  );
}
