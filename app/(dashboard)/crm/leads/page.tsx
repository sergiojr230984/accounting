"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Contact, Loader2, Search, Shuffle } from "lucide-react";
import LeadStatusBadge from "@/components/LeadStatusBadge";
import PriorityBadge from "@/components/PriorityBadge";

const SOURCES = ["WHATSAPP", "MANUAL", "REFERRAL", "FACEBOOK", "INSTAGRAM", "WEBSITE", "OTHER"] as const;
const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp", MANUAL: "Manual", REFERRAL: "Referido",
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", WEBSITE: "Sitio web", OTHER: "Otro",
};

const createSchema = z.object({
  name: z.string().min(1, "Requerido"),
  phone: z.string().min(5, "Teléfono inválido"),
  source: z.enum(SOURCES).default("MANUAL"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  assignedToId: z.string().optional(),
  notes: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

interface Lead {
  id: string;
  name: string;
  phone: string;
  status: "NEW" | "CONTACTED" | "FOLLOW_UP" | "CLOSED" | "LOST";
  priority: "LOW" | "MEDIUM" | "HIGH";
  source: string;
  entryDate: string;
  lastMessageAt: string | null;
  assignedTo: { id: string; name: string } | null;
  _count: { messages: number };
}
interface Salesperson { id: string; name: string }

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [role, setRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Filtros
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const canManage = role === "ADMIN" || role === "MANAGER";

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { source: "MANUAL", priority: "MEDIUM" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (source) params.set("source", source);
    if (assignedToId) params.set("assignedToId", assignedToId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await fetch(`/api/crm/leads?${params}`);
    setLeads(await res.json());
    setLoading(false);
  }, [search, status, priority, source, assignedToId, from, to]);

  useEffect(() => {
    // Rol del usuario actual (para mostrar controles de admin)
    fetch("/api/auth/session").then((r) => r.json()).then((s) => setRole(s?.user?.role ?? ""));
    fetch("/api/crm/salespeople").then((r) => r.json()).then(setSalespeople).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCreate(data: CreateForm) {
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, assignedToId: data.assignedToId || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error?.toString?.() ?? "No se pudo crear el lead");
        return;
      }
      reset();
      setShowForm(false);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function reassign(leadId: string, value: string) {
    const body = value === "__auto__" ? { auto: true } : { toUserId: value };
    await fetch(`/api/crm/leads/${leadId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  const hasFilters = search || status || priority || source || assignedToId || from || to;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">{leads.length} leads</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Nuevo lead
        </button>
      </div>

      {/* Filtros */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-9"
              placeholder="Buscar nombre o teléfono"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="NEW">Nuevo</option>
            <option value="CONTACTED">Contactado</option>
            <option value="FOLLOW_UP">En seguimiento</option>
            <option value="CLOSED">Cerrado</option>
            <option value="LOST">Perdido</option>
          </select>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Toda prioridad</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </select>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Todo origen</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {canManage && (
            <select className="input" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
              <option value="">Toda vendedora</option>
              {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setStatus(""); setPriority(""); setSource(""); setAssignedToId(""); setFrom(""); setTo(""); }}
              className="btn-secondary justify-center"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Formulario nuevo lead */}
      {showForm && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Nuevo lead</h2>
          <form onSubmit={handleSubmit(onCreate)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" {...register("name")} />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="label">Teléfono / WhatsApp *</label>
              <input className="input" placeholder="+52 1 55 1234 5678" {...register("phone")} />
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
            </div>
            <div>
              <label className="label">Origen</label>
              <select className="input" {...register("source")}>
                {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Prioridad</label>
              <select className="input" {...register("priority")}>
                <option value="HIGH">Alta</option>
                <option value="MEDIUM">Media</option>
                <option value="LOW">Baja</option>
              </select>
            </div>
            {canManage && (
              <div>
                <label className="label">Asignar a</label>
                <select className="input" {...register("assignedToId")}>
                  <option value="">Automático / sin asignar</option>
                  {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="md:col-span-2">
              <label className="label">Notas internas</label>
              <textarea className="input" rows={2} {...register("notes")} />
            </div>
            {formError && <div className="md:col-span-2 text-red-500 text-sm">{formError}</div>}
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear lead
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla de leads */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Lead</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Estado</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Prioridad</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Vendedora</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Origen</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Entrada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  <Contact className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay leads {hasFilters ? "con esos filtros" : "todavía"}
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/crm/leads/${l.id}`} className="font-medium text-brand-700 hover:underline">
                      {l.name}
                    </Link>
                    <p className="text-gray-400 text-xs">{l.phone} · {l._count.messages} msgs</p>
                  </td>
                  <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                  <td className="px-4 py-3"><PriorityBadge priority={l.priority} /></td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <select
                          className="input py-1 text-xs w-36"
                          value={l.assignedTo?.id ?? ""}
                          onChange={(e) => e.target.value && reassign(l.id, e.target.value)}
                        >
                          <option value="">Sin asignar</option>
                          {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button
                          title="Asignación automática (rotación)"
                          onClick={() => reassign(l.id, "__auto__")}
                          className="text-gray-400 hover:text-brand-600 p-1"
                        >
                          <Shuffle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-600">{l.assignedTo?.name ?? "Sin asignar"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{SOURCE_LABELS[l.source] ?? l.source}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(l.entryDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
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
