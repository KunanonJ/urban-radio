"use client";

import type { ReactNode } from "react";

export interface SettingsSectionProps {
  /** Section title rendered as an h2. */
  title: string;
  /** Short description sitting below the title. */
  description?: string;
  /** Section body. */
  children?: ReactNode;
  /** Test id override (default settings-section). */
  testId?: string;
}

/**
 * Generic frame for a settings section — a titled column with a description
 * above the controls. Each section component (StationIdentity, Streams, etc.)
 * renders one of these.
 */
export function SettingsSection({
  title,
  description,
  children,
  testId = "settings-section",
}: SettingsSectionProps) {
  return (
    <section data-testid={testId} className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground" data-testid={`${testId}-title`}>
          {title}
        </h2>
        {description ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`${testId}-description`}
          >
            {description}
          </p>
        ) : null}
      </header>
      {children ? <div className="space-y-4">{children}</div> : null}
    </section>
  );
}
