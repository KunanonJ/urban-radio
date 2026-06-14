import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SETTINGS_ROUTES } from "@/lib/settings-routes";

const pushMock = vi.fn();
let pathnameValue = "/app/settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameValue,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

import { SettingsLeftRail } from "./SettingsLeftRail";

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderRail(element: ReactNode): Rendered {
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
}

const rendered: Rendered[] = [];

beforeEach(() => {
  pushMock.mockReset();
  pathnameValue = "/app/settings";
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe("SettingsLeftRail", () => {
  test("renders every section in the catalog as a button", () => {
    const r = renderRail(<SettingsLeftRail />);
    rendered.push(r);
    for (const route of SETTINGS_ROUTES) {
      const item = r.container.querySelector(
        `[data-testid="settings-left-rail-item-${route.id}"]`,
      );
      expect(item).not.toBeNull();
    }
  });

  test("when pathname is /app/settings (no segment), the station section is marked active", () => {
    pathnameValue = "/app/settings";
    const r = renderRail(<SettingsLeftRail />);
    rendered.push(r);
    const station = r.container.querySelector('[data-testid="settings-left-rail-item-station"]');
    const billing = r.container.querySelector('[data-testid="settings-left-rail-item-billing"]');
    expect(station?.getAttribute("data-active")).toBe("true");
    expect(billing?.getAttribute("data-active")).toBeNull();
  });

  test("when pathname matches a section path > only that section is active", () => {
    pathnameValue = "/app/settings/billing";
    const r = renderRail(<SettingsLeftRail />);
    rendered.push(r);
    const station = r.container.querySelector('[data-testid="settings-left-rail-item-station"]');
    const billing = r.container.querySelector('[data-testid="settings-left-rail-item-billing"]');
    expect(billing?.getAttribute("data-active")).toBe("true");
    expect(billing?.getAttribute("aria-current")).toBe("page");
    expect(station?.getAttribute("data-active")).toBeNull();
  });

  test("given activeSection prop > overrides pathname-based detection", () => {
    pathnameValue = "/app/settings/station"; // would normally activate station
    const r = renderRail(<SettingsLeftRail activeSection="audio" />);
    rendered.push(r);
    const audio = r.container.querySelector('[data-testid="settings-left-rail-item-audio"]');
    const station = r.container.querySelector('[data-testid="settings-left-rail-item-station"]');
    expect(audio?.getAttribute("data-active")).toBe("true");
    expect(station?.getAttribute("data-active")).toBeNull();
  });

  test("given a section button is clicked > router.push is called with that section path", () => {
    const r = renderRail(<SettingsLeftRail />);
    rendered.push(r);
    const talent = r.container.querySelector(
      '[data-testid="settings-left-rail-item-talent"]',
    ) as HTMLButtonElement | null;
    expect(talent).not.toBeNull();
    act(() => {
      talent?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pushMock).toHaveBeenCalledWith("/app/settings/talent");
  });
});
