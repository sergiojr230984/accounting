"use client";

import { signOut } from "next-auth/react";
import { ChevronDown, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface TopBarProps {
  user: { name?: string | null; email?: string | null };
}

export default function TopBar({ user }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("La Cuevita Furniture");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { name?: string | null } | null) => {
        if (p?.name && p.name.trim()) setCompanyName(p.name);
      })
      .catch(() => {});
  }, []);

  const initials = (user.name ?? user.email ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-end px-6 flex-shrink-0 gap-4">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
        <span className="font-semibold text-gray-800 uppercase text-xs tracking-wide">{companyName}</span>
        <span className="bg-brand-100 text-brand-700 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded">Starter</span>
      </div>

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
        {open && (
          <div className="absolute right-0 top-12 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="font-medium text-sm text-gray-900 truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
