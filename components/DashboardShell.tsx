"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { usePathname } from "next/navigation";

interface DashboardShellProps {
  role?: string;
  user: { name?: string | null; email?: string | null };
  children: React.ReactNode;
}

export default function DashboardShell({ role, user, children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close the drawer whenever the user navigates — otherwise the
  // overlay sticks around after a Link click and the user has to close
  // it manually.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when the drawer is open on mobile.
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile backdrop — fades in when drawer is open, click to close. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar:
          - On md+: in-flow flex column, always visible.
          - On mobile: fixed-positioned, slides in/out via translate. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar role={role} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar user={user} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
