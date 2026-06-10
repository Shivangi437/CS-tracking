import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AutoSync } from "@/components/AutoSync";
import { HealthBanner } from "@/components/HealthBanner";
import { getLastSyncedAt } from "@/lib/queries";
import { getSyncHealth } from "@/lib/health";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CS Performance Tracker",
  description: "BookLeaf customer support — per-executive performance",
};

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/month", label: "Month" },
  { href: "/agents", label: "Executives" },
  { href: "/escalations", label: "Escalations" },
  { href: "/summaries", label: "Summaries" },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read once on the server so AutoSync can decide whether the dashboard's
  // numbers are stale enough to trigger a background sync. Health drives the
  // top-of-page banner; both swallow errors so a DB hiccup never breaks the chrome.
  const [lastSyncedAt, health] = await Promise.all([
    getLastSyncedAt().catch(() => null),
    getSyncHealth().catch((): null => null),
  ]);
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {health ? <HealthBanner health={health} /> : null}
        <header className="border-b border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
            <div className="flex items-center gap-6">
              <Link
                href="/today"
                className="text-sm font-semibold tracking-tight"
              >
                CS Performance
              </Link>
              <nav className="flex items-center gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <span className="text-xs text-[var(--subtle)]">
              BookLeaf · IST
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
          {children}
        </main>
        <AutoSync
          lastSyncedAt={lastSyncedAt ? lastSyncedAt.toISOString() : null}
        />
      </body>
    </html>
  );
}
