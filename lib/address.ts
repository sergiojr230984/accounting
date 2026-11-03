/**
 * Customer apartment / suite / unit handling.
 *
 * The apartment lives in its own Customer.apartment column (not typed into
 * Customer.address) so the street address stays clean for the address
 * autocomplete, and editing a customer can't duplicate it. Everything that
 * SHOWS or PRINTS a customer's address -- invoice/estimate PDFs, packing
 * list, deliveries, driver link, public pay/estimate pages -- must go
 * through formatCustomerAddress() rather than reading `.address` directly,
 * or the apartment silently drops off that document.
 *
 * Dependency-free on purpose: imported by client components and API routes
 * alike.
 */

/**
 * "705" / "7B" / "12-A" -> "Apt 705". Anything that already carries its own
 * label ("Suite 200", "Unit 4", "#12", "Apto 705") is kept exactly as typed.
 */
export function formatApartment(apartment: string | null | undefined): string {
  const apt = (apartment ?? "").trim();
  if (!apt) return "";
  if (/^[0-9][0-9A-Za-z-]*$/.test(apt) || /^[A-Za-z]$/.test(apt)) return `Apt ${apt}`;
  return apt;
}

/**
 * Full one-line address with the apartment placed right after the street
 * line (before the city), e.g.
 *   ("2137 NW 36th St, Miami, FL 33142", "705")
 *     -> "2137 NW 36th St, Apt 705, Miami, FL 33142"
 * With no comma in the address the apartment is appended at the end. With no
 * address at all the apartment alone is not returned (an apartment number
 * without a street is useless to a driver) -- the result is null.
 */
export function formatAddress(
  address: string | null | undefined,
  apartment: string | null | undefined
): string | null {
  const street = (address ?? "").trim();
  if (!street) return null;
  const apt = formatApartment(apartment);
  if (!apt) return street;
  // Already included by hand (e.g. older records typed as one string)?
  // Don't print it twice.
  if (street.toLowerCase().includes(apt.toLowerCase())) return street;
  const comma = street.indexOf(",");
  if (comma === -1) return `${street}, ${apt}`;
  return `${street.slice(0, comma)}, ${apt}${street.slice(comma)}`;
}

export function formatCustomerAddress(
  customer: { address?: string | null; apartment?: string | null } | null | undefined
): string | null {
  if (!customer) return null;
  return formatAddress(customer.address, customer.apartment);
}
