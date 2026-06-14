"use client";

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Disc3, Keyboard } from 'lucide-react';
import {
  MAX_GRID,
  MIN_GRID,
  type CartTab,
  type CartTileState,
  useCartStore,
} from '@/lib/cart-store';
import { useMergedTracks } from '@/lib/library';
import { usePlayerStore } from '@/lib/store';
import type { Track } from '@/lib/types';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { CartTabBar } from '@/components/cart/CartTabBar';
import { CartGrid } from '@/components/cart/CartGrid';

function gridSizeOptions() {
  const dims: number[] = [];
  for (let n = MIN_GRID; n <= MAX_GRID; n++) dims.push(n);
  return dims;
}

function getActiveTab(tabs: CartTab[], activeTabId: string): CartTab | undefined {
  return tabs.find((t) => t.id === activeTabId) ?? tabs[0];
}

export default function CartPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const tabs = useCartStore((s) => s.tabs);
  const activeTabId = useCartStore((s) => s.activeTabId);
  const auditionMode = useCartStore((s) => s.auditionMode);
  const setActiveTab = useCartStore((s) => s.setActiveTab);
  const addTab = useCartStore((s) => s.addTab);
  const removeTab = useCartStore((s) => s.removeTab);
  const renameTab = useCartStore((s) => s.renameTab);
  const resizeTab = useCartStore((s) => s.resizeTab);
  const setAuditionMode = useCartStore((s) => s.setAuditionMode);
  const setSlot = useCartStore((s) => s.setSlot);
  const clearSlot = useCartStore((s) => s.clearSlot);
  const play = usePlayerStore((s) => s.play);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const allTracks = useMergedTracks();
  const byId = useMemo(() => {
    const m = new Map<string, Track>();
    for (const tr of allTracks) m.set(tr.id, tr);
    return m;
  }, [allTracks]);

  const activeTab = getActiveTab(tabs, activeTabId);
  const [assignSlotIndex, setAssignSlotIndex] = useState<number | null>(null);

  const slotStates: Record<number, CartTileState> = useMemo(() => {
    if (!activeTab || !currentTrack) return {};
    const states: Record<number, CartTileState> = {};
    for (let i = 0; i < activeTab.slots.length; i++) {
      const tr = activeTab.slots[i];
      if (tr && tr.id === currentTrack.id) {
        states[i] = isPlaying ? 'playing' : 'armed';
      }
    }
    return states;
  }, [activeTab, currentTrack, isPlaying]);

  const handleSlotClick = useCallback(
    (slotIndex: number) => {
      if (!activeTab) return;
      const track = activeTab.slots[slotIndex];
      if (track) {
        if (auditionMode) {
          // Audition: still call play for now (preview pipeline can intercept later via the audition handler).
          play(track);
        } else {
          play(track);
        }
        return;
      }
      // Empty slot → open assign menu.
      setAssignSlotIndex(slotIndex);
    },
    [activeTab, auditionMode, play],
  );

  const handleSlotLongPress = useCallback((slotIndex: number) => {
    setAssignSlotIndex(slotIndex);
  }, []);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (!activeTab) return;
      resizeTab(activeTab.id, cols, rows);
    },
    [activeTab, resizeTab],
  );

  const handleAssign = useCallback(
    (trackId: string) => {
      if (assignSlotIndex === null) return;
      const track = byId.get(trackId);
      setSlot(assignSlotIndex, track ?? null);
      setAssignSlotIndex(null);
    },
    [assignSlotIndex, byId, setSlot],
  );

  const isEverythingEmpty = useMemo(
    () => tabs.every((tab) => tab.slots.every((s) => s === null)),
    [tabs],
  );

  const labels = {
    newTab: t('cartWall.newTab'),
    confirmCreate: t('cartWall.newTab'),
    remove: t('cartWall.deleteTab'),
    rename: t('cartWall.renameTab'),
  };

  return (
    <div className="app-page-cart space-y-4">
      <div className="flex items-center gap-3">
        <Disc3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('cartWall.title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('cartWall.subtitle')}</p>
        </div>
      </div>

      <CartTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onCreate={(name) => addTab(name, 4, 4)}
        onRename={renameTab}
        onRemove={removeTab}
        labels={labels}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-[hsl(var(--surface-2))] px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Keyboard className="h-3.5 w-3.5" />
          <span>{t('cartWall.hotkeyHint')}</span>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="cart-audition-toggle" className="text-xs">
              {t('cartWall.auditionMode')}
            </Label>
            <Switch
              id="cart-audition-toggle"
              data-testid="cart-audition-toggle"
              checked={auditionMode}
              onCheckedChange={(v) => setAuditionMode(Boolean(v))}
            />
          </div>
          {activeTab ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cart-cols" className="text-xs">
                  {t('cartWall.cols')}
                </Label>
                <Select
                  value={String(activeTab.gridCols)}
                  onValueChange={(v) => handleResize(Number(v), activeTab.gridRows)}
                >
                  <SelectTrigger id="cart-cols" data-testid="cart-cols-select" className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gridSizeOptions().map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cart-rows" className="text-xs">
                  {t('cartWall.rows')}
                </Label>
                <Select
                  value={String(activeTab.gridRows)}
                  onValueChange={(v) => handleResize(activeTab.gridCols, Number(v))}
                >
                  <SelectTrigger id="cart-rows" data-testid="cart-rows-select" className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gridSizeOptions().map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {activeTab ? (
        <CartGrid
          tab={activeTab}
          slotStates={slotStates}
          onSlotClick={handleSlotClick}
          onSlotLongPress={handleSlotLongPress}
          onSlotClear={clearSlot}
        />
      ) : null}

      {assignSlotIndex !== null ? (
        <div
          data-testid="cart-assign-panel"
          className="rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3"
        >
          <Label className="mb-2 block text-xs">
            {t('cartWall.assignSlot', {
              defaultValue: 'Assign track to slot {{n}}',
              n: assignSlotIndex + 1,
            })}
          </Label>
          <Select onValueChange={handleAssign}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder={t('cart.assignPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {allTracks.slice(0, 80).map((track) => (
                <SelectItem key={track.id} value={track.id}>
                  {track.artist} — {track.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {isEverythingEmpty ? (
        <EmptyState
          title={t('cartWall.emptyState.title')}
          description={t('cartWall.emptyState.description')}
          action={{
            label: t('cartWall.emptyState.action'),
            onClick: () => router.push('/app/tracks'),
          }}
        />
      ) : null}
    </div>
  );
}
