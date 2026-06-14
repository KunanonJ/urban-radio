import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    message: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Production t() interpolates `{{var}}` from the resolved translation
    // string. Our mock has no translation table, so we surface the vars
    // alongside the key — the component should still pass meaningful values
    // (the underlying error message) and we assert on that.
    t: (key: string, vars?: Record<string, unknown> | string) => {
      if (typeof vars === "string") return key; // default-value overload
      if (vars && typeof vars === "object") {
        const parts: string[] = [key];
        for (const [k, v] of Object.entries(vars)) {
          parts.push(`${k}=${String(v)}`);
        }
        return parts.join(" ");
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/ui/select", () => {
  function passthrough({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  return {
    Select: passthrough,
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectValue: () => null,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

// Mock the station-queries hooks — the component now reads + writes via these.
const useStationMock = vi.fn();
const mutateAsyncMock = vi.fn();
const useUpdateStationMock = vi.fn(() => ({
  mutateAsync: mutateAsyncMock,
  isPending: false,
}));

vi.mock("@/lib/station-queries", () => ({
  useStation: () => useStationMock(),
  useUpdateStation: () => useUpdateStationMock(),
}));

import { StationIdentitySection } from "./StationIdentitySection";

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

const stationFixture = {
  id: "urban-radio",
  orgId: "org-1",
  slug: "urban-radio",
  name: "Urban Radio",
  timezone: "Asia/Bangkok",
  streamUrl: "https://stream.example.com/live",
  language: "en",
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  mutateAsyncMock.mockReset();
  useStationMock.mockReset();
  // Reset and reinstall the default return value so sticky mocks from prior
  // tests do not leak across cases.
  useUpdateStationMock.mockReset();
  useUpdateStationMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  });
  // default: data loaded successfully
  useStationMock.mockReturnValue({
    data: { station: stationFixture },
    isLoading: false,
    error: null,
  });
  mutateAsyncMock.mockResolvedValue({ station: stationFixture });
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe("StationIdentitySection", () => {
  test("renders the section title", () => {
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="station-identity-section-title"]')?.textContent,
    ).toBe("settings.station.title");
  });

  test("renders name, slug, and color inputs prefilled from useStation()", () => {
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    const nameInput = r.container.querySelector(
      '[data-testid="station-identity-name"]',
    ) as HTMLInputElement | null;
    const slugInput = r.container.querySelector(
      '[data-testid="station-identity-slug"]',
    ) as HTMLInputElement | null;
    const colorInput = r.container.querySelector(
      '[data-testid="station-identity-color"]',
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.value).toBe("Urban Radio");
    expect(slugInput).not.toBeNull();
    expect(slugInput!.value).toBe("urban-radio");
    // Slug is read-only (per design — changing it breaks external links).
    expect(slugInput!.readOnly || slugInput!.disabled).toBe(true);
    expect(colorInput).not.toBeNull();
  });

  test("clicking save calls the update mutation with the patch shape and toasts success", async () => {
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    const save = r.container.querySelector(
      '[data-testid="station-identity-save"]',
    ) as HTMLButtonElement | null;
    expect(save).not.toBeNull();
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const patch = mutateAsyncMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // Patch must use camelCase keys matching the API contract.
    expect(patch).toEqual(
      expect.objectContaining({
        name: "Urban Radio",
        timezone: "Asia/Bangkok",
        language: "en",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("settings.station.saveSuccess");
  });

  test("mutation error surfaces a toast.error with the error message", async () => {
    mutateAsyncMock.mockRejectedValue(new Error("Invalid timezone"));
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    const save = r.container.querySelector(
      '[data-testid="station-identity-save"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    // The component must pass the error string through the i18n vars so the
    // operator sees the underlying failure (rather than an opaque template).
    const callArgs = toastError.mock.calls[0];
    // toast.error is called with the *result* of t(key, { error }) — we
    // verify the call was made with a string mentioning the original error.
    const passed = String(callArgs?.[0] ?? "");
    expect(passed).toContain("Invalid timezone");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test("while isLoading > shows a loading state and does not render the form", () => {
    useStationMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    // The form's name input should not be rendered until data lands.
    expect(r.container.querySelector('[data-testid="station-identity-name"]')).toBeNull();
    // A loading marker (any element with this test id) is rendered instead.
    expect(r.container.querySelector('[data-testid="station-identity-loading"]')).not.toBeNull();
  });

  test("save button disabled while mutation pending", () => {
    useUpdateStationMock.mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: true,
    });
    const r = render(<StationIdentitySection />);
    rendered.push(r);
    const save = r.container.querySelector(
      '[data-testid="station-identity-save"]',
    ) as HTMLButtonElement | null;
    expect(save).not.toBeNull();
    expect(save!.disabled).toBe(true);
  });
});
