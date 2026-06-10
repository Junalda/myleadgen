// Contactgegevens van een website schrapen (server-side).
// Google levert geen e-mail; we zoeken mailto-links + e-mailadressen via regex
// op de homepage, en vallen terug op de contactpagina.

import type { ContactInfo } from "./types";

// E-mail regex (bewust simpel maar effectief).
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Extensies die wijzen op afbeeldings-/asset-"mails" (bv. sprite@2x.png).
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ico)$/i;

const FETCH_TIMEOUT_MS = 12000;
const MAX_EMAILS = 3;

/** Fetch met timeout en browserachtige headers. */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WebsiteProspector/1.0; +internal-tool)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html") && !ctype.includes("text/")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Haal e-mailadressen uit HTML: eerst mailto-links, dan losse tekst-mails. */
function extractEmails(html: string): string[] {
  const found = new Set<string>();

  // mailto-links hebben voorrang (meest betrouwbaar).
  const mailtoRe = /mailto:([^"'?>\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) {
    found.add(decodeURIComponent(m[1]).trim().toLowerCase());
  }

  // Losse e-mailadressen in de tekst.
  const matches = html.match(EMAIL_RE) ?? [];
  for (const raw of matches) {
    found.add(raw.trim().toLowerCase());
  }

  // Filter afbeeldings-/asset-"mails" en duidelijke nep-adressen weg.
  const cleaned = [...found].filter((e) => {
    if (IMAGE_EXT_RE.test(e)) return false;
    if (e.includes("example.com") || e.startsWith("@")) return false;
    if (e.includes("..")) return false;
    return true;
  });

  return cleaned.slice(0, MAX_EMAILS);
}

/** Zoek een link naar de contactpagina in de HTML. */
function findContactLink(html: string, baseUrl: string): string | null {
  // <a href="...">...contact...</a> — match href waar tekst of href "contact" bevat.
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").toLowerCase();
    if (/contact/i.test(href) || /contact/.test(text)) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        // ongeldige href negeren
      }
    }
  }
  return null;
}

/**
 * Schraap contactgegevens van een website.
 * Stap 1: homepage. Stap 2 (als geen mail): contactpagina.
 */
export async function scrapeContact(website: string): Promise<ContactInfo> {
  const result: ContactInfo = { emails: [], contactPage: null };
  if (!website) return result;

  const home = await fetchText(website);
  if (home) {
    result.emails = extractEmails(home);
    result.contactPage = findContactLink(home, website);
  }

  // Geen mail gevonden? Probeer de contactpagina.
  if (result.emails.length === 0 && result.contactPage) {
    const contactHtml = await fetchText(result.contactPage);
    if (contactHtml) {
      result.emails = extractEmails(contactHtml);
    }
  }

  return result;
}
