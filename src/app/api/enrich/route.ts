// POST /api/enrich — laat Claude per bedrijf een benaderbaarheid-inschatting +
// conceptbericht maken. Streamt resultaten als Server-Sent Events.

import type { NextRequest } from "next/server";
import {
  enrichLead,
  hasAnthropicKey,
  AnthropicConfigError,
  AnthropicFatalError,
} from "@/lib/anthropic";
import type { EnrichEvent, EnrichInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONCURRENCY = 3; // niet te veel parallelle Claude-calls tegelijk

interface EnrichBody {
  businesses?: EnrichInput[];
}

export async function POST(req: NextRequest) {
  let body: EnrichBody;
  try {
    body = (await req.json()) as EnrichBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ongeldige JSON-body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const businesses = Array.isArray(body.businesses) ? body.businesses : [];
  if (businesses.length === 0) {
    return new Response(
      JSON.stringify({ error: "Geen bedrijven om te verwerken." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Vroege, duidelijke fout als de key ontbreekt (scheelt mislukte calls).
  if (!hasAnthropicKey()) {
    return new Response(
      JSON.stringify({
        error:
          "ANTHROPIC_API_KEY ontbreekt. Zet hem in .env.local (zie console.anthropic.com).",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: EnrichEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      send({ type: "total", total: businesses.length });

      let done = 0;
      let fatal = false;

      const process = async (b: EnrichInput) => {
        if (fatal) return;
        try {
          const enrichment = await enrichLead(b);
          send({ type: "result", placeId: b.placeId, enrichment });
        } catch (err) {
          if (
            err instanceof AnthropicFatalError ||
            err instanceof AnthropicConfigError
          ) {
            // Key/auth/permissie: hele run stoppen met een nette melding.
            if (!fatal) {
              fatal = true;
              send({ type: "error", message: err.message, fatal: true });
            }
            return;
          }
          // Eén bedrijf mislukt → markeren en doorgaan.
          send({
            type: "result",
            placeId: b.placeId,
            enrichment: {
              benaderbaar: false,
              reden: "",
              twijfels: "",
              bericht: "",
              error: "kon niet verwerken",
            },
          });
        } finally {
          done++;
          send({ type: "progress", done, total: businesses.length });
        }
      };

      // Concurrency-pool.
      const queue = [...businesses];
      const workers: Promise<void>[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(
          (async () => {
            while (queue.length > 0 && !fatal) {
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
