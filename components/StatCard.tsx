import { type LucideIcon } from "lucide-react";
import { formatCurrency } from "@/lib/money";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: "blue" | "green" | "red" | "yellow" | "purple";
  isCurrency?: boolean;
  subtitle?: string;
}

const colorMap = {
  blue: { bg: "bg-blue-50", icon: "text-blue-600", border: "border-blue-100" },
  green: { bg: "bg-green-50", icon: "text-green-600", border: "border-green-100" },
  red: { bg: "bg-red-50", icon: "text-red-600", border: "border-red-100" },
  yellow: { bg: "bg-yellow-50", icon: "text-yellow-600", border: "border-yellow-100" },
  purple: { bg: "bg-purple-50", icon: "text-purple-600", border: "border-purple-100" },
};

export default function StatCard({
  label,
  value,
  icon: Icon,
  color = "blue",
  isCurrency = true,
  subtitle,
}: StatCardProps) {
  const c = colorMap[color];
  const displayValue = isCurrency ? formatCurrency(value.toString()) : value;

  return (
    <div className={`card border ${c.border}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1 truncate">{displayValue}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`w-10 h-10 ${c.bg} rounded-lg flex items-center justify-center flex-shrink-0 ml-3`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}
