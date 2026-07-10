"use client";

import { useEffect, useState } from "react";
import { UserPlus, Pencil, UserX, CheckCircle, XCircle } from "lucide-react";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "SALES";
  active: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES: "Employee",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "MANAGER" });
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("MANAGER");

  const load = () =>
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => setUsers(d))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const create = async () => {
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error"); return; }
    setShowCreate(false);
    setForm({ name: "", email: "", password: "", role: "MANAGER" });
    load();
  };

  const updateRole = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: editRole }),
    });
    if (res.ok) { setEditId(null); load(); }
    else { const d = await res.json(); alert(d.error); }
  };

  const toggleActive = async (user: UserRecord) => {
    if (!confirm(`${user.active ? "Disable" : "Enable"} ${user.name}?`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    if (res.ok) load();
    else { const d = await res.json(); alert(d.error); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Users</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <UserPlus className="w-4 h-4" /> Invite User
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-5 bg-white rounded-xl border shadow-sm space-y-3">
          <h2 className="font-semibold text-sm text-gray-700">New User</h2>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Password (min 8 chars)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
              <option value="ADMIN">Admin</option>
              <option value="MANAGER">Manager</option>
              <option value="SALES">Employee</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={create} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    {editId === u.id ? (
                      <div className="flex items-center gap-2">
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="border rounded px-2 py-1 text-xs">
                          <option value="ADMIN">Admin</option>
                          <option value="MANAGER">Manager</option>
                          <option value="SALES">Employee</option>
                        </select>
                        <button onClick={() => updateRole(u.id)} className="text-blue-600 text-xs">Save</button>
                        <button onClick={() => setEditId(null)} className="text-gray-400 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3 h-3" /> Active</span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 text-xs"><XCircle className="w-3 h-3" /> Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setEditId(u.id); setEditRole(u.role); }}
                        className="text-gray-400 hover:text-blue-600"
                        title="Change role"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleActive(u)}
                        className="text-gray-400 hover:text-red-600"
                        title={u.active ? "Disable user" : "Enable user"}
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
