"use client";

// Vangnet voor fouten in de root-layout zelf (anders zou de pagina volledig
// leeg blijven). Moet een eigen <html>/<body> renderen.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="nl">
      <body
        style={{
          background: "#0a1628",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          padding: "4rem 1rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff" }}>
          Er ging iets mis
        </h1>
        <p style={{ marginTop: "0.75rem", color: "#94a3b8" }}>
          Er trad een onverwachte fout op. Details staan in de browserconsole
          (F12 → Console).
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            background: "#06b6d4",
            color: "#0a1628",
            fontWeight: 600,
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            cursor: "pointer",
          }}
        >
          Opnieuw proberen
        </button>
      </body>
    </html>
  );
}
