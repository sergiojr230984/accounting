"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  FileText,
  ShoppingCart,
  Users,
  Receipt,
  Sliders,
} from "lucide-react";
import InteractiveTrendChart, { type MonthlyPoint } from "@/components/InteractiveTrendChart";
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
  monthlyChart: MonthlyPoint[];
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
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const dashRes = await fetch(`/api/dashboard`);
      // A non-ok response (e.g. 403 for a role that can't see company-wide
      // P&L) still has a JSON body, but it's an error object, not real
      // DashboardData -- setting it directly used to crash the whole page
      // downstream (e.g. formatCurrency(undefined) throwing a DecimalError).
      const dash = dashRes.ok ? await dashRes.json() : null;
      setData(dash);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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

        {/* Cash flow */}
        {!loading && data && <InteractiveTrendChart data={data.monthlyChart} />}
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
