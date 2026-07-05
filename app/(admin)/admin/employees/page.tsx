"use client";

import { useEffect, useState } from "react";
import { UserPlus, Pencil, Check, X, AlertTriangle } from "lucide-react";

type Employee = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  commissionRate: string;
  active: boolean;
  _count: { invoices: number };
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: "", email: "", phone: "", commissionRate: "" });
  const [editError, setEditError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({ name: "", email: "", phone: "", commissionRate: "0" });
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    fetch("/api/admin/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const startEdit = (e: Employee) => {
    setEditId(e.id);
    setEditError("");
    setEditData({
      name: e.name,
      email: e.email ?? "",
      phone: e.phone ?? "",
      commissionRate: (parseFloat(e.commissionRate) * 100).toFixed(2),
    });
  };

  const saveEdit = async () => {
    setEditError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/employees/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editData.name,
          email: editData.email.trim() || null,
          phone: editData.phone.trim() || null,
          commissionRate: (parseFloat(editData.commissionRate || "0") / 100).toFixed(4),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error ?? "Error saving"); return; }
      setEditId(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (e: Employee) => {
    await fetch(`/api/admin/employees/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !e.active }),
    });
    load();
  };

  const createEmployee = async () => {
    setCreateError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createData.name,
          email: createData.email.trim() || null,
          phone: createData.phone.trim() || null,
          commissionRate: (parseFloat(createData.commissionRate || "0") / 100).toFixed(4),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "Error creating"); return; }
      setShowCreate(false);
      setCreateData({ name: "", email: "", phone: "", commissionRate: "0" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const noEmail = employees.filter((e) => e.active && !e.email);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500">Manage sales reps and link them to their login accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <UserPlus className="w-4 h-4" /> New Employee
        </button>
      </div>

      {noEmail.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {noEmail.length} active employee{noEmail.length > 1 ? "s" : ""} without a login email
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Employees without an email set here cannot be linked to a user login and will see an empty invoice list.
              Set their email below (must match their user account email exactly).
            </p>
            <p className="text-xs text-amber-700 font-medium mt-1">
              {noEmail.map((e) => e.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-sm text-gray-700">New Employee</h2>
          {createError && <p className="text-red-600 text-sm">{createError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Name *</label>
              <input
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="Ali- SW"
                value={createData.name}
                onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Login Email (must match user account)</label>
              <input
                type="email"
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="cuevitasw@gmail.com"
                value={createData.email}
                onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Phone</label>
              <input
                className="border rounded-lg px-3 py-2 text-sm w-full"
                value={createData.phone}
                onChange={(e) => setCreateData({ ...createData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Commission Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                className="border rounded-lg px-3 py-2 text-sm w-full"
                value={createData.commissionRate}
                onChange={(e) => setCreateData({ ...createData, commissionRate: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={createEmployee}
              disabled={saving || !createData.name}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateError(""); }}
              className="px-4 py-2 border text-sm rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Login Email <span className="text-brand-600">(links to user account)</span></th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-center">Commission</th>
              <th className="px-4 py-3 text-center">Invoices</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No employees yet</td></tr>
            ) : (
              employees.map((emp) => (
                <tr key={emp.id} className={emp.active ? "" : "opacity-50 bg-gray-50"}>
                  {editId === emp.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          className="border rounded px-2 py-1 text-sm w-full"
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="email"
                          className="border rounded px-2 py-1 text-sm w-full"
                          placeholder="user@example.com"
                          value={editData.email}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                        />
                        {editError && <p className="text-red-500 text-xs mt-0.5">{editError}</p>}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="border rounded px-2 py-1 text-sm w-full"
                          value={editData.phone}
                          onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            className="border rounded px-2 py-1 text-sm w-20"
                            value={editData.commissionRate}
                            onChange={(e) => setEditData({ ...editData, commissionRate: e.target.value })}
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center text-gray-400">{emp._count.invoices}</td>
                      <td />
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="text-green-600 hover:text-green-700 disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setEditId(null); setEditError(""); }}
                            className="text-gray-400 hover:text-gray-600"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium">{emp.name}</td>
                      <td className="px-4 py-3">
                        {emp.email ? (
                          <span className="text-green-700 font-mono text-xs">{emp.email}</span>
                        ) : (
                          <span className="text-amber-500 text-xs italic">Not set — employee can&apos;t see invoices</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{emp.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        {(parseFloat(emp.commissionRate) * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 bg-brand-100 text-brand-700 rounded-full text-xs font-medium">
                          {emp._count.invoices}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleActive(emp)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            emp.active ? "bg-green-500" : "bg-gray-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              emp.active ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => startEdit(emp)}
                          className="text-gray-400 hover:text-blue-600"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">How employee login linking works</p>
        <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700">
          <li>Create a <strong>User</strong> account (Admin → Users) with role <strong>Employee</strong> and a login email, e.g. <code>cuevitasw@gmail.com</code></li>
          <li>Find the matching <strong>Employee</strong> record in this table (e.g. “Ali-SW”)</li>
          <li>Click the pencil icon and set the email to exactly <code>cuevitasw@gmail.com</code></li>
          <li>That employee will now see only their own invoices when they log in</li>
        </ol>
      </div>
    </div>
  );
}
