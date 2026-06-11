// CSV-export van leadresultaten. UTF-8 BOM zodat Excel NL-tekens goed toont.

import type { LeadResult } from "./types";

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
];

/** Bouw een CSV-string uit de huidige (gefilterde/gesorteerde) resultaten. */
export function buildCsv(rows: LeadResult[]): string {
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
      ].join(",")
    );
  }

  // BOM vooraan voor correcte weergave in Excel.
  return "﻿" + lines.join("\r\n");
}

/** Trigger een download van de CSV in de browser. */
export function downloadCsv(rows: LeadResult[], filename: string): void {
  const csv = buildCsv(rows);
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
