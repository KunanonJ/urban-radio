import { useTranslation } from 'react-i18next';
import type { SearchHit } from '@/lib/search-hits';
import { SearchHitRow } from '@/components/search/SearchHitRow';

export function SearchResultsTable({ hits }: { hits: SearchHit[] }) {
  const { t } = useTranslation();
  if (hits.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border surface-2">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{t('search.sectionAll')}</caption>
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-[11px] text-muted-foreground uppercase tracking-wider">
            <th scope="col" className="w-10 px-2 py-2.5 font-medium">
              #
            </th>
            <th scope="col" className="w-11 px-1 py-2.5 font-medium">
              <span className="sr-only">{t('search.columnArtwork')}</span>
            </th>
            <th scope="col" className="min-w-0 px-2 py-2.5 font-medium">
              {t('search.columnTitle')}
            </th>
            <th scope="col" className="hidden lg:table-cell w-[28%] px-2 py-2.5 font-medium">
              {t('search.columnAlbum')}
            </th>
            <th scope="col" className="w-14 px-2 py-2.5 font-medium text-right">
              {t('search.columnTime')}
            </th>
            <th scope="col" className="w-9 px-1 py-2.5">
              <span className="sr-only">{t('search.columnActions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {hits.map((hit, i) => (
            <SearchHitRow
              key={`${hit.kind}-${hit.kind === 'track' ? hit.track.id : hit.rule.id}`}
              hit={hit}
              index={i}
              variant="table"
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
