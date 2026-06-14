import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

// Capture-and-replay broadcast store mock. We let real callers selectors run
// against a small in-memory state so the read-only mirror's tests don't have
// to import the actual zustand store.
let mockState = {
  isOnAir: false,
  streamMount: "/stream",
  encoderStatus: "idle" as "idle" | "streaming" | "connecting" | "error",
};
vi.mock("@/lib/broadcast-store", () => ({
  useBroadcastStore: <T,>(selector: (s: typeof mockState) => T): T => selector(mockState),
}));

import { StreamsSection } from "./StreamsSection";

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

beforeEach(() => {
  mockState = { isOnAir: false, streamMount: "/stream", encoderStatus: "idle" };
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe("StreamsSection", () => {
  test("renders the section title", () => {
    const r = render(<StreamsSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="streams-section-title"]')?.textContent,
    ).toBe("settings.streams.title");
  });

  test("when not on air > shows the negated on-air label and current mount", () => {
    mockState = { isOnAir: false, streamMount: "/stream", encoderStatus: "idle" };
    const r = render(<StreamsSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="streams-on-air"]')?.textContent,
    ).toBe("settings.streams.onAirNo");
    expect(
      r.container.querySelector('[data-testid="streams-mount"]')?.textContent,
    ).toBe("/stream");
  });

  test("when on air > shows the on-air label and streaming status", () => {
    mockState = { isOnAir: true, streamMount: "/live", encoderStatus: "streaming" };
    const r = render(<StreamsSection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="streams-on-air"]')?.textContent,
    ).toBe("settings.streams.onAirYes");
    expect(
      r.container.querySelector('[data-testid="streams-status"]')?.textContent,
    ).toBe("streaming");
  });

  test("renders a deep-link to /app/broadcast", () => {
    const r = render(<StreamsSection />);
    rendered.push(r);
    const link = r.container.querySelector('[data-testid="streams-deep-link"]');
    expect(link?.getAttribute("href")).toBe("/app/broadcast");
  });
});
