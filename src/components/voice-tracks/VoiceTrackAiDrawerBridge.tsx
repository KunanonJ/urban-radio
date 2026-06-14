"use client";

import { useEffect, useState } from "react";
import { VoiceTrackAiDrawer } from "./VoiceTrackAiDrawer";

/**
 * Global bridge for the AI voice-track drawer.
 *
 * Listens for a `open-vt-ai-drawer` `CustomEvent` on `window` and opens the
 * drawer when one arrives. This decouples the drawer's open state from the
 * Voice Tracks page so any other surface (Live Studio quick-VT panel,
 * Command Palette, etc.) can open it via:
 *
 *     window.dispatchEvent(new CustomEvent('open-vt-ai-drawer'));
 *
 * The bridge is mounted once in `AppChrome` so it persists across route
 * changes.
 */
export const OPEN_VT_AI_DRAWER_EVENT = "open-vt-ai-drawer" as const;

export function VoiceTrackAiDrawerBridge() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_VT_AI_DRAWER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VT_AI_DRAWER_EVENT, onOpen);
  }, []);

  return <VoiceTrackAiDrawer open={open} onOpenChange={setOpen} />;
}

export default VoiceTrackAiDrawerBridge;
