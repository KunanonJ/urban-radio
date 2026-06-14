import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  PWA_DISMISSED_STORAGE_KEY,
  hasDismissedInstallPrompt,
  rememberInstallPromptDismissed,
  shouldRegisterSW,
} from "@/lib/pwa";

interface NavWithSW {
  serviceWorker?: unknown;
}

describe("shouldRegisterSW", () => {
  const originalServiceWorker = (navigator as NavWithSW).serviceWorker;

  beforeEach(() => {
    // Most browsers in jsdom don't expose navigator.serviceWorker; inject a
    // stub so we control presence per-test.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: { register: () => Promise.resolve() },
    });
  });

  afterEach(() => {
    if (originalServiceWorker === undefined) {
      delete (navigator as NavWithSW).serviceWorker;
    } else {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        writable: true,
        value: originalServiceWorker,
      });
    }
  });

  test("given NODE_ENV=production and navigator.serviceWorker present > returns true", () => {
    expect(shouldRegisterSW({ NODE_ENV: "production" })).toBe(true);
  });

  test("given NODE_ENV=development > returns false", () => {
    expect(shouldRegisterSW({ NODE_ENV: "development" })).toBe(false);
  });

  test("given NODE_ENV=test > returns false", () => {
    expect(shouldRegisterSW({ NODE_ENV: "test" })).toBe(false);
  });

  test("given NODE_ENV=production but navigator without serviceWorker > returns false", () => {
    delete (navigator as NavWithSW).serviceWorker;
    expect(shouldRegisterSW({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("install prompt dismissal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test("given no prior dismissal > hasDismissedInstallPrompt returns false", () => {
    expect(hasDismissedInstallPrompt()).toBe(false);
  });

  test("given rememberInstallPromptDismissed called > hasDismissedInstallPrompt returns true", () => {
    rememberInstallPromptDismissed();
    expect(window.localStorage.getItem(PWA_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(hasDismissedInstallPrompt()).toBe(true);
  });
});
