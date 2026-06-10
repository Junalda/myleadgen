"use client";

import { useMemo, useState } from "react";
import type { LeadResult, ScanEvent } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";

// ---------------------------------------------------------------------------
// Sorteer-configuratie
// ---------------------------------------------------------------------------
type SortDir = "asc" | "desc";
type SortKey =
  | "name"
  | "totaalscore"
  | "rating"
  | "performance"
  | "seo"
  | "accessibility";

interface ColumnDef {
  key: SortKey;
  label: string;
}

const SORTABLE_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Naam" },
  { key: "totaalscore", label: "Totaalscore" },
  { key: "rating", label: "Google-rating" },
  { key: "performance", label: "Perf." },
  { key: "seo", label: "SEO" },
  { key: "accessibility", label: "Toegank." },
];

/** Haal de sorteerwaarde voor een kolom uit een lead. */
function sortValue(r: LeadResult, key: SortKey): number | string {
  switch (key) {
    case "name":
      return r.name.toLowerCase();
    case "totaalscore":
      return r.assessment.totaalscore;
    case "rating":
      return r.rating ?? -1;
    case "performance":
      return r.assessment.performance ?? -1;
    case "seo":
      return r.assessment.seo ?? -1;
    case "accessibility":
      return r.assessment.accessibility ?? -1;
  }
}

/** Kleur op basis van score: rood <50, oranje 50-70, groen >70. */
function scoreColor(score: number): string {
  if (score < 50) return "text-red-400";
  if (score <= 70) return "text-orange-400";
  return "text-green-400";
}

function scoreBadge(score: number): string {
  if (score < 50) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (score <= 70)
    return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  return "bg-green-500/15 text-green-400 border-green-500/30";
}

