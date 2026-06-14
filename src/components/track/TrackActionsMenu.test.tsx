import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// jsdom doesn't ship ResizeObserver or scrollIntoView; Radix's dropdown menu needs both.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??=
  ResizeObserverStub;
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
// Radix dropdown also calls hasPointerCapture / releasePointerCapture on the trigger.
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element !== "undefined" && !Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const pushMock = vi.fn();
const useCatalogArtistsMock = vi.fn();
const useMergedAlbumsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/app/library",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "trackActions.openMenu": "Open menu",
        "trackActions.playNow": "Play now",
        "trackActions.playNext": "Play next",
        "trackActions.willPlayNext": "Will play next",
        "trackActions.queuedTrack": "Queued",
        "trackActions.goToAlbum": "Go to album",
        "trackActions.goToArtist": "Go to artist",
        "tracks.addToQueue": "Add to queue",
        "emptyStates.trackArtists.title": "No artists to attribute",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

vi.mock("@/lib/catalog-queries", () => ({
  useCatalogArtists: () => useCatalogArtistsMock(),
}));

vi.mock("@/lib/library", () => ({
  useMergedAlbums: () => useMergedAlbumsMock(),
}));

// Zustand store: keep behaviour-irrelevant actions as no-op mocks.
vi.mock("@/lib/store", () => {
  const noop = () => {};
  const state = {
    play: noop,
    playAtQueueIndex: noop,
    playNext: noop,
    addToQueue: noop,
  } as const;
  type Selector<T> = (s: typeof state) => T;
  const usePlayerStore = <T,>(selector: Selector<T>) => selector(state);
  return { usePlayerStore };
});

import type { Track, Artist } from "@/lib/types";
import { TrackActionsMenu } from "./TrackActionsMenu";

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderMenu(element: ReactNode): Rendered {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function cleanup({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
  // The Radix dropdown portals content into document.body; sweep leftover portals
  // so they don't bleed into the next test.
  document.querySelectorAll('[role="menu"], [data-radix-popper-content-wrapper]').forEach((el) => el.remove());
}

function openMenu(container: HTMLElement) {
  const trigger = container.querySelector('[data-testid="track-actions-trigger"]');
  if (!trigger) throw new Error("trigger not found");
  // Radix DropdownMenu opens on pointerdown; jsdom uses MouseEvent.
  act(() => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

function findMenuItemByText(text: string): HTMLElement | null {
  const items = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
  return items.find((el) => (el.textContent ?? "").includes(text)) ?? null;
}

const trackFixture: Track = {
  id: "t-1",
  title: "Celestial Highway",
  artist: "Midnight Waves",
  artistId: "a1",
  album: "Infinite Loop",
  albumId: "al1",
  duration: 200,
  artwork: "https://example.com/a.jpg",
  source: "local",
  genre: "Electronic",
  year: 2024,
  trackNumber: 1,
};

const artistFixtures: Artist[] = [
  {
    id: "a1",
    name: "Midnight Waves",
    artwork: "https://example.com/a1.jpg",
    genres: ["Electronic"],
    albumCount: 1,
    trackCount: 1,
  },
  {
    id: "a2",
    name: "Solar Drift",
    artwork: "https://example.com/a2.jpg",
    genres: ["Synthwave"],
    albumCount: 1,
    trackCount: 1,
  },
];

const renderedRefs: Rendered[] = [];

beforeEach(() => {
  pushMock.mockReset();
  useCatalogArtistsMock.mockReset();
  useMergedAlbumsMock.mockReset();
  useMergedAlbumsMock.mockReturnValue([]);
});

afterEach(() => {
  while (renderedRefs.length > 0) {
    const r = renderedRefs.pop();
    if (r) cleanup(r);
  }
});

describe("TrackActionsMenu", () => {
  test('given API returns no artists > "Go to artist" submenu shows "No artists to attribute" disabled item', () => {
    useCatalogArtistsMock.mockReturnValue({ data: [] });

    const r = renderMenu(<TrackActionsMenu track={trackFixture} />);
    renderedRefs.push(r);
    openMenu(r.container);

    // Empty-state item appears, marked disabled (Radix sets data-disabled / aria-disabled).
    const emptyItem = findMenuItemByText("No artists to attribute");
    expect(emptyItem).not.toBeNull();
    expect(
      emptyItem?.hasAttribute("data-disabled") || emptyItem?.getAttribute("aria-disabled") === "true",
    ).toBe(true);

    // "Go to artist" should NOT render — there's no artist to navigate to.
    expect(findMenuItemByText("Go to artist")).toBeNull();

    // Clicking the disabled item must not navigate.
    act(() => {
      emptyItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test('given API returns 2 artists > "Go to artist" submenu shows 2 items, both clickable', () => {
    useCatalogArtistsMock.mockReturnValue({ data: artistFixtures });

    const r = renderMenu(<TrackActionsMenu track={trackFixture} />);
    renderedRefs.push(r);
    openMenu(r.container);

    // Empty-state item must not appear.
    expect(findMenuItemByText("No artists to attribute")).toBeNull();

    // The track-specific "Go to artist" item renders and is enabled.
    const goItem = findMenuItemByText("Go to artist");
    expect(goItem).not.toBeNull();
    expect(goItem?.hasAttribute("data-disabled")).toBe(false);
    expect(goItem?.getAttribute("aria-disabled") === "true").toBe(false);
  });

  test("given clicking an artist item > pushes /app/artist/:id", () => {
    useCatalogArtistsMock.mockReturnValue({ data: artistFixtures });

    const r = renderMenu(<TrackActionsMenu track={trackFixture} />);
    renderedRefs.push(r);
    openMenu(r.container);

    const goItem = findMenuItemByText("Go to artist");
    expect(goItem).not.toBeNull();

    act(() => {
      goItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith(`/app/artist/${trackFixture.artistId}`);
  });
});
