import { AppProviders } from '@/components/providers/app-providers';
import { RequireAuth } from '@/lib/auth/guards';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AudioPlayerBar } from '@/components/shared/audio-player-bar';

export default function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <RequireAuth>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-6 pb-20">{children}</main>
          </div>
        </div>
        <AudioPlayerBar />
      </RequireAuth>
    </AppProviders>
  );
}
