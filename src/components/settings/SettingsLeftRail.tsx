"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  Megaphone,
  Palette,
  PlayCircle,
  Plug,
  Radio,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  SETTINGS_ROUTES,
  type SettingsSectionId,
} from "@/lib/settings-routes";

const ICON_MAP: Record<string, LucideIcon> = {
  "radio-tower": RadioTower,
  radio: Radio,
  users: Users,
  plug: Plug,
  megaphone: Megaphone,
  "shield-check": ShieldCheck,
  "sliders-horizontal": SlidersHorizontal,
  "credit-card": CreditCard,
  "play-circle": PlayCircle,
  palette: Palette,
};

function isActive(pathname: string, path: string, sectionId: SettingsSectionId): boolean {
  if (pathname === path) return true;
  // /app/settings (no segment) highlights the default station section.
  if (pathname === "/app/settings" && sectionId === "station") return true;
  return false;
}

export interface SettingsLeftRailProps {
  /** Overrides pathname-based active detection — used by SettingsPage when reading the [section] param. */
  activeSection?: SettingsSectionId;
}

/**
 * Linear-style vertical navigation for the settings page. Sticky on
 * desktop; collapses to a horizontally scrollable strip on mobile.
 */
export function SettingsLeftRail({ activeSection }: SettingsLeftRailProps = {}) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  return (
    <nav
      data-testid="settings-left-rail"
      aria-label={t("settings.title")}
      className="-mx-1 flex flex-shrink-0 flex-row flex-wrap gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:sticky md:top-6 md:mx-0 md:w-56 md:flex-col md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {SETTINGS_ROUTES.map((route) => {
        const Icon = ICON_MAP[route.iconName] ?? Plug;
        const active = activeSection
          ? activeSection === route.id
          : isActive(pathname, route.path, route.id);
        return (
          <button
            key={route.id}
            type="button"
            data-testid={`settings-left-rail-item-${route.id}`}
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => router.push(route.path)}
            className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition-colors md:py-2 ${
              active
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {t(route.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}
