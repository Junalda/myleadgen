"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  EnrichEvent,
  EnrichInput,
  LeadResult,
  ScanEvent,
} from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import { linkedinSearchUrl } from "@/lib/linkedin";

// ---------------------------------------------------------------------------
// Sorteer-configuratie
// ---------------------------------------------------------------------------
type SortDir = "asc" | "desc";
type SortKey =
  | "name"
  | "totaalscore"
  | "rating"
  | "reviews"
  | "performance"
  | "seo"
  | "accessibility"
  | "benaderbaar";

interface ColumnDef {
  key: SortKey;
  label: string;
  /** Optionele tooltip op de kolomkop. */
  title?: string;
}

const SORTABLE_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Naam" },
  { key: "totaalscore", label: "Totaalscore" },
  { key: "rating", label: "Google-rating" },
  {
    key: "reviews",
    label: "Mogelijk jong",
    title:
      "Ruwe schatting op basis van aantal reviews — geen oprichtingsdatum. Verifieer handmatig (bv. via KvK of LinkedIn) voordat je hierop afgaat.",
  },
  { key: "performance", label: "Perf." },
  { key: "seo", label: "SEO" },
  { key: "accessibility", label: "Toegank." },
  {
    key: "benaderbaar",
    label: "Benaderbaar",
    title:
      "AI-inschatting (Claude) op basis van beperkte scan-data — geen feit. Verifieer omvang/situatie zelf.",
  },
];

