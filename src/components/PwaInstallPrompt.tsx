"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type BeforeInstallPromptEvent,
  hasDismissedInstallPrompt,
  rememberInstallPromptDismissed,
} from "@/lib/pwa";

/**
 * PWA install banner.
 *
 * Listens for the Chromium-flavored `beforeinstallprompt` event, captures the
 * deferred prompt, and surfaces a compact banner with Install/Dismiss actions.
 * Dismissals are persisted in localStorage so we don't nag across sessions.
 */
export function PwaInstallPrompt(): JSX.Element | null {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasDismissedInstallPrompt()) return;

    const handler = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler as EventListener);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handler as EventListener,
      );
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setVisible(false);
        setDeferredPrompt(null);
      }
    } catch (error) {
      console.error("PWA install prompt failed", error);
      setVisible(false);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    rememberInstallPromptDismissed();
    setVisible(false);
    setDeferredPrompt(null);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Sonic Bloom"
      data-testid="pwa-install-prompt"
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-[hsl(var(--surface-3))] px-4 py-3 text-sm shadow-lg"
    >
      <span className="flex-1 truncate text-foreground">
        Install Sonic Bloom
      </span>
      <button
        type="button"
        data-testid="pwa-install-button"
        onClick={handleInstall}
        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Install
      </button>
      <button
        type="button"
        data-testid="pwa-dismiss-button"
        onClick={handleDismiss}
        className="inline-flex h-9 items-center rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
