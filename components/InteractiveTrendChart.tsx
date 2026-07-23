"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
  ReferenceLine,
} from "recharts";
import { BarChart3, LineChart as LineChartIcon, AreaChart as AreaChartIcon, X } from "lucide-react";
import { formatCurrency } from "@/lib/money";

export interface MonthlyPoint {
  month: string;
  income: number;
  expenses: number;
  cogs: number;
  services: number;
  operating: number;
  other: number;
  profit: number;
}

type ChartType = "area" | "bar" | "line";
type SeriesKey = "income" | "expenses" | "profit";
type ViewMode = "monthly" | "cumulative";

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "income", label: "Income", color: "#22c55e" },
  { key: "expenses", label: "Expenses", color: "#ef4444" },
  { key: "profit", label: "Net Profit", color: "#0ea5e9" },
];

const CATEGORY_COLORS: Record<string, string> = {
  cogs: "#eab308",
  services: "#3b82f6",
  operating: "#a855f7",
  other: "#6b7280",
};

const CATEGORY_LABELS: Record<string, string> = {
  cogs: "Cost of Goods",
  services: "Services Expense",
  operating: "Operating Expense",
  other: "Other Expense",
};

function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

export default function InteractiveTrendChart({ data }: { data: MonthlyPoint[] }) {
  const [chartType, setChartType] = useState<ChartType>("area");
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [range, setRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: Math.max(data.length - 1, 0),
  });
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const chartData = useMemo(() => {
    const labeled = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
    if (viewMode === "monthly") return labeled;
    let income = 0,
      expenses = 0,
      profit = 0;
    return labeled.map((d) => {
      income += d.income;
      expenses += d.expenses;
      profit += d.profit;
      return { ...d, income, expenses, profit };
    });
  }, [data, viewMode]);

  const visibleRange = chartData.slice(range.start, range.end + 1);

  const rangeTotals = useMemo(() => {
    return visibleRange.reduce(
      (acc, d) => {
        acc.income += d.income;
        acc.expenses += d.expenses;
        acc.profit += d.profit;
        return acc;
      },
      { income: 0, expenses: 0, profit: 0 }
    );
  }, [visibleRange]);

  const avgProfit =
    visibleRange.length > 0
      ? visibleRange.reduce((s, d) => s + d.profit, 0) / visibleRange.length
      : 0;

  const margin = rangeTotals.income !== 0 ? (rangeTotals.profit / rangeTotals.income) * 100 : 0;

  const selected = data.find((d) => d.month === selectedMonth) || null;

  function toggleSeries(key: SeriesKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size === SERIES.length - 1) return prev; // keep at least one visible
        next.add(key);
      }
      return next;
    });
  }

  function handleChartClick(e: { activeLabel?: string }) {
    if (!e || !e.activeLabel) return;
    const point = chartData.find((d) => d.label === e.activeLabel);
    if (point) setSelectedMonth((cur) => (cur === point.month ? null : point.month));
  }

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { dataKey: SeriesKey; value: number; color: string }[];
    label?: string;
  }) => {
    if (!active || !payload || !payload.length) return null;
    const point = chartData.find((d) => d.label === label);
    const idx = point ? chartData.indexOf(point) : -1;
    const prev = idx > 0 ? chartData[idx - 1] : null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[160px]">
        <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
        <div className="space-y-1">
          {SERIES.filter((s) => !hidden.has(s.key)).map((s) => {
            const entry = payload.find((p) => p.dataKey === s.key);
            if (!entry) return null;
            const delta = prev ? entry.value - (prev as unknown as Record<string, number>)[s.key] : null;
            return (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-gray-500">
                  <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(entry.value)}
                  {delta !== null && prev && (prev as unknown as Record<string, number>)[s.key] !== 0 && (
                    <span className={`ml-1 font-normal ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ({delta >= 0 ? "+" : ""}
                      {((delta / Math.abs((prev as unknown as Record<string, number>)[s.key])) * 100).toFixed(0)}%)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-gray-400 mt-1.5 pt-1.5 border-t border-gray-100">Click to see the category breakdown</p>
      </div>
    );
  };

  const showLine = (key: SeriesKey) => !hidden.has(key);

  const seriesElements =
    chartType === "area"
      ? [
          showLine("income") && (
            <Area key="income" type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incomeGrad)" strokeWidth={2} name="Income" isAnimationActive={false} />
          ),
          showLine("expenses") && (
            <Area key="expenses" type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" isAnimationActive={false} />
          ),
          showLine("profit") && (
            <Area key="profit" type="monotone" dataKey="profit" stroke="#0ea5e9" fill="url(#profitGrad)" strokeWidth={2} name="Net Profit" isAnimationActive={false} />
          ),
        ]
      : chartType === "bar"
      ? [
          showLine("income") && <Bar key="income" dataKey="income" fill="#22c55e" name="Income" radius={[3, 3, 0, 0]} isAnimationActive={false} />,
          showLine("expenses") && <Bar key="expenses" dataKey="expenses" fill="#ef4444" name="Expenses" radius={[3, 3, 0, 0]} isAnimationActive={false} />,
          showLine("profit") && <Bar key="profit" dataKey="profit" fill="#0ea5e9" name="Net Profit" radius={[3, 3, 0, 0]} isAnimationActive={false} />,
        ]
      : [
          showLine("income") && <Line key="income" type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Income" isAnimationActive={false} />,
          showLine("expenses") && <Line key="expenses" type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="Expenses" isAnimationActive={false} />,
          showLine("profit") && <Line key="profit" type="monotone" dataKey="profit" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} name="Net Profit" isAnimationActive={false} />,
        ];

  return (
    <div className="card">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Cash Flow Trend</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Drag the scrollbar below the chart to zoom · click a point for details
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
            <button
              onClick={() => setViewMode("monthly")}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === "monthly" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setViewMode("cumulative")}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === "cumulative" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Cumulative
            </button>
          </div>
          <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
            {(
              [
                { type: "area" as ChartType, icon: AreaChartIcon },
                { type: "bar" as ChartType, icon: BarChart3 },
                { type: "line" as ChartType, icon: LineChartIcon },
              ]
            ).map(({ type, icon: Icon }) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                title={`${type[0].toUpperCase()}${type.slice(1)} chart`}
                className={`p-1.5 rounded-md transition-colors ${
                  chartType === type ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend / series toggle */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {SERIES.map((s) => {
          const isHidden = hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                isHidden ? "border-gray-200 text-gray-400 bg-gray-50" : "border-gray-200 text-gray-700 bg-white"
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: isHidden ? "#d1d5db" : s.color }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Range KPI strip — reflects the zoomed / brushed selection */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Income (selected)</p>
          <p className="text-sm font-semibold text-green-700 tabular-nums">{formatCurrency(rangeTotals.income)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Expenses (selected)</p>
          <p className="text-sm font-semibold text-red-700 tabular-nums">{formatCurrency(rangeTotals.expenses)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Net Profit (selected)</p>
          <p className={`text-sm font-semibold tabular-nums ${rangeTotals.profit >= 0 ? "text-sky-700" : "text-red-700"}`}>
            {formatCurrency(rangeTotals.profit)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Margin (selected)</p>
          <p className={`text-sm font-semibold tabular-nums ${margin >= 0 ? "text-gray-900" : "text-red-700"}`}>
            {margin.toFixed(1)}%
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }} onClick={handleChartClick}>
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
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#e1e0d9" }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#898781" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#c3c2b7", strokeWidth: 1 }} />
          <ReferenceLine
            y={avgProfit}
            stroke="#9ca3af"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{ value: "Avg profit", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }}
          />
          {selectedMonth && (
            <ReferenceLine
              x={monthLabel(selectedMonth)}
              stroke="#111827"
              strokeWidth={1.5}
            />
          )}

          {seriesElements}

          <Brush
            dataKey="label"
            height={24}
            travellerWidth={8}
            stroke="#c3c2b7"
            fill="#fcfcfb"
            startIndex={range.start}
            endIndex={range.end}
            onChange={(r) => {
              if (r.startIndex !== undefined && r.endIndex !== undefined) {
                setRange({ start: r.startIndex, end: r.endIndex });
              }
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Drill-down panel for the clicked month */}
      {selected && (
        <div className="mt-4 rounded-lg border border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">{monthLabel(selected.month)} breakdown</h3>
            <button onClick={() => setSelectedMonth(null)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Income</p>
              <p className="text-sm font-semibold text-green-700 tabular-nums">{formatCurrency(selected.income)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Net Profit</p>
              <p className={`text-sm font-semibold tabular-nums ${selected.profit >= 0 ? "text-sky-700" : "text-red-700"}`}>
                {formatCurrency(selected.profit)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Margin</p>
              <p className="text-sm font-semibold text-gray-900 tabular-nums">
                {selected.income !== 0 ? ((selected.profit / selected.income) * 100).toFixed(1) : "0.0"}%
              </p>
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Expense categories</p>
          <div className="space-y-1.5">
            {(["cogs", "services", "operating", "other"] as const).map((key) => {
              const value = selected[key];
              const pct = selected.expenses !== 0 ? (value / selected.expenses) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="w-32 text-gray-500 flex-shrink-0">{CATEGORY_LABELS[key]}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, backgroundColor: CATEGORY_COLORS[key] }}
                    />
                  </div>
                  <span className="w-20 text-right font-medium text-gray-700 tabular-nums">{formatCurrency(value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
