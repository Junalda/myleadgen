"use client";

// Route-level error boundary: als er onverhoopt een render-/runtime-fout
// optreedt, tonen we een nette melding met herstelknop i.p.v. een lege pagina.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log naar de console zodat de oorzaak zichtbaar is in F12 → Console.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-white">Er ging iets mis</h1>
      <p className="mt-3 text-slate-400">
        Er trad een onverwachte fout op bij het laden van de pagina. De details
        staan in de browserconsole (F12 → Console).
      </p>
      {error?.message && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-left text-xs text-red-300">
          {error.message}
        </pre>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-accent px-4 py-2 font-semibold text-navy-900 transition hover:bg-accent-hover"
      >
        Opnieuw proberen
      </button>
    </main>
  );
}
