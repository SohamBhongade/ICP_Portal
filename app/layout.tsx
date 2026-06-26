import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { getServerLocale, getTextOverrides } from "@/lib/i18n/server";

// Font CSS variables are named --font-sans / --font-mono so they line up with
// the @theme mapping in globals.css. Noto Sans Devanagari (--font-devanagari)
// is appended to the body font stack so Hindi/Marathi glyphs render crisply;
// Latin text still uses Geist (browser picks the first font that has the glyph).
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ICP Portal",
    template: "%s · ICP Portal",
  },
  description:
    "Imperial College of Pharmacy, Tiroda — student, teacher & admin portal.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, overrides] = await Promise.all([
    getServerLocale(),
    getTextOverrides(),
  ]);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="min-h-dvh">
        <LanguageProvider initialLocale={locale} overrides={overrides}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
