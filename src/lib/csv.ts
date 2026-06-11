// CSV-export van leadresultaten. UTF-8 BOM zodat Excel NL-tekens goed toont.

import type { LeadResult } from "./types";
import { linkedinSearchUrl } from "./linkedin";

function escapeCell(value: string | number | null): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Velden met komma, quote of newline tussen quotes; quotes verdubbelen.
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS = [
  "Naam",
  "Totaalscore",
  "Zwaktes",
  "Website",
  "E-mail",
  "Telefoon",
  "Contactpagina",
  "Google-rating",
  "Aantal reviews",
  "Performance",
  "SEO",
  "Toegankelijkheid",
  "Best practices",
  "Adres",
  "LinkedIn (zoeklink)",
  "Benaderbaar (AI)",
  "Reden (AI)",
  "Let op (AI)",
  "Conceptbericht (AI)",
];

/** Leesbare waarde voor de "Benaderbaar"-CSV-kolom. */
function benaderbaarCell(r: LeadResult): string {
  const e = r.enrichment;
  if (!e) return "";
  if (e.error) return "mislukt";
  return e.benaderbaar ? "ja" : "nee";
}

/**
 * Bouw een CSV-string uit de huidige (gefilterde/gesorteerde) resultaten.
 * `searchCity` (de gezochte stad) dient als fallback voor de LinkedIn-zoeklink.
 */
export function buildCsv(rows: LeadResult[], searchCity?: string): string {
  const lines: string[] = [];
  lines.push(HEADERS.map(escapeCell).join(","));

  for (const r of rows) {
    // Assessment kan null zijn als de beoordeling nog niet binnen is.
    const a = r.assessment;
    lines.push(
      [
        escapeCell(r.name),
        escapeCell(a ? a.totaalscore : ""),
        escapeCell(a ? a.zwaktes.join("; ") : ""),
        escapeCell(r.website),
        escapeCell(r.emails.join("; ")),
        escapeCell(r.phone),
        escapeCell(r.contactPage),
        escapeCell(r.rating),
        escapeCell(r.userRatingsTotal),
        escapeCell(a ? a.performance : ""),
        escapeCell(a ? a.seo : ""),
        escapeCell(a ? a.accessibility : ""),
        escapeCell(a ? a.bestPractices : ""),
        escapeCell(r.address),
        escapeCell(linkedinSearchUrl(r, searchCity)),
        escapeCell(benaderbaarCell(r)),
        escapeCell(r.enrichment && !r.enrichment.error ? r.enrichment.reden : ""),
        escapeCell(
          r.enrichment && !r.enrichment.error ? r.enrichment.twijfels : ""
        ),
        escapeCell(
          r.enrichment && !r.enrichment.error ? r.enrichment.bericht : ""
        ),
      ].join(",")
    );
  }

  // BOM vooraan voor correcte weergave in Excel.
  return "﻿" + lines.join("\r\n");
}

/** Trigger een download van de CSV in de browser. */
export function downloadCsv(
  rows: LeadResult[],
  filename: string,
  searchCity?: string
): void {
  const csv = buildCsv(rows, searchCity);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
