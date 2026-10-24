"use client";

import { useEffect, useState, use as usePromise } from "react";
import QRCode from "qrcode";
import {
  Truck, Copy, Check, Calendar, Camera, RefreshCw, Ban, ShieldAlert, DollarSign, Mic,
} from "lucide-react";

type Status = "PENDING_SCHEDULE" | "SCHEDULED" | "DELIVERED" | "EXCEPTION";

interface Photo {
  id: string;
  mimeType: string;
  createdAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
}
interface HistoryRow {
  id: string;
  fromStatus: Status;
  toStatus: Status;
  actorType: "OFFICE_USER" | "CREW_LINK" | "SUBCONTRACTOR_LINK";
  actorLabel: string;
  reason: string | null;
  createdAt: string;
}
interface DeliveryDetail {
  id: string;
  status: Status;
  token: string;
  tokenKind: "CREW" | "SUBCONTRACTOR";
  tokenRevokedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  assignedCrewEmployeeId: string | null;
  assignedCrewEmployee: { id: string; name: string } | null;
  assignedSubcontractorName: string | null;
  subcontractorCost: string | null;
  subcontractorPayable: boolean;
  calendarEventId: string | null;
  deliveredAt: string | null;
  overrideReason: string | null;
  exceptionReason: string | null;
  exceptionNote: string | null;
  exceptionVoiceNotePath: string | null;
  publicLinkUrl: string;
  customerInvoice: {
    invoiceNumber: string;
    customerAddress: string | null;
    customer: { name: string; phone: string | null; address: string | null };
  };
  photos: Photo[];
  statusHistory: HistoryRow[];
}
interface Employee {
  id: string;
  name: string;
  active: boolean;
}

