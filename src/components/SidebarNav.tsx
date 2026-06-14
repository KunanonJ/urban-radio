"use client";

import { useMemo, type ReactNode, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Search,
  Library,
  ListMusic,
  Settings,
  Music2,
  Disc3,
  Users,
  Radio,
  Sparkles,
  CalendarClock,
  ShoppingCart,
  Mic2,
  Megaphone,
  CircleHelp,
  Clock,
} from "lucide-react";

const navBtn = (iconOnly: boolean) =>
  cn(
    "flex items-center rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors min-h-[44px]",
    iconOnly ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
  );

function NavSection({
  label,
  iconOnly,
  children,
}: {
  label: string;
  iconOnly: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {!iconOnly && (
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      )}
      {iconOnly && <div className="mx-2 mb-2 h-px bg-border" aria-hidden />}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export type SidebarNavProps = {
  iconOnly: boolean;
  onNavigate?: () => void;
  className?: string;
};

export function SidebarNav({ iconOnly, onNavigate, className }: SidebarNavProps) {
  const { t } = useTranslation();

  const stationNav = useMemo(
    () => [{ title: t("nav.stationDashboard"), url: "/app", icon: LayoutDashboard }],
    [t],
  );

  const playbackNav = useMemo(
    () =>
      [
        { title: t("nav.search"), url: "/app/search", icon: Search },
        { title: t("nav.queue"), url: "/app/queue", icon: ListMusic },
        { title: t("nav.nowPlaying"), url: "/app/now-playing", icon: Radio },
      ] as const,
    [t],
  );

  const libraryNav = useMemo(
    () =>
      [
        { title: t("nav.recentlyAdded"), url: "/app/library/recently-added", icon: Clock },
        { title: t("nav.tracks"), url: "/app/library/tracks", icon: Music2 },
        { title: t("nav.albums"), url: "/app/library/albums", icon: Disc3 },
        { title: t("nav.artists"), url: "/app/library/artists", icon: Users },
        { title: t("nav.playlists"), url: "/app/library/playlists", icon: Library },
      ] as const,
    [t],
  );

  const spotsNav = useMemo(
    () => [{ title: t("nav.spotSchedule"), url: "/app/spot-schedule", icon: Megaphone }],
    [t],
  );

  const toolsNav = useMemo(
    () =>
      [
        { title: t("nav.automation"), url: "/app/automation", icon: CalendarClock },
        { title: t("nav.cart"), url: "/app/cart", icon: ShoppingCart },
        { title: t("nav.broadcast"), url: "/app/broadcast", icon: Mic2 },
        { title: t("nav.generator"), url: "/app/library/generator", icon: Sparkles },
      ] as const,
    [t],
  );

  const wrapNavigate = onNavigate ?? (() => {});

  const renderLinks = (
    items: readonly { title: string; url: string; icon: ComponentType<{ className?: string }> }[],
  ) =>
    items.map((item) => (
      <NavLink
        key={item.url}
        to={item.url}
        end={item.url === "/app"}
        title={iconOnly ? item.title : undefined}
        aria-label={iconOnly ? item.title : undefined}
        className={navBtn(iconOnly)}
        activeClassName="!text-foreground !bg-secondary font-medium"
        onClick={wrapNavigate}
      >
        <item.icon className="w-4 h-4 shrink-0" />
        {!iconOnly && <span>{item.title}</span>}
      </NavLink>
    ));

  return (
    <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden py-4 px-3 space-y-6", className)}>
      <NavSection label={t("nav.sectionStation")} iconOnly={iconOnly}>
        {renderLinks(stationNav)}
      </NavSection>

      <NavSection label={t("nav.sectionPlayback")} iconOnly={iconOnly}>
        {renderLinks(playbackNav)}
      </NavSection>

      <NavSection label={t("nav.sectionLibrary")} iconOnly={iconOnly}>
        {renderLinks(libraryNav)}
      </NavSection>

      <NavSection label={t("nav.sectionSpots")} iconOnly={iconOnly}>
        {renderLinks(spotsNav)}
      </NavSection>

      <NavSection label={t("nav.sectionTools")} iconOnly={iconOnly}>
        {renderLinks(toolsNav)}
      </NavSection>

      <NavSection label={t("nav.sectionHelp")} iconOnly={iconOnly}>
        <NavLink
          to="/app/how-to-use"
          title={iconOnly ? t("nav.howToUse") : undefined}
          aria-label={iconOnly ? t("nav.howToUse") : undefined}
          className={navBtn(iconOnly)}
          activeClassName="!text-foreground !bg-secondary font-medium"
          onClick={wrapNavigate}
        >
          <CircleHelp className="w-4 h-4 shrink-0" />
          {!iconOnly && <span>{t("nav.howToUse")}</span>}
        </NavLink>
        <NavLink
          to="/app/settings"
          title={iconOnly ? t("nav.settings") : undefined}
          aria-label={iconOnly ? t("nav.settings") : undefined}
          className={navBtn(iconOnly)}
          activeClassName="!text-foreground !bg-secondary font-medium"
          onClick={wrapNavigate}
        >
          <Settings className="w-4 h-4 shrink-0" />
          {!iconOnly && <span>{t("nav.settings")}</span>}
        </NavLink>
      </NavSection>
    </nav>
  );
}
