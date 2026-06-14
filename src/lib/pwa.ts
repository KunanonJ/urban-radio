/**
 * PWA helpers.
 *
 * Pure functions and types for service-worker registration and install
 * prompt handling. Components consume these to keep side-effecting boundaries
 * thin and testable.
 */

/** Subset of `process.env` we care about, kept narrow so callers can mock easily. */
export interface PwaEnv {
  NODE_ENV?: string;
}

/**
 * Returns true when a service worker should be registered.
 *
 * Conditions:
 *  - NODE_ENV must be "production" — we never register in dev or test.
 *  - We must be on the client (window defined).
 *  - The browser must expose `navigator.serviceWorker`.
 */
export function shouldRegisterSW(env: PwaEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;
  return "serviceWorker" in navigator;
}

/**
 * The `beforeinstallprompt` event. Not part of the standard DOM types in
 * lib.dom yet, so we model the slice we use.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** LocalStorage key used to suppress the install banner after a dismiss. */
export const PWA_DISMISSED_STORAGE_KEY = "sonic-bloom:pwa-install-dismissed";

/**
 * Returns true when the user has previously dismissed the install banner.
 * Safe to call on the server (returns false when window is undefined).
 */
export function hasDismissedInstallPrompt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PWA_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the user's dismissal of the install banner. */
export function rememberInstallPromptDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Storage may be unavailable (private mode, quota); failing silently
    // means we re-prompt next session — acceptable for a non-critical hint.
  }
}
