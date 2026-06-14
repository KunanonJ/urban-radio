'use client';

import { useEffect, useState } from 'react';

/** After mount, true. Use so playback `progress` matches SSR (avoids RAF drift before hydration). */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
