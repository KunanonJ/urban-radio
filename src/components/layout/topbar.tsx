'use client';

import { UserMenu } from '@/features/auth/components/user-menu';

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Station Dashboard
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}
