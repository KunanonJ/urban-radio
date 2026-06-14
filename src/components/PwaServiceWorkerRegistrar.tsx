"use client";

import { useEffect } from "react";
import { shouldRegisterSW } from "@/lib/pwa";

/**
 * Headless client component that registers /sw.js once on mount.
 *
 * - Skipped in dev/test (NODE_ENV !== "production") and on the server.
 * - Logs registration errors via console.error; never throws.
 * - Renders nothing.
 */
export function PwaServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (!shouldRegisterSW()) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);
  return null;
}
