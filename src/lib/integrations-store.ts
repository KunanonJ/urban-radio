import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConnectionStatus, SourceType } from '@/lib/types';

type IntegrationOverrides = Partial<Record<SourceType, ConnectionStatus>>;

type IntegrationsState = {
  /** User toggled connection (mock OAuth result). */
  statusBySource: IntegrationOverrides;
  setStatus: (id: SourceType, status: ConnectionStatus) => void;
  toggleConnect: (id: SourceType) => void;
};

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set, get) => ({
      statusBySource: {},
      setStatus: (id, status) =>
        set((s) => ({ statusBySource: { ...s.statusBySource, [id]: status } })),
      toggleConnect: (id) => {
        const cur = get().statusBySource[id];
        const next: ConnectionStatus = cur === 'connected' ? 'not-connected' : 'connected';
        set((s) => ({
          statusBySource: { ...s.statusBySource, [id]: next },
        }));
      },
    }),
    { name: 'sonic-bloom-integrations' }
  )
);
