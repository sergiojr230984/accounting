"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Users, Loader2, Search, Pencil, Trash2, X, Check } from "lucide-react";
import Link from "next/link";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Must be a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  _count: { invoices: number };
}

function CustomerForm({
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
    defaultValues: defaultValues ?? {},
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
          <input className="input" placeholder="Acme Corp" {...register("name")} />
          {errors.name && (
            <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
          )}
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" placeholder="billing@company.com" {...register("email")} />
          {errors.email && (
            <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
          )}
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" placeholder="+1-555-0100" {...register("phone")} />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" placeholder="123 Main St, City, State" {...register("address")} />
        </div>
      </div>

      {serverError && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {serverError}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          <X className="w-4 h-4" />
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/customers");
      setCustomers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function parseError(res: Response, fallback: string): Promise<string> {
    try {
      const d = await res.json();
      return (
        d.error?.fieldErrors?.name?.[0] ??
        (typeof d.error === "string" ? d.error : null) ??
        d.message ??
        fallback
      );
    } catch {
      return `${fallback} (server error ${res.status})`;
    }
  }

  async function handleAdd(data: FormData): Promise<string | null> {
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseError(res, "Failed to add customer");
    setShowAddForm(false);
    await load();
    return null;
  }

  async function handleEdit(id: string, data: FormData): Promise<string | null> {
    const res = await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseError(res, "Failed to update customer");
    setEditingId(null);
    await load();
    return null;
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError({});
    const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      setDeleteError((prev) => ({ ...prev, [id]: d.error ?? "Delete failed" }));
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    await load();
  }

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.phone ?? "").includes(search)
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">{customers.length} customer{customers.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setEditingId(null); }}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card border-brand-200 border-2">
          <h2 className="font-semibold text-gray-800 mb-4">New Customer</h2>
          <CustomerForm
            submitLabel="Add Customer"
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search by name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Address</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoices</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  {search ? "No customers match your search" : "No customers yet — add your first one above"}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <>
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3 text-gray-500">{c.email ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{c.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{c.address ?? "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <Link
                        href={`/invoices/customer?customerId=${c.id}`}
                        className="inline-flex items-center justify-center w-7 h-7 bg-brand-100 text-brand-700 rounded-full text-xs font-medium hover:bg-brand-200 transition-colors"
                      >
                        {c._count.invoices}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingId(c.id); setShowAddForm(false); }}
                          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={deletingId === c.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="Delete"
                        >
                          {deletingId === c.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline edit form */}
                  {editingId === c.id && (
                    <tr key={`edit-${c.id}`}>
                      <td colSpan={6} className="px-5 py-4 bg-blue-50 border-b border-blue-100">
                        <p className="text-xs font-semibold text-brand-700 mb-3 uppercase tracking-wide">
                          Editing: {c.name}
                        </p>
                        <CustomerForm
                          defaultValues={{
                            name: c.name,
                            email: c.email ?? "",
                            phone: c.phone ?? "",
                            address: c.address ?? "",
                          }}
                          submitLabel="Save Changes"
                          onSave={(data) => handleEdit(c.id, data)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}

                  {/* Delete error */}
                  {deleteError[c.id] && (
                    <tr key={`err-${c.id}`}>
                      <td colSpan={6} className="px-5 py-2 bg-red-50">
                        <p className="text-red-600 text-xs">{deleteError[c.id]}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
