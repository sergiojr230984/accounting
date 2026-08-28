import { describe, it, expect } from "vitest";
import { rank, isStreetLevel, isFlorida, buildQuery, filterAndRank } from "../lib/geocode";

/**
 * Unit tests for the pure helpers behind /api/geocode's address-suggestion
 * ranking and filtering. These run against realistic, hand-built Nominatim-
 * shaped fixtures rather than the live Nominatim API -- there's no
 * network access to nominatim.openstreetmap.org from this environment (and
 * even where there is, a live third-party geocoder is a bad thing to depend
 * on in an automated test: flaky, rate-limited, and its exact response
 * shape isn't ours to pin down). The full GET handler itself isn't unit-
 * tested here for the same reason it never has been -- it needs a live
 * upstream call -- so this covers the actual logic that changed: which
 * results are trustworthy enough to ever offer, and how they're ordered.
 */

interface Fixture {
  lat: string;
  lon: string;
  address?: { house_number?: string; road?: string; state?: string; [k: string]: unknown };
  display_name: string;
  [key: string]: unknown;
}

// A specific, real-looking Hialeah street address.
const hialeahStreet: Fixture = {
  lat: "25.8576",
  lon: "-80.2781",
  address: { house_number: "790", road: "West 82nd Street", city: "Hialeah", state: "Florida", postcode: "33014" },
  display_name: "790 West 82nd Street, Hialeah, Florida, 33014, United States",
};

// A specific Fort Lauderdale (Broward) street address -- still Florida, but
// outside the tighter Miami-Dade/Broward SOUTH_FLORIDA_BOUNDS box... actually
// Fort Lauderdale IS inside Broward/South Florida bounds, so this should
// rank alongside Hialeah, not behind it.
const fortLauderdaleStreet: Fixture = {
  lat: "26.1224",
  lon: "-80.1373",
  address: { house_number: "100", road: "Las Olas Boulevard", city: "Fort Lauderdale", state: "Florida", postcode: "33301" },
  display_name: "100 Las Olas Boulevard, Fort Lauderdale, Florida, 33301, United States",
};

// A real Miami Beach street address.
const miamiBeachStreet: Fixture = {
  lat: "25.7907",
  lon: "-80.1300",
  address: { house_number: "1601", road: "Collins Avenue", city: "Miami Beach", state: "Florida", postcode: "33139" },
  display_name: "1601 Collins Avenue, Miami Beach, Florida, 33139, United States",
};

// An Orlando street address -- real Florida, but well outside South Florida.
const orlandoStreet: Fixture = {
  lat: "28.5421",
  lon: "-81.3790",
  address: { house_number: "1", road: "Orange Avenue", city: "Orlando", state: "Florida", postcode: "32801" },
  display_name: "1 Orange Avenue, Orlando, Florida, 32801, United States",
};

// What Nominatim actually tends to hand back for a short/incomplete query:
// a locality- or postcode-level match with no house_number/road at all.
// This is the shape that used to get saved verbatim as a customer's
// "address" and then printed on the PDF as a generic, wrong location.
const vagueMiamiLocality: Fixture = {
  lat: "25.7617",
  lon: "-80.1918",
  address: { city: "Miami", state: "Florida", postcode: "33101" },
  display_name: "Miami, Miami-Dade County, Florida, United States",
};

// A real street address, but out of state -- same house number as the
// Hialeah fixture above, to prove state alone (not just numeric luck)
// drives the ranking/filtering decision.
const outOfStateStreet: Fixture = {
  lat: "40.7484",
  lon: "-73.9857",
  address: { house_number: "790", road: "5th Avenue", city: "New York", state: "New York", postcode: "10019" },
  display_name: "790 5th Avenue, New York, New York, 10019, United States",
};

describe("isStreetLevel — filters out vague, non-address matches", () => {
  it("accepts a result with both a house_number and a road", () => {
    expect(isStreetLevel(hialeahStreet)).toBe(true);
    expect(isStreetLevel(miamiBeachStreet)).toBe(true);
    expect(isStreetLevel(fortLauderdaleStreet)).toBe(true);
  });

  it("rejects a locality/postcode-level match with no house_number or road", () => {
    // This is the exact shape that used to end up saved as a customer's
    // address and printed on the invoice PDF as a generic, wrong location.
    expect(isStreetLevel(vagueMiamiLocality)).toBe(false);
  });

  it("rejects a result missing just the house_number (road-only, e.g. the whole street)", () => {
    expect(isStreetLevel({ ...hialeahStreet, address: { road: "West 82nd Street", city: "Hialeah" } })).toBe(false);
  });

  it("rejects a result missing just the road (house_number only)", () => {
    expect(isStreetLevel({ ...hialeahStreet, address: { house_number: "790", city: "Hialeah" } })).toBe(false);
  });

  it("rejects a result with no address object at all", () => {
    expect(isStreetLevel({ lat: "0", lon: "0", display_name: "Somewhere" })).toBe(false);
  });
});

