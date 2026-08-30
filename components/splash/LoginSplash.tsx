// Server-side half of the post-login splash.
//
// Its whole job is to decide, ON THE SERVER, whether this particular request is
// the first render after a successful login — and if so, put the overlay into
// the INITIAL HTML.
//
// That is the reason this is a Server Component and not a hook inside
// DashboardShell. A client component could only read the flag after hydration,
// which means the browser paints the dashboard first and the splash slams over
// the top of it a moment later. Deciding here means the overlay is in the first
// byte of markup: no flash of the page it is supposed to be covering.
//
// It also does not block anything. The root layout streams this shell
// immediately while the page below it is still resolving its data, so the two
// seconds are spent absorbing that latency rather than adding to it.

import { cookies } from "next/headers";
import { getT } from "@/lib/i18n/server";
import { SPLASH_COOKIE } from "./constants";
import { SplashOverlay } from "./SplashOverlay";

export async function LoginSplash() {
  const store = await cookies();
  // Set by loginAction immediately after setSession(). Absent on every other
  // request, so navigation and refresh render nothing at all here.
  if (store.get(SPLASH_COOKIE)?.value !== "1") return null;

  const t = await getT();

  return (
    <SplashOverlay
      collegeName={t("common.collegeName")}
      loadingLabel={t("splash.loading")}
    />
  );
}
