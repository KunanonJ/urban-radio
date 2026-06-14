import { PackageOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: EmptyStateAction;
  className?: string;
}

function EmptyState({ title, description, icon: Icon = PackageOpen, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "surface-1 flex flex-col items-center justify-center gap-3 rounded-lg border border-border/40 px-6 py-12 text-center",
        className,
      )}
    >
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold leading-tight tracking-tight">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Button variant="default" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps, EmptyStateAction };
