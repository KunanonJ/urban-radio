import { afterEach, describe, expect, test } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SettingsSection } from "./SettingsSection";

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderSection(element: ReactNode): Rendered {
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

describe("SettingsSection", () => {
  test("given title only > renders title and no description node", () => {
    const r = renderSection(<SettingsSection title="Station" />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="settings-section-title"]')?.textContent,
    ).toBe("Station");
    expect(
      r.container.querySelector('[data-testid="settings-section-description"]'),
    ).toBeNull();
  });

  test("given title + description + children > renders all three", () => {
    const r = renderSection(
      <SettingsSection title="Streams" description="Encoders + mount points">
        <button type="button" data-testid="child-control">
          Toggle
        </button>
      </SettingsSection>,
    );
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="settings-section-title"]')?.textContent,
    ).toBe("Streams");
    expect(
      r.container.querySelector('[data-testid="settings-section-description"]')?.textContent,
    ).toBe("Encoders + mount points");
    expect(r.container.querySelector('[data-testid="child-control"]')).not.toBeNull();
  });

  test("given a custom testId > applies it to the wrapper and descendants", () => {
    const r = renderSection(
      <SettingsSection testId="station-section" title="Station" description="desc" />,
    );
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="station-section"]')).not.toBeNull();
    expect(
      r.container.querySelector('[data-testid="station-section-title"]')?.textContent,
    ).toBe("Station");
    expect(
      r.container.querySelector('[data-testid="station-section-description"]')?.textContent,
    ).toBe("desc");
  });
});
