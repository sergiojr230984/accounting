"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";

interface DeliveryRow {
  id: string;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  invoiceNumber: string;
  customerName: string;
  deliveryAddress: string | null;
  assignedCrewName: string | null;
  assignedSubcontractorName: string | null;
}

interface RowWithQr extends DeliveryRow {
  qr: string;
  publicLinkUrl: string;
}

export default function RouteSheetPage() {
  const [rows, setRows] = useState<RowWithQr[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/deliveries?status=SCHEDULED");
      if (!res.ok) return setLoading(false);
      const data: DeliveryRow[] = await res.json();
      // Each row's own detail fetch gets us publicLinkUrl (the list endpoint
      // deliberately omits the token -- see app/api/deliveries/route.ts).
      const withLinks = await Promise.all(
        data.map(async (r) => {
          const detailRes = await fetch(`/api/deliveries/${r.id}`);
          const detail = detailRes.ok ? await detailRes.json() : null;
          const publicLinkUrl: string = detail?.publicLinkUrl ?? "";
          const qr = publicLinkUrl ? await QRCode.toDataURL(publicLinkUrl, { width: 140, margin: 1 }) : "";
          return { ...r, qr, publicLinkUrl };
        })
      );
      withLinks.sort((a, b) => (a.windowStart ?? "").localeCompare(b.windowStart ?? ""));
      setRows(withLinks);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Route sheet — scheduled deliveries</h1>
        <button onClick={() => window.print()} className="btn-primary">
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm">No scheduled deliveries.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card flex items-center gap-4 break-inside-avoid">
              {r.qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.qr} alt="QR" className="w-24 h-24 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{r.invoiceNumber} — {r.customerName}</p>
                <p className="text-sm text-gray-600">{r.deliveryAddress}</p>
                <p className="text-sm text-gray-500">
                  {r.windowStart ? new Date(r.windowStart).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                  {r.windowEnd ? ` – ${new Date(r.windowEnd).toLocaleTimeString(undefined, { timeStyle: "short" })}` : ""}
                </p>
                <p className="text-sm text-gray-500">
                  Crew: {r.assignedCrewName ?? r.assignedSubcontractorName ?? "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        @media print {
          nav, aside, header { display: none !important; }
        }
      `}</style>
    </div>
  );
}
