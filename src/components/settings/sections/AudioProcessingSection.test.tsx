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

import { AudioProcessingSection } from "./AudioProcessingSection";

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

describe("AudioProcessingSection", () => {
  test("renders the section title", () => {
    const r = render(<AudioProcessingSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="audio-section-title"]')?.textContent,
    ).toBe("settings.audio.title");
  });

  test("renders an empty state with the Phase 8 placeholder copy", () => {
    const r = render(<AudioProcessingSection />);
    rendered.push(r);
    const text = r.container.textContent ?? "";
    expect(text).toContain("settings.audio.emptyTitle");
    expect(text).toContain("settings.audio.emptyDescription");
  });
});
