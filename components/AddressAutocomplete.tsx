"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

/**
 * Address input with Google Places Autocomplete.
 *
 * - Reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY at runtime. If the key isn't set
 *   (or the script fails to load) the input degrades gracefully to a plain
 *   text field — typing still works, just no suggestions.
 * - Restricts suggestions to US addresses to keep the dropdown clean.
 * - Calls onChange with the formatted address string when the user picks a
 *   suggestion (or types manually). onPlaceSelected receives the structured
 *   place components in case a caller wants city / state / zip separately.
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

// Minimal types for the Google Maps Places library — we only touch the fields
// we use, so a permissive shape keeps this file self-contained.
interface GAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface GPlace {
  formatted_address?: string;
  address_components?: GAddressComponent[];
}
interface GAutocomplete {
  addListener: (event: string, handler: () => void) => void;
  getPlace: () => GPlace;
}
interface GMapsEvent {
  clearInstanceListeners: (instance: unknown) => void;
}
interface GMaps {
  places?: {
    Autocomplete: new (
      input: HTMLInputElement,
      opts: {
        componentRestrictions?: { country: string | string[] };
        fields?: string[];
        types?: string[];
      }
    ) => GAutocomplete;
  };
  event?: GMapsEvent;
}
interface WindowWithMaps {
  google?: { maps?: GMaps };
  __cuevitaMapsLoading?: Promise<void>;
}

function getWindow(): WindowWithMaps {
  return window as unknown as WindowWithMaps;
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  const w = getWindow();
  if (w.google?.maps?.places) return Promise.resolve();
  if (w.__cuevitaMapsLoading) return w.__cuevitaMapsLoading;
  w.__cuevitaMapsLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  });
  return w.__cuevitaMapsLoading;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
  id,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const handlersRef = useRef({ onChange, onPlaceSelected });
  handlersRef.current = { onChange, onPlaceSelected };

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return; // No key — input still works, just no suggestions.

    let autocomplete: GAutocomplete | null = null;
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled) return;
        const w = getWindow();
        const places = w.google?.maps?.places;
        if (!inputRef.current || !places) return;

        autocomplete = new places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "us" },
          fields: ["formatted_address", "address_components"],
          types: ["address"],
        });

        autocomplete.addListener("place_changed", () => {
          if (!autocomplete) return;
          const place = autocomplete.getPlace();
          if (!place.formatted_address) return;

          handlersRef.current.onChange(place.formatted_address);

          if (handlersRef.current.onPlaceSelected) {
            const out: PlaceComponents = { formattedAddress: place.formatted_address };
            for (const c of place.address_components ?? []) {
              if (c.types.includes("street_number")) out.streetNumber = c.long_name;
              if (c.types.includes("route")) out.street = c.long_name;
              if (c.types.includes("locality")) out.city = c.long_name;
              else if (!out.city && c.types.includes("postal_town")) out.city = c.long_name;
              if (c.types.includes("administrative_area_level_1")) out.state = c.short_name;
              if (c.types.includes("postal_code")) out.zip = c.long_name;
              if (c.types.includes("country")) out.country = c.short_name;
            }
            handlersRef.current.onPlaceSelected(out);
          }
        });

        setEnabled(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      const w = getWindow();
      if (autocomplete && w.google?.maps?.event) {
        w.google.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          placeholder ?? (enabled ? "Start typing — pick a suggestion" : "123 Main St, City, State")
        }
        className={`${className ?? "input"} ${enabled ? "pr-9" : ""}`}
        autoComplete="off"
      />
      {enabled && (
        <MapPin className="w-4 h-4 text-brand-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}
      {failed && (
        <p className="text-xs text-amber-600 mt-1">
          Address suggestions unavailable — type manually.
        </p>
      )}
    </div>
  );
}
