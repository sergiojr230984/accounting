"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { ArrowUp, ArrowDown } from "lucide-react";
import { formatCurrency } from "@/lib/money";

export interface TodaySales {
  netSales: string;
  netSalesChangePct: number | null;
  invoiceCount: number;
  invoiceCountChangePct: number | null;
  avgInvoice: string;
  avgInvoiceChangePct: number | null;
  comparisonLabel: string;
  currentHour: number;
  hourly: { hour: number; today: number; comparison: number }[];
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour > 12 ? `${hour - 12}p` : `${hour}a`;
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-400">No activity to compare</span>;
  const up = pct >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${up ? "text-green-600" : "text-red-600"}`}>
      <Icon className="w-3.5 h-3.5" />
      {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

export default function DailySalesCard({ data }: { data: TodaySales }) {
  const [showComparison, setShowComparison] = useState(true);

  const chartData = useMemo(
    () => data.hourly.map((h) => ({ ...h, label: hourLabel(h.hour) })),
    [data.hourly]
  );

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { dataKey: "today" | "comparison"; value: number }[];
    label?: string;
  }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[140px]">
        <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
        <div className="space-y-1">
          {payload.map((p) => (
            <div key={p.dataKey} className="flex items-center justify-between gap-3">
              <span className="text-gray-500">{p.dataKey === "today" ? "Today" : `Last ${data.comparisonLabel}`}</span>
              <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(p.value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Hero metrics */}
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-gray-700">Net sales</p>
            <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(data.netSales)}</p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <ChangeBadge pct={data.netSalesChangePct} />
              {data.netSalesChangePct !== null && (
                <span className="text-xs text-gray-400">vs. last {data.comparisonLabel}</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">Invoices</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{data.invoiceCount}</p>
            <ChangeBadge pct={data.invoiceCountChangePct} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">Average invoice</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(data.avgInvoice)}</p>
            <ChangeBadge pct={data.avgInvoiceChangePct} />
          </div>
        </div>

        {/* Hourly chart */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <p className="text-xs text-gray-400">Which hours are busiest, today vs. last {data.comparisonLabel}</p>
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                <span className="w-2.5 h-2.5 rounded-full bg-brand-600" />
                Today
              </span>
              <button
                onClick={() => setShowComparison((s) => !s)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  showComparison ? "text-gray-700" : "text-gray-300"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${showComparison ? "bg-gray-400" : "bg-gray-200"}`} />
                Last {data.comparisonLabel}
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="label"
                interval={2}
                tick={{ fontSize: 11, fill: "#898781" }}
                axisLine={{ stroke: "#e1e0d9" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#898781" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f5f5f4" }} />
              <Bar dataKey="today" name="today" fill="#ea580c" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              {showComparison && (
                <Line
                  dataKey="comparison"
                  name="comparison"
                  stroke="#9ca3af"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              <ReferenceLine
                x={hourLabel(data.currentHour)}
                stroke="#111827"
                strokeDasharray="2 2"
                label={{ value: "Now", position: "top", fontSize: 10, fill: "#111827" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
