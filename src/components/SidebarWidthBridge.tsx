"use client";

import { useEffect } from "react";
import { applySidebarWidthToDocument, useLayoutStore } from "@/lib/layout-store";
import { useIsDesktopMd, useIsDesktopXl } from "@/lib/use-media-query";

export function SidebarWidthBridge() {
  const iconOnly = useLayoutStore((s) => s.sidebarIconOnly);
  const isDesktop = useIsDesktopMd();
  const isXl = useIsDesktopXl();

  useEffect(() => {
    applySidebarWidthToDocument(iconOnly, isDesktop, isXl);
  }, [iconOnly, isDesktop, isXl]);

  return null;
}
