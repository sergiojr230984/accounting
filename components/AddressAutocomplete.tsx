"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";

/**
 * Address input with OpenStreetMap Nominatim autocomplete.
 *
 * - No API key, no billing setup. Sends one request to nominatim.openstreetmap.org
 *   per ~350 ms of typing (debounced), restricted to US addresses.
 * - Picking a suggestion fills the input with the formatted address and (if
 *   provided) calls onPlaceSelected with the structured components.
 * - Typing manually always works; the suggestion dropdown is purely additive.
 *
 * Nominatim usage policy: ≤1 req/sec per browser, browsers attach a Referer
 * automatically which satisfies the identification requirement.
 */

interface PlaceComponents {
  formattedAddress: string;
  streetNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelected?: (place: PlaceComponents) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  address: NominatimAddress;
}

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;
const MAX_RESULTS = 5;

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
  id,
}: Props) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Skip the next suggestion fetch — used after the user picks a suggestion
  // so the new value (which fully matches the chosen address) doesn't
  // immediately re-trigger the dropdown.
  const skipFetchRef = useRef(false);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", q);
        url.searchParams.set("format", "json");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", String(MAX_RESULTS));
        url.searchParams.set("countrycodes", "us");
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await res.json()) as NominatimResult[];
        setSuggestions(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function formatDisplay(r: NominatimResult): string {
    const a = r.address;
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.hamlet || "";
    const parts = [street, city, a.state, a.postcode].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : r.display_name;
  }

  function handlePick(r: NominatimResult) {
    const formatted = formatDisplay(r);
    skipFetchRef.current = true;
    onChange(formatted);
    setOpen(false);
    setSuggestions([]);
    if (onPlaceSelected) {
      const a = r.address;
      onPlaceSelected({
        formattedAddress: formatted,
        streetNumber: a.house_number,
        street: a.road,
        city: a.city || a.town || a.village || a.hamlet,
        state: a.state,
        zip: a.postcode,
        country: a.country_code?.toUpperCase(),
      });
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder ?? "Start typing an address…"}
        className={`${className ?? "input"} pr-9`}
        autoComplete="off"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-500">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
      </span>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto text-sm">
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button
                type="button"
                onClick={() => handlePick(s)}
                className="w-full text-left px-3 py-2 hover:bg-brand-50 hover:text-brand-700 transition-colors"
              >
                {formatDisplay(s)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
