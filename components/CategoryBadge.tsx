type Category = "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER";

const labels: Record<Category, string> = {
  COGS: "Cost of Goods",
  SERVICES_EXPENSE: "Services",
  OPERATING_EXPENSE: "Operating",
  OTHER: "Other",
};

const styles: Record<Category, string> = {
  COGS: "bg-orange-100 text-orange-800",
  SERVICES_EXPENSE: "bg-blue-100 text-blue-800",
  OPERATING_EXPENSE: "bg-purple-100 text-purple-800",
  OTHER: "bg-gray-100 text-gray-700",
};

export default function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${styles[category]}`}>
      {labels[category]}
    </span>
  );
}
