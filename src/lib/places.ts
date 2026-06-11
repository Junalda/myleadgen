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

  // --- Eerste pagina ---
  // Fouten op de eerste pagina zijn wél fataal (key/quota/malformed query):
  // die wil je duidelijk gemeld zien.
  const firstParams = new URLSearchParams({ query, language: "nl", key });
  const firstRes = await fetch(`${TEXTSEARCH_URL}?${firstParams.toString()}`);
  const first = (await firstRes.json()) as TextSearchResponse;

  if (first.status === "REQUEST_DENIED" || first.status === "INVALID_REQUEST") {
    throw new GoogleApiError(
      `Google Places fout: ${first.status}${
        first.error_message ? ` — ${first.error_message}` : ""
      }`
    );
  }
  if (first.status === "OVER_QUERY_LIMIT") {
    throw new GoogleApiError(
      "Google Places quota overschreden (OVER_QUERY_LIMIT)."
    );
  }

  for (const r of first.results ?? []) {
    if (ids.length >= max) break;
    ids.push(r.place_id);
  }

  // --- Vervolgpagina's (best effort, NOOIT fataal) ---
  // next_page_token heeft tijd nodig om geldig te worden, en op veel nieuwere
  // Google-projecten werkt de legacy-paginering helemaal niet meer (blijft
  // INVALID_REQUEST geven). Dat mag de scan niet laten falen: lukt een
  // vervolgpagina niet, dan stoppen we netjes met wat we al hebben.
  let pageToken = first.next_page_token;
  for (let page = 1; page < 3 && pageToken && ids.length < max; page++) {
    const next = await fetchNextPage(pageToken, key);
    if (!next || next.status !== "OK") break; // paginering niet beschikbaar → stop
    for (const r of next.results ?? []) {
      if (ids.length >= max) break;
      ids.push(r.place_id);
    }
    pageToken = next.next_page_token;
  }

  return ids;
}

/**
 * Haal een vervolgpagina op via next_page_token, met backoff-retries omdat het
 * token soms pas na een paar seconden geldig wordt. Geeft `null` terug als het
 * na de retries nog steeds niet lukt — de aanroeper stopt dan netjes met
 * pagineren (gooit dus géén fout).
 */
async function fetchNextPage(
  token: string,
  key: string
): Promise<TextSearchResponse | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(2000 + attempt * 1000); // 2s, 3s, 4s
    const params = new URLSearchParams({ pagetoken: token, key });
    const res = await fetch(`${TEXTSEARCH_URL}?${params.toString()}`);
    const data = (await res.json()) as TextSearchResponse;
    // Token nog niet geldig → opnieuw proberen. Andere status → teruggeven.
    if (data.status !== "INVALID_REQUEST") return data;
  }
  return null;
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
