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
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

// Sección CRM (leads de WhatsApp) — visible para todos los roles
const crmNav: NavItem[] = [
  { href: "/crm/dashboard", label: "Panel CRM", icon: LayoutDashboard },
  { href: "/crm/leads", label: "Leads", icon: Contact },
];

// Gestión del equipo de ventas — solo administradores
const crmAdminNav: NavItem[] = [
  { href: "/crm/team", label: "Vendedoras", icon: UsersRound },
];

// Sección Contabilidad — solo ADMIN / MANAGER
const accountingNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices/customer", label: "Customer Invoices", icon: FileText },
  { href: "/invoices/supplier", label: "Supplier Invoices", icon: ShoppingCart },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/reports", label: "Reports", icon: BarChart3 },
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
    pathname === href || (href !== "/dashboard" && href !== "/crm/dashboard" && pathname.startsWith(href));

  const canManage = role === "ADMIN" || role === "MANAGER";
  const isAdmin = role === "ADMIN";

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

        {canManage && (
          <>
            <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" />
              Contabilidad
            </p>
            {accountingNav.map((item) => (
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
