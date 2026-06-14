'use client';

import { useEffect } from 'react';

import { usePlayerStore } from '@/lib/store';

/**
 * Detect targets where typed input should win over the hotkey listener.
 *
 * Matches the same predicate used in `CartHotkeysBridge` so the two bridges
 * stay consistent.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

/**
 * Global keyboard listener for the Live Studio screen.
 *
 * Mounted as a side-effect-only "bridge" (returns null) by the LiveStudioPage
 * shell. Mirrors the tone of `SchedulerBridge.tsx`.
 *
 * Bindings (no modifiers, to avoid Cmd+K palette collisions):
 *   Space      → togglePlay
 *   ArrowRight → next
 *   ArrowLeft  → previous
 *   J          → next
 *   K          → togglePlay
 *   L          → previous
 *   M          → toggleMute
 *
 * J/K/L semantics: J→next, K→togglePlay, L→previous. This matches the
 * keyboard layout (J is the left finger on a US layout, L the right, K in
 * the middle) and gives users a play/pause cluster with adjacent skip keys.
 * It's the *opposite* of the YouTube convention (J = back 10s, L = forward
 * 10s) — but our app doesn't have a "seek 10s" action; J/L map cleanly to
 * "previous track" / "next track" instead. Documented intent: pick one and
 * stick.
 *
 * Modifier rules:
 *   - Any modifier held (Shift/Alt/Meta/Ctrl) => ignored.
 *   - Typing into an input/textarea/select/contenteditable => ignored.
 *   - The Cmd+K command palette steals focus when open, which trips the
 *     editable-target check, so this listener never fights the palette.
 */
export function LiveStudioHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;

      const store = usePlayerStore.getState();

      // Space — togglePlay. Use the .code so localized layouts still match.
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        store.togglePlay();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        store.next();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        store.previous();
        return;
      }
      if (e.key.length === 1) {
        const key = e.key.toUpperCase();
        if (key === 'J') {
          e.preventDefault();
          store.next();
          return;
        }
        if (key === 'K') {
          e.preventDefault();
          store.togglePlay();
          return;
        }
        if (key === 'L') {
          e.preventDefault();
          store.previous();
          return;
        }
        if (key === 'M') {
          e.preventDefault();
          store.toggleMute();
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}

export default LiveStudioHotkeys;
