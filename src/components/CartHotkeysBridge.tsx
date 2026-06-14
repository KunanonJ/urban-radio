"use client";

import { useEffect } from 'react';
import { defaultHotkeyForSlot, useCartStore } from '@/lib/cart-store';
import { usePlayerStore } from '@/lib/store';
import type { Track } from '@/lib/types';

/**
 * Build a lookup from key → slot index for the active tab.
 * Order matches `defaultHotkeyForSlot`:
 *   A-Z   → slots 0..25
 *   1..0  → slots 26..35
 *   F1-F12 → slots 36..47
 *
 * Per-tab `hotkeyMap` overrides take precedence.
 */
function buildLookup(
  slotCount: number,
  hotkeyMap: Record<number, string> | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < slotCount; i++) {
    const override = hotkeyMap?.[i];
    const key = override ?? defaultHotkeyForSlot(i);
    if (!key) continue;
    map.set(key.toUpperCase(), i);
  }
  return map;
}

function normalizeKey(e: KeyboardEvent): string | null {
  // Function keys: e.key is 'F1'..'F12'
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  // Digits: 0-9 (top row) — code path Digit0..Digit9 gives consistent value even with shift.
  if (e.code && /^Digit[0-9]$/.test(e.code)) return e.code.replace('Digit', '');
  // Letters: use e.key (single char) — uppercased.
  if (e.key.length === 1) {
    const upper = e.key.toUpperCase();
    if (/^[A-Z]$/.test(upper)) return upper;
  }
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

/**
 * Optional audition handler: a hook (or test) can register a custom preview function via
 * `window.__cartAuditionHandler`. Falls back to a no-op + dev console when missing.
 */
type AuditionHandler = (track: Track) => void;
const AUDITION_HANDLER_KEY = '__cartAuditionHandler' as const;
type AuditionWindow = Window & { [AUDITION_HANDLER_KEY]?: AuditionHandler };

function fireSlot(slotIndex: number) {
  const cart = useCartStore.getState();
  const tab = cart.tabs.find((t) => t.id === cart.activeTabId) ?? cart.tabs[0];
  if (!tab) return;
  const track = tab.slots[slotIndex];
  if (!track) return;
  if (cart.auditionMode) {
    if (typeof window !== 'undefined') {
      const handler = (window as AuditionWindow)[AUDITION_HANDLER_KEY];
      if (typeof handler === 'function') {
        handler(track);
        return;
      }
    }
    // Fallback: still send to player so the action is observable.
    usePlayerStore.getState().play(track);
    return;
  }
  usePlayerStore.getState().play(track);
}

/**
 * Global keyboard listener for the cart wall.
 *
 * Mapping (default): A–Z → slots 0..25, 1..0 → slots 26..35, F1–F12 → slots 36..47.
 * Per-tab overrides are honored via `tab.hotkeyMap`.
 *
 * Modifier rules:
 *  - Shift / Alt / Meta / Ctrl held => ignored (avoid collisions with other shortcuts and capitalization).
 *  - Typing into an input/textarea/select/contenteditable => ignored.
 */
export function CartHotkeysBridge() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;

      const key = normalizeKey(e);
      if (!key) return;

      const cart = useCartStore.getState();
      const tab = cart.tabs.find((t) => t.id === cart.activeTabId) ?? cart.tabs[0];
      if (!tab) return;
      const lookup = buildLookup(tab.slots.length, tab.hotkeyMap);
      const slotIndex = lookup.get(key);
      if (slotIndex === undefined) return;
      e.preventDefault();
      fireSlot(slotIndex);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}

export default CartHotkeysBridge;
