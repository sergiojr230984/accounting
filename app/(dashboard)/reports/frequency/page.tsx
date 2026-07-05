"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Loader2,
  ShoppingCart,
  RefreshCw,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Package,
} from "lucide-react";
import { formatCurrency } from "@/lib/money";

type Period = "this-month" | "3m" | "6m" | "12m" | "custom";

interface FrequencyRow {
  key: string;
  displayName: string;
  invoiceCount: number;
  totalQty: string;
  totalRevenue: string;
  avgPrice: string;
  monthsActive: number;
  months: string[];
}

interface FrequencyData {
  rows: FrequencyRow[];
  nearDuplicateGroups: { displayNames: string[] }[];
  totalLineItems: number;
  uniqueDescriptions: number;
  totalMonthsInRange: number;
}

type SortKey = "displayName" | "invoiceCount" | "totalQty" | "totalRevenue" | "avgPrice" | "monthsActive";
type SortDir = "asc" | "desc";

function getPeriodDates(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (period === "custom") return { from: customFrom, to: customTo };

  if (period === "this-month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: fmt(from), to: fmt(to) };
  }

  const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
  const from = new Date(today.getFullYear(), today.getMonth() - months + 1, 1);
  return { from: fmt(from), to: fmt(today) };
}

function sortRows(rows: FrequencyRow[], key: SortKey, dir: SortDir): FrequencyRow[] {
  return [...rows].sort((a, b) => {
    let va: number | string = 0;
    let vb: number | string = 0;
    if (key === "displayName") { va = a.displayName.toLowerCase(); vb = b.displayName.toLowerCase(); }
    else if (key === "invoiceCount") { va = a.invoiceCount; vb = b.invoiceCount; }
    else if (key === "totalQty") { va = parseFloat(a.totalQty); vb = parseFloat(b.totalQty); }
    else if (key === "totalRevenue") { va = parseFloat(a.totalRevenue); vb = parseFloat(b.totalRevenue); }
    else if (key === "avgPrice") { va = parseFloat(a.avgPrice); vb = parseFloat(b.avgPrice); }
    else if (key === "monthsActive") { va = a.monthsActive; vb = b.monthsActive; }

    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

export default function FrequencyReportPage() {
  const [period, setPeriod] = useState<Period>("3m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [threshold, setThreshold] = useState(5);
  const [data, setData] = useState<FrequencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("invoiceCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async () => {
    const { from, to } = getPeriodDates(period, customFrom, customTo);
    if (period === "custom" && (!from || !to)) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/reports/frequency?${params}`);
      if (res.status === 403) { setForbidden(true); return; }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (period !== "custom") load();
  }, [period, load]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <ChevronDown className="w-3 h-3 text-gray-300 inline ml-1" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-brand-500 inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-brand-500 inline ml-1" />;
  }

  function exportCSV() {
    if (!data) return;
    const { from, to } = getPeriodDates(period, customFrom, customTo);
    const sorted = sortRows(data.rows, sortKey, sortDir);
    const header = "Producto / Servicio,# Facturas,Cantidad Total,Ingresos Totales,Precio Promedio,Meses Activo";
    const body = sorted.map((r) =>
      `"${r.displayName.replace(/"/g, '""')}",${r.invoiceCount},${r.totalQty},${r.totalRevenue},${r.avgPrice},${r.monthsActive}`
    ).join("\n");
    const csv = `Reporte de Frecuencia de Productos y Servicios\nPeríodo: ${from} al ${to}\n\n${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frecuencia-productos-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (forbidden) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-gray-500 font-medium">Acceso restringido a administradores.</p>
        </div>
      </div>
    );
  }

  const sorted = data ? sortRows(data.rows, sortKey, sortDir) : [];
  const bulkCandidates = data ? data.rows.filter((r) => r.invoiceCount >= threshold) : [];
  const recurring = data
    ? data.rows.filter((r) => data.totalMonthsInRange > 1 && r.monthsActive >= data.totalMonthsInRange)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Frecuencia de Productos y Servicios</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Identifica qué productos se repiten más para comprar en volumen y qué servicios son recurrentes.
        </p>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Período</label>
            <select
              className="input w-44"
              value={period}
              onChange={(e) => { setPeriod(e.target.value as Period); setData(null); }}
            >
              <option value="this-month">Este mes</option>
              <option value="3m">Últimos 3 meses</option>
              <option value="6m">Últimos 6 meses</option>
              <option value="12m">Últimos 12 meses</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          {period === "custom" && (
            <>
              <div>
                <label className="label">Desde</label>
                <input type="date" className="input w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input type="date" className="input w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
              <button onClick={load} disabled={loading || !customFrom || !customTo} className="btn-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Generar
              </button>
            </>
          )}
          <div>
            <label className="label">Umbral compra al por mayor</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className="input w-20"
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
              />
              <span className="text-sm text-gray-500">facturas</span>
            </div>
          </div>
          {data && (
            <button onClick={exportCSV} className="btn-secondary">
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Near-duplicates warning */}
          {data.nearDuplicateGroups.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm">
                    Posibles duplicados detectados
                  </p>
                  <p className="text-amber-700 text-sm mt-0.5">
                    Los siguientes grupos comparten la misma palabra inicial y podrían ser el mismo producto escrito de forma diferente:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {data.nearDuplicateGroups.slice(0, 8).map((g, i) => (
                      <li key={i} className="text-sm text-amber-800">
                        <span className="font-medium">{g.displayNames.join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Líneas analizadas</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{data.totalLineItems}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Productos únicos</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{data.uniqueDescriptions}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Candidatos al por mayor</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{bulkCandidates.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Servicios recurrentes</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{recurring.length}</p>
            </div>
          </div>

          {/* Bulk candidates highlight */}
          {bulkCandidates.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingCart className="w-5 h-5 text-orange-500" />
                <h2 className="font-semibold text-gray-800">
                  Candidatos para compra al por mayor
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({threshold}+ facturas en el período)
                  </span>
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {bulkCandidates
                  .sort((a, b) => b.invoiceCount - a.invoiceCount)
                  .map((r) => (
                    <div
                      key={r.key}
                      className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2"
                    >
                      <Package className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-orange-900">{r.displayName}</span>
                      <span className="text-xs text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                        {r.invoiceCount} facturas
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Recurring services highlight */}
          {recurring.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <RefreshCw className="w-5 h-5 text-blue-500" />
                <h2 className="font-semibold text-gray-800">
                  Servicios recurrentes
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    (aparece en los {data.totalMonthsInRange} meses del período)
                  </span>
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {recurring.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-blue-900">{r.displayName}</span>
                    <span className="text-xs text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                      {r.monthsActive} meses
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main table */}
          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Detalle por producto / servicio</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-gray-500 text-xs uppercase">
                    {(
                      [
                        { key: "displayName", label: "Nombre", align: "" },
                        { key: "invoiceCount", label: "# Facturas", align: "text-right" },
                        { key: "totalQty", label: "Cantidad Total", align: "text-right" },
                        { key: "totalRevenue", label: "Ingresos Totales", align: "text-right" },
                        { key: "avgPrice", label: "Precio Promedio", align: "text-right" },
                        { key: "monthsActive", label: "Meses Activo", align: "text-right" },
                      ] as { key: SortKey; label: string; align: string }[]
                    ).map((col) => (
                      <th
                        key={col.key}
                        className={`pb-2 cursor-pointer select-none hover:text-gray-800 transition-colors ${col.align}`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <SortIcon col={col.key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">
                        No hay datos para el período seleccionado.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((row) => (
                      <tr key={row.key} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 font-medium text-gray-900 max-w-xs truncate" title={row.displayName}>
                          {row.displayName}
                        </td>
                        <td className="py-2.5 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                              row.invoiceCount >= threshold
                                ? "bg-orange-100 text-orange-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {row.invoiceCount}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-gray-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {parseFloat(row.totalQty) % 1 === 0
                            ? parseInt(row.totalQty).toLocaleString()
                            : parseFloat(row.totalQty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 text-right font-medium text-gray-900" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatCurrency(row.totalRevenue)}
                        </td>
                        <td className="py-2.5 text-right text-gray-600" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatCurrency(row.avgPrice)}
                        </td>
                        <td className="py-2.5 text-right text-gray-600">
                          {row.monthsActive}
                          {data.totalMonthsInRange > 1 && row.monthsActive >= data.totalMonthsInRange && (
                            <RefreshCw className="w-3 h-3 text-blue-400 inline ml-1" />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
