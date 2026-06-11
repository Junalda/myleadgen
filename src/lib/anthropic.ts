// Claude-stap: beoordeel of een lead benaderbaar is en schrijf een
// LinkedIn-openingsbericht. Draait server-side; de key blijft server-side.
//
// Belangrijk: dit is een RUWE inschatting op basis van beperkte scan-data.
// Claude doet hier geen live-onderzoek; behandel de output als concept.

import Anthropic from "@anthropic-ai/sdk";
import type { Enrichment, EnrichInput } from "./types";

// De gebruiker koos expliciet voor het nieuwste Sonnet-model.
const MODEL = "claude-sonnet-4-6";

/** Fout met een betekenisvolle boodschap (ontbrekende key, quota/auth). */
export class AnthropicConfigError extends Error {}

/** Fatale fout die de hele enrich-run zou moeten stoppen (key/auth/permissie). */
export class AnthropicFatalError extends Error {}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicConfigError(
      "ANTHROPIC_API_KEY ontbreekt. Zet hem in .env.local (zie console.anthropic.com)."
    );
  }
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

/** Geeft true als de Anthropic-key server-side is ingesteld. */
export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// System-prompt: letterlijk overgenomen uit de opdracht.
const SYSTEM_PROMPT = `Je bent een sales-assistent voor een Nederlands webbureau (Webmaister) dat premium websites + groeistrategie verkoopt voor ~€2.700 aan kleine, zelfstandige dienstverleners. De ideale klant is een ZELFSTANDIG bedrijf van grofweg 3-30 medewerkers met groeiambitie en betaalbereidheid — niet een eenpitter (te klein voor de prijs) en niet een groot concern of onderdeel van een keten (onbereikbaar / heeft eigen marketing). Sterke koopsignalen: betaalt al voor leads (bv. Werkspot), recent opgericht/in groei, zwakke of verouderde website terwijl het bedrijf gevestigd oogt. Referentieklant om te noemen: NursiTree (boom/groen voor gemeenten).

Beoordeel op basis van de aangeleverde data of dit een benaderbare lead is. Wees eerlijk en conservatief: als de data wijst op een eenpitter, een concern, of een bedrijf zonder zichtbaar koopsignaal, zet benaderbaar op false en leg uit waarom. Je kunt omvang NIET zeker weten uit deze data — geef dat aan in 'twijfels'.

Schrijf als het benaderbaar is een kort, warm, niet-pusherig LinkedIn-openingsbericht in het Nederlands. Het bericht moet: persoonlijk openen met iets concreets over dit bedrijf, NursiTree als referentie noemen, inspelen op groei (niet op 'je site is lelijk'), en eindigen met een laagdrempelige vraag om een kort gesprek. Geen prijs noemen. Geen overdreven verkooptaal.

Antwoord UITSLUITEND met JSON in dit formaat, geen tekst eromheen:
{"benaderbaar": true/false, "reden": "korte uitleg", "twijfels": "wat de gebruiker zelf moet checken", "bericht": "het openingsbericht, of leeg als niet benaderbaar"}`;

/** Bouw de leesbare bedrijfsdata waarop Claude zijn oordeel baseert. */
function buildUserMessage(b: EnrichInput): string {
  const lines = [
    `Naam: ${b.name}`,
    `Website: ${b.website || "GEEN WEBSITE"}`,
    `Website-totaalscore (0-100, lager = zwakker): ${
      b.totaalscore === null ? "onbekend" : b.totaalscore
    }`,
    `Zwaktes website: ${b.zwaktes.length ? b.zwaktes.join(", ") : "geen"}`,
    `Telefoon: ${b.phone || "onbekend"}`,
    `E-mail: ${b.email || "onbekend"}`,
    `Aantal Google-reviews: ${
      b.userRatingsTotal === null ? "onbekend" : b.userRatingsTotal
    }`,
    `Adres/plaats: ${b.address || "onbekend"}`,
    `LinkedIn-zoeklink: ${b.linkedinUrl}`,
  ];
  return lines.join("\n");
}

/**
 * Haal veilig JSON uit het modelantwoord: strip eventuele ```json fences en
 * pak het eerste JSON-object. Gooit bij mislukking (aanroeper vangt het af).
 */
function parseJson(text: string): Enrichment {
  let cleaned = text.trim();
  // Strip ```json ... ``` of ``` ... ``` fences.
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Val terug op het eerste { ... } blok als er nog tekst omheen staat.
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }
  const obj = JSON.parse(cleaned) as Partial<Enrichment>;
  return {
    benaderbaar: !!obj.benaderbaar,
    reden: typeof obj.reden === "string" ? obj.reden : "",
    twijfels: typeof obj.twijfels === "string" ? obj.twijfels : "",
    bericht: typeof obj.bericht === "string" ? obj.bericht : "",
  };
}

/**
 * Verrijk één lead via Claude. Gooit AnthropicFatalError bij key-/auth-/
 * permissiefouten (de hele run moet dan stoppen). Andere fouten (parse,
 * transient) worden door de aanroeper als "kon niet verwerken" gemarkeerd.
 */
export async function enrichLead(input: EnrichInput): Promise<Enrichment> {
  const anthropic = getClient();

  let response;
  try {
    // Geen extended thinking: de taak is goed afgebakend en we draaien dit
    // per bedrijf, dus we houden latency en kosten laag. max_tokens ruim
    // genoeg voor een bericht.
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
    });
  } catch (err) {
    // Auth/permissie/ontbrekende key zijn fataal voor de hele run.
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    ) {
      throw new AnthropicFatalError(
        `Anthropic-fout (${err.status}): controleer je ANTHROPIC_API_KEY. ${err.message}`
      );
    }
    // Overige API-fouten (rate limit na retries, server) → per bedrijf falen.
    const msg = err instanceof Error ? err.message : "onbekende API-fout";
    throw new Error(msg);
  }

  // Tekst uit de content-blokken halen.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseJson(text);
}
