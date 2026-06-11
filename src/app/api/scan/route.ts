// POST /api/scan — voert de volledige pipeline uit en streamt resultaten als
// Server-Sent Events, zodat de frontend bedrijven één voor één ziet binnenkomen.

import type { NextRequest } from "next/server";
import { findBusinesses, GoogleApiError } from "@/lib/places";
import { scrapeContact } from "@/lib/scrape";
import { assessWebsite } from "@/lib/assess";
import type { Business, LeadResult, ScanEvent } from "@/lib/types";

// PageSpeed kan traag zijn; geef de route ruim de tijd (Node runtime).
export const runtime = "nodejs";
export const maxDuration = 300;

const CONCURRENCY = 5; // max bedrijven tegelijk beoordelen

interface ScanBody {
  stad?: string;
  branche?: string;
  max?: number;
  maxScore?: number | null;
}

export async function POST(req: NextRequest) {
  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ongeldige JSON-body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stad = (body.stad ?? "").trim();
  const branche = (body.branche ?? "").trim();
  const max = Math.min(Math.max(Number(body.max) || 20, 1), 60);
  // maxScore wordt client-side toegepast (zie frontend), niet meer server-side.

  if (!stad || !branche) {
    return new Response(
      JSON.stringify({ error: "Vul zowel stad als branche in." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Helper: stuur één SSE-event.
      const send = (event: ScanEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        // Stap 1: bedrijven vinden via Google Places.
        const businesses = await findBusinesses(stad, branche, max);
        send({ type: "total", total: businesses.length });

        if (businesses.length === 0) {
          send({ type: "done" });
          controller.close();
          return;
        }

        // Fase 1: stuur elke lead METEEN door met de contactgegevens van
        // Google. Zo verschijnen de leads binnen seconden — ook als PageSpeed
        // traag is of (op Vercel) de functie voortijdig wordt afgekapt. De
        // websitebeoordeling volgt in fase 2 als losse update-events.
        for (const b of businesses) {
          send({
            type: "result",
            result: { ...b, emails: [], contactPage: null, assessment: null },
          });
        }

        let done = 0;

        // Fase 2: per bedrijf contact schrapen + website beoordelen, daarna een
        // update-event sturen dat de bestaande rij verrijkt.
        const enrich = async (b: Business) => {
          let emails: string[] = [];
          let contactPage: string | null = null;
          let assessment;
          try {
            const [contact, result] = await Promise.all([
              scrapeContact(b.website),
              assessWebsite(b.website),
            ]);
            emails = contact.emails;
            contactPage = contact.contactPage;
            assessment = result;
          } catch {
            // Beoordeling mislukt: markeer het bedrijf, maar laat de lead staan.
            assessment = {
              hasWebsite: !!b.website,
              https: false,
              sslValid: false,
              reachable: false,
              hasTitle: false,
              hasMetaDescription: false,
              hasViewport: false,
              performance: null,
              seo: null,
              accessibility: null,
              bestPractices: null,
              psiOk: false,
              totaalscore: b.website ? 100 : 0,
              zwaktes: b.website
                ? ["beoordeling mislukt"]
                : ["GEEN WEBSITE GEVONDEN"],
            };
          }

          done++;
          // De maxScore-filter wordt client-side toegepast, zodat een lead nooit
          // halverwege de scan stilletjes verdwijnt voordat hij beoordeeld is.
          send({ type: "update", placeId: b.placeId, emails, contactPage, assessment });
          send({ type: "progress", done, total: businesses.length });
        };

        // Eenvoudige concurrency-pool: maximaal CONCURRENCY tegelijk.
        const queue = [...businesses];
        const workers: Promise<void>[] = [];
        for (let i = 0; i < CONCURRENCY; i++) {
          workers.push(
            (async () => {
              while (queue.length > 0) {
                const next = queue.shift();
                if (!next) break;
                await enrich(next);
              }
            })()
          );
        }
        await Promise.all(workers);

        send({ type: "done" });
        controller.close();
      } catch (err) {
        // Fatale fout (bv. ontbrekende key, quota/auth) — meld duidelijk.
        const message =
          err instanceof GoogleApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Onbekende fout tijdens de scan.";
        send({ type: "error", message, fatal: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
