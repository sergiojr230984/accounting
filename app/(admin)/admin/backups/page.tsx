"use client";

import { useEffect, useState } from "react";
import { DatabaseBackup, Play, Download, CheckCircle, XCircle, Clock, RotateCcw } from "lucide-react";

type BackupEntry = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  type: string;
  sizeBytes: string | number | null;
  errorMessage: string | null;
};

export default function BackupsPage() {
  const [logs, setLogs] = useState<BackupEntry[]>([]);
  const [lastSuccess, setLastSuccess] = useState<BackupEntry | null>(null);
  const [running, setRunning] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState("");

  const load = () =>
    fetch("/api/admin/backups")
      .then((r) => r.json())
      .then((d) => { setLogs(d.logs ?? []); setLastSuccess(d.lastSuccess ?? null); });

  useEffect(() => { load(); }, []);

  const runBackup = async () => {
    if (!confirm("Run a manual backup now?")) return;
    setRunning(true);
    const res = await fetch("/api/admin/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setRunning(false);
    if (res.ok) load();
    else { const d = await res.json(); alert(d.error); }
  };

  const exportAll = () => { window.location.href = "/api/admin/export"; };

  const doRestore = async () => {
    if (restoreConfirm !== "RESTORE") { alert("Type RESTORE to confirm"); return; }
    const res = await fetch("/api/admin/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", confirm: "RESTORE" }),
    });
    const d = await res.json();
    alert(d.message ?? d.error);
    setShowRestore(false);
    setRestoreConfirm("");
  };

  const statusIcon = (s: string) =>
    s === "SUCCESS" ? <CheckCircle className="w-4 h-4 text-green-500" /> :
    s === "FAILED" ? <XCircle className="w-4 h-4 text-red-500" /> :
    <Clock className="w-4 h-4 text-yellow-500" />;

  const formatSize = (bytes: string | number | null) => {
    if (!bytes) return "—";
    const n = Number(bytes);
    if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <DatabaseBackup className="w-6 h-6 text-green-600" />
          <h1 className="text-xl font-bold text-gray-900">Backups</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportAll} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
            <Download className="w-4 h-4" /> Export All Data
          </button>
          <button onClick={() => setShowRestore(true)} className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
            <RotateCcw className="w-4 h-4" /> Restore
          </button>
          <button onClick={runBackup} disabled={running} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
            <Play className="w-4 h-4" /> {running ? "Running..." : "Backup Now"}
          </button>
        </div>
      </div>

      {/* Health summary */}
      <div className="mb-6 p-4 bg-white rounded-xl border shadow-sm">
        <p className="text-sm font-medium text-gray-700">Last successful backup</p>
        {lastSuccess ? (
          <p className="text-lg font-bold text-gray-900 mt-1">
            {new Date(lastSuccess.finishedAt!).toLocaleString()}
            <span className="ml-3 text-sm font-normal text-gray-500">{formatSize(lastSuccess.sizeBytes)}</span>
          </p>
        ) : (
          <p className="text-gray-500 text-sm mt-1">No successful backups yet</p>
        )}
      </div>

      {showRestore && (
        <div className="mb-6 p-5 bg-red-50 border border-red-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-red-800">
            ⚠️ Restore is destructive. It will replace all data. Type <strong>RESTORE</strong> to confirm.
          </p>
          <input
            value={restoreConfirm}
            onChange={(e) => setRestoreConfirm(e.target.value)}
            placeholder="Type RESTORE"
            className="border rounded-lg px-3 py-2 text-sm w-full"
          />
          <div className="flex gap-2">
            <button onClick={doRestore} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg">Confirm Restore</button>
            <button onClick={() => { setShowRestore(false); setRestoreConfirm(""); }} className="px-4 py-2 border text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Finished</th>
              <th className="px-4 py-3 text-left">Size</th>
              <th className="px-4 py-3 text-left">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3">{statusIcon(log.status)}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{log.type}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{new Date(log.startedAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600">{log.finishedAt ? new Date(log.finishedAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-3">{formatSize(log.sizeBytes)}</td>
                <td className="px-4 py-3 text-red-600 text-xs">{log.errorMessage ?? ""}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No backups yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
