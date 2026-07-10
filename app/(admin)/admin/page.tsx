"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ScrollText, DatabaseBackup, FileSpreadsheet, UserCog, CheckCircle, XCircle, Clock } from "lucide-react";

interface BackupStatus {
  lastSuccess: { finishedAt: string; sizeBytes: string | number } | null;
  logs: Array<{ status: string; startedAt: string; type: string }>;
}

export default function AdminDashboardPage() {
  const [backups, setBackups] = useState<BackupStatus | null>(null);

  useEffect(() => {
    fetch("/api/admin/backups")
      .then((r) => r.json())
      .then(setBackups)
      .catch(() => null);
  }, []);

  const lastBackup = backups?.lastSuccess;
  const lastStatus = backups?.logs?.[0]?.status;

  const cards = [
    {
      href: "/admin/users",
      icon: UserCog,
      label: "Users",
      description: "Manage accounts, roles, and access",
      color: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      href: "/admin/audit-log",
      icon: ScrollText,
      label: "Audit Log",
      description: "Immutable record of all system activity",
      color: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      href: "/admin/backups",
      icon: DatabaseBackup,
      label: "Backups",
      description: "Scheduled & manual database backups",
      color: "bg-green-50 text-green-700 border-green-200",
    },
    {
      href: "/admin/1099",
      icon: FileSpreadsheet,
      label: "1099 Contractors",
      description: "Year-end contractor payment summary",
      color: "bg-amber-50 text-amber-700 border-amber-200",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <ShieldCheck className="w-8 h-8 text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500">Owner-only controls and oversight</p>
        </div>
      </div>

      {/* Backup health indicator */}
      <div className="mb-6 p-4 rounded-xl border flex items-center gap-4
        bg-white shadow-sm">
        <div className="flex items-center gap-2">
          {lastStatus === "SUCCESS" ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : lastStatus === "FAILED" ? (
            <XCircle className="w-5 h-5 text-red-500" />
          ) : (
            <Clock className="w-5 h-5 text-gray-400" />
          )}
          <span className="text-sm font-medium text-gray-700">
            {lastBackup
              ? `Last backup: ${new Date(lastBackup.finishedAt).toLocaleString()}`
              : "No backups yet"}
          </span>
        </div>
        <Link
          href="/admin/backups"
          className="ml-auto text-sm text-blue-600 hover:underline"
        >
          View backups &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(({ href, icon: Icon, label, description, color }) => (
          <Link
            key={href}
            href={href}
            className={`block p-6 rounded-xl border shadow-sm hover:shadow-md transition-shadow ${color}`}
          >
            <Icon className="w-6 h-6 mb-3" />
            <p className="font-semibold text-base">{label}</p>
            <p className="text-xs mt-1 opacity-75">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
