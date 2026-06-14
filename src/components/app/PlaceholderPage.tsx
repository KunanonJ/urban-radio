export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="app-page space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      <p className="surface-1 text-sm text-muted-foreground rounded-lg border border-border p-4">
        Placeholder route — wire real data via Cloudflare Pages Functions + D1
        (<code className="font-mono text-xs">functions/api/*</code>) following the upgrade plan.
      </p>
    </div>
  );
}
