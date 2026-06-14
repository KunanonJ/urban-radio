"use client";

import { useEffect, useState } from "react";

function getMediaMatches(query: string): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMediaMatches(query));

  useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setMatches(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

export function useIsDesktopMd() {
  return useMediaQuery("(min-width: 768px)");
}

export function useIsDesktopXl() {
  return useMediaQuery("(min-width: 1280px)");
}
