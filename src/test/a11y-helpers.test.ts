import { describe, expect, test } from 'vitest';
import { expectNoA11yViolations } from './a11y-helpers';

/**
 * Tests for the a11y helper itself. We exercise both paths:
 *   - clean markup passes (the matcher succeeds)
 *   - dirty markup throws (the matcher reports the violation)
 *
 * Markup is built with explicit DOM APIs (no innerHTML) to avoid the
 * security-reminder hook that warns on `innerHTML = …` for untrusted strings.
 */

function makeCleanContainer(): HTMLElement {
  const container = document.createElement('section');
  container.setAttribute('aria-label', 'example');

  const heading = document.createElement('h1');
  heading.textContent = 'Title';
  container.appendChild(heading);

  const para = document.createElement('p');
  para.textContent = 'Paragraph copy.';
  container.appendChild(para);

  const label = document.createElement('label');
  label.setAttribute('for', 'email');
  label.textContent = 'Email';
  container.appendChild(label);

  const input = document.createElement('input');
  input.id = 'email';
  input.type = 'email';
  container.appendChild(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Submit';
  container.appendChild(button);

  document.body.appendChild(container);
  return container;
}

function makeDirtyContainerWithImgNoAlt(): HTMLElement {
  const container = document.createElement('section');
  container.setAttribute('aria-label', 'example');

  const img = document.createElement('img');
  // 1×1 transparent SVG as data URL — no alt attribute on purpose.
  img.src =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=';
  container.appendChild(img);

  document.body.appendChild(container);
  return container;
}

describe('a11y-helpers > expectNoA11yViolations', () => {
  test('given clean markup > resolves without throwing', async () => {
    const container = makeCleanContainer();
    await expect(expectNoA11yViolations(container)).resolves.toBeUndefined();
    container.remove();
  });

  test('given an <img> without alt > rejects with an axe violation', async () => {
    const container = makeDirtyContainerWithImgNoAlt();
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/image-alt/);
    container.remove();
  });
});