// ---------------------------------------------------------------------------
// Hoofdpagina
// ---------------------------------------------------------------------------
export default function Home() {
  const [stad, setStad] = useState("");
  const [branche, setBranche] = useState("");
  const [max, setMax] = useState(20);
  const [maxScore, setMaxScore] = useState<string>("");

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<LeadResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Standaard sorteren op totaalscore oplopend (zwakste site bovenaan).
  const [sortKey, setSortKey] = useState<SortKey>("totaalscore");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedResults = useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp: number;
      if (typeof va === "string" && typeof vb === "string") {
        cmp = va.localeCompare(vb, "nl");
      } else {
        cmp = (va as number) - (vb as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [results, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "asc");
    }
  }

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (scanning) return;
    setError(null);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    setScanning(true);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stad,
          branche,
          max,
          maxScore: maxScore.trim() === "" ? null : Number(maxScore),
        }),
      });

      if (!res.ok || !res.body) {
        // Niet-streaming foutpad (bv. 400 met JSON-body).
        let msg = `Scan mislukt (HTTP ${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* negeren */
        }
        setError(msg);
        setScanning(false);
        return;
      }

      // SSE-stream lezen en per event verwerken.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Events zijn gescheiden door een lege regel (\n\n).
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const json = line.slice(6);
          let event: ScanEvent;
          try {
            event = JSON.parse(json) as ScanEvent;
          } catch {
            continue;
          }
          handleEvent(event);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Onbekende fout tijdens de scan."
      );
    } finally {
      setScanning(false);
    }
  }

  function handleEvent(event: ScanEvent) {
    switch (event.type) {
      case "total":
        setProgress((p) => ({ ...p, total: event.total }));
        break;
      case "progress":
        setProgress({ done: event.done, total: event.total });
        break;
      case "result":
        setResults((prev) => [...prev, event.result]);
        break;
      case "error":
        setError(event.message);
        break;
      case "done":
        break;
    }
  }

  function handleDownload() {
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = (s: string) =>
      s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "scan";
    downloadCsv(
      sortedResults,
      `leads-${safe(branche)}-${safe(stad)}-${stamp}.csv`
    );
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Website <span className="text-accent">Prospector</span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Vind bedrijven per stad &amp; branche, beoordeel hun website en
          exporteer warme leads.
        </p>
      </header>

      {/* Formulier */}
      <form
        onSubmit={runScan}
        className="rounded-xl border border-navy-600 bg-navy-800 p-5 shadow-lg"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Stad" className="lg:col-span-1">
            <input
              type="text"
              value={stad}
              onChange={(e) => setStad(e.target.value)}
              placeholder="bv. Utrecht"
              required
              className={inputClass}
            />
          </Field>
          <Field label="Branche" className="lg:col-span-1">
            <input
              type="text"
              value={branche}
              onChange={(e) => setBranche(e.target.value)}
              placeholder="bv. tandarts"
              required
              className={inputClass}
            />
          </Field>
          <Field label="Max bedrijven">
            <input
              type="number"
              min={1}
              max={60}
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Max score (optioneel)">
            <input
              type="number"
              min={0}
              max={100}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              placeholder="bv. 70"
              className={inputClass}
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={scanning}
              className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-navy-900 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanning ? "Bezig met scannen…" : "Scannen"}
            </button>
          </div>
        </div>

        {/* Caveats */}
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          ⚠️ Google levert geen e-mailadressen; die worden van de site
          geschraapt en lukken bij ~50–70%. &nbsp;•&nbsp; &quot;Lelijk
          design&quot; wordt niet gemeten — alleen meetbare technische signalen.
          &nbsp;•&nbsp; Bedoeld voor gerichte, warme B2B-benadering, niet voor
          massale koude mail (AVG/GDPR).
        </p>
      </form>

      {/* Voortgang */}
      {scanning && (
        <div className="mt-6">
          <div className="mb-1 flex justify-between text-sm text-slate-400">
            <span>
              {progress.done} / {progress.total || "?"} beoordeeld
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-navy-700">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Foutmelding */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Resultaten */}
      {results.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {results.length} resultaten
            </h2>
            <button
              onClick={handleDownload}
              className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20"
            >
              ⬇ Download CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-navy-600">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-navy-700 text-left text-slate-300">
                <tr>
                  {SORTABLE_COLUMNS.map((col) => (
                    <SortableTh
                      key={col.key}
                      label={col.label}
                      active={sortKey === col.key}
                      dir={sortDir}
                      onClick={() => toggleSort(col.key)}
                    />
                  ))}
                  <th className="px-3 py-2 font-medium">Zwaktes</th>
                  <th className="px-3 py-2 font-medium">Website</th>
                  <th className="px-3 py-2 font-medium">E-mail</th>
                  <th className="px-3 py-2 font-medium">Telefoon</th>
                  <th className="px-3 py-2 font-medium">Contactpagina</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r) => (
                  <tr
                    key={r.placeId}
                    className="border-t border-navy-700 hover:bg-navy-700/40"
                  >
                    {/* Naam */}
                    <td className="px-3 py-2 font-medium text-white">
                      {r.name}
                    </td>
                    {/* Totaalscore */}
                    <td className="px-3 py-2">
                      {r.assessment.hasWebsite ? (
                        <span
                          className={`inline-block rounded border px-2 py-0.5 font-semibold ${scoreBadge(
                            r.assessment.totaalscore
                          )}`}
                        >
                          {r.assessment.totaalscore}
                        </span>
                      ) : (
                        <span className="inline-block rounded border border-accent/50 bg-accent/15 px-2 py-0.5 font-bold text-accent">
                          GEEN WEBSITE
                        </span>
                      )}
                    </td>
                    {/* Rating */}
                    <td className="px-3 py-2 text-slate-300">
                      {r.rating !== null ? (
                        <>
                          ★ {r.rating.toFixed(1)}
                          <span className="text-slate-500">
                            {" "}
                            ({r.userRatingsTotal ?? 0})
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    {/* Performance / SEO / Toegankelijkheid */}
                    <ScoreCell value={r.assessment.performance} />
                    <ScoreCell value={r.assessment.seo} />
                    <ScoreCell value={r.assessment.accessibility} />
                    {/* Zwaktes */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.assessment.zwaktes.map((z, i) => (
                          <span
                            key={i}
                            className="rounded bg-navy-600 px-1.5 py-0.5 text-xs text-slate-300"
                          >
                            {z}
                          </span>
                        ))}
                      </div>
                    </td>
                    {/* Website */}
                    <td className="px-3 py-2">
                      {r.website ? (
                        <a
                          href={r.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          link
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    {/* E-mail */}
                    <td className="px-3 py-2">
                      {r.emails.length > 0 ? (
                        <div className="flex flex-col">
                          {r.emails.map((m) => (
                            <a
                              key={m}
                              href={`mailto:${m}`}
                              className="text-accent hover:underline"
                            >
                              {m}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    {/* Telefoon */}
                    <td className="px-3 py-2 text-slate-300">
                      {r.phone || <span className="text-slate-600">—</span>}
                    </td>
                    {/* Contactpagina */}
                    <td className="px-3 py-2">
                      {r.contactPage ? (
                        <a
                          href={r.contactPage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          contact
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Lege staat */}
      {!scanning && results.length === 0 && !error && (
        <div className="mt-16 text-center text-slate-500">
          Vul een stad en branche in en klik op <em>Scannen</em>.
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Kleine hulpcomponenten
// ---------------------------------------------------------------------------
const inputClass =
  "w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent";

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="cursor-pointer select-none px-3 py-2 font-medium hover:text-accent"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? "text-accent" : "text-slate-600"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  if (value === null) {
    return <td className="px-3 py-2 text-slate-600">—</td>;
  }
  return (
    <td className={`px-3 py-2 font-medium ${scoreColor(value)}`}>{value}</td>
  );
}
