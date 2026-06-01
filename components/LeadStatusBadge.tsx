type LeadStatus = "NEW" | "CONTACTED" | "FOLLOW_UP" | "CLOSED" | "LOST";

// Etiqueta en español + color para cada estado del lead
export const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  NEW: { label: "Nuevo", className: "bg-blue-100 text-blue-800" },
  CONTACTED: { label: "Contactado", className: "bg-indigo-100 text-indigo-800" },
  FOLLOW_UP: { label: "En seguimiento", className: "bg-yellow-100 text-yellow-800" },
  CLOSED: { label: "Cerrado", className: "bg-green-100 text-green-800" },
  LOST: { label: "Perdido", className: "bg-red-100 text-red-800" },
};

export default function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
