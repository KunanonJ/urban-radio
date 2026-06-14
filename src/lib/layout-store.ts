import { create } from "zustand";

/** When `isDesktop` is false, main content is full width (mobile drawer replaces sidebar). */
export function applySidebarWidthToDocument(iconOnly: boolean, isDesktop = true, isXl = false) {
  if (typeof document === "undefined") return;
  if (!isDesktop) {
    document.documentElement.style.setProperty("--sidebar-width", "0px");
    return;
  }
  if (iconOnly) {
    document.documentElement.style.setProperty("--sidebar-width", "4.5rem");
    return;
  }
  document.documentElement.style.setProperty("--sidebar-width", isXl ? "18rem" : "16rem");
}

type LayoutState = {
  sidebarIconOnly: boolean;
  setSidebarIconOnly: (iconOnly: boolean) => void;
  toggleSidebarIconOnly: () => void;
};

/** Non-persisted for SSR simplicity; add `persist` when you want parity with Vite localStorage. */
export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarIconOnly: false,
  setSidebarIconOnly: (iconOnly) => set({ sidebarIconOnly: iconOnly }),
  toggleSidebarIconOnly: () => set((s) => ({ sidebarIconOnly: !s.sidebarIconOnly })),
}));
