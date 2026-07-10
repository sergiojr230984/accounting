"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Building2, ChevronDown, Check, Plus } from "lucide-react";

interface CompanyOption {
  id: string;
  name: string;
  role: string;
}

export default function CompanySwitcher() {
  const { data: session, update } = useSession();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const activeCompanyId = session?.companyId;
  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch("/api/companies");
      if (res.ok) setCompanies(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function toggleOpen() {
    if (!open) loadCompanies();
    setOpen((o) => !o);
    setError("");
  }

  async function handleSwitch(companyId: string) {
    if (companyId === activeCompanyId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await update({ companyId });
      window.location.reload();
    } finally {
      setSwitching(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSwitching(true);
    setError("");
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create company");
        setSwitching(false);
        return;
      }
      await update({ companyId: body.id });
      window.location.reload();
    } catch {
      setError("Could not create company");
      setSwitching(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggleOpen}
        className="flex items-center gap-2 text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
      >
        <Building2 className="w-4 h-4 text-brand-600" />
        <span className="font-medium max-w-[140px] truncate">
          {activeCompany?.name ?? "Loading…"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">
            Your companies
          </div>
          {loading && <div className="px-3 py-2 text-sm text-gray-400">Loading…</div>}
          {!loading &&
            companies.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSwitch(c.id)}
                disabled={switching}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 text-left disabled:opacity-50"
              >
                <span className="flex flex-col">
                  <span className="text-gray-800">{c.name}</span>
                  <span className="text-xs text-gray-400">{c.role}</span>
                </span>
                {c.id === activeCompanyId && <Check className="w-4 h-4 text-brand-600" />}
              </button>
            ))}

          <div className="border-t border-gray-100 mt-1 pt-1">
            {!creating ? (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-600 hover:bg-gray-50"
              >
                <Plus className="w-4 h-4" />
                Add a company
              </button>
            ) : (
              <div className="px-3 py-2 space-y-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="Company name"
                  className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={switching || !newName.trim()}
                    className="flex-1 text-xs font-medium bg-brand-600 text-white rounded-md py-1.5 hover:bg-brand-700 disabled:opacity-50"
                  >
                    Create & switch
                  </button>
                  <button
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                      setError("");
                    }}
                    className="text-xs font-medium text-gray-500 rounded-md py-1.5 px-2 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
