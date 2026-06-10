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

const CONCURRENCY = 3; // max bedrijven tegelijk verwerken

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
  const maxScore =
    body.maxScore === null || body.maxScore === undefined
      ? null
      : Number(body.maxScore);

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

        let done = 0;

        // Verwerk één bedrijf: schrapen + beoordelen, dan event sturen.
        const process = async (b: Business) => {
          let result: LeadResult;
          try {
            // Contact schrapen + website beoordelen parallel.
            const [contact, assessment] = await Promise.all([
              scrapeContact(b.website),
              assessWebsite(b.website),
            ]);
            result = {
              ...b,
              emails: contact.emails,
              contactPage: contact.contactPage,
              assessment,
            };
          } catch {
            // Markeer het bedrijf als mislukt, maar ga door met de scan.
            result = {
              ...b,
              emails: [],
              contactPage: null,
              assessment: {
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
              },
            };
          }

          done++;
          // Pas de maxScore-filter server-side toe (no-website = score 0 = haalt
          // de filter altijd). Voortgang telt álle beoordeelde bedrijven.
          const passesFilter =
            maxScore === null ||
            Number.isNaN(maxScore) ||
            result.assessment.totaalscore <= maxScore;
          if (passesFilter) send({ type: "result", result });
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
                await process(next);
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
