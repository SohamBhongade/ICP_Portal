// Values shared between the three halves of the splash feature.
//
// Kept in a directive-free module on purpose: loginAction ("use server") and
// SplashOverlay ("use client") both need the cookie name, and importing it from
// either side would drag that side's module — and its bundle graph — into the
// other. A plain constants file belongs to neither and is safe for both.

/**
 * One-shot flag set by loginAction immediately after the session is issued, and
 * deleted by SplashOverlay the moment it mounts. Its presence is the ONLY thing
 * that makes the splash render, so "logged in just now" is the only state that
 * can trigger it — not a refresh, not a navigation.
 */
export const SPLASH_COOKIE = "icp_splash";

/**
 * Where the college mark lives, relative to /public.
 *
 * TO REPLACE THE LOGO: drop the new file at `public/logo.png` and update
 * LOGO_INTRINSIC below to its real pixel dimensions. Nothing else needs to
 * change — this constant is the single reference used by the splash.
 */
export const SPLASH_LOGO_SRC = "/logo.png";

/**
 * Intrinsic pixel size of that asset. next/image uses it to reserve the right
 * aspect ratio before the image loads, which is what stops the splash from
 * shifting as it decodes (CLS).
 *
 * The current asset is 200x104 (~1.9:1). If you swap in a different logo, put
 * its ACTUAL dimensions here — a wrong ratio here stretches the mark.
 */
export const LOGO_INTRINSIC = { width: 200, height: 104 } as const;
