"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, Download, AlertTriangle, CheckCircle } from "lucide-react";

type Contractor = {
  id: string;
  name: string;
  legalName: string;
  businessAddress: string;
  tin: string;
  taxIdType: string;
  w9OnFile: boolean;
  totalPaid: string;
  meetsThreshold: boolean;
  missingTin: boolean;
  missingW9: boolean;
};

export default function Form1099Page() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [threshold, setThreshold] = useState("600.00");
  const [loading, setLoading] = useState(false);
  const [showTins, setShowTins] = useState(false);

  const load = (y: number, tins: boolean) => {
    setLoading(true);
    fetch(`/api/admin/1099?year=${y}&includeTin=${tins}`)
      .then((r) => r.json())
      .then((d) => {
        setContractors(d.contractors ?? []);
        setThreshold(d.irsThreshold ?? "600.00");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(year, showTins); }, [year, showTins]);

  const exportCsv = () => {
    window.location.href = `/api/admin/1099?year=${year}&includeTin=true&export=csv`;
  };

  const fmt = (v: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(v));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-amber-600" />
          <h1 className="text-xl font-bold text-gray-900">1099 Contractor Summary</h1>
        </div>
        <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Tax Year</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
            {[0, 1, 2, 3].map((offset) => {
              const y = new Date().getFullYear() - offset;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showTins} onChange={(e) => setShowTins(e.target.checked)} className="rounded" />
          Show full TINs (logged)
        </label>
        <p className="text-xs text-gray-400 ml-auto">IRS filing threshold: {fmt(threshold)}</p>
      </div>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Contractor (Legal Name)</th>
                <th className="px-4 py-3 text-left">TIN</th>
                <th className="px-4 py-3 text-left">W-9</th>
                <th className="px-4 py-3 text-right">Total Paid {year}</th>
                <th className="px-4 py-3 text-left">File 1099?</th>
                <th className="px-4 py-3 text-left">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contractors.map((c) => (
                <tr key={c.id} className={c.meetsThreshold ? "" : "opacity-60"}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.legalName}</p>
                    {c.legalName !== c.name && <p className="text-xs text-gray-400">{c.name}</p>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {c.tin} <span className="text-gray-400">({c.taxIdType})</span>
                  </td>
                  <td className="px-4 py-3">
                    {c.w9OnFile ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(c.totalPaid)}</td>
                  <td className="px-4 py-3">
                    {c.meetsThreshold ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Yes (≥ $600)</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">No (&lt; $600)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {c.missingTin && <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Missing TIN</span>}
                      {c.missingW9 && <span className="text-xs text-orange-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Missing W-9</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {contractors.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No 1099 contractors found for {year}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
