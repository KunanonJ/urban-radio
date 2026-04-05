'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/context';
import { QueryProvider } from './query-provider';
import { Toaster } from '@/components/ui/sonner';

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </QueryProvider>
  );
}
