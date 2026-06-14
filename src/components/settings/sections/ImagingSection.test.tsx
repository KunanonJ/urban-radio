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

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ImagingSection } from "./ImagingSection";

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

describe("ImagingSection", () => {
  test("renders the section title", () => {
    const r = render(<ImagingSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="imaging-section-title"]')?.textContent,
    ).toBe("settings.imaging.title");
  });

  test("renders a hotkey legend with kbd elements and deep-links to /app/cart", () => {
    const r = render(<ImagingSection />);
    rendered.push(r);
    const grid = r.container.querySelector('[data-testid="imaging-hotkey-grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll("kbd").length).toBeGreaterThan(0);
    const link = r.container.querySelector('[data-testid="imaging-deep-link"]');
    expect(link?.getAttribute("href")).toBe("/app/cart");
  });
});
