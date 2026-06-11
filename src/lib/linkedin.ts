// Bouwt per bedrijf een Google-zoeklink gericht op LinkedIn. We scrapen of
// bevragen LinkedIn NIET — dit is puur een slimme zoekopdracht die de gebruiker
// zelf met één klik opent (het bedrijfsprofiel staat dan vrijwel altijd bovenaan).

import type { Business } from "./types";

/** Probeer de plaatsnaam uit een formatted_address te halen (best effort). */
function cityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  // Laatste deel is meestal het land; sla bekende landnamen over.
  let idx = parts.length - 1;
  if (/^(nederland|netherlands|nl|belgië|belgie|belgium)$/i.test(parts[idx])) {
    idx -= 1;
  }
  if (idx < 0) return null;

  // Strip een NL-postcode (bv. "1234 AB ") vóór de plaatsnaam.
  const city = parts[idx].replace(/^\d{4}\s?[A-Za-z]{2}\s+/, "").trim();
  return city || null;
}

/**
 * Bouw een Google-zoek-URL die naar het LinkedIn-profiel van het bedrijf wijst.
 * Formaat: `"{naam}" {stad} site:linkedin.com`, volledig URL-encoded.
 * `fallbackCity` (bv. de gezochte stad) wordt gebruikt als het adres geen
 * plaatsnaam oplevert.
 */
export function linkedinSearchUrl(b: Business, fallbackCity?: string): string {
  const city = cityFromAddress(b.address) ?? (fallbackCity ?? "").trim();
  const query = `"${b.name}" ${city} site:linkedin.com`
    .replace(/\s+/g, " ")
    .trim();
  return "https://www.google.com/search?q=" + encodeURIComponent(query);
}
