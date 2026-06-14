import { afterEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Stub out the existing integrations UI so this test stays focused on the
// section frame + delegation. The full SettingsIntegrations UI is covered
// by the existing SettingsPage tests / page-level tests.
vi.mock("@/views/app/SettingsPage", () => ({
  SettingsIntegrations: () => <div data-testid="integrations-inner">inner</div>,
}));

import { IntegrationsSection } from "./IntegrationsSection";

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

describe("IntegrationsSection", () => {
  test("renders the section title", () => {
    const r = render(<IntegrationsSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="integrations-section-title"]')?.textContent,
    ).toBe("settings.integrations");
  });

  test("delegates to the existing SettingsIntegrations component", () => {
    const r = render(<IntegrationsSection />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="integrations-inner"]')).not.toBeNull();
  });
});
