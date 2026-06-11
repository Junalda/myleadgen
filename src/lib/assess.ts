// Website beoordelen: eigen fetch-checks + Google PageSpeed Insights.

import type { Assessment } from "./types";

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const FETCH_TIMEOUT_MS = 12000;

/** Resultaat van de eigen, snelle HTML-check. */
interface BasicCheck {
  reachable: boolean;
  https: boolean;
  sslValid: boolean;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasViewport: boolean;
}

/**
 * Eigen fetch: HTTPS, SSL geldig, title, meta description, viewport, bereikbaar.
 * Een mislukte SSL-handshake gooit in fetch → sslValid=false.
 */
async function basicCheck(website: string): Promise<BasicCheck> {
  const check: BasicCheck = {
    reachable: false,
    https: website.toLowerCase().startsWith("https://"),
    sslValid: false,
    hasTitle: false,
    hasMetaDescription: false,
    hasViewport: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(website, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WebsiteProspector/1.0; +internal-tool)",
      },
      redirect: "follow",
    });
    check.reachable = res.ok;
    // We konden de pagina ophalen. Als de uiteindelijke URL https is, is de
    // SSL-handshake geslaagd (fetch zou anders gegooid hebben).
    check.sslValid = res.url.toLowerCase().startsWith("https://");
    if (check.sslValid) check.https = true;

    if (res.ok) {
      const html = await res.text();
      check.hasTitle = /<title[^>]*>\s*\S+/i.test(html);
      check.hasMetaDescription =
        /<meta[^>]+name=["']description["'][^>]*content=["']\s*\S+/i.test(html);
      check.hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    }
  } catch {
    // Onbereikbaar of SSL-fout: alle defaults blijven false.
  } finally {
    clearTimeout(timer);
  }

  return check;
}

interface PsiScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  ok: boolean;
}

/** Haal Lighthouse-scores op via PageSpeed Insights (strategy=mobile). */
async function psiScores(website: string): Promise<PsiScores> {
  const out: PsiScores = {
    performance: null,
    seo: null,
    accessibility: null,
    bestPractices: null,
    ok: false,
  };

  const key = process.env.GOOGLE_PSI_KEY;
  if (!key) {
    // Geen key: PSI overslaan, fallback-scoring neemt het over.
    return out;
  }

  const params = new URLSearchParams({ url: website, strategy: "mobile", key });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) {
    params.append("category", c);
  }

  // PSI is traag, maar een te ruime timeout laat één hangende call de hele
  // scan ophouden (en op Vercel de functie over de tijdslimiet duwen).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${PSI_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return out;
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: Record<string, { score: number | null }>;
      };
    };
    const cats = data.lighthouseResult?.categories;
    if (!cats) return out;

    const toScore = (s: number | null | undefined) =>
      typeof s === "number" ? Math.round(s * 100) : null;

    out.performance = toScore(cats["performance"]?.score);
    out.seo = toScore(cats["seo"]?.score);
    out.accessibility = toScore(cats["accessibility"]?.score);
    out.bestPractices = toScore(cats["best-practices"]?.score);
    out.ok =
      out.performance !== null ||
      out.seo !== null ||
      out.accessibility !== null ||
      out.bestPractices !== null;
  } catch {
    // Timeout/quota/auth: laat fallback-scoring het werk doen.
  } finally {
    clearTimeout(timer);
  }

  return out;
}

/**
 * Beoordeel een website volledig. `website` mag leeg zijn (geen website),
 * dan is dit per definitie de sterkste lead (score 0).
 */
export async function assessWebsite(website: string): Promise<Assessment> {
  // Geen website => sterkste lead.
  if (!website) {
    return {
      hasWebsite: false,
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
      totaalscore: 0,
      zwaktes: ["GEEN WEBSITE GEVONDEN"],
    };
  }

  // Eigen check en PSI parallel.
  const [basic, psi] = await Promise.all([
    basicCheck(website),
    psiScores(website),
  ]);

  const zwaktes: string[] = [];
  if (!basic.reachable) zwaktes.push("site onbereikbaar");
  if (!basic.https) zwaktes.push("geen HTTPS");
  else if (!basic.sslValid) zwaktes.push("ongeldig SSL-certificaat");
  if (!basic.hasTitle) zwaktes.push("geen paginatitel");
  if (!basic.hasMetaDescription) zwaktes.push("geen meta description");
  if (!basic.hasViewport) zwaktes.push("niet mobielvriendelijk");

  let totaalscore: number;

  if (psi.ok) {
    // Gemiddelde van de beschikbare Lighthouse-scores.
    const scores = [
      psi.performance,
      psi.seo,
      psi.accessibility,
      psi.bestPractices,
    ].filter((s): s is number => s !== null);
    totaalscore = Math.round(
      scores.reduce((a, b) => a + b, 0) / scores.length
    );

    if (psi.performance !== null && psi.performance < 50)
      zwaktes.push("trage site");
    if (psi.seo !== null && psi.seo < 70) zwaktes.push("zwakke SEO");
    if (psi.accessibility !== null && psi.accessibility < 70)
      zwaktes.push("matige toegankelijkheid");
  } else {
    // Fallback: PSI faalde → puntenaftrek voor basis-zwaktes.
    zwaktes.push("PageSpeed-score niet beschikbaar");
    let score = 100;
    if (!basic.reachable) score -= 50;
    if (!basic.https) score -= 20;
    if (!basic.sslValid) score -= 10;
    if (!basic.hasTitle) score -= 10;
    if (!basic.hasMetaDescription) score -= 10;
    if (!basic.hasViewport) score -= 20;
    totaalscore = Math.max(0, Math.min(100, score));
  }

  return {
    hasWebsite: true,
    https: basic.https,
    sslValid: basic.sslValid,
    reachable: basic.reachable,
    hasTitle: basic.hasTitle,
    hasMetaDescription: basic.hasMetaDescription,
    hasViewport: basic.hasViewport,
    performance: psi.performance,
    seo: psi.seo,
    accessibility: psi.accessibility,
    bestPractices: psi.bestPractices,
    psiOk: psi.ok,
    totaalscore,
    zwaktes,
  };
}
