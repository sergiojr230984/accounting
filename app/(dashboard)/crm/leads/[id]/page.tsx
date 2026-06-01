"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, Save, Phone, History } from "lucide-react";
import LeadStatusBadge from "@/components/LeadStatusBadge";
import PriorityBadge from "@/components/PriorityBadge";

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp", MANUAL: "Manual", REFERRAL: "Referido",
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", WEBSITE: "Sitio web", OTHER: "Otro",
};

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  timestamp: string;
}
interface Assignment {
  id: string;
  fromUserName: string | null;
  reason: string | null;
  createdAt: string;
  toUser: { name: string };
  changedBy: { name: string } | null;
}
interface Lead {
  id: string;
  name: string;
  phone: string;
  status: "NEW" | "CONTACTED" | "FOLLOW_UP" | "CLOSED" | "LOST";
  priority: "LOW" | "MEDIUM" | "HIGH";
  source: string;
  notes: string | null;
  entryDate: string;
  nextFollowUpAt: string | null;
  assignedTo: { id: string; name: string } | null;
  messages: Message[];
  assignments: Assignment[];
}
interface Salesperson { id: string; name: string }

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState("");

  const canManage = role === "ADMIN" || role === "MANAGER";

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/leads/${id}`);
    if (res.ok) {
      const data: Lead = await res.json();
      setLead(data);
      setNotes(data.notes ?? "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/auth/session").then((r) => r.json()).then((s) => setRole(s?.user?.role ?? ""));
    fetch("/api/crm/salespeople").then((r) => r.json()).then(setSalespeople).catch(() => {});
  }, [load]);

  // Actualiza un campo del lead (estado, prioridad, seguimiento)
  async function patch(body: Record<string, unknown>) {
    await fetch(`/api/crm/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await patch({ notes });
    } finally {
      setSavingNotes(false);
    }
  }

  async function sendMessage() {
    if (!draft.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/crm/leads/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error?.toString?.() ?? "No se pudo enviar el mensaje");
        return;
      }
      setDraft("");
      load();
    } finally {
      setSending(false);
    }
  }

  async function reassign(value: string) {
    const body = value === "__auto__" ? { auto: true } : { toUserId: value };
    await fetch(`/api/crm/leads/${id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  if (loading) return <div className="card animate-pulse h-64 bg-gray-100" />;
  if (!lead) return <div className="card text-gray-500">Lead no encontrado.</div>;

  return (
    <div className="space-y-5">
      <Link href="/crm/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft className="w-4 h-4" /> Volver a leads
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
          <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5">
            <Phone className="w-3.5 h-3.5" /> {lead.phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadStatusBadge status={lead.status} />
          <PriorityBadge priority={lead.priority} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Conversación */}
        <div className="lg:col-span-2 card flex flex-col" style={{ minHeight: 480 }}>
          <h2 className="font-semibold text-gray-800 mb-3">Conversación</h2>
          <div className="flex-1 space-y-3 overflow-y-auto max-h-[420px] pr-1">
            {lead.messages.length === 0 ? (
              <p className="text-sm text-gray-400">Sin mensajes todavía.</p>
            ) : (
              lead.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                      m.direction === "OUTBOUND"
                        ? "bg-brand-600 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`text-[10px] mt-1 ${m.direction === "OUTBOUND" ? "text-brand-100" : "text-gray-400"}`}>
                      {new Date(m.timestamp).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Caja de envío */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
            <div className="flex gap-2">
              <textarea
                className="input flex-1 resize-none"
                rows={2}
                placeholder="Escribe un mensaje de WhatsApp…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
              />
              <button onClick={sendMessage} disabled={sending || !draft.trim()} className="btn-primary self-end">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Panel lateral de detalles */}
        <div className="space-y-5">
          <div className="card space-y-4">
            <h2 className="font-semibold text-gray-800">Detalles</h2>

            <div>
              <label className="label">Estado</label>
              <select className="input" value={lead.status} onChange={(e) => patch({ status: e.target.value })}>
                <option value="NEW">Nuevo</option>
                <option value="CONTACTED">Contactado</option>
                <option value="FOLLOW_UP">En seguimiento</option>
                <option value="CLOSED">Cerrado</option>
                <option value="LOST">Perdido</option>
              </select>
            </div>

            <div>
              <label className="label">Prioridad</label>
              <select className="input" value={lead.priority} onChange={(e) => patch({ priority: e.target.value })}>
                <option value="HIGH">Alta</option>
                <option value="MEDIUM">Media</option>
                <option value="LOW">Baja</option>
              </select>
            </div>

            <div>
              <label className="label">Vendedora</label>
              {canManage ? (
                <select
                  className="input"
                  value={lead.assignedTo?.id ?? ""}
                  onChange={(e) => e.target.value && reassign(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__auto__">↻ Asignación automática</option>
                </select>
              ) : (
                <p className="text-sm text-gray-700">{lead.assignedTo?.name ?? "Sin asignar"}</p>
              )}
            </div>

            <div>
              <label className="label">Próximo seguimiento</label>
              <input
                type="date"
                className="input"
                value={lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : ""}
                onChange={(e) => patch({ nextFollowUpAt: e.target.value || null })}
              />
            </div>

            <div className="text-xs text-gray-400 space-y-1 pt-1 border-t border-gray-100">
              <p>Origen: {SOURCE_LABELS[lead.source] ?? lead.source}</p>
              <p>Entrada: {new Date(lead.entryDate).toLocaleString("es-MX", { dateStyle: "medium" })}</p>
            </div>
          </div>

          {/* Notas internas */}
          <div className="card space-y-2">
            <label className="label">Notas internas</label>
            <textarea className="input resize-none" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button onClick={saveNotes} disabled={savingNotes} className="btn-secondary w-full justify-center text-sm">
              {savingNotes ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar notas
            </button>
          </div>

          {/* Historial de asignaciones */}
          {lead.assignments.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-1.5 text-sm">
                <History className="w-4 h-4" /> Historial de asignación
              </h2>
              <ul className="space-y-2 text-xs text-gray-500">
                {lead.assignments.map((a) => (
                  <li key={a.id} className="border-l-2 border-brand-200 pl-2">
                    <span className="text-gray-700 font-medium">
                      {a.fromUserName ? `${a.fromUserName} → ` : ""}{a.toUser.name}
                    </span>
                    <p>
                      {a.changedBy?.name ?? "Sistema"} · {a.reason} ·{" "}
                      {new Date(a.createdAt).toLocaleDateString("es-MX", { dateStyle: "short" })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
