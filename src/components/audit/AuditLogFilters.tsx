"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  KNOWN_AUDIT_ACTIONS,
  KNOWN_AUDIT_TARGET_TYPES,
  type AuditLogFilters as Filters,
} from '@/lib/audit-log-queries';

const SEARCH_DEBOUNCE_MS = 300;
const ALL_VALUE = '__all__';

export interface AuditLogFiltersProps {
  filters: Filters;
  onFilterChange: (next: Filters) => void;
  className?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

/**
 * Filter bar for the Audit Log page. Mirrors `FacetedFilterBar` in look —
 * sticky surface-2 strip, debounced search, immediate-apply dropdowns.
 *
 * The action and target-type dropdowns are populated from the
 * `KNOWN_AUDIT_*` constants in `audit-log-queries.ts`. Unknown actions still
 * surface in the list itself — users just can't narrow by them from the
 * dropdown until the constant is extended.
 */
export function AuditLogFilters({ filters, onFilterChange, className }: AuditLogFiltersProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const lastEmittedSearch = useRef(filters.search ?? '');

  useEffect(() => {
    if (debouncedSearch === lastEmittedSearch.current) return;
    lastEmittedSearch.current = debouncedSearch;
    onFilterChange({ ...filters, search: debouncedSearch || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if ((filters.search ?? '') !== searchInput && (filters.search ?? '') !== debouncedSearch) {
      setSearchInput(filters.search ?? '');
      lastEmittedSearch.current = filters.search ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const setSelectField = useCallback(
    (key: 'action' | 'targetType', value: string) => {
      const next: Filters = { ...filters };
      if (value === ALL_VALUE) {
        delete next[key];
      } else {
        next[key] = value;
      }
      onFilterChange(next);
    },
    [filters, onFilterChange],
  );

  const setTextField = useCallback(
    (key: 'actorUserId' | 'from' | 'to', value: string) => {
      const next: Filters = { ...filters };
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        delete next[key];
      } else {
        next[key] = trimmed;
      }
      onFilterChange(next);
    },
    [filters, onFilterChange],
  );

  const handleClear = useCallback(() => {
    setSearchInput('');
    lastEmittedSearch.current = '';
    onFilterChange({});
  }, [onFilterChange]);

  const hasActiveFilters =
    Boolean(filters.search) ||
    Boolean(filters.actorUserId) ||
    Boolean(filters.action) ||
    Boolean(filters.targetType) ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  return (
    <div
      data-testid="audit-log-filters"
      className={`sticky top-0 z-20 surface-2 border border-border rounded-xl px-4 py-3 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="flex-1 min-w-[220px] space-y-1.5">
          <Label htmlFor="alf-search" className="text-xs text-muted-foreground">
            {t('auditLog.filter.search')}
          </Label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="alf-search"
              data-testid="alf-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('auditLog.filter.search')}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5 w-full sm:w-48">
          <Label htmlFor="alf-actor" className="text-xs text-muted-foreground">
            {t('auditLog.filter.actor')}
          </Label>
          <Input
            id="alf-actor"
            data-testid="alf-actor-input"
            value={filters.actorUserId ?? ''}
            onChange={(e) => setTextField('actorUserId', e.target.value)}
            placeholder="user-id"
          />
        </div>

        <div className="space-y-1.5 w-full sm:w-44">
          <Label className="text-xs text-muted-foreground">{t('auditLog.filter.action')}</Label>
          <Select
            value={filters.action ?? ALL_VALUE}
            onValueChange={(v) => setSelectField('action', v)}
          >
            <SelectTrigger data-testid="alf-action-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('auditLog.filter.all')}</SelectItem>
              {KNOWN_AUDIT_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-full sm:w-44">
          <Label className="text-xs text-muted-foreground">{t('auditLog.filter.target')}</Label>
          <Select
            value={filters.targetType ?? ALL_VALUE}
            onValueChange={(v) => setSelectField('targetType', v)}
          >
            <SelectTrigger data-testid="alf-target-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('auditLog.filter.all')}</SelectItem>
              {KNOWN_AUDIT_TARGET_TYPES.map((tt) => (
                <SelectItem key={tt} value={tt}>
                  {tt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alf-from" className="text-xs text-muted-foreground">
            {t('auditLog.filter.from')}
          </Label>
          <Input
            id="alf-from"
            data-testid="alf-from-input"
            type="datetime-local"
            value={filters.from ?? ''}
            onChange={(e) => setTextField('from', e.target.value)}
            className="w-44"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alf-to" className="text-xs text-muted-foreground">
            {t('auditLog.filter.to')}
          </Label>
          <Input
            id="alf-to"
            data-testid="alf-to-input"
            type="datetime-local"
            value={filters.to ?? ''}
            onChange={(e) => setTextField('to', e.target.value)}
            className="w-44"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasActiveFilters}
            data-testid="alf-clear"
            onClick={handleClear}
            className="gap-1"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
