"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-safe media query hook.
 *
 * `useSyncExternalStore` is used rather than useEffect+useState because it gives
 * React an explicit server snapshot: the server always renders the `false`
 * branch (desktop / table layout), and the client subscribes to `matchMedia`
 * before paint. A useState version would hydrate with the desktop tree and then
 * flip on the first effect, which flashes the wrong layout on phones.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && !!window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false, // server snapshot — never matches
  );
}
