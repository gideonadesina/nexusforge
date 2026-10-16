import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexusForge",
  description:
    "Evidence-backed organizational intelligence. Trace how a change propagates " +
    "through connected systems, inspect the source records behind every finding, " +
    "and review controlled actions. Powered by FalkorDB.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
