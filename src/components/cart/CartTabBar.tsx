"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { CartTab } from '@/lib/cart-store';
import { MAX_TABS } from '@/lib/cart-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface CartTabBarProps {
  tabs: CartTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** Labels (passed in to avoid coupling this component to i18n directly). */
  labels?: {
    newTab?: string;
    confirmCreate?: string;
    cancel?: string;
    remove?: string;
    rename?: string;
  };
}

export function CartTabBar({
  tabs,
  activeTabId,
  onSelect,
  onCreate,
  onRename,
  onRemove,
  labels,
}: CartTabBarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const newInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const t = useCallback(
    (key: keyof NonNullable<CartTabBarProps['labels']>, fallback: string) =>
      labels?.[key] ?? fallback,
    [labels],
  );

  useEffect(() => {
    if (creating) newInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renameId) renameInputRef.current?.focus();
  }, [renameId]);

  const handleCreateSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = newName.trim();
      if (trimmed.length === 0) return;
      onCreate(trimmed);
      setNewName('');
      setCreating(false);
    },
    [newName, onCreate],
  );

  const handleRenameCommit = useCallback(() => {
    if (!renameId) return;
    const trimmed = renameValue.trim();
    if (trimmed.length > 0) {
      onRename(renameId, trimmed);
    }
    setRenameId(null);
    setRenameValue('');
  }, [renameId, renameValue, onRename]);

  const startRename = useCallback((tab: CartTab) => {
    setRenameId(tab.id);
    setRenameValue(tab.name);
  }, []);

  const canAdd = tabs.length < MAX_TABS;

  return (
    <div
      data-testid="cart-tab-bar"
      className="flex flex-wrap items-center gap-1 border-b border-border/60 pb-2"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const isRenaming = renameId === tab.id;
        return (
          <div
            key={tab.id}
            data-testid={`cart-tab-${tab.id}`}
            data-active={active ? 'true' : 'false'}
            className={cn(
              'group flex items-center gap-1 rounded-md border px-2 py-1 text-sm',
              active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {isRenaming ? (
              <input
                ref={renameInputRef}
                data-testid="cart-tab-rename-input"
                className="bg-transparent text-sm outline-none"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRenameCommit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameId(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                data-testid={`cart-tab-button-${tab.id}`}
                className="cursor-pointer truncate font-medium"
                onClick={() => onSelect(tab.id)}
                onDoubleClick={() => startRename(tab)}
              >
                {tab.name}
              </button>
            )}
            {tabs.length > 1 && !isRenaming ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                aria-label={`${t('remove', 'Remove')} ${tab.name}`}
                onClick={() => onRemove(tab.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        );
      })}

      {creating ? (
        <form
          data-testid="cart-tab-create-form"
          className="flex items-center gap-1 rounded-md border border-primary px-2 py-1"
          onSubmit={handleCreateSubmit}
        >
          <input
            ref={newInputRef}
            data-testid="cart-tab-create-input"
            className="w-32 bg-transparent text-sm outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('newTab', 'New tab')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setNewName('');
                setCreating(false);
              }
            }}
          />
          <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs">
            {t('confirmCreate', 'Add')}
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          data-testid="cart-tab-add-button"
          onClick={() => setCreating(true)}
          disabled={!canAdd}
          aria-label={t('newTab', 'New tab')}
        >
          <Plus className="mr-1 h-3 w-3" />
          {t('newTab', 'New tab')}
        </Button>
      )}
    </div>
  );
}

export default CartTabBar;
