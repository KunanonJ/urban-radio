'use client';

import { Badge } from '@/components/ui/badge';
import { RundownItemRow } from './rundown-item-row';
import type { RundownItem } from '@/types/rundown';

interface HourBlockProps {
  readonly hour: number;
  readonly items: readonly RundownItem[];
  readonly templateName?: string;
  readonly onReplaceItem?: (item: RundownItem) => void;
}

export function HourBlock({ hour, items, templateName, onReplaceItem }: HourBlockProps) {
  const totalDuration = items.reduce((sum, item) => sum + item.durationSec, 0);
  const overflow = totalDuration > 3600;
  const conflicts = items.flatMap((item) => item.conflictFlags);
  const hasErrors = conflicts.some((f) => ['NO_VALID_TRACK', 'HOUR_OVERFLOW', 'CAMPAIGN_EXPIRED', 'SPOT_NOT_APPROVED'].includes(f));

  return (
    <div className={`rounded-lg border p-4 ${hasErrors ? 'border-destructive/50' : ''}`}>
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">
            {String(hour).padStart(2, '0')}:00
          </h3>
          {templateName && (
            <Badge variant="secondary" className="text-xs">{templateName}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{items.length} items</span>
          <span className="text-muted-foreground/50">|</span>
          <span className={overflow ? 'font-semibold text-destructive' : ''}>
            {Math.floor(totalDuration / 60)}m {totalDuration % 60}s
          </span>
          {conflicts.length > 0 && (
            <Badge variant={hasErrors ? 'destructive' : 'outline'} className="text-xs">
              {conflicts.length} issue{conflicts.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No items — assign a template and generate</p>
        ) : (
          items.map((item) => (
            <RundownItemRow key={item.id} item={item} onReplace={onReplaceItem} />
          ))
        )}
      </div>
    </div>
  );
}
