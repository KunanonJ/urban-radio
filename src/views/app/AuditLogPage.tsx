"use client";

import { useCallback, useMemo, useState } from 'react';
import { FileClock, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { AuditLogFilters } from '@/components/audit/AuditLogFilters';
import { AuditLogList } from '@/components/audit/AuditLogList';
import {
  useAuditLog,
  useAuditLogCsvExport,
  type AuditLogEntry,
  type AuditLogFilters as Filters,
} from '@/lib/audit-log-queries';

/**
 * Triggers a browser download for a Blob using `URL.createObjectURL`. Pulled
 * out so we can stub `URL.createObjectURL` in tests when needed and keep the
 * page component small.
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the URL once the browser dispatches the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AuditLogPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>({});

  const query = useAuditLog(filters);
  const csvMutation = useAuditLogCsvExport();

  const entries = useMemo<AuditLogEntry[]>(() => {
    const pages = query.data?.pages ?? [];
    return pages.flatMap((p) => p.entries);
  }, [query.data]);

  const handleFilterChange = useCallback((next: Filters) => {
    setFilters(next);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const handleExport = useCallback(() => {
    csvMutation.mutate(filters, {
      onSuccess: (blob) => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        triggerBlobDownload(blob, `audit-log-${stamp}.csv`);
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });
  }, [csvMutation, filters]);

  return (
    <div className="app-page space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <FileClock className="h-6 w-6 text-primary" />
            <h1
              data-testid="audit-log-title"
              className="text-3xl font-bold text-foreground"
            >
              {t('auditLog.title')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('auditLog.subtitle')}</p>
        </div>
        <Button
          type="button"
          data-testid="audit-log-export-button"
          onClick={handleExport}
          disabled={csvMutation.isPending}
        >
          <Download className="mr-1 size-4" />
          {t('auditLog.exportCsv')}
        </Button>
      </header>

      <AuditLogFilters filters={filters} onFilterChange={handleFilterChange} />

      <AuditLogList
        entries={entries}
        isLoading={query.isLoading}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}

export default AuditLogPage;
