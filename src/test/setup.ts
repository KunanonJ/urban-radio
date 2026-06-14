import "@testing-library/jest-dom";

// Some suites (e.g. server-side route handler tests that use `jose` under
// `@vitest-environment node`) run without a DOM. Guard window-only setup so
// the setup file is universal.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
