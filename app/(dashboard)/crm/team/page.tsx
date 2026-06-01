"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2, UserRound, ShieldAlert } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Requerido"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  whatsappNumber: z.string().optional(),
  whatsappPhoneNumberId: z.string().optional(),
});
type Form = z.infer<typeof schema>;

interface Salesperson {
  id: string;
  name: string;
  email: string;
  active: boolean;
  whatsappNumber: string | null;
  whatsappPhoneNumberId: string | null;
  _count?: { assignedLeads: number };
}

export default function TeamPage() {
  const [people, setPeople] = useState<Salesperson[]>([]);
  const [mode, setMode] = useState<"MANUAL" | "ROUND_ROBIN">("ROUND_ROBIN");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const isAdmin = role === "ADMIN";

  const { register, handleSubmit, reset, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema) });

  async function load() {
    setLoading(true);
    const [p, s] = await Promise.all([
      fetch("/api/crm/salespeople").then((r) => r.json()),
      fetch("/api/crm/settings").then((r) => r.json()),
    ]);
    setPeople(p);
    setMode(s.assignmentMode);
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((s) => setRole(s?.user?.role ?? ""));
    load();
  }, []);

  async function setAssignmentMode(newMode: "MANUAL" | "ROUND_ROBIN") {
    setMode(newMode);
    await fetch("/api/crm/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentMode: newMode }),
    });
  }

  async function toggleActive(p: Salesperson) {
    await fetch(`/api/crm/salespeople/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    load();
  }

  async function onCreate(data: Form) {
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/crm/salespeople", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error?.toString?.() ?? "No se pudo crear la vendedora");
        return;
      }
      reset();
      setShowForm(false);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && !isAdmin) {
    return (
      <div className="card flex items-center gap-3 text-gray-600">
        <ShieldAlert className="w-5 h-5 text-amber-500" />
        Solo los administradores pueden gestionar el equipo de ventas.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendedoras</h1>
          <p className="text-sm text-gray-500">Equipo de ventas y configuración de asignación</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary">
          <Plus className="w-4 h-4" /> Nueva vendedora
        </button>
      </div>

      {/* Modo de asignación */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-1">Asignación automática de leads</h2>
        <p className="text-sm text-gray-500 mb-3">
          Define cómo se reparten los leads entrantes que no llegan al WhatsApp de una vendedora específica.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setAssignmentMode("ROUND_ROBIN")}
            className={mode === "ROUND_ROBIN" ? "btn-primary" : "btn-secondary"}
          >
            Rotación automática
          </button>
          <button
            onClick={() => setAssignmentMode("MANUAL")}
            className={mode === "MANUAL" ? "btn-primary" : "btn-secondary"}
          >
            Solo manual
          </button>
        </div>
      </div>

      {/* Formulario nueva vendedora */}
      {showForm && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Nueva vendedora</h2>
          <form onSubmit={handleSubmit(onCreate)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" {...register("name")} />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="label">Email *</label>
              <input type="email" className="input" {...register("email")} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="label">Contraseña *</label>
              <input type="password" className="input" {...register("password")} />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>
            <div>
              <label className="label">WhatsApp (E.164)</label>
              <input className="input" placeholder="+5215512345678" {...register("whatsappNumber")} />
            </div>
            <div className="md:col-span-2">
              <label className="label">WhatsApp Phone Number ID (Meta)</label>
              <input className="input" placeholder="Ej: 109876543210987" {...register("whatsappPhoneNumberId")} />
              <p className="text-xs text-gray-400 mt-1">
                Permite identificar a qué vendedora le escribió el cliente. Lo encuentras en el panel de WhatsApp de Meta.
              </p>
            </div>
            {formError && <div className="md:col-span-2 text-red-500 text-sm">{formError}</div>}
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear vendedora
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Listado */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Vendedora</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">WhatsApp</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Leads</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Activa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-400">Cargando…</td></tr>
            ) : people.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-gray-400">
                  <UserRound className="w-8 h-8 mx-auto mb-2 opacity-40" /> Sin vendedoras todavía
                </td>
              </tr>
            ) : (
              people.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-gray-400 text-xs">{p.email}</p>
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    {p.whatsappNumber ?? "—"}
                    {p.whatsappPhoneNumberId && (
                      <p className="text-[10px] text-gray-400">ID: {p.whatsappPhoneNumberId}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 bg-brand-100 text-brand-700 rounded-full text-xs font-medium">
                      {p._count?.assignedLeads ?? 0}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={() => toggleActive(p)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${p.active ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.active ? "translate-x-4" : "translate-x-1"}`} />
                    </button>
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
