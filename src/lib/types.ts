// Gedeelde types voor de business/result objecten.

/** Basisgegevens van een bedrijf zoals geleverd door Google Places. */
export interface Business {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  /** Website-URL (lege string als Google er geen kent). */
  website: string;
  /** Google Maps link naar het bedrijf. */
  googleUrl: string;
  rating: number | null;
  userRatingsTotal: number | null;
}

/** Resultaat van het schrapen van contactgegevens van de website. */
export interface ContactInfo {
  emails: string[];
  contactPage: string | null;
}

/** Uitgebreide beoordeling van de website. */
export interface Assessment {
  /** Heeft de site een website om te beoordelen? */
  hasWebsite: boolean;
  https: boolean;
  sslValid: boolean;
  reachable: boolean;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  /** viewport-meta aanwezig => mobiel-responsief signaal. */
  hasViewport: boolean;
  // Lighthouse-scores (0-100) of null als PSI faalde.
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  /** Of de PageSpeed Insights call gelukt is. */
  psiOk: boolean;
  /** Totaalscore 0-100 (lager = zwakkere site = betere lead). */
  totaalscore: number;
  /** Leesbare lijst met zwaktes. */
  zwaktes: string[];
}

/** Het volledige lead-resultaat dat naar de frontend gaat. */
export interface LeadResult extends Business {
  emails: string[];
  contactPage: string | null;
  /** null = website wordt nog beoordeeld (komt later via een update-event). */
  assessment: Assessment | null;
  /** AI-verrijking (Claude); undefined zolang niet aangevraagd. */
  enrichment?: Enrichment | null;
}

/** Server-Sent-Events die de scan-route naar de frontend streamt. */
export type ScanEvent =
  | { type: "total"; total: number }
  | { type: "progress"; done: number; total: number }
  // Lead verschijnt direct (Places-data); assessment kan nog null zijn.
  | { type: "result"; result: LeadResult }
  // Verrijking achteraf: contact + websitebeoordeling per bedrijf.
  | {
      type: "update";
      placeId: string;
      emails: string[];
      contactPage: string | null;
      assessment: Assessment;
    }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "done" };

/**
 * AI-gegenereerde inschatting + conceptbericht per bedrijf (via Claude).
 * RUW: gebaseerd op beperkte scan-data, geen live-onderzoek. Behandel als hint.
 */
export interface Enrichment {
  benaderbaar: boolean;
  reden: string;
  twijfels: string;
  bericht: string;
  /** Gezet als het bedrijf niet verwerkt kon worden (parse-/API-fout). */
  error?: string;
}

/** Input die de frontend per bedrijf naar /api/enrich stuurt. */
export interface EnrichInput {
  placeId: string;
  name: string;
  website: string;
  totaalscore: number | null;
  zwaktes: string[];
  phone: string;
  email: string | null;
  userRatingsTotal: number | null;
  address: string;
  linkedinUrl: string;
}

/** Server-Sent-Events die de enrich-route naar de frontend streamt. */
export type EnrichEvent =
  | { type: "total"; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; placeId: string; enrichment: Enrichment }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "done" };
