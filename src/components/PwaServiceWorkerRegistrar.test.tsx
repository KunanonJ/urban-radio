import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PwaServiceWorkerRegistrar } from "@/components/PwaServiceWorkerRegistrar";

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

interface NavWithSW {
  serviceWorker?: { register: (url: string) => Promise<unknown> };
}

const originalServiceWorker = (navigator as NavWithSW).serviceWorker;
const registerMock = vi.fn(() => Promise.resolve({}));

function stubServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: { register: registerMock },
  });
}

function restoreServiceWorker() {
  if (originalServiceWorker === undefined) {
    delete (navigator as NavWithSW).serviceWorker;
  } else {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: originalServiceWorker,
    });
  }
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PwaServiceWorkerRegistrar />);
  });
  return { container, root };
}

function unmount(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  registerMock.mockClear();
  stubServiceWorker();
});

afterEach(() => {
  restoreServiceWorker();
  vi.unstubAllEnvs();
});

describe("PwaServiceWorkerRegistrar", () => {
  test("renders nothing (null)", () => {
    // dev env keeps the effect a no-op while we assert the render output.
    vi.stubEnv("NODE_ENV", "development");
    const { container, root } = mount();
    expect(container.innerHTML).toBe("");
    unmount(container, root);
  });

  test("given production env with serviceWorker support > registers /sw.js", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container, root } = mount();
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith("/sw.js");
    unmount(container, root);
  });

  test("given non-production env > does NOT register", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { container, root } = mount();
    expect(registerMock).not.toHaveBeenCalled();
    unmount(container, root);
  });
});
