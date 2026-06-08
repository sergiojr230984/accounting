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
  UserCircle,
  KeyRound,
  Power,
} from "lucide-react";
import { format } from "date-fns";

type Section = "users" | "company" | "taxes" | "fees";

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
  const [section, setSection] = useState<Section>("users");

  return (
    <div className="max-w-7xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="grid grid-cols-12 gap-6">
        {/* Sub-nav */}
        <nav className="col-span-12 md:col-span-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 py-2">User management</p>
            <button
              onClick={() => setSection("users")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                section === "users" ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <UserCircle className="w-4 h-4 flex-shrink-0" />
              Users
            </button>
          </div>
          <div>
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
          </div>
        </nav>

        {/* Main content */}
        <div className="col-span-12 md:col-span-9">
          {section === "users" && <UsersSection />}
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

/**
 * Read an image File and return a downscaled PNG data URL.
 *
 * - PNG is preferred so logos with transparency render cleanly on the
 *   invoice header (white tile in the brand corner).
 * - SVG inputs are passed through as-is because they're vector + tiny.
 * - Anything bigger than `maxDim` on either side gets proportionally
 *   shrunk so the resulting base64 payload stays well under any
 *   reasonable request-body cap.
 */
async function fileToShrunkDataUrl(file: File, maxDim = 400, _quality = 0.9): Promise<string> {
  if (file.type === "image/svg+xml") {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read SVG"));
      r.readAsDataURL(file);
    });
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image"));
    el.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round((height / width) * maxDim);
      width = maxDim;
    } else {
      width = Math.round((width / height) * maxDim);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
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
        const text = await res.text();
        let parsed: { error?: unknown } = {};
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        const msg =
          (parsed.error && typeof parsed.error === "object" && "formErrors" in parsed.error
            ? (parsed.error as { formErrors?: string[] }).formErrors?.[0]
            : typeof parsed.error === "string" ? parsed.error : null) ??
          (text.slice(0, 200) || `HTTP ${res.status}`);
        setError(`Save failed (${res.status}): ${msg}`);
        return;
      }
      setSavedAt(new Date());
    } catch (e) {
      setError(`Network error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > 4 * 1024 * 1024) {
      setError("Logo file too large — max 4 MB. We'll auto-shrink it for the invoice.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(file.type)) {
      setError("Logo must be a PNG, JPG, SVG, or WebP file.");
      return;
    }
    try {
      const dataUrl = await fileToShrunkDataUrl(file, 400, 0.9);
      update("logo", dataUrl);
    } catch (err) {
      setError(`Could not process the image: ${(err as Error).message}`);
    }
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
              <p className="text-xs text-gray-400">PNG, JPG, SVG, or WebP. Auto-resized to 400 px for the invoice header.</p>
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

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER";
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
}

function UsersSection() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<{ id: string | null; role: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPwId, setShowPwId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, meRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/me"),
      ]);
      if (usersRes.ok) {
        setUsers(await usersRes.json());
      } else {
        const d = await usersRes.json().catch(() => ({}));
        setError(`Could not load users (${usersRes.status}): ${d.error ?? "unknown"}`);
      }
      if (meRes.ok) {
        const meData = await meRes.json();
        setMe({ id: meData.id ?? null, role: meData.role ?? null });
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function updateUser(id: string, patch: Partial<{ name: string; email: string; role: "ADMIN" | "MANAGER"; active: boolean; password: string }>) {
    setBusy(id); setError("");
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.formErrors?.[0] ?? d.error ?? "Update failed");
    } else {
      await load();
      setEditingId(null);
      setShowPwId(null);
    }
    setBusy(null);
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this user? They won't be able to log in but their history stays.")) return;
    setBusy(id); setError("");
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Delete failed");
    } else {
      await load();
    }
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Users</h2>
            <p className="text-sm text-gray-500 mt-1">
              Each person who logs in needs their own account. Admins manage settings and the team; managers enter invoices and customers.
            </p>
          </div>
          {!showCreate && (
            <button onClick={() => { setShowCreate(true); setError(""); }} className="btn-primary">
              <Plus className="w-4 h-4" />
              Invite user
            </button>
          )}
        </div>

        {showCreate && (
          <UserCreateForm
            onCancel={() => { setShowCreate(false); setError(""); }}
            onCreated={() => { setShowCreate(false); load(); }}
            onError={setError}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Email</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Last login</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No users yet — invite your first one above.</td></tr>
              ) : (
                users.map((u) => {
                  const isSelf = me?.id === u.id;
                  const editing = editingId === u.id;
                  return (
                    <UserRowDisplay
                      key={u.id}
                      user={u}
                      isSelf={isSelf}
                      editing={editing}
                      busy={busy === u.id}
                      showingPw={showPwId === u.id}
                      onStartEdit={() => setEditingId(u.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onPatch={(patch) => updateUser(u.id, patch)}
                      onTogglePwForm={() => setShowPwId((cur) => (cur === u.id ? null : u.id))}
                      onDeactivate={() => deactivate(u.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UserCreateForm({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MANAGER">("MANAGER");
  const [saving, setSaving] = useState(false);

  function generatePw() {
    const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    for (const n of arr) out += alpha[n % alpha.length];
    setPassword(out);
  }

  async function submit() {
    onError("");
    if (!name.trim() || !email.trim() || !password) {
      onError("Name, email, and password are required.");
      return;
    }
    if (password.length < 8) {
      onError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password, role }),
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed: { error?: unknown; debug?: unknown } = {};
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        const baseMsg =
          (parsed.error && typeof parsed.error === "object" && "formErrors" in parsed.error
            ? (parsed.error as { formErrors?: string[] }).formErrors?.[0]
            : typeof parsed.error === "string" ? parsed.error : null) ??
          (text.slice(0, 200) || `HTTP ${res.status}`);
        const dbg = parsed.debug ? ` — debug: ${JSON.stringify(parsed.debug)}` : "";
        onError(`Create failed (${res.status}): ${baseMsg}${dbg}`);
      } else {
        onCreated();
      }
    } catch (e) {
      onError(`Network error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-gray-800 text-sm">Invite a new user</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Full name</label>
          <input className="input" placeholder="Maria Lopez" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email (used to sign in)</label>
          <input className="input" type="email" placeholder="maria@lacuevita.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Initial password</label>
          <div className="flex gap-2">
            <input className="input flex-1" type="text" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={generatePw} className="btn-secondary text-xs whitespace-nowrap">Generate</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Share securely. They can change it after their first login.</p>
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MANAGER")}>
            <option value="MANAGER">Manager — invoices, customers, suppliers</option>
            <option value="ADMIN">Admin — full access including settings</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-brand-100">
        <button onClick={onCancel} className="btn-secondary">
          <X className="w-4 h-4" />Cancel
        </button>
        <button onClick={submit} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Create user
        </button>
      </div>
    </div>
  );
}

