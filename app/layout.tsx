import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { LoginSplash } from "@/components/splash/LoginSplash";
import { getServerLocale, getTextOverrides } from "@/lib/i18n/server";

// Font CSS variables are named --font-sans / --font-mono so they line up with
// the @theme mapping in globals.css. The portal is English-only, so only Latin
// subsets are loaded.
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

export const metadata: Metadata = {
  title: {
    default: "ICP Portal",
    template: "%s · ICP Portal",
  },
  description:
    "Imperial College of Pharmacy, Tiroda — student & staff portal.",
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh">
        <LanguageProvider initialLocale={locale} overrides={overrides}>
          {children}
          {/*
            Post-login splash. Rendered AFTER {children} so it sits on top in
            paint order (it is also z-100), and so the page below is what the
            server streams first — the dashboard resolves its data underneath
            while the splash plays.

            Returns null on every request except the first one after a
            successful login, so this costs one cookie read otherwise.
          */}
          <LoginSplash />
        </LanguageProvider>
      </body>
    </html>
  );
}
