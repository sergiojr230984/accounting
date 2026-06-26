"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  FileText,
  ShoppingCart,
  Users,
  Receipt,
  AlertCircle,
  ChevronRight,
  Sliders,
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
import { format } from "date-fns";
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

interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string;
  customer: { name: string };
}

const QUICK_ACTIONS = [
  {
    href: "/invoices/customer/new",
    label: "Create invoice",
    icon: FileText,
    bg: "bg-brand-50 hover:bg-brand-100",
    text: "text-brand-700",
    iconBg: "bg-brand-200",
  },
  {
    href: "/invoices/supplier/new",
    label: "Add bill",
    icon: Receipt,
    bg: "bg-orange-50 hover:bg-orange-100",
    text: "text-orange-700",
    iconBg: "bg-orange-200",
  },
  {
    href: "/customers",
    label: "Add customer",
    icon: Users,
    bg: "bg-green-50 hover:bg-green-100",
    text: "text-green-700",
    iconBg: "bg-green-200",
  },
  {
    href: "/employees",
    label: "Add employee",
    icon: ShoppingCart,
    bg: "bg-purple-50 hover:bg-purple-100",
    text: "text-purple-700",
    iconBg: "bg-purple-200",
  },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [overdue, setOverdue] = useState<OverdueInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [dashRes, invRes] = await Promise.all([
        fetch(`/api/dashboard`),
        fetch(`/api/invoices/customer?status=UNPAID&page=1&limit=20`),
      ]);
      const dash = await dashRes.json();
      const inv = invRes.ok ? await invRes.json() : { invoices: [] };
      setData(dash);
      const today = new Date();
      const od = (inv.invoices ?? []).filter((i: OverdueInvoice) => new Date(i.dueDate) < today);
      od.sort((a: OverdueInvoice, b: OverdueInvoice) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setOverdue(od.slice(0, 5));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const overdueTotal = useMemo(
    () =>
      overdue.reduce(
        (sum, i) => sum + Math.max(parseFloat(i.totalAmount) - parseFloat(i.paidAmount), 0),
        0
      ),
    [overdue]
  );

  const profitPositive = data ? parseFloat(data.netProfit) >= 0 : true;
  const firstName = (session?.user?.name ?? "").split(" ")[0];

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Greeting */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
      </div>

      {/* Quick action cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {QUICK_ACTIONS.map(({ href, label, icon: Icon, bg, text, iconBg }) => (
          <Link
            key={href}
            href={href}
            className={`${bg} ${text} rounded-2xl px-5 py-4 flex items-center gap-3 transition-colors font-medium`}
          >
            <div className={`${iconBg} w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0`}>
              <Icon className="w-4.5 h-4.5" strokeWidth={2.5} />
            </div>
            <span className="text-sm">{label}</span>
          </Link>
        ))}
      </div>

      {/* Insights */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Insights for you</h2>
          <button className="btn-secondary text-xs" disabled>
            <Sliders className="w-3.5 h-3.5" />
            Customize
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Overdue invoices */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">Overdue invoices and bills</h3>
                {overdueTotal > 0 && (
                  <span className="text-sm font-semibold text-red-600">{formatCurrency(overdueTotal.toFixed(2))}</span>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-6 py-4">
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4 mb-2" />
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-1/3" />
                  </div>
                ))
              ) : overdue.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="w-6 h-6 text-green-500" />
                  </div>
                  <p className="text-sm text-gray-500">No overdue invoices. Nice work.</p>
                </div>
              ) : (
                overdue.map((inv) => {
                  const balance = Math.max(parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount), 0);
                  const days = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
                  return (
                    <Link
                      key={inv.id}
                      href={`/invoices/customer/${inv.id}`}
                      className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{inv.customer.name}</p>
                        <p className="text-xs text-red-600 mt-0.5">
                          Overdue {days} day{days !== 1 ? "s" : ""} · {inv.invoiceNumber}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-900">{formatCurrency(balance.toFixed(2))}</span>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
            {data && data.unpaidCustomerCount > overdue.length && (
              <Link
                href="/invoices/customer?status=UNPAID"
                className="block px-6 py-3 text-sm text-brand-600 hover:bg-gray-50 border-t border-gray-100 font-medium"
              >
                View all {data.unpaidCustomerCount} unpaid invoices →
              </Link>
            )}
          </div>

          {/* Cash flow */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">Cash flow</h3>
                <p className="text-xs text-gray-500 mt-0.5">Always displays cash basis (paid)</p>
              </div>
              <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 px-2 py-1 rounded">Last 12 months</span>
            </div>
            <div className="px-2 py-4">
              {loading ? (
                <div className="h-64 bg-gray-50 animate-pulse rounded" />
              ) : data ? (
                <>
                  <div className="px-4 flex items-center gap-4 text-xs text-gray-600 mb-2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-green-500 rounded-sm" /> Inflow
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-red-400 rounded-sm" /> Outflow
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-brand-500 rounded-sm" /> Profit
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={data.monthlyChart} margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        tickFormatter={(v: string) => {
                          // API sends "YYYY-MM" — show short month name, and
                          // tag January with the year so the reader can see
                          // year boundaries in the 12-month series.
                          const [y, m] = v.split("-");
                          const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                          const name = names[parseInt(m, 10) - 1] ?? v;
                          return m === "01" ? `${name} '${y.slice(2)}` : name;
                        }}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend wrapperStyle={{ display: "none" }} />
                      <Area type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                      <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
                      <Area type="monotone" dataKey="profit" stroke="#f97316" fill="url(#profitGrad)" strokeWidth={2} name="Profit" />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* P&L summary */}
      {data && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Profit & Loss</h2>
          <div className="card">
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Income</span>
                <span className="font-semibold text-green-700">{formatCurrency(data.totalIncome)}</span>
              </div>
              <div className="flex justify-between text-sm pl-4">
                <span className="text-gray-500">Less: Cost of Goods Sold</span>
                <span className="font-medium text-red-600">({formatCurrency(data.totalCOGS)})</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-2.5">
                <span className="text-gray-900">= Gross Profit</span>
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
              <div className="flex justify-between font-bold border-t border-gray-100 pt-3 text-base">
                <span className="text-gray-900">= Net Profit</span>
                <span className={profitPositive ? "text-green-700" : "text-red-700"}>
                  {formatCurrency(data.netProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
