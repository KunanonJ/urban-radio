"use client";

import type { CartTab, CartTileState } from '@/lib/cart-store';
import { hotkeyLabelForSlot } from '@/lib/cart-store';
import { CartTile } from '@/components/cart/CartTile';

interface CartGridProps {
  tab: CartTab;
  /** Map from slotIndex → visual state. Defaults to 'idle' when missing. */
  slotStates?: Record<number, CartTileState>;
  /** Fired when a slot is clicked (with or without a track). */
  onSlotClick?: (slotIndex: number) => void;
  /** Fired on long-press of a slot. */
  onSlotLongPress?: (slotIndex: number) => void;
  /** Fired when the user explicitly clears a slot from the tile UI. */
  onSlotClear?: (slotIndex: number) => void;
}

export function CartGrid({
  tab,
  slotStates,
  onSlotClick,
  onSlotLongPress,
  onSlotClear,
}: CartGridProps) {
  const total = tab.gridCols * tab.gridRows;
  // Reconcile slots length defensively (rehydration races, etc.).
  const slots = Array.from({ length: total }, (_, i) => tab.slots[i] ?? null);

  return (
    <div
      data-testid="cart-grid"
      data-cols={tab.gridCols}
      data-rows={tab.gridRows}
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${tab.gridCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${tab.gridRows}, minmax(0, 1fr))`,
      }}
    >
      {slots.map((track, index) => (
        <CartTile
          key={`${tab.id}-${index}`}
          slotIndex={index}
          track={track}
          hotkey={hotkeyLabelForSlot(tab, index)}
          state={slotStates?.[index] ?? 'idle'}
          onClick={onSlotClick ? () => onSlotClick(index) : undefined}
          onLongPress={onSlotLongPress ? () => onSlotLongPress(index) : undefined}
          onClear={onSlotClear ? () => onSlotClear(index) : undefined}
        />
      ))}
    </div>
  );
}

export default CartGrid;
