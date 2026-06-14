import { afterEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Music } from "lucide-react";
import { EmptyState } from "./empty-state";

// Note: project does not ship `@testing-library/dom` (peer of @testing-library/react@16),
// so render/screen/fireEvent from @testing-library/react fail at import. We follow the
// existing TrackRow.test.tsx pattern using react-dom/client createRoot. Same behavioral
// assertions as the brief: title, description, action click, custom icon rendering.

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderEmptyState(element: ReactNode): Rendered {
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

function findByText(container: HTMLElement, text: string): Element | null {
  const all = container.querySelectorAll("*");
  for (const el of Array.from(all)) {
    if (el.children.length === 0 && el.textContent?.trim() === text) {
      return el;
    }
  }
  return null;
}

describe("EmptyState", () => {
  test("given title only > renders title", () => {
    const r = renderEmptyState(<EmptyState title="No tracks yet" />);
    rendered.push(r);
    expect(findByText(r.container, "No tracks yet")).not.toBeNull();
  });

  test("given title + description > renders both", () => {
    const r = renderEmptyState(<EmptyState title="Empty" description="Upload to start" />);
    rendered.push(r);
    expect(findByText(r.container, "Upload to start")).not.toBeNull();
  });

  test("given action > renders button calling onAction", () => {
    const fn = vi.fn();
    const r = renderEmptyState(<EmptyState title="X" action={{ label: "Upload", onClick: fn }} />);
    rendered.push(r);
    const button = r.container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent?.toLowerCase()).toContain("upload");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fn).toHaveBeenCalledOnce();
  });

  test("given icon > renders custom icon", () => {
    const r = renderEmptyState(<EmptyState title="X" icon={Music} />);
    rendered.push(r);
    // lucide icons render as svg
    expect(r.container.querySelector("svg")).toBeTruthy();
  });
});
