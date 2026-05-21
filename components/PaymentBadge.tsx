type Status = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export default function PaymentBadge({ status }: { status: Status }) {
  if (status === "PAID") return <span className="badge-paid">Paid</span>;
  if (status === "PARTIALLY_PAID") return <span className="badge-partial">Partial</span>;
  return <span className="badge-unpaid">Unpaid</span>;
}
