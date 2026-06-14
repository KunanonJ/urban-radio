"use client";

import "@/i18n";
import i18n from "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { I18nLangBridge } from "@/components/I18nLangBridge";
import { ThemeAttributeBridge } from "@/components/ThemeAttributeBridge";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeAttributeBridge />
          <I18nLangBridge />
          <Toaster />
          {children}
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