function UserRowDisplay({
  user,
  isSelf,
  editing,
  busy,
  showingPw,
  onStartEdit,
  onCancelEdit,
  onPatch,
  onTogglePwForm,
  onDeactivate,
}: {
  user: UserRow;
  isSelf: boolean;
  editing: boolean;
  busy: boolean;
  showingPw: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onPatch: (patch: Partial<{ name: string; email: string; role: "ADMIN" | "MANAGER"; active: boolean; password: string }>) => void;
  onTogglePwForm: () => void;
  onDeactivate: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<"ADMIN" | "MANAGER">(user.role);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => { setName(user.name); setEmail(user.email); setRole(user.role); }, [user]);

  if (editing) {
    return (
      <tr className="bg-brand-50/40">
        <td className="px-4 py-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></td>
        <td className="px-4 py-2"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></td>
        <td className="px-4 py-2 text-center">
          <select className="input w-28" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MANAGER")} disabled={isSelf}>
            <option value="ADMIN">Admin</option>
            <option value="MANAGER">Manager</option>
          </select>
        </td>
        <td className="px-4 py-2 text-gray-400">—</td>
        <td className="px-4 py-2" />
        <td className="px-4 py-2 text-right whitespace-nowrap">
          <button
            onClick={() => onPatch({ name, email, role })}
            disabled={busy}
            className="text-brand-700 hover:text-brand-800 mr-3"
            title="Save"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button onClick={onCancelEdit} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-3 font-medium text-gray-900">
          {user.name}
          {isSelf && <span className="ml-2 text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">you</span>}
        </td>
        <td className="px-4 py-3 text-gray-700">{user.email}</td>
        <td className="px-4 py-3 text-center">
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
            user.role === "ADMIN" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
          }`}>
            {user.role}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {user.lastLogin ? format(new Date(user.lastLogin), "MMM d, yyyy h:mm a") : "Never"}
        </td>
        <td className="px-4 py-3 text-center">
          {user.active ? (
            <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Active</span>
          ) : (
            <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
          )}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button onClick={onStartEdit} title="Edit name/email/role" className="text-gray-400 hover:text-brand-600 mr-2"><Pencil className="w-4 h-4" /></button>
          <button onClick={onTogglePwForm} title="Reset password" className="text-gray-400 hover:text-brand-600 mr-2"><KeyRound className="w-4 h-4" /></button>
          {user.active ? (
            <button
              onClick={onDeactivate}
              disabled={busy || isSelf}
              title={isSelf ? "Can't deactivate yourself" : "Deactivate"}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            </button>
          ) : (
            <button
              onClick={() => onPatch({ active: true })}
              disabled={busy}
              title="Reactivate"
              className="text-gray-400 hover:text-green-600"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            </button>
          )}
        </td>
      </tr>
      {showingPw && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="label">Reset password for {user.email}</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Min 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <button onClick={onTogglePwForm} className="btn-secondary"><X className="w-4 h-4" />Cancel</button>
              <button
                onClick={() => { onPatch({ password: newPassword }); setNewPassword(""); }}
                disabled={busy || newPassword.length < 8}
                className="btn-primary"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Set password
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">After resetting, share the new password with the user securely.</p>
          </td>
        </tr>
      )}
    </>
  );
}
