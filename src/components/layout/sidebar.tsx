'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Music,
  Megaphone,
  Clock,
  CalendarDays,
  Radio,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { canAccessRoute } from '@/lib/auth/roles';
import { useUIStore } from '@/lib/store/ui-store';
import { Button } from '@/components/ui/button';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly group: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', href: '/app/dashboard', icon: LayoutDashboard, group: 'Main' },
  { label: 'Tracks', href: '/app/library/tracks', icon: Music, group: 'Music Library' },
  { label: 'Artists', href: '/app/library/artists', icon: Music, group: 'Music Library' },
  { label: 'Albums', href: '/app/library/albums', icon: Music, group: 'Music Library' },
  { label: 'Advertisers', href: '/app/ads/advertisers', icon: Megaphone, group: 'Ad Management' },
  { label: 'Campaigns', href: '/app/ads/campaigns', icon: Megaphone, group: 'Ad Management' },
  { label: 'Clock Templates', href: '/app/clock-templates', icon: Clock, group: 'Scheduling' },
  { label: 'Rundown', href: '/app/rundown', icon: CalendarDays, group: 'Scheduling' },
  { label: 'Operator', href: '/app/operator', icon: Radio, group: 'Operator' },
  { label: 'Reports', href: '/app/reports', icon: BarChart3, group: 'Reports' },
  { label: 'Users', href: '/app/settings/users', icon: Settings, group: 'Settings' },
  { label: 'Station', href: '/app/settings/station', icon: Settings, group: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { role } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => role && canAccessRoute(role, item.href),
  );

  const groups = Array.from(new Set(visibleItems.map((item) => item.group)));

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex h-14 items-center justify-between border-b px-3">
        {!sidebarCollapsed && (
          <span className="text-sm font-semibold">Urban Radio</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            {!sidebarCollapsed && (
              <p className="mb-1 px-2 text-xs font-medium uppercase text-muted-foreground">
                {group}
              </p>
            )}
            {visibleItems
              .filter((item) => item.group === group)
              .map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/app/dashboard' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                      sidebarCollapsed && 'justify-center',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
