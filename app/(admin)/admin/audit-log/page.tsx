"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, Download, ChevronDown, ChevronRight } from "lucide-react";

type LogEntry = {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  ipAddress: string;
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  VOID: "bg-orange-100 text-orange-800",
  LOGIN: "bg-gray-100 text-gray-700",
  LOGIN_FAILED: "bg-red-100 text-red-700",
  ACCESS_DENIED: "bg-red-200 text-red-900",
  EXPORT: "bg-purple-100 text-purple-800",
  BACKUP_RUN: "bg-teal-100 text-teal-800",
  TIN_VIEW: "bg-amber-100 text-amber-900",
  ROLE_CHANGE: "bg-yellow-100 text-yellow-900",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState({ from: "", to: "", action: "", entityType: "", search: "" });

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.search) params.set("search", filters.search);
    fetch(`/api/admin/audit-log?${params}`)
      .then((r) => r.json())
      .then((d) => { setLogs(d.logs ?? []); setTotal(d.total ?? 0); })
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const params = new URLSearchParams({ export: "csv" });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entityType", filters.entityType);
    window.location.href = `/api/admin/audit-log?${params}`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ScrollText className="w-6 h-6 text-purple-600" />
          <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
          <span className="text-sm text-gray-500">{total.toLocaleString()} entries</span>
        </div>
        <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="From" />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="To" />
        <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All actions</option>
          {["CREATE","UPDATE","DELETE","VOID","LOGIN","LOGIN_FAILED","LOGOUT","EXPORT","SETTING_CHANGE","ROLE_CHANGE","BACKUP_RUN","BACKUP_RESTORE","ACCESS_DENIED","TIN_VIEW"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input placeholder="Entity type..." value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
        <input placeholder="Search label..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left w-4"></th>
                <th className="px-4 py-3 text-left">Date / Time</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Entity</th>
                <th className="px-4 py-3 text-left">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <>
                  <tr
                    key={log.id}
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-3 py-2 text-gray-400">
                      {log.changes && Object.keys(log.changes).length > 0
                        ? expanded === log.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
                        : null}
                    </td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{log.actorName}</p>
                      <p className="text-xs text-gray-400">{log.actorRole}</p>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{log.entityType}</td>
                    <td className="px-4 py-2 text-gray-700">{log.entityLabel}</td>
                  </tr>
                  {expanded === log.id && log.changes && Object.keys(log.changes).length > 0 && (
                    <tr key={`${log.id}-detail`} className="bg-gray-50">
                      <td colSpan={6} className="px-8 py-3">
                        <pre className="text-xs text-gray-700 overflow-x-auto">
                          {JSON.stringify(log.changes, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-40">Prev</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
