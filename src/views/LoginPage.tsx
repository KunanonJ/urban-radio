"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Music2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore, isAuthRequired } from "@/lib/auth-store";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, authNotConfigured, checkSession, checked, username: sessionUser } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!isAuthRequired() || !sessionUser) return;
    const raw = searchParams.get("redirect");
    const target = raw ? decodeURIComponent(raw) : "/app";
    router.replace(target);
  }, [router, searchParams, sessionUser]);

  if (isAuthRequired() && !checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-busy>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!isAuthRequired()) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <p className="mb-4 text-muted-foreground">{t("auth.notRequired")}</p>
        <Button asChild>
          <Link href="/app">{t("auth.goToApp")}</Link>
        </Button>
      </div>
    );
  }

  if (isAuthRequired() && authNotConfigured) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">{t("auth.serverNotConfigured")}</p>
        <Button asChild variant="outline">
          <Link href="/app">{t("auth.goToApp")}</Link>
        </Button>
      </div>
    );
  }

  if (isAuthRequired() && sessionUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-busy>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      const raw = searchParams.get("redirect");
      const target = raw ? decodeURIComponent(raw) : "/app";
      router.replace(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <nav className="glass flex h-14 items-center justify-between border-b border-border px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Music2 className="h-4 w-4 text-primary-foreground" />
          </div>
          {t("layout.appName")}
        </Link>
        <LanguageSwitcher compact />
      </nav>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="surface-2 w-full max-w-sm rounded-2xl border border-border p-8 shadow-xl">
          <h1 className="mb-1 text-center text-2xl font-semibold text-foreground">{t("auth.title")}</h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">{t("auth.subtitle")}</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-username">{t("auth.username")}</Label>
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">{t("auth.password")}</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-background"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link href="/" className="underline underline-offset-2 hover:text-foreground">
              {t("auth.backHome")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
