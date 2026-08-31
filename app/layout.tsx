import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import SessionTabGuard from "@/components/auth/SessionTabGuard";
import { LoginSplash } from "@/components/splash/LoginSplash";
import { getServerLocale, getTextOverrides } from "@/lib/i18n/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

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
  const [locale, overrides, cookieStore] = await Promise.all([
    getServerLocale(),
    getTextOverrides(),
    cookies(),
  ]);

  // Authentication state for SessionTabGuard, resolved on the SERVER from the
  // cookie the browser already sent. No client-side "am I logged in?" fetch on
  // every render, and no DB hit either — verifySessionToken only checks the
  // HMAC and the expiry.
  //
  // Imported from lib/auth/session (Edge-safe, dependency-light) rather than
  // lib/auth, so the root layout does not pull the Drizzle client into its
  // module graph just to read a boolean.
  const isAuthenticated =
    (await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) !== null;

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
          {/*
            Per-tab session guard. Mounted at the ROOT so it covers every
            protected page in one place (/admin, /teacher, /student,
            /dashboard) without each shell having to remember to include it.

            On /login and the other public routes isAuthenticated is false and
            the component returns null before touching anything — which is also
            what keeps a restored tab from ping-ponging: the page it is sent to
            never re-arms the guard.
          */}
          <SessionTabGuard isAuthenticated={isAuthenticated} />
        </LanguageProvider>
      </body>
    </html>
  );
}
