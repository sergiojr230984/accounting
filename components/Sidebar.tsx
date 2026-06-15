"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Users,
  BarChart3,
  BookOpen,
  Plus,
  ChevronDown,
  Settings,
} from "lucide-react";

type LeafItem = { href: string; label: string; icon?: React.ComponentType<{ className?: string }> };
type GroupItem = { label: string; icon: React.ComponentType<{ className?: string }>; children: LeafItem[] };
type NavItem = LeafItem | GroupItem;

type NavItemWithRole = NavItem & { adminOnly?: boolean };

const navItems: NavItemWithRole[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Sales & Payments",
    icon: FileText,
    children: [
      { href: "/invoices/customer", label: "Invoices" },
      { href: "/customers", label: "Customers" },
    ],
  },
  {
    label: "Purchases",
    icon: ShoppingCart,
    children: [
      { href: "/invoices/supplier", label: "Bills" },
      { href: "/suppliers", label: "Suppliers" },
    ],
  },
  {
    label: "Team",
    icon: Users,
    children: [
      { href: "/employees", label: "Employees" },
      { href: "/performance", label: "Performance" },
    ],
  },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

function isLeaf(item: NavItem): item is LeafItem {
  return (item as LeafItem).href !== undefined;
}

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  // Admin-only items disappear from the sidebar entirely for managers; they
  // can't even see Settings exists.
  const visibleNav = navItems.filter((item) => !item.adminOnly || role === "ADMIN");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of visibleNav) {
      if (!isLeaf(item)) {
        initial[item.label] = item.children.some((c) => pathname.startsWith(c.href));
      }
    }
    return initial;
  });

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-sm text-gray-900">La Cuevita</p>
            <p className="text-gray-400 text-[10px] uppercase tracking-wide">Accounting</p>
          </div>
        </Link>
      </div>

      {/* Create new */}
      <div className="px-4">
        <Link
          href="/invoices/customer/new"
          className="flex items-center gap-2 px-3 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create new
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => {
          if (isLeaf(item)) {
            const Icon = item.icon!;
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          }

          const Icon = item.icon;
          const open = openGroups[item.label] ?? false;
          const anyChildActive = item.children.some((c) => pathname.startsWith(c.href));
          return (
            <div key={item.label}>
              <button
                onClick={() => setOpenGroups((s) => ({ ...s, [item.label]: !s[item.label] }))}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  anyChildActive ? "text-brand-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l border-gray-100 pl-3">
                  {item.children.map((c) => {
                    const active = pathname === c.href || pathname.startsWith(c.href + "/");
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                          active ? "text-brand-700 font-medium" : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-gray-100">
        <p className="text-gray-400 text-[10px] text-center">
          La Cuevita Accounting · v1.1.4 · role: {role ?? "none"}
        </p>
      </div>
    </aside>
  );
}
