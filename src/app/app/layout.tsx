import { AppAuthGate } from "@/components/app/AppAuthGate";
import { AppChrome } from "@/components/AppChrome";

export default function AppSegmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppAuthGate>
      <AppChrome>{children}</AppChrome>
    </AppAuthGate>
  );
}
