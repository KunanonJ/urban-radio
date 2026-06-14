import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import LoginPage from "@/views/LoginPage";

function LoginFallback() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background" role="status" aria-busy>
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

export default function LoginRoutePage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPage />
    </Suspense>
  );
}
