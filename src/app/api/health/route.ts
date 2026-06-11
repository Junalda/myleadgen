// GET /api/health — meldt of de server-side API-keys aanwezig zijn.
// Geeft ALLEEN booleans + een veilige key-vorm terug, nooit de keys zelf,
// zodat de frontend bij het laden een duidelijke melding kan tonen.

import { anthropicKeyFormat } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    placesKey: !!process.env.GOOGLE_PLACES_KEY,
    psiKey: !!process.env.GOOGLE_PSI_KEY,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    // Veilige diagnose (geen keytekens): missing | placeholder |
    // unexpected_prefix | ok.
    anthropicKeyFormat: anthropicKeyFormat(),
  });
}
