"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
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
import type { TrackQueryFilters } from '@/lib/catalog-queries';

const SEARCH_DEBOUNCE_MS = 300;

export interface CategoryOption {
  id: string;
  label: string;
}

export interface FacetedFilterBarProps {
  filters: TrackQueryFilters;
  onFilterChange: (next: TrackQueryFilters) => void;
  categories?: CategoryOption[];
  fileTypes?: string[];
  /** Visible track count, surfaced beside the search input. */
  totalCount?: number;
  className?: string;
}

/** Hook: debounce primitive value updates, returning the most recent value
 *  after `delay`ms of inactivity. Local-only — no external deps so we don't
 *  pull lodash into the bundle. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

const DEFAULT_FILE_TYPES = ['mp3', 'wav', 'flac', 'aac', 'ogg'];

const ALL_CATEGORIES_VALUE = '__all__';
const ALL_FILE_TYPES_VALUE = '__all__';

export function FacetedFilterBar({
  filters,
  onFilterChange,
  categories,
  fileTypes = DEFAULT_FILE_TYPES,
  totalCount,
  className,
}: FacetedFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);

  // Track the most recent debounced value the parent saw, so we don't emit a
  // duplicate change when the parent re-renders with the same filters.
  const lastEmittedSearch = useRef(filters.search ?? '');

  useEffect(() => {
    if (debouncedSearch === lastEmittedSearch.current) return;
    lastEmittedSearch.current = debouncedSearch;
    onFilterChange({ ...filters, search: debouncedSearch || undefined });
    // We intentionally exclude `filters` and `onFilterChange` from deps. The
    // search field owns its own debounced lifecycle; the other dimensions
    // (category, fileType, bpm) emit synchronously below and don't need to
    // re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Keep local search input in sync if parent resets filters externally.
  useEffect(() => {
    if ((filters.search ?? '') !== searchInput && (filters.search ?? '') !== debouncedSearch) {
      setSearchInput(filters.search ?? '');
      lastEmittedSearch.current = filters.search ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const handleCategoryChange = useCallback(
    (value: string) => {
      const next: TrackQueryFilters = { ...filters };
      if (value === ALL_CATEGORIES_VALUE) delete next.category;
      else next.category = value;
      onFilterChange(next);
    },
    [filters, onFilterChange],
  );

  const handleFileTypeChange = useCallback(
    (value: string) => {
      const next: TrackQueryFilters = { ...filters };
      if (value === ALL_FILE_TYPES_VALUE) delete next.fileType;
      else next.fileType = value;
      onFilterChange(next);
    },
    [filters, onFilterChange],
  );

  const handleBpmChange = useCallback(
    (which: 'min' | 'max', raw: string) => {
      const next: TrackQueryFilters = { ...filters };
      const parsed = raw.trim() === '' ? undefined : Number(raw);
      const key = which === 'min' ? 'minBpm' : 'maxBpm';
      if (parsed === undefined || !Number.isFinite(parsed)) {
        delete next[key];
      } else {
        next[key] = parsed;
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
    Boolean(filters.category) ||
    Boolean(filters.fileType) ||
    typeof filters.minBpm === 'number' ||
    typeof filters.maxBpm === 'number';

  return (
    <div
      data-testid="faceted-filter-bar"
      className={`sticky top-0 z-20 surface-2 border border-border rounded-xl px-4 py-3 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="flex-1 min-w-[220px] space-y-1.5">
          <Label htmlFor="ffb-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="ffb-search"
              data-testid="ffb-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title, artist, or album"
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5 w-full sm:w-44">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select
            value={filters.category ?? ALL_CATEGORIES_VALUE}
            onValueChange={handleCategoryChange}
          >
            <SelectTrigger data-testid="ffb-category-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES_VALUE}>All categories</SelectItem>
              {(categories ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-full sm:w-36">
          <Label className="text-xs text-muted-foreground">File type</Label>
          <Select
            value={filters.fileType ?? ALL_FILE_TYPES_VALUE}
            onValueChange={handleFileTypeChange}
          >
            <SelectTrigger data-testid="ffb-filetype-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILE_TYPES_VALUE}>Any file type</SelectItem>
              {fileTypes.map((ft) => (
                <SelectItem key={ft} value={ft}>
                  {ft.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">BPM range</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              data-testid="ffb-bpm-min"
              inputMode="numeric"
              value={typeof filters.minBpm === 'number' ? filters.minBpm : ''}
              onChange={(e) => handleBpmChange('min', e.target.value)}
              placeholder="Min"
              className="w-20"
              aria-label="Minimum BPM"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="number"
              data-testid="ffb-bpm-max"
              inputMode="numeric"
              value={typeof filters.maxBpm === 'number' ? filters.maxBpm : ''}
              onChange={(e) => handleBpmChange('max', e.target.value)}
              placeholder="Max"
              className="w-20"
              aria-label="Maximum BPM"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {typeof totalCount === 'number' && (
            <span className="text-xs text-muted-foreground">
              {totalCount.toLocaleString()} tracks
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasActiveFilters}
            data-testid="ffb-clear"
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
