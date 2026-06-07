"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Building2,
  Receipt,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  Save,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Upload,
} from "lucide-react";

type Section = "company" | "taxes" | "fees";

interface CompanyProfile {
  id: string;
  name: string | null;
  logo: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  creditCardFeeRate: string;
  creditCardFeeLabel: string;
}

interface TaxRate {
  id: string;
  name: string;
  rate: string;
  active: boolean;
}

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("company");

  return (
    <div className="max-w-7xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="grid grid-cols-12 gap-6">
        {/* Sub-nav */}
        <nav className="col-span-12 md:col-span-3 space-y-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 py-2">Sales & Payments</p>
          {[
            { key: "company" as const, label: "Company profile & logo", icon: Building2 },
            { key: "taxes" as const, label: "Sales taxes", icon: Receipt },
            { key: "fees" as const, label: "Credit card fee", icon: CreditCard },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                section === key ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <div className="col-span-12 md:col-span-9">
          {section === "company" && <CompanySection />}
          {section === "taxes" && <TaxesSection />}
          {section === "fees" && <FeesSection />}
        </div>
      </div>
    </div>
  );
}

function useProfile() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (res.ok) setProfile(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { profile, setProfile, loading, reload: load };
}

function CompanySection() {
  const { profile, setProfile, loading } = useProfile();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (loading || !profile) {
    return <div className="card animate-pulse h-48 bg-gray-50" />;
  }

  function update<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          logo: profile.logo,
          address: profile.address,
          email: profile.email,
          phone: profile.phone,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.formErrors?.[0] ?? d.error ?? "Save failed");
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 800 * 1024) {
      setError("Logo too large — max 800 KB. Compress and try again.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(file.type)) {
      setError("Logo must be a PNG, JPG, or SVG file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("logo", String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Company profile</h2>
          <p className="text-sm text-gray-500 mt-1">This shows on every invoice you send and on the PDF you print.</p>
        </div>

        <div>
          <label className="label">Logo</label>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden">
              {profile.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logo} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-gray-300" />
              )}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" hidden onChange={onPickFile} />
              <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm">
                <Upload className="w-4 h-4" />
                {profile.logo ? "Replace logo" : "Upload logo"}
              </button>
              {profile.logo && (
                <button onClick={() => update("logo", null)} className="text-xs text-red-600 hover:underline block">
                  Remove logo
                </button>
              )}
              <p className="text-xs text-gray-400">PNG, JPG, or SVG · max 800 KB</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Company name</label>
            <input
              className="input"
              placeholder="La Cuevita de San Miguel"
              value={profile.name ?? ""}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="hello@lacuevita.com"
              value={profile.email ?? ""}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              placeholder="+1 555 0100"
              value={profile.phone ?? ""}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Address</label>
            <textarea
              className="input"
              rows={3}
              placeholder="123 Main St&#10;San Miguel, GTO&#10;Mexico"
              value={profile.address ?? ""}
              onChange={(e) => update("address", e.target.value)}
            />
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

        <div className="flex items-center justify-end gap-3 pt-2 border-t">
          {savedAt && <span className="text-xs text-green-600">Saved {savedAt.toLocaleTimeString()}</span>}
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function TaxesSection() {
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/taxes");
      if (res.ok) setTaxes(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setError("");
    if (!newName.trim() || !newRate.trim()) {
      setError("Name and rate are required.");
      return;
    }
    const ratePct = parseFloat(newRate);
    if (isNaN(ratePct)) {
      setError("Rate must be a number (percent).");
      return;
    }
    const res = await fetch("/api/settings/taxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, rate: (ratePct / 100).toFixed(4), active: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.formErrors?.[0] ?? d.error ?? "Failed to add tax");
      return;
    }
    setNewName(""); setNewRate(""); setCreating(false);
    await load();
  }

  async function saveEdit(id: string) {
    const ratePct = parseFloat(editRate);
    if (isNaN(ratePct)) return;
    await fetch(`/api/settings/taxes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, rate: (ratePct / 100).toFixed(4) }),
    });
    setEditingId(null);
    await load();
  }

  async function toggleActive(t: TaxRate) {
    await fetch(`/api/settings/taxes/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/settings/taxes/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Sales taxes</h2>
          <p className="text-sm text-gray-500 mt-1">Define named tax rates so they're a one-click pick on invoice line items.</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add tax rate
          </button>
        )}
      </div>

      {creating && (
        <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" placeholder="IVA / GST / Sales tax" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="label">Rate (%)</label>
              <input className="input" placeholder="16" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setCreating(false); setError(""); }} className="btn-secondary"><X className="w-4 h-4" />Cancel</button>
            <button onClick={add} className="btn-primary"><Check className="w-4 h-4" />Add</button>
          </div>
        </div>
      )}

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Name</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Rate</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Active</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
            ) : taxes.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No tax rates yet — add one above.</td></tr>
            ) : (
              taxes.map((t) => (
                editingId === t.id ? (
                  <tr key={t.id} className="bg-brand-50">
                    <td className="px-4 py-2"><input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                    <td className="px-4 py-2"><input className="input text-right" value={editRate} onChange={(e) => setEditRate(e.target.value)} /></td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => saveEdit(t.id)} className="text-brand-700 hover:text-brand-800 mr-3"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-right">{(parseFloat(t.rate) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(t)}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          t.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {t.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setEditingId(t.id); setEditName(t.name); setEditRate((parseFloat(t.rate) * 100).toString()); }}
                        className="text-gray-400 hover:text-brand-600 mr-3"
                      ><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                )
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeesSection() {
  const { profile, setProfile, loading } = useProfile();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [ratePct, setRatePct] = useState("0");

  useEffect(() => {
    if (profile) setRatePct((parseFloat(profile.creditCardFeeRate) * 100).toString());
  }, [profile]);

  if (loading || !profile) return <div className="card animate-pulse h-48 bg-gray-50" />;

  async function save() {
    if (!profile) return;
    setError("");
    const r = parseFloat(ratePct);
    if (isNaN(r) || r < 0 || r > 100) {
      setError("Rate must be a percentage between 0 and 100.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditCardFeeRate: (r / 100).toFixed(4),
          creditCardFeeLabel: profile.creditCardFeeLabel || "Credit card processing fee",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error?.formErrors?.[0] ?? d.error ?? "Save failed");
        return;
      }
      setProfile(await res.json());
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Credit card processing fee</h2>
        <p className="text-sm text-gray-500 mt-1">
          When enabled on an invoice, this percentage of the subtotal is added as a separate line so the customer covers your card processor's fee.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Fee rate (%)</label>
          <input
            className="input"
            placeholder="3.5"
            value={ratePct}
            onChange={(e) => setRatePct(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">e.g. 3.5 means 3.5% of the invoice subtotal.</p>
        </div>
        <div>
          <label className="label">Label shown on invoice</label>
          <input
            className="input"
            placeholder="Credit card processing fee"
            value={profile.creditCardFeeLabel}
            onChange={(e) => setProfile((p) => (p ? { ...p, creditCardFeeLabel: e.target.value } : p))}
          />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="flex items-center justify-end gap-3 pt-2 border-t">
        {savedAt && <span className="text-xs text-green-600">Saved {savedAt.toLocaleTimeString()}</span>}
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save changes
        </button>
      </div>
    </div>
  );
}