/** Haal de sorteerwaarde voor een kolom uit een lead. */
function sortValue(r: LeadResult, key: SortKey): number | string {
  const a = r.assessment;
  switch (key) {
    case "name":
      return r.name.toLowerCase();
    case "totaalscore":
      // Nog niet beoordeeld → sorteer onderaan (hoge waarde).
      return a ? a.totaalscore : 9999;
    case "rating":
      return r.rating ?? -1;
    case "reviews":
      // Minder reviews = mogelijk jonger → sorteer op aantal reviews.
      return r.userRatingsTotal ?? -1;
    case "performance":
      return a?.performance ?? -1;
    case "seo":
      return a?.seo ?? -1;
    case "accessibility":
      return a?.accessibility ?? -1;
    case "benaderbaar":
      // Benaderbaar bovenaan (desc): ja=2, nee=1, nog niet verwerkt=0.
      if (!r.enrichment) return 0;
      return r.enrichment.benaderbaar ? 2 : 1;
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

/**
 * RUWE leeftijds-proxy op basis van het aantal Google-reviews. Dit is GEEN
 * oprichtingsdatum — alleen een zwakke hint om op te prioriteren.
 *   < 10  → mogelijk jong/nieuw
 *   10-40 → gevestigd-ish
 *   > 40  → waarschijnlijk gevestigd
 * Bedrijven zonder reviews krijgen "geen reviews" (ook een zwak jong-signaal).
 */
function ageHint(reviews: number | null): { label: string; className: string } {
  if (reviews === null || reviews === 0)
    return {
      label: "geen reviews",
      className: "bg-accent/15 text-accent border-accent/30",
    };
  if (reviews < 10)
    return {
      label: "mogelijk jong/nieuw",
      className: "bg-accent/15 text-accent border-accent/30",
    };
  if (reviews <= 40)
    return {
      label: "gevestigd-ish",
      className: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    };
  return {
    label: "waarschijnlijk gevestigd",
    className: "bg-slate-600/15 text-slate-400 border-slate-600/30",
  };
}

// ---------------------------------------------------------------------------
// Hoofdpagina
// ---------------------------------------------------------------------------
export default function Home() {
  const [stad, setStad] = useState("");
  const [branche, setBranche] = useState("");
  const [max, setMax] = useState(20);
  const [maxScore, setMaxScore] = useState<string>("");

  // Optioneel filter: toon alleen bedrijven met < X reviews (client-side).
  const [onlyFewReviews, setOnlyFewReviews] = useState(false);
  const [fewReviewsThreshold, setFewReviewsThreshold] = useState(10);
  // Optioneel filter: toon alleen door Claude als benaderbaar beoordeelde leads.
  const [onlyBenaderbaar, setOnlyBenaderbaar] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<LeadResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Claude-verrijking (lead-filtering + berichtgeneratie).
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 });
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Status van de server-side API-keys (alleen booleans, nooit de keys zelf).
  const [keyStatus, setKeyStatus] = useState<{
    placesKey: boolean;
    psiKey: boolean;
    anthropicKey: boolean;
    anthropicKeyFormat: "missing" | "placeholder" | "unexpected_prefix" | "ok";
  } | null>(null);

  // Standaard sorteren op totaalscore oplopend (zwakste site bovenaan).
  const [sortKey, setSortKey] = useState<SortKey>("totaalscore");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Bij laden: check of de keys server-side aanwezig zijn, zodat we een
  // duidelijke melding kunnen tonen i.p.v. pas te falen bij het scannen.
  // Faalt deze check, dan laten we de UI gewoon werken (geen blokkade).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setKeyStatus({
            placesKey: !!data.placesKey,
            psiKey: !!data.psiKey,
            anthropicKey: !!data.anthropicKey,
            anthropicKeyFormat: data.anthropicKeyFormat ?? "missing",
          });
        }
      })
      .catch(() => {
        /* health-check mislukt: stil negeren, formulier blijft werken */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxScoreNum =
    maxScore.trim() === "" ? null : Number(maxScore);

  const sortedResults = useMemo(() => {
    const filtered = results.filter((r) => {
      // Optioneel: alleen bedrijven met < X reviews (geen reviews telt mee).
      if (onlyFewReviews && (r.userRatingsTotal ?? 0) >= fewReviewsThreshold)
        return false;
      // Max score-filter (client-side): nog niet-beoordeelde leads blijven
      // zichtbaar tot hun score binnen is; daarna pas verbergen indien te hoog.
      if (
        maxScoreNum !== null &&
        !Number.isNaN(maxScoreNum) &&
        r.assessment !== null &&
        r.assessment.totaalscore > maxScoreNum
      )
        return false;
      // Optioneel: alleen door Claude als benaderbaar beoordeelde leads.
      if (onlyBenaderbaar && !r.enrichment?.benaderbaar) return false;
      return true;
    });
    const copy = [...filtered];
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
  }, [
    results,
    sortKey,
    sortDir,
    onlyFewReviews,
    fewReviewsThreshold,
    maxScoreNum,
    onlyBenaderbaar,
  ]);

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
      // Browsers gooien "TypeError: Failed to fetch" als de server niet
      // bereikbaar is — vertaal dat naar iets waar je wat mee kunt.
      const raw = err instanceof Error ? err.message : "";
      const friendly = /failed to fetch|networkerror|load failed/i.test(raw)
        ? "Kon de server niet bereiken. Draait de dev-server nog? Start hem met `npm run dev` en probeer opnieuw."
        : raw || "Onbekende fout tijdens de scan.";
      setError(friendly);
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
      case "update":
        // Verrijk de bestaande rij (contact + websitebeoordeling).
        setResults((prev) =>
          prev.map((r) =>
            r.placeId === event.placeId
              ? {
                  ...r,
                  emails: event.emails,
                  contactPage: event.contactPage,
                  assessment: event.assessment,
                }
              : r
          )
        );
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
      `leads-${safe(branche)}-${safe(stad)}-${stamp}.csv`,
      stad
    );
  }

  // Roept /api/enrich aan voor de huidige (gefilterde) lijst en streamt de
  // benaderbaarheid-inschatting + conceptberichten terug.
  async function runEnrich() {
    if (enriching || sortedResults.length === 0) return;
    setEnrichError(null);
    setEnrichProgress({ done: 0, total: sortedResults.length });
    setEnriching(true);

    // Bouw de input (incl. LinkedIn-zoeklink) voor de getoonde bedrijven.
    const businesses: EnrichInput[] = sortedResults.map((r) => ({
      placeId: r.placeId,
      name: r.name,
      website: r.website,
      totaalscore: r.assessment?.totaalscore ?? null,
      zwaktes: r.assessment?.zwaktes ?? [],
      phone: r.phone,
      email: r.emails[0] ?? null,
      userRatingsTotal: r.userRatingsTotal,
      address: r.address,
      linkedinUrl: linkedinSearchUrl(r, stad),
    }));

    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businesses }),
      });

      if (!res.ok || !res.body) {
        let msg = `Verrijking mislukt (HTTP ${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* negeren */
        }
        setEnrichError(msg);
        setEnriching(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let event: EnrichEvent;
          try {
            event = JSON.parse(line.slice(6)) as EnrichEvent;
          } catch {
            continue;
          }
          handleEnrichEvent(event);
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setEnrichError(
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? "Kon de server niet bereiken. Draait de dev-server nog?"
          : raw || "Onbekende fout tijdens de verrijking."
      );
    } finally {
      setEnriching(false);
    }
  }

  function handleEnrichEvent(event: EnrichEvent) {
    switch (event.type) {
      case "total":
        setEnrichProgress((p) => ({ ...p, total: event.total }));
        break;
      case "progress":
        setEnrichProgress({ done: event.done, total: event.total });
        break;
      case "result":
        // Merge de verrijking in de bestaande rij op placeId.
        setResults((prev) =>
          prev.map((r) =>
            r.placeId === event.placeId
              ? { ...r, enrichment: event.enrichment }
              : r
          )
        );
        break;
      case "error":
        setEnrichError(event.message);
        break;
      case "done":
        break;
    }
  }

  async function copyMessage(placeId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(placeId);
      setTimeout(() => setCopiedId((c) => (c === placeId ? null : c)), 1500);
    } catch {
      /* clipboard geweigerd — stil negeren */
    }
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

      {/* Waarschuwing als de server-side API-keys ontbreken. */}
      {keyStatus && (!keyStatus.placesKey || !keyStatus.psiKey) && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-semibold">⚠️ Google API-keys ontbreken</p>
          <p className="mt-1 text-amber-200/90">
            {!keyStatus.placesKey && (
              <>
                <code className="rounded bg-navy-900 px-1">
                  GOOGLE_PLACES_KEY
                </code>{" "}
                is niet ingesteld
                {!keyStatus.psiKey ? " " : "."}
              </>
            )}
            {!keyStatus.psiKey && (
              <>
                {!keyStatus.placesKey && "en "}
                <code className="rounded bg-navy-900 px-1">
                  GOOGLE_PSI_KEY
                </code>{" "}
                is niet ingesteld.
              </>
            )}{" "}
            Zet ze in een{" "}
            <code className="rounded bg-navy-900 px-1">.env.local</code>-bestand
            in de projectmap en herstart de dev-server (
            <code className="rounded bg-navy-900 px-1">npm run dev</code>).
            Zonder Places-key kan er niet gescand worden; zonder PSI-key vallen
            de scores terug op een basis-beoordeling.
          </p>
        </div>
      )}

      {/* Info over de Anthropic-key (alleen de Claude-stap raakt dit). */}
      {keyStatus && keyStatus.anthropicKeyFormat !== "ok" && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
          <p>
            🤖 <code className="rounded bg-navy-900 px-1">ANTHROPIC_API_KEY</code>{" "}
            {keyStatus.anthropicKeyFormat === "missing" &&
              "is niet ingesteld."}
            {keyStatus.anthropicKeyFormat === "placeholder" &&
              "is nog de voorbeeld-placeholder uit .env.example — vervang hem door je echte key."}
            {keyStatus.anthropicKeyFormat === "unexpected_prefix" &&
              "begint niet met 'sk-ant-' — controleer of je de volledige, juiste key plakte (zonder quotes of spaties)."}{" "}
            Scannen werkt gewoon; &quot;Genereer berichten met Claude&quot; werkt
            pas met een geldige key in{" "}
            <code className="rounded bg-navy-900 px-1">.env.local</code> (lokaal,
            daarna dev-server herstarten) of in je Vercel Environment Variables.
            Nieuwe key:{" "}
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              console.anthropic.com
            </a>
            .
          </p>
        </div>
      )}

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
          {/* Eerlijkheids-disclaimer over de hint-signalen. */}
          <p className="mb-3 rounded-lg border border-navy-600 bg-navy-800/60 px-3 py-2 text-xs text-slate-400">
            ℹ️ Leeftijds- en B2B-inschatting zijn hulpmiddelen, geen feiten.
            Gebruik ze om te prioriteren, niet om automatisch te selecteren.
          </p>

          {/* AI-disclaimer over de Claude-stap. */}
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
            🤖 De benaderbaarheid-inschatting en het conceptbericht zijn
            AI-gegenereerd op basis van beperkte scan-data. Claude kan hier niet
            live zoeken, dus controleer omvang en situatie zelf voordat je
            verstuurt. Behandel het bericht als concept, niet als verzendklaar.
          </p>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              {sortedResults.length}
              {sortedResults.length !== results.length && (
                <span className="text-slate-500"> / {results.length}</span>
              )}{" "}
              resultaten
            </h2>

            <div className="flex flex-wrap items-center gap-4">
              {/* Filter: alleen weinig reviews (mogelijk jongere bedrijven). */}
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyFewReviews}
                  onChange={(e) => setOnlyFewReviews(e.target.checked)}
                  className="h-4 w-4 accent-[#06b6d4]"
                />
                Toon alleen bedrijven met &lt;
                <input
                  type="number"
                  min={1}
                  value={fewReviewsThreshold}
                  onChange={(e) =>
                    setFewReviewsThreshold(Math.max(1, Number(e.target.value)))
                  }
                  className="w-16 rounded border border-navy-600 bg-navy-900 px-2 py-1 text-slate-100 outline-none focus:border-accent"
                />
                reviews
              </label>

              {/* Filter: alleen door Claude benaderbaar bevonden leads. */}
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyBenaderbaar}
                  onChange={(e) => setOnlyBenaderbaar(e.target.checked)}
                  className="h-4 w-4 accent-[#06b6d4]"
                />
                Alleen benaderbaar
              </label>

              <button
                onClick={runEnrich}
                disabled={enriching}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-navy-900 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enriching
                  ? "Claude denkt na…"
                  : "✨ Genereer berichten met Claude"}
              </button>

              <button
                onClick={handleDownload}
                className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20"
              >
                ⬇ Download CSV
              </button>
            </div>
          </div>

          {/* Voortgang van de Claude-verrijking. */}
          {enriching && (
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-sm text-slate-400">
                <span>
                  {enrichProgress.done} / {enrichProgress.total || "?"}{" "}
                  verwerkt door Claude
                </span>
                <span>
                  {enrichProgress.total > 0
                    ? Math.round(
                        (enrichProgress.done / enrichProgress.total) * 100
                      )
                    : 0}
                  %
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-navy-700">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{
                    width: `${
                      enrichProgress.total > 0
                        ? Math.round(
                            (enrichProgress.done / enrichProgress.total) * 100
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Foutmelding van de Claude-stap. */}
          {enrichError && (
            <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {enrichError}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-navy-600">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-navy-700 text-left text-slate-300">
                <tr>
                  {SORTABLE_COLUMNS.map((col) => (
                    <SortableTh
                      key={col.key}
                      label={col.label}
                      title={col.title}
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
                  <th className="px-3 py-2 font-medium">LinkedIn</th>
                  <th className="px-3 py-2 font-medium">Let op</th>
                  <th className="px-3 py-2 font-medium">Conceptbericht</th>
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
                      {r.assessment === null ? (
                        <span className="inline-block animate-pulse whitespace-nowrap rounded border border-navy-600 bg-navy-700 px-2 py-0.5 text-xs text-slate-400">
                          ⏳ beoordelen…
                        </span>
                      ) : r.assessment.hasWebsite ? (
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
                    {/* Mogelijk jong (ruwe proxy o.b.v. aantal reviews) */}
                    <td className="px-3 py-2">
                      {(() => {
                        const hint = ageHint(r.userRatingsTotal);
                        return (
                          <span
                            title={`${
                              r.userRatingsTotal ?? 0
                            } reviews — ruwe schatting, geen oprichtingsdatum`}
                            className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${hint.className}`}
                          >
                            {hint.label}
                          </span>
                        );
                      })()}
                    </td>
                    {/* Performance / SEO / Toegankelijkheid */}
                    <ScoreCell value={r.assessment?.performance ?? null} />
                    <ScoreCell value={r.assessment?.seo ?? null} />
                    <ScoreCell value={r.assessment?.accessibility ?? null} />
                    {/* Benaderbaar (AI-inschatting via Claude) */}
                    <td className="px-3 py-2">
                      {r.enrichment === undefined || r.enrichment === null ? (
                        <span className="text-slate-600">—</span>
                      ) : r.enrichment.error ? (
                        <span className="whitespace-nowrap text-xs text-red-400">
                          mislukt
                        </span>
                      ) : r.enrichment.benaderbaar ? (
                        <span className="inline-block whitespace-nowrap rounded border border-green-500/30 bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">
                          ✓ ja
                        </span>
                      ) : (
                        <span className="inline-block whitespace-nowrap rounded border border-slate-500/30 bg-slate-500/15 px-2 py-0.5 text-xs text-slate-400">
                          nee
                        </span>
                      )}
                    </td>
                    {/* Zwaktes */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(r.assessment?.zwaktes ?? []).map((z, i) => (
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
                    {/* LinkedIn — Google-zoeklink (geen scraping) */}
                    <td className="px-3 py-2">
                      <a
                        href={linkedinSearchUrl(r, stad)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Zoek dit bedrijf op LinkedIn via Google"
                        className="text-accent hover:underline"
                      >
                        🔍 zoek
                      </a>
                    </td>
                    {/* Let op (twijfels van Claude) */}
                    <td className="px-3 py-2 align-top text-xs text-slate-400">
                      {r.enrichment?.error ? (
                        <span className="text-red-400">kon niet verwerken</span>
                      ) : r.enrichment?.twijfels ? (
                        <span className="block max-w-[18rem]">
                          {r.enrichment.twijfels}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    {/* Conceptbericht + kopieerknop */}
                    <td className="px-3 py-2 align-top">
                      {r.enrichment && !r.enrichment.error ? (
                        r.enrichment.bericht ? (
                          <div className="max-w-[24rem]">
                            <p className="mb-1 whitespace-pre-wrap text-xs text-slate-300">
                              {r.enrichment.bericht}
                            </p>
                            <button
                              onClick={() =>
                                copyMessage(r.placeId, r.enrichment!.bericht)
                              }
                              className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent transition hover:bg-accent/20"
                            >
                              {copiedId === r.placeId
                                ? "✓ gekopieerd"
                                : "Kopieer"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs italic text-slate-500">
                            {r.enrichment.reden || "geen bericht"}
                          </span>
                        )
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
  title,
  active,
  dir,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
      className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-accent ${
        title ? "underline decoration-dotted underline-offset-4" : ""
      }`}
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
