"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Users,
  Truck,
  BarChart3,
  BookOpen,
  MessageSquare,
  Contact,
  UsersRound,
  ShieldCheck,
  ScrollText,
  DatabaseBackup,
  FileSpreadsheet,
  UserCog,
  TrendingUp,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const crmNav: NavItem[] = [
  { href: "/crm/dashboard", label: "Panel CRM", icon: LayoutDashboard },
  { href: "/crm/leads", label: "Leads", icon: Contact },
];

const crmAdminNav: NavItem[] = [
  { href: "/crm/team", label: "Vendedoras", icon: UsersRound },
];

// Employee (SALES) can only see their own invoices and customers
const salesNav: NavItem[] = [
  { href: "/invoices/customer", label: "My Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
];

// AP/AR work — ADMIN and MANAGER
const apArNav: NavItem[] = [
  { href: "/invoices/customer", label: "Customer Invoices", icon: FileText },
  { href: "/invoices/supplier", label: "Supplier Bills", icon: ShoppingCart },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
];

// Financial pages — ADMIN only
const financialNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

const adminNav: NavItem[] = [
  { href: "/admin", label: "Admin Dashboard", icon: ShieldCheck },
  { href: "/admin/users", label: "Users", icon: UserCog },
  { href: "/admin/employees", label: "Employees", icon: UsersRound },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
  { href: "/admin/1099", label: "1099 Contractors", icon: FileSpreadsheet },
];

function NavLink({ href, label, icon: Icon, active }: NavItem & { active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-white" : "text-brand-200 hover:bg-brand-800 hover:text-white"
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </Link>
  );
}

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" &&
      href !== "/crm/dashboard" &&
      href !== "/admin" &&
      pathname.startsWith(href));

  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";
  const isSales = role === "SALES";

  return (
    <aside className="w-60 bg-brand-900 text-white flex flex-col flex-shrink-0">
      <div className="p-5 border-b border-brand-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <p className="font-bold text-sm">La Cuevita</p>
            <p className="text-brand-300 text-xs">CRM de Ventas</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
          CRM
        </p>
        {crmNav.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
        {isAdmin &&
          crmAdminNav.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(item.href)} />
          ))}

        {/* SALES employees: own invoices + customers */}
        {isSales && (
          <>
            <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" />
              My Sales
            </p>
            {salesNav.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
          </>
        )}

        {/* AP/AR section: Admin + Manager */}
        {(isAdmin || isManager) && (
          <>
            <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" />
              Contabilidad
            </p>
            {apArNav.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
          </>
        )}

        {/* Financials: Admin only */}
        {isAdmin && (
          <>
            <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
              <BarChart3 className="w-3 h-3" />
              Financials
            </p>
            {financialNav.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
          </>
        )}

        {/* Admin tools: Admin only */}
        {isAdmin && (
          <>
            <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3" />
              Admin / Owner
            </p>
            {adminNav.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-brand-700">
        <p className="text-brand-400 text-xs text-center">v1.0.0</p>
      </div>
    </aside>
  );
}
