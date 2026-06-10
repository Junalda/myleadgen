import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Website Prospector",
  description: "Interne lead-generatie tool voor het webbureau.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-navy-900 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
