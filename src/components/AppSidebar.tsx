"use client";

import { useTranslation } from "react-i18next";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/lib/layout-store";
import { Music2, ChevronsLeft, ChevronsRight } from "lucide-react";
import { SidebarNav } from "@/components/SidebarNav";

export function AppSidebar() {
  const { t } = useTranslation();
  const iconOnly = useLayoutStore((s) => s.sidebarIconOnly);
  const toggleSidebarIconOnly = useLayoutStore((s) => s.toggleSidebarIconOnly);

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col fixed left-0 top-0 bottom-[var(--player-bar-total)] w-[var(--sidebar-width)] surface-1 border-r border-border z-40",
        "transition-[width] duration-200 ease-out",
      )}
    >
      <div
        className={cn(
          "h-14 flex items-center border-b border-border shrink-0",
          iconOnly ? "justify-center px-2" : "px-5 gap-2.5",
        )}
      >
        <NavLink
          to="/app"
          end
          className={cn("flex items-center gap-2.5 min-w-0", iconOnly ? "justify-center" : "")}
          aria-label={t("nav.stationDashboard")}
        >
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Music2 className="w-4 h-4 text-primary-foreground" />
          </div>
          {!iconOnly && (
            <span className="font-bold text-base tracking-tight text-foreground truncate">
              {t("layout.appName")}
            </span>
          )}
        </NavLink>
      </div>

      <SidebarNav iconOnly={iconOnly} />

      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={() => toggleSidebarIconOnly()}
          className="w-full flex items-center justify-center rounded-lg px-2 py-2 min-h-[44px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-expanded={!iconOnly}
          aria-label={iconOnly ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          title={iconOnly ? t("nav.expandSidebar") : t("nav.iconsOnly")}
        >
          {iconOnly ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
