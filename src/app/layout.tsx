import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Joogle Docs — Collaborative Document Editor",
  description:
    "Lightweight collaborative document editor. Zero-dependency rich text, local persistence, and identity-context sharing flows.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
