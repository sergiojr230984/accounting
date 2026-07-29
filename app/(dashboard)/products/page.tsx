"use client";

import { Fragment, useEffect, useState } from "react";
import { Plus, Package, Loader2, Search, Pencil, X, Check } from "lucide-react";
import { formatCurrency } from "@/lib/money";

const INCOME_ACCOUNTS = ["Sales", "Services", "Materials", "Other Revenue"];

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  taxRate: string;
  incomeAccount: string | null;
  active: boolean;
}

interface FormState {
  name: string;
  description: string;
  price: string;
  taxRate: string;
  incomeAccount: string;
  active: boolean;
}

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  price: "0",
  taxRate: "0",
  incomeAccount: "Sales",
  active: true,
});

interface TaxRate {
  id: string;
  name: string;
  rate: string;
  active: boolean;
}

function ProductForm({
  initial,
  taxRates,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial: FormState;
  taxRates: TaxRate[];
  onSave: (data: FormState) => Promise<string | null>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function set(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Item name is required"); return; }
    setSubmitting(true);
    setError("");
    const err = await onSave(form);
    if (err) setError(err);
    setSubmitting(false);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Item name *</label>
          <input
            className="input"
            placeholder="e.g. Dining table delivery"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Income account</label>
          <select
            className="input"
            value={form.incomeAccount}
            onChange={(e) => set("incomeAccount", e.target.value)}
          >
            {INCOME_ACCOUNTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <input
            className="input"
            placeholder="Optional description shown on invoices"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Price ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Tax</label>
          {taxRates.length > 0 ? (
            <select
              className="input"
              value={form.taxRate}
              onChange={(e) => set("taxRate", e.target.value)}
            >
              <option value="0">No tax</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.rate}>
                  {t.name} ({(parseFloat(t.rate) * 100).toFixed(2)}%)
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              step="0.0001"
              min="0"
              max="1"
              className="input"
              placeholder="0 = no tax, 0.08 = 8%"
              value={form.taxRate}
              onChange={(e) => set("taxRate", e.target.value)}
            />
          )}
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="product-active"
            type="checkbox"
            className="w-4 h-4 accent-brand-600"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          <label htmlFor="product-active" className="text-sm text-gray-700">Active (visible in invoice picker)</label>
        </div>
      </div>

      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          <X className="w-4 h-4" /> Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [prRes, taxRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/settings/taxes"),
      ]);
      if (prRes.ok) setProducts(await prRes.json());
      if (taxRes.ok) setTaxRates((await taxRes.json()).filter((t: TaxRate) => t.active));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { viewer?: { isAdmin?: boolean } } | null) => setIsAdmin(!!d?.viewer?.isAdmin))
      .catch(() => {});
  }, []);

  async function parseErr(res: Response): Promise<string> {
    try {
      const d = await res.json();
      return (
        d.error?.fieldErrors?.name?.[0] ??
        (typeof d.error === "string" ? d.error : null) ??
        `Error ${res.status}`
      );
    } catch {
      return `Error ${res.status}`;
    }
  }

  async function handleAdd(data: FormState): Promise<string | null> {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseErr(res);
    setShowAddForm(false);
    await load();
    return null;
  }

  async function handleEdit(id: string, data: FormState): Promise<string | null> {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return parseErr(res);
    setEditingId(null);
    await load();
    return null;
  }

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.incomeAccount ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products &amp; Services</h1>
          <p className="text-sm text-gray-500">{products.length} item{products.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowAddForm(true); setEditingId(null); }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            New product / service
          </button>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        {isAdmin ? (
          <p>
            When staff type an item name on an invoice, matching products here are suggested so they reuse the
            existing one instead of creating a near-duplicate. Typing a genuinely new name still adds it here for
            everyone to reuse. Mark a product <strong>Inactive</strong> to stop it from being suggested or used on
            new invoices without losing its history — items can&apos;t be deleted, only locked.
          </p>
        ) : (
          <p>
            Only admins can edit or lock products/services here. When creating an invoice, matching items will be
            suggested as you type — please reuse an existing one instead of adding a near-duplicate if one already fits.
          </p>
        )}
      </div>

      {showAddForm && isAdmin && (
        <div className="card border-brand-200 border-2">
          <h2 className="font-semibold text-gray-800 mb-4">New product or service</h2>
          <ProductForm
            initial={emptyForm()}
            taxRates={taxRates}
            submitLabel="Create"
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search by name or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Description</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Account</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tax</th>
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
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  {search ? "No items match your search" : "No products yet — add your first one above"}
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <Fragment key={p.id}>
                  <tr className={`hover:bg-gray-50 transition-colors ${!p.active ? "opacity-50" : ""}`}>
                    <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{p.description ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{p.incomeAccount ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-700 text-right font-medium">{formatCurrency(p.price)}</td>
                    <td className="px-5 py-3 text-gray-500 text-right">
                      {parseFloat(p.taxRate) > 0 ? `${(parseFloat(p.taxRate) * 100).toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {p.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setEditingId(p.id); setShowAddForm(false); }}
                            className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {editingId === p.id && isAdmin && (
                    <tr key={`edit-${p.id}`}>
                      <td colSpan={7} className="px-5 py-4 bg-blue-50 border-b border-blue-100">
                        <p className="text-xs font-semibold text-brand-700 mb-3 uppercase tracking-wide">
                          Editing: {p.name}
                        </p>
                        <ProductForm
                          initial={{
                            name: p.name,
                            description: p.description ?? "",
                            price: p.price,
                            taxRate: p.taxRate,
                            incomeAccount: p.incomeAccount ?? "Sales",
                            active: p.active,
                          }}
                          taxRates={taxRates}
                          submitLabel="Save changes"
                          onSave={(data) => handleEdit(p.id, data)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
