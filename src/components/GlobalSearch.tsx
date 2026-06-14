'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { usePlayerStore } from '@/lib/store';
import { useMergedAlbums, useMergedTracks } from '@/lib/library';
import { useSearchResults } from '@/hooks/use-search-results';
import { SearchHitCompactRow } from '@/components/search/SearchHitRow';
import { Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const TOP_RESULTS_LIMIT = 5;

export function GlobalSearch() {
  const { t } = useTranslation();
  const { isSearchOpen, setSearchOpen } = usePlayerStore();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const mergedTracks = useMergedTracks();
  const mergedAlbums = useMergedAlbums();
  const unifiedHits = useSearchResults(query);
  const topHits = unifiedHits.slice(0, TOP_RESULTS_LIMIT);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) setQuery('');
  }, [isSearchOpen]);

  const go = (path: string) => {
    router.push(path);
    setSearchOpen(false);
  };

  const close = () => setSearchOpen(false);

  return (
    <AnimatePresence>
      {isSearchOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl surface-2 border border-border rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('globalSearch.inputPlaceholder')}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-2">
              {hasQuery && topHits.length > 0 && (
                <>
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {t('globalSearch.topResults')}
                  </p>
                  {topHits.map((hit) => (
                    <SearchHitCompactRow
                      key={`${hit.kind}-${hit.kind === 'track' ? hit.track.id : hit.rule.id}`}
                      hit={hit}
                      onPick={close}
                    />
                  ))}
                </>
              )}

              {hasQuery && topHits.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t('globalSearch.noMatches')}</p>
              )}

              {!hasQuery && (
                <>
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {t('globalSearch.quickLinks')}
                  </p>
                  {[
                    { labelKey: 'globalSearch.searchPage', path: '/app/search' },
                    { labelKey: 'globalSearch.allTracks', path: '/app/library/tracks' },
                    { labelKey: 'globalSearch.allAlbums', path: '/app/library/albums' },
                  ].map((l) => (
                    <button
                      key={l.path}
                      type="button"
                      onClick={() => go(l.path)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      {t(l.labelKey)}
                    </button>
                  ))}

                  <p className="px-3 py-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {t('globalSearch.tracks')}
                  </p>
                  {mergedTracks.slice(0, 4).map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => go(`/app/library/tracks`)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary transition-colors"
                    >
                      <Image
                        src={tr.artwork}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                        className="w-8 h-8 rounded object-cover"
                      />
                      <div className="text-left min-w-0">
                        <p className="text-sm text-foreground truncate">{tr.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{tr.artist}</p>
                      </div>
                    </button>
                  ))}

                  <p className="px-3 py-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {t('globalSearch.albums')}
                  </p>
                  {mergedAlbums.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => go(`/app/album/${a.id}`)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary transition-colors"
                    >
                      <Image
                        src={a.artwork}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                        className="w-8 h-8 rounded object-cover"
                      />
                      <div className="text-left min-w-0">
                        <p className="text-sm text-foreground truncate">{a.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{a.artist}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {hasQuery && (
                <>
                  <p className="px-3 py-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {t('globalSearch.quickLinks')}
                  </p>
                  {[
                    { labelKey: 'globalSearch.searchPage', path: '/app/search' },
                    { labelKey: 'globalSearch.spotSchedule', path: '/app/spot-schedule' },
                  ].map((l) => (
                    <button
                      key={l.path}
                      type="button"
                      onClick={() => go(l.path)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      {t(l.labelKey)}
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{t('globalSearch.footerHint')}</span>
              <kbd className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border bg-muted">
                {t('globalSearch.esc')}
              </kbd>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