describe("isFlorida — the actual state-name check, independent of the viewbox", () => {
  it("accepts a Florida result", () => {
    expect(isFlorida(hialeahStreet)).toBe(true);
    expect(isFlorida(orlandoStreet)).toBe(true);
  });

  it("rejects an out-of-state result", () => {
    // Defense-in-depth: the route's bounded=1 viewbox is a bounding box
    // (square corners), so a sliver of Georgia/Alabama near the Florida
    // panhandle is technically inside it -- state name is the real check.
    expect(isFlorida(outOfStateStreet)).toBe(false);
  });

  it("rejects a result with no state on its address at all", () => {
    expect(isFlorida({ ...hialeahStreet, address: { house_number: "790", road: "West 82nd Street" } })).toBe(false);
  });
});

describe("rank — South Florida first, then the rest of Florida, then everything else", () => {
  it("ranks a Hialeah address ahead of an Orlando address", () => {
    expect(rank(hialeahStreet)).toBeLessThan(rank(orlandoStreet));
  });

  it("ranks a Miami Beach address the same tier as a Hialeah address (both South Florida)", () => {
    expect(rank(miamiBeachStreet)).toBe(rank(hialeahStreet));
  });

  it("ranks a Fort Lauderdale (Broward) address in the South Florida tier, not behind it", () => {
    expect(rank(fortLauderdaleStreet)).toBe(0);
  });

  it("ranks any real Florida address ahead of an out-of-state address with the identical house number", () => {
    expect(rank(hialeahStreet)).toBeLessThan(rank(outOfStateStreet));
  });

  it("ranks an out-of-Florida address last", () => {
    expect(rank(outOfStateStreet)).toBe(2);
  });
});

describe("buildQuery — nudges Nominatim toward Florida on ambiguous/partial input", () => {
  it("appends a Florida hint to a query that doesn't already name a state", () => {
    expect(buildQuery("790 West 82nd Street")).toBe("790 West 82nd Street, Florida");
  });

  it("does not append a duplicate hint when the query already says Florida", () => {
    expect(buildQuery("790 West 82nd Street, Florida")).toBe("790 West 82nd Street, Florida");
  });

  it("does not append a hint when the query already says FL (case-insensitive, word-boundary safe)", () => {
    expect(buildQuery("1601 Collins Ave, Miami Beach, FL")).toBe("1601 Collins Ave, Miami Beach, FL");
    expect(buildQuery("1601 collins ave, miami beach, fl")).toBe("1601 collins ave, miami beach, fl");
  });

  it("does not false-positive on a street name that merely contains 'fl', like 'Flagler'", () => {
    // \bfl\b requires FL to be its own word -- "Flagler" must still get the
    // Florida hint appended, since the street name alone doesn't say what
    // state it's in.
    expect(buildQuery("100 E Flagler St")).toBe("100 E Flagler St, Florida");
  });

  it("appends the hint even to a query explicitly scoped to another state (this business has no real out-of-state case; isFlorida() has the final say on what's shown, not this hint)", () => {
    expect(buildQuery("790 5th Avenue, New York, NY")).toBe("790 5th Avenue, New York, NY, Florida");
  });
});

describe("filterAndRank — the combined pass the route actually applies", () => {
  it("would surface only real street-level Florida matches, closest first, from a realistic mixed Nominatim response", () => {
    const raw = [orlandoStreet, vagueMiamiLocality, outOfStateStreet, fortLauderdaleStreet, hialeahStreet, miamiBeachStreet];

    const filtered = filterAndRank(raw, 10);

    // The vague locality match and the out-of-state match never appear.
    expect(filtered).not.toContain(vagueMiamiLocality);
    expect(filtered).not.toContain(outOfStateStreet);

    // The three South Florida results all sort ahead of Orlando (still
    // Florida, but not South Florida), in their original relative order.
    const southFloridaCount = filtered.indexOf(orlandoStreet);
    expect(southFloridaCount).toBe(3);
    expect(filtered.slice(0, 3)).toEqual([fortLauderdaleStreet, hialeahStreet, miamiBeachStreet]);
  });

  it("trims to maxResults after filtering and ranking, not before", () => {
    const raw = [orlandoStreet, vagueMiamiLocality, fortLauderdaleStreet, hialeahStreet, miamiBeachStreet];
    // Only 2 slots, but 4 real street-level matches exist -- the vague one
    // must still be dropped rather than counted against the limit, and the
    // 2 kept must be the top-ranked (South Florida) ones.
    const filtered = filterAndRank(raw, 2);
    expect(filtered).toHaveLength(2);
    expect(filtered).toEqual([fortLauderdaleStreet, hialeahStreet]);
  });
});
