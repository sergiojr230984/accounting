import { format } from "date-fns";

/**
 * Formats a calendar date (stored as UTC midnight, e.g. from a <input type="date">)
 * using its UTC year/month/day so the displayed date doesn't shift when the
 * viewer's local timezone is behind UTC.
 */
export function formatDateOnly(value: string | Date, fmt = "MMM d, yyyy"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const localDate = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return format(localDate, fmt);
}
