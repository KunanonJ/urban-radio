"use client";

import { useCallback, useRef } from 'react';
import Image from 'next/image';
import { Trash2 } from 'lucide-react';
import type { Track } from '@/lib/types';
import type { CartTileState } from '@/lib/cart-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface CartTileProps {
  /** Slot index this tile represents (0-based within its tab). */
  slotIndex: number;
  /** Track assigned, or null for empty slot. */
  track: Track | null;
  /** Display label for the hotkey, or null when none. */
  hotkey?: string | null;
  /** Visual state. */
  state?: CartTileState;
  /** Click handler — short-press fire. */
  onClick?: () => void;
  /** Long-press handler — used to assign / open menu in higher-level components. */
  onLongPress?: () => void;
  /** Optional clear-slot handler shown when a track is present. */
  onClear?: () => void;
  /** Accessible label override. */
  label?: string;
}

const LONG_PRESS_MS = 500;

function visualClassForState(state: CartTileState): string {
  switch (state) {
    case 'armed':
      return 'ring-2 ring-primary animate-pulse';
    case 'playing':
      return 'ring-2 ring-primary bg-primary/10';
    case 'held':
      return 'ring-2 ring-amber-500';
    case 'ducked':
      return 'opacity-60';
    case 'idle':
    default:
      return '';
  }
}

export function CartTile({
  slotIndex,
  track,
  hotkey = null,
  state = 'idle',
  onClick,
  onLongPress,
  onClear,
  label,
}: CartTileProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    longPressFiredRef.current = false;
    if (!onLongPress) return;
    cancelTimer();
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }, [onLongPress, cancelTimer]);

  const handlePointerUp = useCallback(() => {
    cancelTimer();
  }, [cancelTimer]);

  const handlePointerLeave = useCallback(() => {
    cancelTimer();
  }, [cancelTimer]);

  const handleClick = useCallback(() => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onClick?.();
  }, [onClick]);

  const ariaLabel =
    label ??
    (track ? `Play ${track.title}` : `Empty cart slot ${slotIndex + 1}`);

  return (
    <div
      className={cn(
        'surface-2 group relative flex h-full min-h-[96px] flex-col items-stretch gap-2 overflow-hidden rounded-xl border border-border/70 p-0 transition-all hover:border-primary/60',
        visualClassForState(state),
      )}
      data-state={state}
    >
      <button
        type="button"
        data-testid={`cart-tile-${slotIndex}`}
        data-slot-index={slotIndex}
        data-state={state}
        aria-label={ariaLabel}
        className={cn(
          'flex h-full w-full flex-col items-stretch gap-2 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          track ? 'cursor-pointer' : 'cursor-default text-muted-foreground',
        )}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            data-testid={`cart-tile-${slotIndex}-hotkey`}
            className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {hotkey ?? `#${slotIndex + 1}`}
          </span>
          {/* placeholder where clear button will overlay (kept for layout balance) */}
          <span aria-hidden className="h-6 w-6" />
        </div>
        {track ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Image
              src={track.artwork}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground" data-testid={`cart-tile-${slotIndex}-title`}>
                {track.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/80">
            <span data-testid={`cart-tile-${slotIndex}-empty`}>—</span>
          </div>
        )}
      </button>
      {track && onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100"
          aria-label={`Clear slot ${slotIndex + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}

export default CartTile;
