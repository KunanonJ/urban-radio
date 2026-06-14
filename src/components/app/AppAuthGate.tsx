"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthStore, isAuthRequired } from "@/lib/auth-store";

function fullPath(pathname: string) {
  if (typeof window === "undefined") return pathname;
  const q = window.location.search;
  return `${pathname}${q || ""}`;
}

export function AppAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { username, checked, authNotConfigured, checkSession } = useAuthStore();

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!isAuthRequired() || authNotConfigured || !checked || username) return;
    router.replace(`/login?redirect=${encodeURIComponent(fullPath(pathname))}`);
  }, [authNotConfigured, checked, pathname, router, username]);

  if (!isAuthRequired()) {
    return <>{children}</>;
  }

  if (authNotConfigured) {
    return <>{children}</>;
  }

  if (!checked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background" role="status" aria-busy>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!username) {
    return null;
  }

  return <>{children}</>;
}
