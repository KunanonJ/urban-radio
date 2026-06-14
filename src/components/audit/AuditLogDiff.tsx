"use client";

import { useTranslation } from 'react-i18next';

export interface AuditLogDiffProps {
  before: unknown;
  after: unknown;
  className?: string;
}

function isEmptyPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  return false;
}

function pretty(value: unknown): string {
  if (isEmptyPayload(value)) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Cyclic structures or non-serializable values — fall back to toString.
    return String(value);
  }
}

/**
 * Side-by-side viewer for the `before` and `after` payloads on a single
 * audit_log row. Pretty-prints JSON; if either side is empty we render the
 * remaining side full-width. If both sides are empty we render a small
 * "(no diff)" placeholder so the consumer doesn't have to special-case.
 *
 * Intentionally no diff library — large diff machinery is out of scope for
 * v1. The two payloads are shown verbatim so the user can spot changes by
 * eye; future work can introduce a JSON-aware diff renderer.
 */
export function AuditLogDiff({ before, after, className }: AuditLogDiffProps) {
  const { t } = useTranslation();
  const beforeText = pretty(before);
  const afterText = pretty(after);
  const bothEmpty = beforeText.length === 0 && afterText.length === 0;

  if (bothEmpty) {
    return (
      <div
        data-testid="audit-log-diff-empty"
        className={`rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground ${className ?? ''}`}
      >
        (no diff)
      </div>
    );
  }

  return (
    <div
      data-testid="audit-log-diff"
      className={`grid gap-3 md:grid-cols-2 ${className ?? ''}`}
    >
      <section className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
          {t('auditLog.diff.before')}
        </h4>
        <pre
          data-testid="audit-log-diff-before"
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-xs"
        >
          {beforeText || '—'}
        </pre>
      </section>
      <section className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          {t('auditLog.diff.after')}
        </h4>
        <pre
          data-testid="audit-log-diff-after"
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-xs"
        >
          {afterText || '—'}
        </pre>
      </section>
    </div>
  );
}
