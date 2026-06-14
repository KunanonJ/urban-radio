import { afterEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/app/settings",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/ui/select", () => {
  function passthrough({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  return {
    Select: passthrough,
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectValue: () => null,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

// Stub heavyweight sub-trees so the page test stays focused on routing.
vi.mock("@/views/app/SettingsPlayback", () => ({
  SettingsPlayback: () => <div data-testid="settings-playback-stub">playback</div>,
}));

vi.mock("@/components/settings/sections/IntegrationsSection", () => ({
  IntegrationsSection: () => <div data-testid="integrations-section-stub">integrations</div>,
}));

vi.mock("@/components/settings/sections/StreamsSection", () => ({
  StreamsSection: () => <div data-testid="streams-section-stub">streams</div>,
}));

vi.mock("@/components/CloudUploadPanel", () => ({
  CloudUploadPanel: () => <div data-testid="cloud-upload-panel-stub" />,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="lang-switcher-stub" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// The StationIdentitySection now reads from /api/stations/me via TanStack.
// We stub the hooks so the SettingsPage tests do not need a QueryClient.
vi.mock("@/lib/station-queries", () => ({
  useStation: () => ({
    data: {
      station: {
        id: "urban-radio",
        orgId: "org-1",
        slug: "urban-radio",
        name: "Urban Radio",
        timezone: "Asia/Bangkok",
        streamUrl: null,
        language: "en",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    isLoading: false,
    error: null,
  }),
  useUpdateStation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ station: {} }),
    isPending: false,
  }),
}));

import { SettingsPage } from "./SettingsPage";

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: ReactNode): Rendered {
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

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe("SettingsPage", () => {
  test("renders the left rail and a section content slot", () => {
    const r = render(<SettingsPage />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="settings-left-rail"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="settings-page-content"]')).not.toBeNull();
  });

  test("when no section is provided > the station section is active by default", () => {
    const r = render(<SettingsPage />);
    rendered.push(r);
    const content = r.container.querySelector('[data-testid="settings-page-content"]');
    expect(content?.getAttribute("data-active-section")).toBe("station");
    expect(r.container.querySelector('[data-testid="station-identity-section"]')).not.toBeNull();
  });

  test("given section='billing' > renders the billing section", () => {
    const r = render(<SettingsPage section="billing" />);
    rendered.push(r);
    const content = r.container.querySelector('[data-testid="settings-page-content"]');
    expect(content?.getAttribute("data-active-section")).toBe("billing");
    expect(r.container.querySelector('[data-testid="billing-section"]')).not.toBeNull();
  });

  test("given section='integrations' > delegates to the IntegrationsSection wrapper", () => {
    const r = render(<SettingsPage section="integrations" />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="integrations-section-stub"]')).not.toBeNull();
  });

  test("given an unknown section > renders the not-found empty state and falls back the rail to default", () => {
    const r = render(<SettingsPage section="nope" />);
    rendered.push(r);
    const content = r.container.querySelector('[data-testid="settings-page-content"]');
    expect(content?.getAttribute("data-active-section")).toBe("station");
    const text = r.container.textContent ?? "";
    expect(text).toContain("settings.notFound.title");
  });

  test("given section='playback' > delegates to the SettingsPlayback subtree", () => {
    const r = render(<SettingsPage section="playback" />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="settings-playback-stub"]')).not.toBeNull();
  });
});
