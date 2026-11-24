import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFinanceData, type FinanceScope } from '@/lib/finance-api';
import type { FinanceData } from '@/lib/finance';

type Request = { owner: string; scope: FinanceScope; controller?: AbortController };
type Snapshot = { owner: string; scope: FinanceScope; data: FinanceData | null; error: string };

export function useFinanceData(workspaceOwnerId: string | null, scope: FinanceScope) {
  const active = useRef<Request | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    const request = active.current;
    if (!request) return;
    request.controller?.abort();
    const controller = new AbortController();
    request.controller = controller;
    const { owner, scope } = request;
    try {
      const data = await loadFinanceData(owner, scope, controller.signal);
      if (!controller.signal.aborted) setSnapshot({ owner, scope, data, error: '' });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Something went wrong while loading your records.';
      setSnapshot((previous) => ({ owner, scope, data: previous?.owner === owner && previous.scope === scope ? previous.data : null, error: message }));
    }
  }, []);

  useEffect(() => {
    setSnapshot(null);
    if (!workspaceOwnerId) return;
    const request = { owner: workspaceOwnerId, scope } as Request;
    active.current = request;
    void refresh();
    return () => {
      request.controller?.abort();
      active.current = null;
    };
  }, [workspaceOwnerId, scope, refresh]);

  const current = snapshot?.owner === workspaceOwnerId && snapshot.scope === scope ? snapshot : null;
  return { data: current?.data ?? null, loadError: current?.error ?? '', refresh };
}