const EXCEPTION_LABELS: Record<string, string> = {
  CLIENTE_AUSENTE: "Cliente ausente",
  DIRECCION_INCORRECTA: "Dirección incorrecta",
  ACCESO_IMPOSIBLE: "Acceso imposible",
  PRODUCTO_DANADO: "Producto dañado",
  CLIENTE_RECHAZO: "Cliente rechazó",
  OTRO: "Otro",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [assignMode, setAssignMode] = useState<"crew" | "subcontractor">("crew");
  const [crewId, setCrewId] = useState("");
  const [subName, setSubName] = useState("");
  const [subCost, setSubCost] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [dRes, eRes] = await Promise.all([fetch(`/api/deliveries/${id}`), fetch("/api/employees")]);
      if (dRes.ok) {
        const d: DeliveryDetail = await dRes.json();
        setDelivery(d);
        setWindowStart(toLocalInput(d.windowStart));
        setWindowEnd(toLocalInput(d.windowEnd));
        setAssignMode(d.tokenKind === "SUBCONTRACTOR" ? "subcontractor" : "crew");
        setCrewId(d.assignedCrewEmployeeId ?? "");
        setSubName(d.assignedSubcontractorName ?? "");
        setSubCost(d.subcontractorCost ?? "");
        QRCode.toDataURL(d.publicLinkUrl, { width: 200, margin: 1 }).then(setQrDataUrl);
      }
      if (eRes.ok) setEmployees(await eRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!windowStart || !windowEnd) { setError("Set a window start and end."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/deliveries/${id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windowStart: new Date(windowStart).toISOString(),
          windowEnd: new Date(windowEnd).toISOString(),
          assignedCrewEmployeeId: assignMode === "crew" ? crewId || null : null,
          assignedSubcontractorName: assignMode === "subcontractor" ? subName || null : null,
          subcontractorCost: assignMode === "subcontractor" ? subCost || null : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "Could not schedule.");
      } else {
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleOverride() {
    const reason = prompt("Reason for marking Delivered without a photo:");
    if (!reason || !reason.trim()) return;
    const res = await fetch(`/api/deliveries/${id}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) load();
    else alert("Could not apply override.");
  }

  async function handleRevoke() {
    if (!confirm("Revoke this upload link? The crew/subcontractor will no longer be able to submit a photo.")) return;
    const res = await fetch(`/api/deliveries/${id}/revoke`, { method: "POST" });
    if (res.ok) load();
  }

  async function handleRegenerate() {
    if (!confirm("Generate a new link? The old link will stop working immediately.")) return;
    const res = await fetch(`/api/deliveries/${id}/regenerate`, { method: "POST" });
    if (res.ok) load();
  }

  async function handlePayable() {
    const res = await fetch(`/api/deliveries/${id}/payable`, { method: "POST" });
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "No proof exists yet.");
    }
  }

  function copyLink() {
    if (!delivery) return;
    navigator.clipboard.writeText(delivery.publicLinkUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>;
  if (!delivery) return <div className="text-gray-400 text-sm">Not found.</div>;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-brand-600" />
            {delivery.customerInvoice.invoiceNumber}
          </h1>
          <p className="text-sm text-gray-500">{delivery.customerInvoice.customer.name}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{delivery.status}</span>
      </div>

      {delivery.status === "EXCEPTION" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="font-semibold text-amber-800">No se pudo entregar — {EXCEPTION_LABELS[delivery.exceptionReason ?? ""] ?? delivery.exceptionReason}</p>
          {delivery.exceptionNote && <p className="text-sm text-amber-700 mt-1">{delivery.exceptionNote}</p>}
          {delivery.exceptionVoiceNotePath && (
            <div className="mt-2 flex items-center gap-2">
              <Mic className="w-4 h-4 text-amber-600" />
              <audio controls src={`/api/deliveries/${delivery.id}/voice-note`} className="h-8" />
            </div>
          )}
        </div>
      )}

      {delivery.status === "DELIVERED" && delivery.overrideReason && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <ShieldAlert className="w-4 h-4 inline mr-1.5" />
          Marked delivered via manager override: {delivery.overrideReason}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Schedule
          </h2>
          <form onSubmit={handleSchedule} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Window start</label>
                <input type="datetime-local" className="input" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </div>
              <div>
                <label className="label">Window end</label>
                <input type="datetime-local" className="input" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={assignMode === "crew"} onChange={() => setAssignMode("crew")} /> In-house crew
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={assignMode === "subcontractor"} onChange={() => setAssignMode("subcontractor")} /> Subcontractor
              </label>
            </div>

            {assignMode === "crew" ? (
              <select className="input" value={crewId} onChange={(e) => setCrewId(e.target.value)}>
                <option value="">Select crew member…</option>
                {employees.filter((e) => e.active).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder="Subcontractor name" value={subName} onChange={(e) => setSubName(e.target.value)} />
                <input className="input" placeholder="Cost ($)" type="number" step="0.01" value={subCost} onChange={(e) => setSubCost(e.target.value)} />
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={saving} className="btn-primary w-full">
              {saving ? "Saving…" : delivery.calendarEventId ? "Update schedule" : "Schedule & create calendar event"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3">Upload link</h2>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR code" className="mx-auto mb-3 w-40 h-40" />
          )}
          <div className="flex items-center gap-2 mb-3">
            <input readOnly className="input text-xs" value={delivery.publicLinkUrl} />
            <button onClick={copyLink} className="btn-secondary px-3">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {delivery.tokenRevokedAt && (
            <p className="text-xs text-red-600 mb-2">Revoked {new Date(delivery.tokenRevokedAt).toLocaleString()}</p>
          )}
          <div className="flex gap-2">
            <button onClick={handleRevoke} className="btn-secondary flex-1 text-xs">
              <Ban className="w-3.5 h-3.5" /> Revoke
            </button>
            <button onClick={handleRegenerate} className="btn-secondary flex-1 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Camera className="w-4 h-4" /> Photos ({delivery.photos.length})
          </h2>
          {delivery.status !== "DELIVERED" && (
            <button onClick={handleOverride} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              Manager override: mark Delivered
            </button>
          )}
        </div>
        {delivery.photos.length === 0 ? (
          <p className="text-sm text-gray-400">No photos yet.</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {delivery.photos.map((p) => (
              <a key={p.id} href={`/api/deliveries/photos/${p.id}`} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/deliveries/photos/${p.id}`} alt="" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}

        {delivery.tokenKind === "SUBCONTRACTOR" && delivery.status === "DELIVERED" && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Subcontractor cost: {delivery.subcontractorCost ? `$${delivery.subcontractorCost}` : "—"}
            </p>
            {delivery.subcontractorPayable ? (
              <span className="text-sm text-green-700 font-medium">Marked payable</span>
            ) : (
              <button
                onClick={handlePayable}
                disabled={delivery.photos.length === 0}
                className="btn-secondary text-xs disabled:opacity-40"
              >
                <DollarSign className="w-3.5 h-3.5" /> Mark payable
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-3">Status history</h2>
        <ul className="space-y-2 text-sm">
          {delivery.statusHistory.map((h) => (
            <li key={h.id} className="flex items-start gap-3 border-b border-gray-50 pb-2 last:border-0">
              <span className="text-gray-400 w-36 flex-shrink-0">{new Date(h.createdAt).toLocaleString()}</span>
              <span className="text-gray-700">
                {h.fromStatus} → <strong>{h.toStatus}</strong> by {h.actorLabel}
                {h.reason && <span className="text-gray-500"> — {h.reason}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
