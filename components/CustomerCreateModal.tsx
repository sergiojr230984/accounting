"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import AddressAutocomplete from "@/components/AddressAutocomplete";

export interface SavedCustomer {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

interface Props {
  open: boolean;
  initialName?: string;
  // When set, the modal edits this existing customer (PATCH) instead of
  // creating a new one (POST) -- same form, same modal, just a different
  // save target and pre-filled fields.
  customer?: SavedCustomer | null;
  onClose: () => void;
  onSaved: (customer: SavedCustomer) => void;
}

export default function CustomerCreateModal({ open, initialName = "", customer, onClose, onSaved }: Props) {
  const editing = !!customer;
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(customer?.name ?? initialName);
      setEmail(customer?.email ?? "");
      setPhone(customer?.phone ?? "");
      setAddress(customer?.address ?? "");
      setEmergencyContactName(customer?.emergencyContactName ?? "");
      setEmergencyContactPhone(customer?.emergencyContactPhone ?? "");
      setError("");
    }
  }, [open, initialName, customer]);

  if (!open) return null;

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/customers/${customer!.id}` : "/api/customers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          address: address || undefined,
          emergencyContactName: emergencyContactName || undefined,
          emergencyContactPhone: emergencyContactPhone || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.formErrors?.[0] ?? d.error ?? `Failed to ${editing ? "save" : "create"}`);
        return;
      }
      const c = await res.json();
      onSaved(c);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-gray-800">{editing ? "Edit Customer" : "New Customer"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Address</label>
            <AddressAutocomplete value={address} onChange={setAddress} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Emergency contact name</label>
              <input className="input" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} placeholder="Spouse, family…" />
            </div>
            <div>
              <label className="label">Emergency contact phone</label>
              <input className="input" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
            </div>
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? "Save Changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
