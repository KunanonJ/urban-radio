import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PWA_DISMISSED_STORAGE_KEY } from "@/lib/pwa";

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PwaInstallPrompt />);
  });
  return { container, root };
}

function unmount(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

interface FakePromptInit {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function createFakePromptEvent({ prompt, userChoice }: FakePromptInit): Event {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  // The deferred prompt event carries extra methods; we attach them onto the
  // Event instance so the component can call them.
  Object.assign(event, { prompt, userChoice });
  return event;
}

function dispatchPromptEvent(event: Event) {
  act(() => {
    window.dispatchEvent(event);
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("PwaInstallPrompt", () => {
  test("renders nothing initially (before beforeinstallprompt fires)", () => {
    const { container, root } = mount();
    expect(
      document.querySelector('[data-testid="pwa-install-prompt"]'),
    ).toBeNull();
    unmount(container, root);
  });

  test("given beforeinstallprompt event > shows banner with Install + Dismiss buttons", () => {
    const { container, root } = mount();

    dispatchPromptEvent(
      createFakePromptEvent({
        prompt: vi.fn(() => Promise.resolve()),
        userChoice: Promise.resolve({
          outcome: "accepted",
          platform: "web",
        }),
      }),
    );

    expect(
      document.querySelector('[data-testid="pwa-install-prompt"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="pwa-install-button"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="pwa-dismiss-button"]'),
    ).not.toBeNull();

    unmount(container, root);
  });

  test("given Install button clicked > calls prompt() on deferred event", async () => {
    const { container, root } = mount();
    const promptMock = vi.fn(() => Promise.resolve());
    dispatchPromptEvent(
      createFakePromptEvent({
        prompt: promptMock,
        userChoice: Promise.resolve({
          outcome: "accepted",
          platform: "web",
        }),
      }),
    );

    const button = document.querySelector(
      '[data-testid="pwa-install-button"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });

    expect(promptMock).toHaveBeenCalledTimes(1);
    unmount(container, root);
  });

  test("given Dismiss button clicked > writes localStorage marker and hides banner", () => {
    const { container, root } = mount();
    dispatchPromptEvent(
      createFakePromptEvent({
        prompt: vi.fn(() => Promise.resolve()),
        userChoice: Promise.resolve({
          outcome: "dismissed",
          platform: "web",
        }),
      }),
    );

    const dismiss = document.querySelector(
      '[data-testid="pwa-dismiss-button"]',
    ) as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();

    act(() => {
      dismiss?.click();
    });

    expect(window.localStorage.getItem(PWA_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(
      document.querySelector('[data-testid="pwa-install-prompt"]'),
    ).toBeNull();

    unmount(container, root);
  });

  test("given user previously dismissed > banner stays hidden even on beforeinstallprompt", () => {
    window.localStorage.setItem(PWA_DISMISSED_STORAGE_KEY, "1");
    const { container, root } = mount();
    dispatchPromptEvent(
      createFakePromptEvent({
        prompt: vi.fn(() => Promise.resolve()),
        userChoice: Promise.resolve({
          outcome: "accepted",
          platform: "web",
        }),
      }),
    );

    expect(
      document.querySelector('[data-testid="pwa-install-prompt"]'),
    ).toBeNull();
    unmount(container, root);
  });
});
