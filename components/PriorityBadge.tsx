type Priority = "LOW" | "MEDIUM" | "HIGH";

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  LOW: { label: "Baja", className: "bg-gray-100 text-gray-700" },
  MEDIUM: { label: "Media", className: "bg-amber-100 text-amber-800" },
  HIGH: { label: "Alta", className: "bg-red-100 text-red-800" },
};

export default function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
