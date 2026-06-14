"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarClock,
  Clock,
  FileClock,
  Headphones,
  Library,
  ListMusic,
  Megaphone,
  Mic,
  Mic2,
  Radio,
  Search,
  Settings,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type PaletteAction = {
  id: string;
  labelKey: string;
  path: string;
  icon: LucideIcon;
};

// All target routes verified to exist under src/app/app/. Edit here, not in tests.
const ACTIONS: readonly PaletteAction[] = [
  { id: "library", labelKey: "commandPalette.go.library", path: "/app/library/tracks", icon: Library },
  { id: "clocks", labelKey: "commandPalette.go.clocks", path: "/app/clocks", icon: Clock },
  { id: "schedule", labelKey: "commandPalette.go.schedule", path: "/app/schedule", icon: CalendarClock },
  { id: "liveStudio", labelKey: "commandPalette.go.liveStudio", path: "/app/live-studio", icon: Headphones },
  { id: "voiceTracks", labelKey: "commandPalette.go.voiceTracks", path: "/app/voice-tracks", icon: Mic },
  { id: "reports", labelKey: "commandPalette.go.reports", path: "/app/reports", icon: BarChart3 },
  { id: "auditLog", labelKey: "commandPalette.go.auditLog", path: "/app/audit-log", icon: FileClock },
  { id: "queue", labelKey: "commandPalette.go.queue", path: "/app/queue", icon: ListMusic },
  { id: "search", labelKey: "commandPalette.go.search", path: "/app/search", icon: Search },
  { id: "nowPlaying", labelKey: "commandPalette.go.nowPlaying", path: "/app/now-playing", icon: Radio },
  { id: "cart", labelKey: "commandPalette.go.cart", path: "/app/cart", icon: ShoppingCart },
  { id: "broadcast", labelKey: "commandPalette.go.broadcast", path: "/app/broadcast", icon: Mic2 },
  { id: "spotSchedule", labelKey: "commandPalette.go.spotSchedule", path: "/app/spot-schedule", icon: Megaphone },
  { id: "settings", labelKey: "commandPalette.go.settings", path: "/app/settings", icon: Settings },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    // Capture phase + stopImmediatePropagation so we claim Cmd/Ctrl+K ahead of
    // GlobalSearch's bubble-phase listener (we can't edit GlobalSearch).
    const handler = (event: KeyboardEvent) => {
      const isToggle =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "k";

      if (isToggle) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen((prev) => !prev);
        return;
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
    };
  }, []);

  const runAction = useCallback(
    (path: string) => {
      router.push(path);
      setOpen(false);
    },
    [router],
  );

  const items = useMemo(
    () =>
      ACTIONS.map((action) => ({
        ...action,
        label: t(action.labelKey),
      })),
    [t],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("commandPalette.title")}>
      <CommandInput placeholder={t("commandPalette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("commandPalette.noResults")}</CommandEmpty>
        <CommandGroup>
          {items.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                value={action.label}
                onSelect={() => runAction(action.path)}
              >
                <Icon className="mr-2 h-4 w-4" aria-hidden />
                <span>{action.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
