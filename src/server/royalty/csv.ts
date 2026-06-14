/**
 * Shared CSV helpers used by every royalty emitter.
 *
 * Ports `functions/_lib/royalty/index.ts` helpers byte-for-byte so the
 * Cloudflare and Railway stacks produce identical CSV output during the
 * dual-stack window. PRO importers (ASCAP, BMI, SoundExchange) are picky:
 *
 *  - UTF-8 BOM (`﻿`) prefix is required by some Excel-based intakes.
 *  - Line endings are CRLF per RFC 4180.
 *  - Fields are wrapped in `"..."` only when they contain `,`, `"`, CR, or LF.
 *  - Embedded `"` is doubled.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

/** UTF-8 Byte Order Mark. Required by some PRO importers. */
export const BOM = '﻿';
export const CRLF = '\r\n';

const NEEDS_QUOTE_RE = /[",\r\n]/;

/**
 * Pentest M-11: CSV injection escape. Excel / LibreOffice / Numbers all
 * interpret cells starting with `=`, `+`, `-`, `@` (and some treat leading
 * `\t` / `\r`) as formulas — so a track title like
 * `=HYPERLINK("https://evil.example", "click")` becomes an active link when
 * a PRO opens the export.
 *
 * Neutralize by prefixing such values with a leading apostrophe. Excel
 * suppresses the apostrophe on display while treating the cell as text.
 * The leading character forces the value to be quoted (the apostrophe
 * doesn't match `NEEDS_QUOTE_RE`, but the resulting string still has the
 * formula-triggering character at position 1 and Excel only interprets
 * formulas when a cell BEGINS with one of these characters).
 *
 * Per OWASP CSV injection guidance.
 */
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Defuse leading formula characters BEFORE deciding on quoting so the
  // apostrophe lives inside the quoted segment when one is needed.
  if (FORMULA_TRIGGER_RE.test(str)) {
    str = `'${str}`;
  }
  if (!NEEDS_QUOTE_RE.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function csvRow(
  cells: ReadonlyArray<string | number | null | undefined>,
): string {
  return cells.map(csvEscape).join(',');
}

/**
 * Build a complete CSV string from a header row + data rows, prepended with
 * a UTF-8 BOM and terminated with CRLF.
 */
export function buildCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines: string[] = [csvRow(header)];
  for (const row of rows) lines.push(csvRow(row));
  return BOM + lines.join(CRLF) + CRLF;
}

/**
 * Format an ISO 8601 instant as `YYYY-MM-DD` in UTC. Invalid input → ''.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format an ISO 8601 instant as `HH:MM:SS` in UTC. Invalid input → ''. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Convert `duration_played_ms` to whole seconds, rounded. null / non-finite
 * → '' (blank cell rather than NaN).
 */
export function formatDurationSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  if (!Number.isFinite(ms)) return '';
  return Math.round(ms / 1000).toString();
}
