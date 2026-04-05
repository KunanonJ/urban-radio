import { cn } from '@/lib/utils';

interface FulfillmentMeterProps {
  readonly contracted: number;
  readonly played: number;
  readonly label?: string;
}

export function FulfillmentMeter({ contracted, played, label }: FulfillmentMeterProps) {
  const pct = contracted > 0 ? Math.min((played / contracted) * 100, 100) : 0;
  const isOverdelivered = played > contracted;

  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isOverdelivered ? 'bg-amber-500' : pct >= 90 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="min-w-[4rem] text-right text-xs tabular-nums">
          {played}/{contracted}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {Math.round(pct)}% fulfilled
        {isOverdelivered && ' (over-delivered)'}
      </p>
    </div>
  );
}
