"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Truck, Loader2, Search, Pencil, Trash2, X, Check } from "lucide-react";
import Link from "next/link";

const CATEGORIES = ["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"] as const;

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Must be a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  defaultCategory: z.enum(CATEGORIES).optional().or(z.literal("")),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankRouting: z.string().optional(),
  zelle: z.string().optional(),
  paymentInstructions: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  defaultCategory: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankRouting: string | null;
  zelle: string | null;
  paymentInstructions: string | null;
  _count: { invoices: number };
}

function SupplierForm({
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
    defaultValues: { paymentTermsDays: 30, defaultCategory: "", ...(defaultValues ?? {}) } as FormData,
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
          <input className="input" placeholder="Acme Supplies" {...register("name")} />
          {errors.name && (
            <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
          )}
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" placeholder="billing@supplier.com" {...register("email")} />
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
        <div>
          <label className="label">Payment terms (days)</label>
          <input type="number" className="input" placeholder="30" {...register("paymentTermsDays")} />
          <p className="text-xs text-gray-400 mt-1">e.g. 30 = Net 30. Auto-calculates due date on their invoices.</p>
        </div>
        <div>
          <label className="label">Default expense category</label>
          <select className="input" {...register("defaultCategory")}>
            <option value="">— None —</option>
            <option value="COGS">Cost of Goods Sold</option>
            <option value="SERVICES_EXPENSE">Services Expense</option>
            <option value="OPERATING_EXPENSE">Operating Expense</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Payment details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Bank name</label>
            <input className="input" placeholder="First National Bank" {...register("bankName")} />
          </div>
          <div>
            <label className="label">Account number</label>
            <input className="input" placeholder="••••1234" {...register("bankAccountNumber")} />
          </div>
          <div>
            <label className="label">Routing / ABA</label>
            <input className="input" {...register("bankRouting")} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Zelle</label>
            <input className="input" placeholder="email or phone" {...register("zelle")} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Payment instructions</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Pay via Zelle to ops@acme.com, reference invoice #"
              {...register("paymentInstructions")}
            />
          </div>
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

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/suppliers");
      setSuppliers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function parseError(res: Response, fallback: string): Promise<string> {
    try {
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        const msg =
          d.error?.fieldErrors?.name?.[0] ??
          (typeof d.error === "string" ? d.error : null) ??
          d.message ??
          null;
        return msg ?? `[${res.status}] ${text.slice(0, 300)}`;
      } catch {
        return `[${res.status}] ${text.slice(0, 300)}`;
      }
    } catch {
      return `${fallback} (network error)`;
    }
  }

  async function handleAdd(data: FormData): Promise<string | null> {
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseError(res, "Failed to add supplier");
    setShowAddForm(false);
    await load();
    return null;
  }

  async function handleEdit(id: string, data: FormData): Promise<string | null> {
    const res = await fetch(`/api/suppliers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseError(res, "Failed to update supplier");
    setEditingId(null);
    await load();
    return null;
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError({});
    const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      setDeleteError((prev) => ({ ...prev, [id]: d.error ?? "Delete failed" }));
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    await load();
  }

  const filtered = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? "").includes(search)
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setEditingId(null); }}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add Supplier
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card border-brand-200 border-2">
          <h2 className="font-semibold text-gray-800 mb-4">New Supplier</h2>
          <SupplierForm
            submitLabel="Add Supplier"
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
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Zelle</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoices</th>
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
                  {search ? "No suppliers match your search" : "No suppliers yet — add your first one above"}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <>
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-5 py-3 text-gray-500">{s.email ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{s.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{s.address ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{s.zelle ?? "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <Link
                        href={`/invoices/supplier?supplierId=${s.id}`}
                        className="inline-flex items-center justify-center w-7 h-7 bg-orange-100 text-orange-700 rounded-full text-xs font-medium hover:bg-orange-200 transition-colors"
                      >
                        {s._count.invoices}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingId(s.id); setShowAddForm(false); }}
                          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="Delete"
                        >
                          {deletingId === s.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline edit form */}
                  {editingId === s.id && (
                    <tr key={`edit-${s.id}`}>
                      <td colSpan={7} className="px-5 py-4 bg-blue-50 border-b border-blue-100">
                        <p className="text-xs font-semibold text-brand-700 mb-3 uppercase tracking-wide">
                          Editing: {s.name}
                        </p>
                        <SupplierForm
                          defaultValues={{
                            name: s.name,
                            email: s.email ?? "",
                            phone: s.phone ?? "",
                            address: s.address ?? "",
                            paymentTermsDays: s.paymentTermsDays ?? 30,
                            defaultCategory: (s.defaultCategory as FormData["defaultCategory"]) ?? "",
                            bankName: s.bankName ?? "",
                            bankAccountNumber: s.bankAccountNumber ?? "",
                            bankRouting: s.bankRouting ?? "",
                            zelle: s.zelle ?? "",
                            paymentInstructions: s.paymentInstructions ?? "",
                          }}
                          submitLabel="Save Changes"
                          onSave={(data) => handleEdit(s.id, data)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}

                  {/* Delete error */}
                  {deleteError[s.id] && (
                    <tr key={`err-${s.id}`}>
                      <td colSpan={7} className="px-5 py-2 bg-red-50">
                        <p className="text-red-600 text-xs">{deleteError[s.id]}</p>
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
