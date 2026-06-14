import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Stub the drawer to a plain marker so we can detect open/closed via DOM
// without exercising the full drawer (which has its own test).
vi.mock('./VoiceTrackAiDrawer', () => {
  function VoiceTrackAiDrawer({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved?: (track: unknown) => void;
  }) {
    if (!open) return null;
    return (
      <div data-testid="drawer-marker">
        <button
          type="button"
          data-testid="drawer-close"
          onClick={() => onOpenChange(false)}
        >
          close
        </button>
      </div>
    );
  }
  return { VoiceTrackAiDrawer };
});

import { VoiceTrackAiDrawerBridge } from './VoiceTrackAiDrawerBridge';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function mount(): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<VoiceTrackAiDrawerBridge />);
  });
  return { container, root };
}

function unmount({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function fireOpen() {
  act(() => {
    window.dispatchEvent(new CustomEvent('open-vt-ai-drawer'));
  });
}

beforeEach(() => {
  // No setup.
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('VoiceTrackAiDrawerBridge', () => {
  test('VoiceTrackAiDrawerBridge > renders nothing visible until event fires', () => {
    const r = mount();
    expect(document.querySelector('[data-testid="drawer-marker"]')).toBeNull();
    unmount(r);
  });

  test('VoiceTrackAiDrawerBridge > given window dispatches open-vt-ai-drawer > drawer opens', () => {
    const r = mount();

    fireOpen();

    expect(document.querySelector('[data-testid="drawer-marker"]')).not.toBeNull();
    unmount(r);
  });

  test('VoiceTrackAiDrawerBridge > given drawer closes > can re-open on next event', () => {
    const r = mount();

    fireOpen();
    expect(document.querySelector('[data-testid="drawer-marker"]')).not.toBeNull();

    // Trigger the drawer's close.
    const closeBtn = document.querySelector(
      '[data-testid="drawer-close"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="drawer-marker"]')).toBeNull();

    // Fire again — re-opens.
    fireOpen();
    expect(document.querySelector('[data-testid="drawer-marker"]')).not.toBeNull();
    unmount(r);
  });
});
