"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Truck, Search, Camera, DollarSign, Printer } from "lucide-react";

type Status = "PENDING_SCHEDULE" | "SCHEDULED" | "DELIVERED" | "EXCEPTION";

interface DeliveryRow {
  id: string;
  status: Status;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  tokenKind: "CREW" | "SUBCONTRACTOR";
  invoiceNumber: string;
  customerName: string;
  deliveryAddress: string | null;
  assignedCrewName: string | null;
  assignedSubcontractorName: string | null;
  subcontractorPayable: boolean;
  deliveredAt: string | null;
  exceptionReason: string | null;
  photoCount: number;
  firstPhotoId: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  PENDING_SCHEDULE: "Sin programar",
  SCHEDULED: "Programada",
  DELIVERED: "Entregada",
  EXCEPTION: "Excepción",
};
const STATUS_COLOR: Record<Status, string> = {
  PENDING_SCHEDULE: "bg-gray-100 text-gray-600",
  SCHEDULED: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  EXCEPTION: "bg-amber-100 text-amber-700",
};

export default function DeliveriesBoardPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/deliveries");
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markPayable(id: string) {
    const res = await fetch(`/api/deliveries/${id}/payable`, { method: "POST" });
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "No se pudo marcar como pagable.");
    }
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (r.deliveryAddress ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-brand-600" />
            Deliveries
          </h1>
          <p className="text-sm text-gray-500">{rows.length} delivery record{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/deliveries/route-sheet" className="btn-secondary">
          <Printer className="w-4 h-4" />
          Print route sheet
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["ALL", "PENDING_SCHEDULE", "SCHEDULED", "DELIVERED", "EXCEPTION"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              statusFilter === s ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s === "ALL" ? "All" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search by invoice #, customer, or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoice</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Window</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Assigned</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Proof</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                  <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No deliveries match.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <Link href={`/deliveries/${r.id}`} className="hover:text-brand-600">{r.invoiceNumber}</Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{r.customerName}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {r.windowStart
                      ? new Date(r.windowStart).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {r.assignedCrewName ?? r.assignedSubcontractorName ?? "—"}
                    {r.tokenKind === "SUBCONTRACTOR" && r.assignedSubcontractorName && (
                      <span className="ml-1.5 text-xs text-gray-400">(sub)</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {r.photoCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                        <Camera className="w-3.5 h-3.5" /> {r.photoCount}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.tokenKind === "SUBCONTRACTOR" && r.status === "DELIVERED" && !r.subcontractorPayable && (
                      <button
                        onClick={() => markPayable(r.id)}
                        disabled={r.photoCount === 0}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:text-gray-300"
                        title={r.photoCount === 0 ? "Needs proof before it can be marked payable" : "Mark payable"}
                      >
                        <DollarSign className="w-3.5 h-3.5" /> Mark payable
                      </button>
                    )}
                    {r.subcontractorPayable && <span className="text-xs text-green-700">Payable</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
