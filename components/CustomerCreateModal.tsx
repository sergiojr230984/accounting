"use client";

import { useEffect, useState } from "react";
import { X, Loader2, UserPlus } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  address?: string | null;
}

interface Props {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

export default function CustomerCreateModal({ open, initialName, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setEmail("");
      setPhone("");
      setAddress("");
      setError("");
      setSaving(false);
    }
  }, [open, initialName]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, address }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.fieldErrors?.name?.[0] ?? d.error?.formErrors?.[0] ?? (typeof d.error === "string" ? d.error : "Failed to create customer"));
        return;
      }
      const customer: Customer = await res.json();
      onCreated(customer);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-brand-600" />
            <h2 className="font-semibold text-gray-900">New customer</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="label">Name <span className="text-red-500">*</span></label>
            <input
              className="input"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@email.com"
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 000-0000"
            />
          </div>
          <div>
            <label className="label">Address</label>
            <textarea
              className="input"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State 00000"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create customer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
