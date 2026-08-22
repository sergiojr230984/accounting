"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, UserCog, Loader2, Search, Pencil, Trash2, X, Check } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  commissionRate: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number").default("0"),
  active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  commissionRate: string;
  active: boolean;
  _count: { invoices: number };
}

function EmployeeForm({
  defaultValues,
  onSave,
  onCancel,
  submitLabel,
}: {
  defaultValues?: Partial<FormData>;
  onSave: (data: FormData) => Promise<string | null>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { commissionRate: "0", active: true, ...(defaultValues ?? {}) },
  });

  async function onSubmit(data: FormData) {
    setSubmitting(true);
    setServerError("");
    const err = await onSave(data);
    if (err) setServerError(err);
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" placeholder="Jane Smith" {...register("name")} />
          {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" placeholder="jane@company.com" {...register("email")} />
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" placeholder="+1-555-0100" {...register("phone")} />
        </div>
        <div>
          <label className="label">Default commission rate</label>
          <div className="relative">
            <input className="input pr-10" placeholder="0.05" {...register("commissionRate")} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">decimal</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">e.g. 0.05 = 5%. Used as default on new invoices.</p>
          {errors.commissionRate && <p className="text-red-500 text-xs mt-1">{errors.commissionRate.message}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input id="active" type="checkbox" {...register("active")} className="w-4 h-4 rounded border-gray-300" />
          <label htmlFor="active" className="text-sm text-gray-700">Active (can be assigned to new invoices)</label>
        </div>
      </div>

      {serverError && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {serverError}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary"><X className="w-4 h-4" />Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/employees");
      if (!res.ok) return;
      setEmployees(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function createEmployee(data: FormData): Promise<string | null> {
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return d.error?.formErrors?.[0] ?? d.error ?? "Failed to create";
    }
    await load();
    setCreating(false);
    return null;
  }

  async function updateEmployee(id: string, data: FormData): Promise<string | null> {
    const res = await fetch(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return d.error?.formErrors?.[0] ?? d.error ?? "Failed to update";
    }
    await load();
    setEditingId(null);
    return null;
  }

  async function deleteEmployee(id: string) {
    const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to delete");
    }
    await load();
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500 mt-0.5">{employees.length} total · {employees.filter(e => e.active).length} active</p>
        </div>
        <button onClick={() => setCreating((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" />
          New Employee
        </button>
      </div>

      {creating && (
        <div className="card border-brand-200">
          <h2 className="font-semibold text-gray-800 mb-4">Add Employee</h2>
          <EmployeeForm
            onSave={createEmployee}
            onCancel={() => setCreating(false)}
            submitLabel="Create"
          />
        </div>
      )}

      <div className="card py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Commission</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoices</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
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
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  <UserCog className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No employees yet
                </td>
              </tr>
            ) : (
              filtered.map((e) =>
                editingId === e.id ? (
                  <tr key={e.id}>
                    <td colSpan={7} className="px-5 py-4 bg-brand-50 border-b border-brand-100">
                      <EmployeeForm
                        defaultValues={{
                          name: e.name,
                          email: e.email ?? "",
                          phone: e.phone ?? "",
                          commissionRate: e.commissionRate,
                          active: e.active,
                        }}
                        onSave={(d) => updateEmployee(e.id, d)}
                        onCancel={() => setEditingId(null)}
                        submitLabel="Save"
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">{e.name}</td>
                    <td className="px-5 py-3 text-gray-500">{e.email ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{e.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium">{(parseFloat(e.commissionRate) * 100).toFixed(2)}%</td>
                    <td className="px-5 py-3 text-right text-gray-500">{e._count.invoices}</td>
                    <td className="px-5 py-3 text-center">
                      {e.active ? (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">Active</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">Inactive</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {confirmDelete === e.id ? (
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <span className="text-red-700">Delete?</span>
                          <button onClick={() => deleteEmployee(e.id)} className="text-red-700 font-medium hover:underline">Yes</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-gray-500 hover:underline">No</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => setEditingId(e.id)} className="text-brand-600 hover:text-brand-700"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDelete(e.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
