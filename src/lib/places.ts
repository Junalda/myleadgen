// Google Places: bedrijven vinden via Text Search + Place Details ophalen.
// Alles draait server-side; de key komt nooit in de frontend.

import type { Business } from "./types";

const TEXTSEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

/** Fout met betekenisvolle boodschap (ontbrekende key, quota/auth). */
export class GoogleApiError extends Error {}

function placesKey(): string {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) {
    throw new GoogleApiError(
      "GOOGLE_PLACES_KEY ontbreekt. Zet hem in .env.local."
    );
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TextSearchResponse {
  status: string;
  error_message?: string;
  next_page_token?: string;
  results: Array<{ place_id: string }>;
}

/**
 * Vind place_ids voor "{branche} in {stad}" via Text Search, met paginering
 * (next_page_token) tot we `max` resultaten hebben of geen pagina's meer zijn.
 */
async function findPlaceIds(
  stad: string,
  branche: string,
  max: number
): Promise<string[]> {
  const key = placesKey();
  const query = `${branche} in ${stad}`;
  const ids: string[] = [];
  let pageToken: string | undefined;

  // Google levert ~20 resultaten per pagina, max 3 pagina's (60 totaal).
  for (let page = 0; page < 3 && ids.length < max; page++) {
    const params = new URLSearchParams({ query, language: "nl", key });
    if (pageToken) params.set("pagetoken", pageToken);

    const res = await fetch(`${TEXTSEARCH_URL}?${params.toString()}`);
    const data = (await res.json()) as TextSearchResponse;

    if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
      throw new GoogleApiError(
        `Google Places fout: ${data.status}${
          data.error_message ? ` — ${data.error_message}` : ""
        }`
      );
    }
    if (data.status === "OVER_QUERY_LIMIT") {
      throw new GoogleApiError(
        "Google Places quota overschreden (OVER_QUERY_LIMIT)."
      );
    }

    for (const r of data.results ?? []) {
      if (ids.length >= max) break;
      ids.push(r.place_id);
    }

    if (!data.next_page_token || ids.length >= max) break;
    pageToken = data.next_page_token;
    // next_page_token wordt pas na een korte vertraging geldig.
    await sleep(2000);
  }

  return ids;
}

interface DetailsResponse {
  status: string;
  error_message?: string;
  result?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
    url?: string;
    rating?: number;
    user_ratings_total?: number;
  };
}

/** Haal Place Details op voor één place_id. */
async function getDetails(placeId: string): Promise<Business | null> {
  const key = placesKey();
  const params = new URLSearchParams({
    place_id: placeId,
    fields:
      "name,formatted_address,formatted_phone_number,website,url,rating,user_ratings_total",
    language: "nl",
    key,
  });

  const res = await fetch(`${DETAILS_URL}?${params.toString()}`);
  const data = (await res.json()) as DetailsResponse;

  if (data.status !== "OK" || !data.result) return null;

  const r = data.result;
  return {
    placeId,
    name: r.name ?? "(onbekend)",
    address: r.formatted_address ?? "",
    phone: r.formatted_phone_number ?? "",
    website: r.website ?? "",
    googleUrl: r.url ?? "",
    rating: typeof r.rating === "number" ? r.rating : null,
    userRatingsTotal:
      typeof r.user_ratings_total === "number" ? r.user_ratings_total : null,
  };
}

/**
 * Volledige Places-stap: vind bedrijven en haal hun details op.
 * Geeft een lijst Business-objecten terug (max `max` lang).
 */
export async function findBusinesses(
  stad: string,
  branche: string,
  max: number
): Promise<Business[]> {
  const ids = await findPlaceIds(stad, branche, max);
  const businesses: Business[] = [];

  // Details serieel ophalen — Places Details is snel en zo blijven we
  // onder de rate limits.
  for (const id of ids) {
    try {
      const b = await getDetails(id);
      if (b) businesses.push(b);
    } catch {
      // Eén mislukte detail-call mag de scan niet stoppen.
    }
  }

  return businesses;
}
