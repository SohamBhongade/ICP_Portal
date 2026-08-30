"use client";

// The visible splash. Rendered only when LoginSplash (server) has seen the
// one-shot flag, so this component's mere presence means "a login just
// happened" — it never has to decide that for itself.
//
// It owns three things:
//   1. CONSUMING the flag, immediately on mount. Deleting the cookie before the
//      animation finishes means a refresh mid-splash does not replay it.
//   2. The 2s hold, then a 400ms fade, then unmounting itself so the overlay
//      cannot sit invisibly on top of the dashboard swallowing clicks.
//   3. Letting the user skip it. A splash that ignores input is an obstacle,
//      not a flourish.
//
// It does NOT gate rendering of anything: the dashboard is already streaming
// underneath, so the 2s is spent hiding latency rather than adding to it.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  LOGO_INTRINSIC,
  SPLASH_COOKIE,
  SPLASH_LOGO_SRC,
} from "./constants";
import styles from "./LoginSplash.module.css";

// Timings. Kept here (not in CSS) because JS owns mount/unmount; the module's
// durations mirror these two values and the pair must stay in step.
const HOLD_MS = 2000; // fully visible before the exit begins
const FADE_OUT_MS = 400; // must match .overlay's transition-duration

export function SplashOverlay({
  collegeName,
  loadingLabel,
}: {
  /** Supporting line under the logo. Passed in so copy stays with i18n. */
  collegeName: string;
  /** Screen-reader announcement while the splash is up. */
  loadingLabel: string;
}) {
  // "leaving" drives the CSS opacity transition; "done" unmounts entirely.
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);

  /** Begin the exit early (user skipped) or on schedule. */
  const dismiss = useCallback(() => setLeaving(true), []);

  // --- 1. Consume the flag, first thing. -----------------------------------
  useEffect(() => {
    // Expire the cookie with the same path it was set with, or the browser
    // keeps a second copy and the splash would replay on the next navigation.
    document.cookie = `${SPLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  }, []);

  // --- 2. Hold, then fade, then unmount. -----------------------------------
  useEffect(() => {
    const holdTimer = window.setTimeout(dismiss, HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [dismiss]);

  useEffect(() => {
    if (!leaving) return;
    const exitTimer = window.setTimeout(() => setDone(true), FADE_OUT_MS);
    return () => window.clearTimeout(exitTimer);
  }, [leaving]);

  // --- 3. Skippable. -------------------------------------------------------
  // Any key dismisses, which covers keyboard and switch-control users without
  // needing a focusable target inside a purely decorative overlay.
  useEffect(() => {
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [dismiss]);

  if (done) return null;

  return (
    <div
      className={`${styles.overlay} ${leaving ? styles.leaving : ""}`}
      onClick={dismiss}
      // Announced once, politely — it must not interrupt whatever the screen
      // reader is already saying about the dashboard loading beneath.
      role="status"
      aria-live="polite"
      aria-label={loadingLabel}
    >
      <Image
        src={SPLASH_LOGO_SRC}
        // Decorative here: the college name is already in the caption below, so
        // alt text would make a screen reader say it twice.
        alt=""
        aria-hidden="true"
        width={LOGO_INTRINSIC.width}
        height={LOGO_INTRINSIC.height}
        // The splash is the first paint after login — never lazy-load it.
        priority
        className={styles.logo}
      />

      <p className={styles.caption}>{collegeName}</p>

      {/*
        Determinate bar: it runs for a known 2s, so exposing the real ARIA
        progress semantics would imply it reflects load state, which it does
        not. It is presentational; `aria-label` on the overlay carries the
        meaning for assistive tech.
      */}
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} />
      </div>
    </div>
  );
}
